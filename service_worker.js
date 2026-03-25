/**
 * Caching wrapper around shared resolve logic (resolve_core.js).
 */

importScripts("resolve_core.js");

const CACHE_TTL_MS = 15 * 60 * 1000;
/** @type {Map<string, { expires: number, payload: ServerMetaOk }>} */
const cache = new Map();

/** @typedef {{ ok: true, ip: string, country: string, countryCode: string, flagUrl: string, iconType: 'flag'|'local'|'unknown' }} ServerMetaOk */
/** @typedef {{ ok: false, error: string }} ServerMetaErr */

/**
 * @param {string} hostname
 * @param {string} [protocol]
 * @returns {Promise<ServerMetaOk | ServerMetaErr>}
 */
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
});
