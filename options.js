(function () {
  const runtime =
    typeof globalThis.browser !== "undefined" && globalThis.browser?.runtime
      ? globalThis.browser
      : globalThis.chrome;

  const STORAGE_CUSTOM_GEO_BASE_URL = "customGeoBaseUrl";
  const STORAGE_ENABLED_PUBLIC_GEO = "enabledPublicGeoProviders";

  /** @type {readonly { id: string, label: string }[]} */
  const PUBLIC_GEO_PROVIDERS = Object.freeze([
    { id: "ipwho", label: "ipwho.is" },
    { id: "ipinfo", label: "ipinfo.io" },
    { id: "ipapi", label: "ipapi.co" },
    { id: "geojs", label: "get.geojs.io (GeoJS)" },
    { id: "reallyfree", label: "reallyfreegeoip.org" },
    { id: "ipapi_http", label: "ip-api.com (HTTP)" },
  ]);

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

  function readSelectedProviderIds() {
    return PUBLIC_GEO_PROVIDERS.map((p) => p.id).filter((id) => {
      const el = /** @type {HTMLInputElement | null} */ (document.getElementById(`provider_${id}`));
      return el?.checked;
    });
  }

  function applyDefaultProviderChecks() {
    for (const p of PUBLIC_GEO_PROVIDERS) {
      const el = /** @type {HTMLInputElement | null} */ (document.getElementById(`provider_${p.id}`));
      if (el) el.checked = true;
    }
  }

  async function load() {
    if (!runtime?.storage?.local) return;
    const data = await runtime.storage.local.get([
      STORAGE_CUSTOM_GEO_BASE_URL,
      STORAGE_ENABLED_PUBLIC_GEO,
    ]);
    input.value =
      typeof data[STORAGE_CUSTOM_GEO_BASE_URL] === "string" ? data[STORAGE_CUSTOM_GEO_BASE_URL] : "";

    const saved = data[STORAGE_ENABLED_PUBLIC_GEO];
    const allowed = new Set(PUBLIC_GEO_PROVIDERS.map((p) => p.id));
    if (Array.isArray(saved) && saved.length > 0) {
      const picked = new Set(saved.filter((x) => typeof x === "string" && allowed.has(x)));
      for (const p of PUBLIC_GEO_PROVIDERS) {
        const el = /** @type {HTMLInputElement | null} */ (document.getElementById(`provider_${p.id}`));
        if (el) el.checked = picked.has(p.id);
      }
      if (picked.size === 0) applyDefaultProviderChecks();
    } else {
      applyDefaultProviderChecks();
    }
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("Saving…");
    try {
      const enabled = readSelectedProviderIds();
      if (enabled.length === 0) {
        throw new Error("Select at least one public geo provider (used only when no custom URL is set).");
      }

      const normalized = normalizeBaseUrl(input.value);
      if (normalized) {
        await ensureHostPermission(normalized);
        await runtime.storage.local.set({
          [STORAGE_CUSTOM_GEO_BASE_URL]: normalized,
          [STORAGE_ENABLED_PUBLIC_GEO]: enabled,
        });
        setStatus(
          "Saved. Only your custom URL is used for country lookup; public geo APIs are disabled until you clear the URL.",
          "ok"
        );
      } else {
        await runtime.storage.local.remove(STORAGE_CUSTOM_GEO_BASE_URL);
        await runtime.storage.local.set({ [STORAGE_ENABLED_PUBLIC_GEO]: enabled });
        setStatus("Saved. Public provider selection applies when no custom URL is set.", "ok");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    }
  });

  clearBtn?.addEventListener("click", async () => {
    input.value = "";
    setStatus("");
    try {
      await runtime.storage.local.remove(STORAGE_CUSTOM_GEO_BASE_URL);
      setStatus("Cleared custom geo URL.", "ok");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), "error");
    }
  });

  load().catch((err) => setStatus(err instanceof Error ? err.message : String(err), "error"));
})();
