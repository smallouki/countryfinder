(function () {
  function svgDataUrl(svg) {
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  const LOADING_SVG = svgDataUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="20" viewBox="0 0 28 20">' +
      '<defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fff7ed"/><stop offset="1" stop-color="#ffedd5"/></linearGradient></defs>' +
      '<rect width="28" height="20" rx="2.5" fill="url(#gl)"/>' +
      '<circle cx="14" cy="10" r="3.4" fill="#fb923c" opacity=".9">' +
      '<animate attributeName="opacity" values=".95;.38;.95" dur="1s" repeatCount="indefinite"/>' +
      "</circle></svg>"
  );

  const LOCAL_SVG = svgDataUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="20" viewBox="0 0 28 20">' +
      "<defs>" +
      '<linearGradient id="gh" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffe8d9"/><stop offset="0.5" stop-color="#fdba74"/><stop offset="1" stop-color="#ea580c"/></linearGradient>' +
      '<linearGradient id="ghRoof" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffd4d4"/><stop offset="0.45" stop-color="#f87171"/><stop offset="1" stop-color="#dc2626"/></linearGradient>' +
      "</defs>" +
      '<rect width="28" height="20" rx="2.5" fill="#000" fill-opacity="0.66"/>' +
      '<rect x="19.4" y="3.2" width="2.5" height="6.2" rx="0.35" fill="#9a3412" stroke="rgba(255,255,255,0.2)" stroke-width="0.35"/>' +
      '<rect x="7" y="10.4" width="14" height="8.8" rx="1.05" fill="url(#gh)" stroke="rgba(255,255,255,0.28)" stroke-width="0.45"/>' +
      '<path fill="url(#ghRoof)" stroke="rgba(255,255,255,0.28)" stroke-width="0.45" stroke-linejoin="round" d="M2.2 10.4L14 1.6L25.8 10.4H2.2z"/>' +
      '<rect x="8.3" y="12.1" width="3.4" height="2.9" rx="0.4" fill="rgba(255,250,245,0.55)" stroke="rgba(0,0,0,0.18)" stroke-width="0.3"/>' +
      '<rect x="16.4" y="13.6" width="3.6" height="5.4" rx="0.5" fill="#7c2d12" stroke="rgba(0,0,0,0.25)" stroke-width="0.25"/>' +
      "</svg>"
  );

  const UNKNOWN_SVG = svgDataUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="20" viewBox="0 0 28 20">' +
      "<defs>" +
      '<linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#fffbeb"/><stop offset="1" stop-color="#fde68a"/></linearGradient>' +
      "</defs>" +
      '<rect width="28" height="20" rx="2.5" fill="url(#gb)"/>' +
      '<text x="14" y="14.8" text-anchor="middle" font-family="ui-rounded,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="800" fill="#b45309">?</text>' +
      "</svg>"
  );

  const EXT_STYLE = `
    :host {
      display: block;
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483646;
      width: 28px;
      height: 20px;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      pointer-events: none;
      box-sizing: border-box;
    }
    .chip {
      pointer-events: auto;
      display: block;
      width: 28px;
      height: 20px;
      padding: 0;
      margin: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      cursor: default;
      position: relative;
      box-sizing: border-box;
    }
    .chip:hover .tooltip {
      opacity: 1;
      visibility: visible;
    }
    .flag {
      display: block;
      width: 28px;
      height: 20px;
      object-fit: cover;
      border-radius: 2.5px;
      vertical-align: top;
    }
    .tooltip {
      visibility: hidden;
      opacity: 0;
      transition: opacity 0.12s ease;
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 8px;
      min-width: 140px;
      max-width: 280px;
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(10, 10, 14, 0.95);
      color: #f4f4f5;
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-all;
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }
    .tooltip strong {
      display: block;
      font-weight: 600;
      margin-bottom: 4px;
      color: #fff;
    }
  `;

  function mountTarget() {
    return document.body || document.documentElement;
  }

  function inferIconType(meta) {
    if (meta.iconType === "flag" || meta.iconType === "local" || meta.iconType === "unknown") {
      return meta.iconType;
    }
    const c = String(meta.country || "").toLowerCase();
    if (c === "local" || c === "local network") return "local";
    if (meta.flagUrl) return "flag";
    return "unknown";
  }

  async function loadMetaFromBackground(hostname, protocol) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "RESOLVE_SERVER_META",
            hostname,
            protocol,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                error: chrome.runtime.lastError.message,
              });
              return;
            }
            resolve(response || { ok: false, error: "No response" });
          }
        );
      } catch (e) {
        resolve({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  function mount() {
    if (document.getElementById("show-country-ext-root")) return;

    const hostEl = document.createElement("div");
    hostEl.id = "show-country-ext-root";
    hostEl.setAttribute("data-show-country", "1");
    const shadow = hostEl.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = EXT_STYLE;
    shadow.appendChild(style);

    const chip = document.createElement("div");
    chip.className = "chip";
    chip.setAttribute("role", "img");
    chip.setAttribute(
      "aria-label",
      "Server country flag. Hover to show country name and IP."
    );

    const tooltip = document.createElement("div");
    tooltip.className = "tooltip";
    tooltip.setAttribute("aria-hidden", "true");

    const img = document.createElement("img");
    img.className = "flag";
    img.alt = "";
    img.decoding = "async";
    img.src = LOADING_SVG;

    chip.appendChild(tooltip);
    chip.appendChild(img);
    shadow.appendChild(chip);
    mountTarget().appendChild(hostEl);

    const protocol = window.location.protocol;
    const hostname = window.location.hostname || "";

    loadMetaFromBackground(hostname, protocol).then((meta) => {
      if (!meta.ok) {
        img.src = UNKNOWN_SVG;
        img.onerror = null;
        tooltip.innerHTML = `<strong>Unavailable</strong>${meta.error ? `\n${escapeHtml(String(meta.error))}` : ""}`;
        chip.setAttribute(
          "aria-label",
          "Server location unavailable. Hover for details."
        );
        return;
      }

      const iconType = inferIconType(meta);

      if (iconType === "local") {
        img.src = LOCAL_SVG;
        img.onerror = null;
        tooltip.innerHTML = `<strong>${escapeHtml(meta.country || "Local network")}</strong>${meta.ip ? `\n${escapeHtml(meta.ip)}` : ""}`;
        chip.setAttribute(
          "aria-label",
          "Local network. Hover for details."
        );
        return;
      }

      if (iconType === "unknown") {
        img.src = UNKNOWN_SVG;
        img.onerror = null;
        tooltip.innerHTML = `<strong>${escapeHtml(meta.country || "Unknown")}</strong>${meta.ip ? `\n${escapeHtml(meta.ip)}` : ""}`;
        chip.setAttribute(
          "aria-label",
          "Location unknown. Hover for details."
        );
        return;
      }

      img.onerror = () => {
        img.onerror = null;
        img.src = UNKNOWN_SVG;
      };
      img.src = meta.flagUrl || UNKNOWN_SVG;

      tooltip.innerHTML = `<strong>${escapeHtml(meta.country || "Unknown")}</strong>${meta.ip ? `\n${escapeHtml(meta.ip)}` : ""}`;
      chip.setAttribute(
        "aria-label",
        "Server country flag. Hover to show country name and IP."
      );
    });
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      mount();
    }
  } catch {}
})();
