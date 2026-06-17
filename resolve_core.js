/** Hostname → IP (DoH) and IP → country; service worker only. */

/** 
 * @description Detects and sets up the global scope context (Window, Self, or globalThis) 
 * for cross-browser compatibility (Firefox, Chrome, Workers).
 */
function setupGlobalScope() {
    if (typeof globalThis === 'undefined') {
        globalThis = this;
    }
}

setupGlobalScope();

// --- Compatibility Wrapper for Browser/Worker/Global APIs ---
/**
 * Retrieves the active global scope object.
 * Checks for window, self, and falls back to globalThis.
 * @returns {!Object} The active global scope object.
 */
const getAPI = () => {
    if (typeof window !== 'undefined') {
        return window;
    }
    if (typeof self !== 'undefined') {
        return self;
    }
    return globalThis;
};

/**
 * Utility function to check if the provided API object is valid.
 * @param {object} apiInstance The API object.
 * @returns {boolean} True if the API object seems valid.
 */
const isApiValid = (apiInstance) => !!apiInstance;

// Initialize the API variable using the robust getter
const api = getAPI();

/**
 * Safely calls a method on the API object.
 * @param {string} methodName The name of the method to call.
 * @param {...any} args Arguments to pass to the method.
 * @returns {any} The result of the method call.
 * @throws {Error} If the method does not exist or if the API instance is invalid.
 */
const apiCall = (methodName, ...args) => {
    if (!isApiValid(api)) {
        throw new Error(`API instance is not defined or usable.`);
    }
    const method = api[methodName];
    if (typeof method !== 'function') {
        throw new Error(`Method "${methodName}" is not a function on the API object.`);
    }
    return method(...args);
};

// --- Core Utility Functions ---

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
 * Performs a DNS JSON query using a specified DOH endpoint.
 * @param {string} base The DOH base URL.
 * @param {string} name The hostname.
 * @param {number} typeNum The DNS record type number (A=1, AAAA=28).
 * @returns {Promise<string|null>} The resolved IP address or null.
 */
async function dohDnsJsonQuery(base, name, typeNum) {
    const type = typeNum === 1 ? "A" : "AAAA";
    const url = new URL(base);
    url.searchParams.set("name", name);
    url.searchParams.set("type", type);
    
    // Use apiCall for fetch
    const res = await apiCall('fetch', url.toString(), {
        headers: { Accept: "application/dns-json" }
    });
    
    if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
    
    const json = await res.json();
    return pickDohAnswer(json, typeNum);
}

/**
 * Performs A record lookup using Google's DNS.
 * @param {string} name The hostname.
 * @param {number} typeNum The DNS record type number.
 * @returns {Promise<string|null>} The resolved IP address or null.
 */
async function dohGoogle(name, typeNum) {
    const url = new URL(DOH_GOOGLE);
    url.searchParams.set("name", name);
    url.searchParams.set("type", String(typeNum));

    const res = await apiCall('fetch', url.toString(), {
        headers: { Accept: "application/dns-json" }
    });

    if (!res.ok) throw new Error(`DNS lookup failed (${res.status})`);
    
    const json = await res.json();
    return pickDohAnswer(json, typeNum);
}

/**
 * Iterates through multiple DOH resolvers to find the IP address for a hostname.
 * @param {string} name The hostname.
 * @param {'A' | 'AAAA'} type The desired record type.
 * @returns {Promise<string|null>} The resolved IP address or null.
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
 * Resolves a hostname to an IP address (A or AAAA) using DoH providers.
 * @param {string} hostname The hostname.
 * @returns {Promise<string>} The resolved IP address.
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
        // Use Intl.DisplayNames for robust region naming
        const dn = new Intl.DisplayNames(["en"], { type: "region" });
        return dn.of(cc) || cc;
    } catch {
        return cc;
    }
}

/**
 * Orchestrates multiple geo-lookup services to determine country/countryCode.
 * @param {string} ip The IP address.
 * @returns {Promise<{country: string, countryCode: string}>} Geo data.
 */
async function lookupGeo(ip) {
    const fetchFn = (url) => apiCall('fetch', url, { headers: { Accept: "application/json" } });

    // List of synchronous lookup functions wrapped to use the 'fetch' apiCall
    const lookups = [
        async () => {
            const res = await fetchFn(`${GEO_REALLY_FREE}/${encodeURIComponent(ip)}`);
            if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
            const data = await res.json();
            const country = (typeof data.country_name === "string" ? data.country_name : typeof data.country === "string" ? data.country : "");
            const countryCode = (typeof data.country_code === "string" ? data.country_code.toUpperCase() : "");
            if (!country && !countryCode) throw new Error("Geo lookup unsuccessful");
            return { country, countryCode };
        },
        async () => {
            const res = await fetchFn(`${GEO_IPINFO}/${encodeURIComponent(ip)}/json`);
            if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
            const data = await res.json();
            const countryCode = (typeof data.country === "string" ? data.country.toUpperCase() : "");
            if (!countryCode || countryCode.length !== 2) throw new Error("Geo lookup unsuccessful");
            return { country: regionDisplayName(countryCode) || countryCode, countryCode };
        },
        async () => {
            const res = await fetchFn(`${GEO_IPWHO}/${encodeURIComponent(ip)}`);
            if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || "Geo lookup unsuccessful");
            const country = typeof data.country === "string" ? data.country : "";
            const countryCode = typeof data.country_code === "string" ? data.country_code.toUpperCase() : "";
            return { country, countryCode };
        },
        async () => {
            const res = await fetchFn(`${GEO_IPAPI}/${encodeURIComponent(ip)}/json/`);
            if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
            const data = await res.json();
            if (data.error) throw new Error(data.reason || "Geo lookup unsuccessful");
            const country = typeof data.country_name === "string" ? data.country_name : typeof data.country === "string" ? data.country : "";
            const countryCode = typeof data.country_code === "string" ? data.country_code.toUpperCase() : "";
            return { country, countryCode };
        },
        async () => {
            const res = await fetchFn(`${GEO_GEOJS}/${encodeURIComponent(ip)}.json`);
            if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
            const data = await res.json();
            const country = typeof data.country === "string" ? data.country : "";
            const countryCode = typeof data.country_code === "string" ? data.country_code.toUpperCase() : "";
            if (!country && !countryCode) throw new Error("Geo lookup unsuccessful");
            return { country, countryCode };
        },
        async () => {
            const url = new URL(GEO_IPAPI_HTTP);
            url.pathname += `/${encodeURIComponent(ip)}`;
            url.searchParams.set("fields", "status,message,country,countryCode");
            const res = await fetchFn(url.toString());

            if (!res.ok) throw new Error(`Geo lookup failed (${res.status})`);
            const data = await res.json();
            if (data.status !== "success") throw new Error(data.message || "Geo lookup unsuccessful");
            const country = typeof data.country === "string" ? data.country : "";
            const countryCode = typeof data.countryCode === "string" ? data.countryCode.toUpperCase() : "";
            return { country, countryCode };
        }
    ];

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

function flagUrlFor(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "";
    const cc = countryCode.toLowerCase();
    return `https://flagcdn.com/w40/${cc}.png`;
}

/**
 * Resolves the metadata (IP, Country, Flag) for a given URL hostname.
 * @param {string} hostname The hostname to resolve.
 * @param {?string} protocol The URL protocol (optional).
 * @returns {Promise<{ok: boolean, ip: string, country: string, countryCode: string, flagUrl: string, iconType: 'flag' | 'local' | 'unknown', error?: string}>}
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
        let iconType = "unknown";

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
                const flagUrl = flagUrlFor(countryCode) || "";
                iconType = flagUrl ? "flag" : "unknown";
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
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}

// Export functions for use in other modules
module.exports = {
    apiCall,
    isApiValid,
    resolveServerMetaUncached,
    // Keep helper enums/constants available if needed
    DOH_GOOGLE,
    DOH_QUAD9,
    // ... add other exports if other modules depend on them
};