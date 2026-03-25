/** Hostname → IP (DoH) and IP → country; service worker only. */

(function () {
  const DOH_GOOGLE = "https://dns.google/resolve";
  const DOH_QUAD9 = "https://dns.quad9.net/dns-query";
  const DOH_OPENDNS = "https://doh.opendns.com/dns-query";
  const DOH_ADGUARD = "https://dns.adguard-dns.com/dns-query";
  const DOH_CF = "https://cloudflare-dns.com/dns-query";
  const DOH_1111 = "https://1.1.1.1/dns-query";

  const GEO_REALLY_FREE = "https://reallyfreegeoip.org/json";
  const GEO_IPINFO = "https://ipinfo.io";
  const GEO_IPWHO = "https://ipwho.is";
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
    if (p === "chrome:" || p === "chrome-extension:" || p === "edge:") return true;
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
   * @param {string} name
   * @param {number} typeNum
   */
  async function dohGoogle(name, typeNum) {
    const url = new URL(DOH_GOOGLE);
    url.searchParams.set("name", name);
    url.searchParams.set("type", String(typeNum));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/dns-json" },
    });
    if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
    const json = await res.json();
    return pickDohAnswer(json, typeNum);
  }

  /**
   * @param {string} name
   * @param {'A' | 'AAAA'} type
   */
  async function dohQuery(name, type) {
    const typeNum = type === "A" ? 1 : 28;
    const resolvers = [
      () => dohGoogle(name, typeNum),
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

  /**
   * @param {string} hostname
   */
  async function resolveHostnameToIp(hostname) {
    const lit = isLiteralIp(hostname);
    if (lit) return hostname;

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

  async function lookupGeoReallyFree(ip) {
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
    return {
      country: country || regionDisplayName(countryCode) || "Unknown",
      countryCode,
    };
  }

  async function lookupGeoIpInfo(ip) {
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
  }

  async function lookupGeoIpWho(ip) {
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
  }

  async function lookupGeoIpApi(ip) {
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
  }

  async function lookupGeoGeoJs(ip) {
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
  }

  async function lookupGeoIpApiHttp(ip) {
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
  }

  async function lookupGeo(ip) {
    let lastErr = null;
    const fns = [
      lookupGeoReallyFree,
      lookupGeoIpInfo,
      lookupGeoIpWho,
      lookupGeoIpApi,
      lookupGeoGeoJs,
      lookupGeoIpApiHttp,
    ];
    for (const fn of fns) {
      try {
        return await fn(ip);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr || new Error("Geo lookup failed");
  }

  function flagUrlFor(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "";
    const cc = countryCode.toLowerCase();
    return `https://flagcdn.com/w40/${cc}.png`;
  }

  /**
   * @param {string} hostname
   * @param {string} [protocol]
   */
  async function resolveServerMetaUncached(hostname, protocol) {
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
          const geo = await lookupGeo(ip);
          country = geo.country || "Unknown";
          countryCode = geo.countryCode || "";
          const fu = flagUrlFor(countryCode) || "";
          if (fu) {
            iconType = "flag";
          } else {
            iconType = "unknown";
          }
        }
      }

      const flagUrl =
        iconType === "flag" ? flagUrlFor(countryCode) || "" : "";

      return {
        ok: true,
        ip,
        country,
        countryCode,
        flagUrl,
        iconType,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  const g = typeof self !== "undefined" ? self : globalThis;
  g.resolveServerMetaUncached = resolveServerMetaUncached;
})();
