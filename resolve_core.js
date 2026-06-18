/** Hostname → IP (Firefox: system DNS via browser.dns; Chrome: DoH) and IP → country; service worker only (importScripts). */

(function () {
  const DOH_QUAD9 = "https://dns.quad9.net/dns-query";
  const DOH_OPENDNS = "https://doh.opendns.com/dns-query";
  const DOH_ADGUARD = "https://dns.adguard-dns.com/dns-query";
  const DOH_CF = "https://cloudflare-dns.com/dns-query";
  const DOH_1111 = "https://1.1.1.1/dns-query";

  const GEO_IPINFO = "https://ipinfo.io";
  const GEO_IPWHO = "https://ipwho.is";
  const GEO_REALLY_FREE = "https://reallyfreegeoip.org/json";
  const GEO_IPAPI = "https://ipapi.co";
  const GEO_GEOJS = "https://get.geojs.io/v1/ip/geo";
  const GEO_IPAPI_HTTP = "http://ip-api.com/json";

  const IPV4_RE =
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,3})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,3})$/;

  function isLocalHostname(hostname) {
    const h = hostname.toLowerCase();
    return (
      h === "localhost" ||
      h.endsWith(".localhost") ||
      h === "127.0.0.1" ||
      h === "::1"
    );
  }

  function isUnsupportedPage(protocol, hostname) {
    const p = (protocol || "").toLowerCase();
    if (!hostname && p !== "file:") return true;
    if (
      p === "chrome:" ||
      p === "chrome-extension:" ||
      p === "edge:" ||
      p === "moz-extension:" ||
      p === "about:"
    ) {
      return true;
    }
    if (!hostname && p === "file:") return false;
    return false;
  }

  function isLiteralIp(hostname) {
    if (!hostname) return null;
    if (IPV4_RE.test(hostname)) return "v4";
    if (hostname.includes(":")) return "v6";
    return null;
  }

  /**
   * RFC1918, loopback, link-local, ULA, CGNAT — treat like "local network" for UI.
   * @param {string} ip
   */
  function isPrivateLanIp(ip) {
    if (!ip || typeof ip !== "string") return false;
    const s = ip.trim();
    const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const a = +v4[1];
      const b = +v4[2];
      const c = +v4[3];
      const d = +v4[4];
      if (a > 255 || b > 255 || c > 255 || d > 255) return false;
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      return false;
    }
    const ip6 = s.replace(/^\[|\]$/g, "").toLowerCase();
    if (ip6 === "::1" || ip6 === "0:0:0:0:0:0:0:1") return true;
    if (ip6.startsWith("fe80:")) return true;
    if (/^f[cd][0-9a-f]{0,3}:/i.test(ip6)) return true;
    return false;
  }

  /**
   * @param {any} json
   * @param {number} typeNum
   */
  function pickDohAnswer(json, typeNum) {
    const answers = (json.Answer || []).filter((a) => a.type === typeNum);
    if (!answers.length) return null;
    const data = answers[answers.length - 1].data;
    if (typeof data !== "string") return null;
    return data.replace(/"/g, "").trim().replace(/\.$/, "");
  }

  /**
   * @param {string} base
   * @param {string} name
   * @param {number} typeNum
   */
  async function dohDnsJsonQuery(base, name, typeNum) {
    const type = typeNum === 1 ? "A" : "AAAA";
    const url = new URL(base);
    url.searchParams.set("name", name);
    url.searchParams.set("type", type);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/dns-json" },
    });
    if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
    const json = await res.json();
    return pickDohAnswer(json, typeNum);
  }

  /**
   * Chrome (and any non-Firefox) fallback: DoH chain. Quad9 is first; Google Public DNS is not used.
   * @param {string} name
   * @param {'A' | 'AAAA'} type
   */
  async function dohQuery(name, type) {
    const typeNum = type === "A" ? 1 : 28;
    const resolvers = [
      () => dohDnsJsonQuery(DOH_QUAD9, name, typeNum),
      () => dohDnsJsonQuery(DOH_OPENDNS, name, typeNum),
      () => dohDnsJsonQuery(DOH_ADGUARD, name, typeNum),
      () => dohDnsJsonQuery(DOH_CF, name, typeNum),
      () => dohDnsJsonQuery(DOH_1111, name, typeNum),
    ];

    let lastErr = null;
    let anySuccess = false;
    for (const run of resolvers) {
      try {
        const ip = await run();
        anySuccess = true;
        if (ip) return ip;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    if (!anySuccess && lastErr) throw lastErr;
    return null;
  }

  function getFirefoxDns() {
    try {
      if (typeof browser !== "undefined" && browser.dns && typeof browser.dns.resolve === "function") {
        return browser.dns;
      }
    } catch {
      /* `browser` may be undeclared in some workers */
    }
    const root = typeof self !== "undefined" ? self : globalThis;
    if (root.browser?.dns && typeof root.browser.dns.resolve === "function") {
      return root.browser.dns;
    }
    return null;
  }

  function isFirefoxDnsApiAvailable() {
    return !!getFirefoxDns();
  }

  /**
   * Firefox / LibreWolf only: resolve via the browser's native resolver (your OS / network DNS),
   * not via extension-initiated DoH. `disable_trr` skips Firefox "Trusted Recursive Resolver" (DoH)
   * so lookups follow normal system DNS when the user has turned off DoH in the browser.
   * @param {string} hostname
   * @returns {Promise<string | null>}
   */
  async function resolveHostnameToIpViaFirefoxDns(hostname) {
    const dns = getFirefoxDns();
    if (!dns) {
      return null;
    }
    const flags = ["disable_trr", "bypass_cache"];
    try {
      const res = await dns.resolve(hostname, flags);
      const addrs = Array.isArray(res?.addresses) ? res.addresses : [];
      for (const raw of addrs) {
        const a = String(raw || "")
          .split("%")[0]
          .replace(/^\[|\]$/g, "")
          .trim();
        if (!a) continue;
        if (IPV4_RE.test(a)) return a;
      }
      for (const raw of addrs) {
        const a = String(raw || "")
          .split("%")[0]
          .replace(/^\[|\]$/g, "")
          .trim();
        if (a.includes(":")) return a;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * @param {string} hostname
   */
  async function resolveHostnameToIp(hostname) {
    const lit = isLiteralIp(hostname);
    if (lit) return hostname;

    if (isFirefoxDnsApiAvailable()) {
      const native = await resolveHostnameToIpViaFirefoxDns(hostname);
      if (native) return native;
      throw new Error("No A/AAAA record found");
    }

    const v4 = await dohQuery(hostname, "A");
    if (v4) return v4;
    const v6 = await dohQuery(hostname, "AAAA");
    if (v6) return v6;
    throw new Error("No A/AAAA record found");
  }

  function regionDisplayName(code) {
    const cc = (code || "").toUpperCase();
    if (cc.length !== 2) return "";
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      return dn.of(cc) || cc;
    } catch {
      return cc;
    }
  }

  const HOMELAB_FETCH_TIMEOUT_MS = 2500;

  /**
   * Parse JSON from a custom homelab geo service (GET {base}/{ip}).
   * Supports a thin `{ country, countryCode }` wrapper and cloud66-oss/geo-style `country.iso_code` / `country.names`.
   * @param {any} data
   * @returns {{ country: string, countryCode: string }}
   */
  function parseCustomGeoJson(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid geo JSON");
    }
    if (typeof data.countryCode === "string" && data.countryCode.length === 2) {
      const countryCode = data.countryCode.toUpperCase();
      const country =
        typeof data.country === "string" && data.country.trim()
          ? data.country.trim()
          : regionDisplayName(countryCode) || countryCode;
      return { country, countryCode };
    }
    const c = data.country;
    if (c && typeof c === "object" && typeof c.iso_code === "string" && c.iso_code.length === 2) {
      const countryCode = c.iso_code.toUpperCase();
      let name = "";
      if (c.names && typeof c.names === "object") {
        if (typeof c.names.en === "string" && c.names.en.trim()) {
          name = c.names.en.trim();
        } else {
          const first = Object.values(c.names).find((v) => typeof v === "string" && v.trim());
          name = typeof first === "string" ? first.trim() : "";
        }
      }
      const country = name || regionDisplayName(countryCode) || countryCode;
      return { country, countryCode };
    }
    throw new Error("Geo lookup unsuccessful");
  }

  /**
   * @param {string} urlString full URL
   * @param {number} timeoutMs
   * @returns {Promise<any>}
   */
  async function fetchHomelabJson(urlString, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(urlString, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Geo lookup failed (${res.status})`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Homelab GET using only the configured URL (`{base}/{ip}`). Never rewrites the host to a
   * resolved IP: Kubernetes ingress and TLS need the original hostname (SNI / Host); `fetch`
   * cannot set `Host` manually. If the request fails, the caller shows Unknown (no public APIs when homelab URL is set).
   * @param {string} baseUrl trimmed base without trailing slash
   * @param {string} ip
   * @param {number} timeoutMs
   */
  async function lookupGeoHomelab(baseUrl, ip, timeoutMs) {
    const base = baseUrl.replace(/\/+$/, "");
    const urlByName = `${base}/${encodeURIComponent(ip)}`;
    return parseCustomGeoJson(await fetchHomelabJson(urlByName, timeoutMs));
  }

  /** Fixed order when chaining public providers (subset chosen in options when no homelab URL). */
  const PUBLIC_GEO_PROVIDER_ORDER = Object.freeze([
    "ipwho",
    "ipinfo",
    "ipapi",
    "geojs",
    "reallyfree",
    "ipapi_http",
  ]);

  /**
   * @param {unknown} raw
   * @returns {string[]}
   */
  function normalizePublicGeoProviderIds(raw) {
    const order = /** @type {string[]} */ (PUBLIC_GEO_PROVIDER_ORDER.slice());
    if (!Array.isArray(raw) || raw.length === 0) return order;
    const picked = order.filter((id) => raw.includes(id));
    return picked.length > 0 ? picked : order;
  }

  /**
   * Public geo APIs (only when no custom homelab URL is configured).
   * @param {string} ip
   * @param {string[] | undefined} enabledIds ids in `PUBLIC_GEO_PROVIDER_ORDER`; missing/empty ⇒ all
   */
  async function lookupGeoPublic(ip, enabledIds) {
    const order = normalizePublicGeoProviderIds(enabledIds);

    /** @type {Record<string, () => Promise<{ country: string, countryCode: string }>>} */
    const byId = {
      ipwho: async () => {
        const res = await fetch(`${GEO_IPWHO}/${encodeURIComponent(ip)}`, {
          headers: {
            Accept: "application/json",
            Referer: "https://ipwho.is/",
          },
        });
        if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message || "Geo lookup unsuccessful");
        }
        const country = typeof data.country === "string" ? data.country : "";
        const countryCode =
          typeof data.country_code === "string" ? data.country_code.toUpperCase() : "";
        return { country, countryCode };
      },
      ipinfo: async () => {
        const res = await fetch(`${GEO_IPINFO}/${encodeURIComponent(ip)}/json`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
        const data = await res.json();
        const countryCode =
          typeof data.country === "string" ? data.country.toUpperCase() : "";
        if (!countryCode || countryCode.length !== 2) {
          throw new Error("Geo lookup unsuccessful");
        }
        return {
          country: regionDisplayName(countryCode) || countryCode,
          countryCode,
        };
      },
      ipapi: async () => {
        const res = await fetch(`${GEO_IPAPI}/${encodeURIComponent(ip)}/json/`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
        const data = await res.json();
        if (data.error) {
          throw new Error(typeof data.reason === "string" ? data.reason : "Geo lookup unsuccessful");
        }
        const country =
          typeof data.country_name === "string"
            ? data.country_name
            : typeof data.country === "string"
              ? data.country
              : "";
        const countryCode =
          typeof data.country_code === "string" ? data.country_code.toUpperCase() : "";
        return { country, countryCode };
      },
      geojs: async () => {
        const res = await fetch(`${GEO_GEOJS}/${encodeURIComponent(ip)}.json`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
        const data = await res.json();
        const country = typeof data.country === "string" ? data.country : "";
        const countryCode =
          typeof data.country_code === "string" ? data.country_code.toUpperCase() : "";
        if (!country && !countryCode) {
          throw new Error("Geo lookup unsuccessful");
        }
        return { country, countryCode };
      },
      reallyfree: async () => {
        const res = await fetch(`${GEO_REALLY_FREE}/${encodeURIComponent(ip)}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
        const data = await res.json();
        const country =
          typeof data.country_name === "string"
            ? data.country_name
            : typeof data.country === "string"
              ? data.country
              : "";
        const countryCode =
          typeof data.country_code === "string" ? data.country_code.toUpperCase() : "";
        if (!country && !countryCode) throw new Error("Geo lookup unsuccessful");
        return { country, countryCode };
      },
      ipapi_http: async () => {
        const url = new URL(GEO_IPAPI_HTTP);
        url.pathname += `/${encodeURIComponent(ip)}`;
        url.searchParams.set("fields", "status,message,country,countryCode");
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
        const data = await res.json();
        if (data.status !== "success") {
          throw new Error(typeof data.message === "string" ? data.message : "Geo lookup unsuccessful");
        }
        const country = typeof data.country === "string" ? data.country : "";
        const countryCode =
          typeof data.countryCode === "string" ? data.countryCode.toUpperCase() : "";
        return { country, countryCode };
      },
    };

    const lookups = order.map((id) => {
      const fn = byId[id];
      if (!fn) throw new Error(`Unknown geo provider: ${id}`);
      return fn;
    });

    let lastErr = null;
    for (const fn of lookups) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr || new Error("Geo lookup failed");
  }

  /**
   * When a custom base URL is set: **only** that homelab endpoint is used for country lookup
   * (no public fallbacks). Otherwise uses `lookupGeoPublic` with `enabledPublicGeoProviders`.
   * @param {string} ip
   * @param {{ customGeoBaseUrl?: string, homelabNextTryAt?: number, enabledPublicGeoProviders?: string[] } | undefined} homelabOpts
   * @returns {Promise<{ country: string, countryCode: string, _homelabState: 'none'|'skipped'|'success'|'fail_after_attempt' }>}
   */
  async function lookupGeoWithOptionalHomelab(ip, homelabOpts) {
    const opts = homelabOpts || {};
    const base = (opts.customGeoBaseUrl || "").trim();
    const skip =
      typeof opts.homelabNextTryAt === "number" && opts.homelabNextTryAt > Date.now();

    if (!base) {
      const geo = await lookupGeoPublic(ip, opts.enabledPublicGeoProviders);
      return { ...geo, _homelabState: /** @type {const} */ ("none") };
    }

    if (skip) {
      return {
        country: "Unknown",
        countryCode: "",
        _homelabState: /** @type {const} */ ("skipped"),
      };
    }

    try {
      const geo = await lookupGeoHomelab(base, ip, HOMELAB_FETCH_TIMEOUT_MS);
      return { ...geo, _homelabState: /** @type {const} */ ("success") };
    } catch {
      return {
        country: "Unknown",
        countryCode: "",
        _homelabState: /** @type {const} */ ("fail_after_attempt"),
      };
    }
  }

  function flagUrlFor(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "";
    const cc = countryCode.toLowerCase();
    return `https://flagcdn.com/w40/${cc}.png`;
  }

  /**
   * @param {string} hostname
   * @param {string} [protocol]
   * @param {{ customGeoBaseUrl?: string, homelabNextTryAt?: number, enabledPublicGeoProviders?: string[] } | undefined} [homelabOpts]
   */
  async function resolveServerMetaUncached(hostname, protocol, homelabOpts) {
    const hostRaw = (hostname || "").trim();
    const host = hostRaw.toLowerCase();

    if (isUnsupportedPage(protocol, hostRaw)) {
      return { ok: false, error: "Page not supported" };
    }

    if (!hostRaw && (protocol || "").toLowerCase() === "file:") {
      return { ok: false, error: "No host for file URL" };
    }

    if (!hostRaw) {
      return { ok: false, error: "No hostname" };
    }

    try {
      let ip;
      let country = "";
      let countryCode = "";
      let iconType = /** @type {"flag" | "local" | "unknown"} */ ("unknown");
      /** @type {'none'|'skipped'|'success'|'fail_after_attempt'|undefined} */
      let homelabState;

      if (isLocalHostname(host)) {
        ip = host.includes(":") && !host.includes(".") ? "::1" : "127.0.0.1";
        country = "Local network";
        countryCode = "";
        iconType = "local";
      } else {
        ip = await resolveHostnameToIp(hostRaw);
        if (isPrivateLanIp(ip)) {
          country = "Local network";
          countryCode = "";
          iconType = "local";
        } else {
          const geo = await lookupGeoWithOptionalHomelab(ip, homelabOpts);
          country = geo.country || "Unknown";
          countryCode = geo.countryCode || "";
          const fu = flagUrlFor(countryCode) || "";
          iconType = fu ? "flag" : "unknown";
          homelabState = geo._homelabState;
        }
      }

      const flagUrl = iconType === "flag" ? flagUrlFor(countryCode) || "" : "";

      return {
        ok: true,
        ip,
        country,
        countryCode,
        flagUrl,
        iconType,
        ...(typeof homelabState !== "undefined" ? { _homelabState: homelabState } : {}),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  const g = typeof self !== "undefined" ? self : globalThis;
  g.resolveServerMetaUncached = resolveServerMetaUncached;
  g.normalizePublicGeoProviderIds = normalizePublicGeoProviderIds;
  g.PUBLIC_GEO_PROVIDER_ORDER = PUBLIC_GEO_PROVIDER_ORDER;
})();
