(function () {
  const runtime =
    typeof globalThis.browser !== "undefined" && globalThis.browser?.runtime
      ? globalThis.browser
      : globalThis.chrome;

  const STORAGE_CUSTOM_GEO_BASE_URL = "customGeoBaseUrl";
  const STORAGE_HOMELAB_GEO = "homelabGeo";

  const form = document.getElementById("form");
  const input = /** @type {HTMLInputElement} */ (document.getElementById("baseUrl"));
  const statusEl = document.getElementById("status");
  const clearBtn = document.getElementById("clear");

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.classList.remove("error", "ok");
    if (kind === "error") statusEl.classList.add("error");
    if (kind === "ok") statusEl.classList.add("ok");
  }

  /**
   * @param {string} raw
   * @returns {string} normalized base without trailing slash, or "" if empty
   */
  function normalizeBaseUrl(raw) {
    const t = (raw || "").trim();
    if (!t) return "";
    let u;
    try {
      u = new URL(t);
    } catch {
      throw new Error("Invalid URL");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("Only http and https URLs are allowed");
    }
    if (u.username || u.password) {
      throw new Error("URL must not include credentials");
    }
    if (u.search || u.hash) {
      throw new Error("URL must not include query or fragment");
    }
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  }

  /**
   * @param {string} normalizedBase
   * @returns {Promise<void>}
   */
  async function ensureHostPermission(normalizedBase) {
    if (!normalizedBase) return;
    const u = new URL(normalizedBase);
    const origins = [`${u.origin}/*`];
    if (!runtime?.permissions?.request || !runtime.permissions.contains) {
      throw new Error("Permissions API is not available; check the extension manifest.");
    }
    const has = await runtime.permissions.contains({ origins });
    if (has) return;
    const granted = await runtime.permissions.request({ origins });
    if (!granted) {
      throw new Error("Host permission was not granted; the extension cannot call your geo URL.");
    }
  }

  async function load() {
    if (!runtime?.storage?.local) return;
    const data = await runtime.storage.local.get(STORAGE_CUSTOM_GEO_BASE_URL);
    input.value = typeof data[STORAGE_CUSTOM_GEO_BASE_URL] === "string" ? data[STORAGE_CUSTOM_GEO_BASE_URL] : "";
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("Saving…");
    try {
      const normalized = normalizeBaseUrl(input.value);
      if (normalized) {
        await ensureHostPermission(normalized);
        await runtime.storage.local.set({ [STORAGE_CUSTOM_GEO_BASE_URL]: normalized });
        setStatus("Saved. Homelab geo will be tried first (with fallback to public APIs).", "ok");
      } else {
        await runtime.storage.local.remove([STORAGE_CUSTOM_GEO_BASE_URL, STORAGE_HOMELAB_GEO]);
        setStatus("Cleared custom geo URL and homelab backoff state.", "ok");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    }
  });

  clearBtn?.addEventListener("click", async () => {
    input.value = "";
    setStatus("");
    try {
      await runtime.storage.local.remove([STORAGE_CUSTOM_GEO_BASE_URL, STORAGE_HOMELAB_GEO]);
      setStatus("Cleared custom geo URL and homelab backoff state.", "ok");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    }
  });

  load().catch((err) => setStatus(err instanceof Error ? err.message : String(err), "error"));
})();
