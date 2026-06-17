// This polyfill wrapper standardizes API calls for Chrome (chrome.*) and Firefox (browser.*) webextensions.
const getApiContext = () => {
  if (typeof self.browser !== "undefined") return self.browser;
  if (typeof self.chrome !== "undefined") return self.chrome;
  throw new Error("No supported webextension API context found (browser or chrome).");
};

// Chrome MV3: load core in the service worker. Firefox MV3: manifest lists resolve_core.js then this file.
if (typeof importScripts === "function") {
  importScripts("resolve_core.js");
}

const API_API = getApiContext();

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

  const result = await self.resolveServerMetaUncached(hostname, protocol);
  if (result.ok) {
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload: result });
  }
  return result;
}

// Use the determined API context's message listener
const messageListener = (msg, _sender, sendResponse) => {
  if (msg?.type !== "RESOLVE_SERVER_META") return false;

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

// Messaging lives on runtime, not the extension root (chrome.runtime / browser.runtime).
if (API_API?.runtime?.onMessage) {
  API_API.runtime.onMessage.addListener(messageListener);
} else {
  console.warn("Failed to attach runtime.onMessage listener: API context missing.");
}