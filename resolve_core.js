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

  const HOMELAB_FETCH_TIMEOUT_MS = 1000;

  /**
   * @param {any} data
   * @returns {{ latitude?: number, longitude?: number }}
   */
  function pickOptionalLatLon(data) {
    if (!data || typeof data !== "object") return {};
    let lat = NaN;
    let lon = NaN;
    const asNum = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
      }
      return NaN;
    };
    lat = asNum(data.latitude);
    lon = asNum(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      lat = asNum(data.lat);
      lon = asNum(data.lon !== undefined ? data.lon : data.lng);
    }
    const locStr = typeof data.loc === "string" ? data.loc.trim() : "";
    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && locStr.includes(",")) {
      const parts = locStr.split(",");
      lat = asNum(parts[0]);
      lon = asNum(parts[1]);
    }
    const loc = data.location;
    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && loc && typeof loc === "object") {
      lat = asNum(loc.latitude ?? loc.lat);
      lon = asNum(loc.longitude ?? loc.lon ?? loc.lng);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return {};
    return { latitude: lat, longitude: lon };
  }

  /**
   * @param {unknown} err
   * @returns {string}
   */
  function errorToGeoHint(err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const name = /** @type {{ name?: string }} */ (e).name;
    if (name === "AbortError") return "Timeout";
    let m = (e.message || "Request failed").trim().replace(/\s+/g, " ");
    const mHttp = /^Geo lookup failed \((\d+)\)$/.exec(m);
    if (mHttp) return `HTTP ${mHttp[1]}`;
    if (/failed to fetch|networkerror|load failed|ns_error_connection/i.test(m)) return "Network error";
    if (m.length > 100) m = `${m.slice(0, 97)}…`;
    return m;
  }

  /**
   * Normalise a string to a two-letter A–Z country code, or "".
   * @param {unknown} s
   */
  function normalizeIso2CountryCode(s) {
    if (typeof s !== "string") return "";
    const t = s.trim().toUpperCase();
    return t.length === 2 && /^[A-Z]{2}$/.test(t) ? t : "";
  }

  /**
   * Parse JSON from a custom homelab geo service (GET {base}/{ip}).
   * Supports: `countryCode` / `country_code`; or **MaxMind-like** flat JSON where **`country` is the ISO-2 code**
   * (e.g. `"country":"DE"`) when no separate `countryCode` is present; optional `countryName` / `country_name`;
   * and cloud66-oss/geo-style `country` object with `iso_code` / `names`.
   * @param {any} data
   * @returns {{ country: string, countryCode: string, latitude?: number, longitude?: number }}
   */
  function parseCustomGeoJson(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid geo JSON");
    }

    let countryCode = normalizeIso2CountryCode(
      (typeof data.countryCode === "string" && data.countryCode) ||
        (typeof data.country_code === "string" && data.country_code) ||
        ""
    );
    if (!countryCode && typeof data.country === "string") {
      countryCode = normalizeIso2CountryCode(data.country);
    }

    if (countryCode) {
      const explicitName =
        (typeof data.countryName === "string" && data.countryName.trim()) ||
        (typeof data.country_name === "string" && data.country_name.trim()) ||
        "";
      let countryFromCountryField = "";
      if (typeof data.country === "string") {
        const raw = data.country.trim();
        if (raw && normalizeIso2CountryCode(raw) !== countryCode) {
          countryFromCountryField = raw;
        }
      }
      const country =
        explicitName ||
        countryFromCountryField ||
        regionDisplayName(countryCode) ||
        countryCode;
      return { country, countryCode, ...pickOptionalLatLon(data) };
    }

    const c = data.country;
    if (c && typeof c === "object") {
      const iso = normalizeIso2CountryCode(c.iso_code);
      if (iso) {
        const countryCodeNested = iso;
        let name = "";
        if (c.names && typeof c.names === "object") {
          if (typeof c.names.en === "string" && c.names.en.trim()) {
            name = c.names.en.trim();
          } else {
            const first = Object.values(c.names).find((v) => typeof v === "string" && v.trim());
            name = typeof first === "string" ? first.trim() : "";
          }
        }
        const country = name || regionDisplayName(countryCodeNested) || countryCodeNested;
        return { country, countryCode: countryCodeNested, ...pickOptionalLatLon(data) };
      }
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

    /** @type {Record<string, () => Promise<{ country: string, countryCode: string, latitude?: number, longitude?: number }>>} */
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
        return { country, countryCode, ...pickOptionalLatLon(data) };
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
          ...pickOptionalLatLon(data),
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
        return { country, countryCode, ...pickOptionalLatLon(data) };
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
        return { country, countryCode, ...pickOptionalLatLon(data) };
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
        return { country, countryCode, ...pickOptionalLatLon(data) };
      },
      ipapi_http: async () => {
        const url = new URL(GEO_IPAPI_HTTP);
        url.pathname += `/${encodeURIComponent(ip)}`;
        url.searchParams.set("fields", "status,message,country,countryCode,lat,lon");
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
        return { country, countryCode, ...pickOptionalLatLon(data) };
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
   * @param {{ customGeoBaseUrl?: string, enabledPublicGeoProviders?: string[] } | undefined} homelabOpts
   * @returns {Promise<{ country: string, countryCode: string, latitude?: number, longitude?: number, geoErrorHint?: string }>}
   */
  async function lookupGeoWithOptionalHomelab(ip, homelabOpts) {
    const opts = homelabOpts || {};
    const base = (opts.customGeoBaseUrl || "").trim();

    if (!base) {
      return await lookupGeoPublic(ip, opts.enabledPublicGeoProviders);
    }

    try {
      return await lookupGeoHomelab(base, ip, HOMELAB_FETCH_TIMEOUT_MS);
    } catch (e) {
      return {
        country: "Unknown",
        countryCode: "",
        geoErrorHint: errorToGeoHint(e),
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
   * @param {{ customGeoBaseUrl?: string, enabledPublicGeoProviders?: string[] } | undefined} [homelabOpts]
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
      let iconType = /** @type {"flag" | "local" | "unknown" | "geo_error"} */ ("unknown");
      /** @type {number | undefined} */
      let latitude;
      /** @type {number | undefined} */
      let longitude;
      /** @type {string | undefined} */
      let geoErrorHint;

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
          if (geo.geoErrorHint) {
            iconType = "geo_error";
            geoErrorHint = geo.geoErrorHint;
          } else {
            const fu = flagUrlFor(countryCode) || "";
            iconType = fu ? "flag" : "unknown";
          }
          if (typeof geo.latitude === "number" && typeof geo.longitude === "number") {
            latitude = geo.latitude;
            longitude = geo.longitude;
          }
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
        ...(typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : {}),
        ...(typeof geoErrorHint === "string" && geoErrorHint ? { geoErrorHint } : {}),
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
