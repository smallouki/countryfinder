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
const STORAGE_ENABLED_PUBLIC_GEO = "enabledPublicGeoProviders";

const CACHE_TTL_MS = 15 * 60 * 1000;
/** @type {Map<string, { expires: number, payload: ServerMetaOk }>} */
const cache = new Map();

/**
 * Serialize host resolves so parallel tabs do not interleave cache reads/writes oddly.
 * @type {Promise<void>}
 */
let resolveMutexTail = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function runResolveExclusive(fn) {
  const next = resolveMutexTail.then(fn, fn);
  resolveMutexTail = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/** @typedef {{ ok: true, ip: string, country: string, countryCode: string, flagUrl: string, iconType: 'flag'|'local'|'unknown'|'geo_error', latitude?: number, longitude?: number, geoErrorHint?: string }} ServerMetaOk */
/** @typedef {{ ok: false, error: string }} ServerMetaErr */

/**
 * @returns {Promise<{ customGeoBaseUrl: string, enabledPublicGeoProviders: string[] }>}
 */
async function loadHomelabOpts() {
  const data = await API_API.storage.local.get([
    STORAGE_CUSTOM_GEO_BASE_URL,
    STORAGE_ENABLED_PUBLIC_GEO,
  ]);
  const customGeoBaseUrl =
    typeof data[STORAGE_CUSTOM_GEO_BASE_URL] === "string" ? data[STORAGE_CUSTOM_GEO_BASE_URL] : "";
  const rawProviders = data[STORAGE_ENABLED_PUBLIC_GEO];
  const enabledPublicGeoProviders = Array.isArray(rawProviders)
    ? rawProviders.filter((x) => typeof x === "string")
    : [];
  return { customGeoBaseUrl, enabledPublicGeoProviders };
}

async function resolveServerMeta(hostname, protocol) {
  return runResolveExclusive(async () => {
    const hostRaw = (hostname || "").trim();
    const host = hostRaw.toLowerCase();
    const homelabOpts = await loadHomelabOpts();
    const geoKeySuffix = homelabOpts.customGeoBaseUrl
      ? homelabOpts.customGeoBaseUrl
      : `p:${self.normalizePublicGeoProviderIds(homelabOpts.enabledPublicGeoProviders).join(",")}`;
    const cacheKey = `${protocol || ""}|${host}|${geoKeySuffix}`;

    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) {
      return hit.payload;
    }

    const result = await self.resolveServerMetaUncached(hostname, protocol, homelabOpts);
    if (result.ok) {
      cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload: result });
    }
    return result;
  });
}

// Use the determined API context's message listener
const messageListener = (msg, _sender, sendResponse) => {
  if (msg?.type === "OPEN_OSM") {
    const lat = msg.latitude;
    const lon = msg.longitude;
    if (
      typeof lat === "number" &&
      typeof lon === "number" &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      const url = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(lat))}&mlon=${encodeURIComponent(String(lon))}&zoom=12`;
      try {
        if (API_API.tabs && typeof API_API.tabs.create === "function") {
          API_API.tabs.create({ url, active: true });
        }
      } catch (e) {
        console.warn("show-country: tabs.create failed", e);
      }
    }
    return false;
  }

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

// Drop cached host results when geo options change so the next resolve picks up new settings.
if (API_API?.storage?.onChanged) {
  API_API.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_CUSTOM_GEO_BASE_URL] || changes[STORAGE_ENABLED_PUBLIC_GEO]) {
      cache.clear();
    }
  });
}
