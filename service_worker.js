// This polyfill wrapper standardizes API calls for Chrome (chrome.*) and Firefox (browser.*) webextensions.
const getApiContext = () => {
    // Prioritize 'browser' API if available (Firefox/WebExtension standard)
    if (typeof self.browser !== 'undefined') return self.browser;
    // Fallback to 'chrome' API (Chrome specific)
    if (typeof self.chrome !== 'undefined') return self.chrome;
    throw new Error("No supported webextension API context found (browser or chrome).");
};

// Use the determined API context for all webextension calls
const API_API = getApiContext();

importScripts("resolve_core.js");

const CACHE_TTL_MS = 15 * 60 * 1000;
/** @type {Map<string, { expires: number, payload: ServerMetaOk }>} */
const cache = new Map();

/** @typedef {{ ok: true, ip: string, country: string, countryCode: string, flagUrl: string, iconType: 'flag'|'local'|'unknown' }} ServerMetaOk */
/** @typedef {{ ok: false, error: string }} ServerMetaErr */

async function resolveServerMeta(hostname, protocol) {
  const hostRaw = (hostname || "").trim();
  const host = hostRaw.toLowerCase();
  const cacheKey = `${protocol || ""}|${host}`;

  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    return hit.payload;
  }

  // Pass the API context getter to the uncached resolver function
  const result = await self.resolveServerMetaUncached(hostname, protocol, API_API);
  if (result.ok) {
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload: result });
  }
  return result;
}

// Use the determined API context's message listener
const messageListener = (msg, _sender, sendResponse) => {
  if (msg?.type !== "RESOLVE_SERVER_META") return;

  resolveServerMeta(msg.hostname, msg.protocol)
    .then(sendResponse)
    .catch((e) => {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    });

  return true;
}

// Register the appropriate message listener
(API_API && API_API.onMessage) ? API_API.onMessage.addListener(messageListener) : console.warn("Failed to attach onMessage listener: API context missing.");