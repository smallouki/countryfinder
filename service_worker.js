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

const STORAGE_CUSTOM_GEO_BASE_URL = "customGeoBaseUrl";
const STORAGE_HOMELAB_GEO = "homelabGeo";
const HOMELAB_BACKOFF_MS = 5 * 60 * 1000;

const CACHE_TTL_MS = 15 * 60 * 1000;
/** @type {Map<string, { expires: number, payload: ServerMetaOk }>} */
const cache = new Map();

/** @typedef {{ ok: true, ip: string, country: string, countryCode: string, flagUrl: string, iconType: 'flag'|'local'|'unknown' }} ServerMetaOk */
/** @typedef {{ ok: false, error: string }} ServerMetaErr */

/**
 * @returns {Promise<{ customGeoBaseUrl: string, homelabNextTryAt: number }>}
 */
async function loadHomelabOpts() {
  const data = await API_API.storage.local.get([STORAGE_CUSTOM_GEO_BASE_URL, STORAGE_HOMELAB_GEO]);
  const customGeoBaseUrl =
    typeof data[STORAGE_CUSTOM_GEO_BASE_URL] === "string" ? data[STORAGE_CUSTOM_GEO_BASE_URL] : "";
  const raw = data[STORAGE_HOMELAB_GEO];
  const homelabNextTryAt =
    raw && typeof raw === "object" && typeof raw.nextTryAt === "number" ? raw.nextTryAt : 0;
  return { customGeoBaseUrl, homelabNextTryAt };
}

/**
 * @param {Record<string, unknown>} result
 */
async function applyHomelabBackoffFromResult(result) {
  if (!result || !result.ok) return;
  const state = /** @type {unknown} */ (result)._homelabState;
  if (state === "success") {
    await API_API.storage.local.remove(STORAGE_HOMELAB_GEO);
  } else if (state === "fail_after_attempt") {
    await API_API.storage.local.set({
      [STORAGE_HOMELAB_GEO]: { nextTryAt: Date.now() + HOMELAB_BACKOFF_MS },
    });
  }
  if ("_homelabState" in result) {
    delete /** @type {{ _homelabState?: string }} */ (result)._homelabState;
  }
}

async function resolveServerMeta(hostname, protocol) {
  const hostRaw = (hostname || "").trim();
  const host = hostRaw.toLowerCase();
  const cacheKey = `${protocol || ""}|${host}`;

  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    return hit.payload;
  }

  const homelabOpts = await loadHomelabOpts();
  const result = await self.resolveServerMetaUncached(hostname, protocol, homelabOpts);
  await applyHomelabBackoffFromResult(result);
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
};

// Messaging lives on runtime, not the extension root (chrome.runtime / browser.runtime).
if (API_API?.runtime?.onMessage) {
  API_API.runtime.onMessage.addListener(messageListener);
} else {
  console.warn("Failed to attach runtime.onMessage listener: API context missing.");
}
