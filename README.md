# Show Country

Minimal **Chrome** and **Firefox** extension (Manifest V3): resolves the **top-level page hostname** to an IP (via DNS-over-HTTPS), looks up **approximate country** using public IP geolocation APIs, and shows a **small flag** in the bottom-right of the page. **Country name and IP appear only on hover.**

## Browser support

| Browser | Minimum | Manifest |
|---------|---------|----------|
| **Chrome** / Chromium | Current stable channel practices (MV3) | [`manifest.json`](manifest.json) |
| **Firefox** | **121.0** (MV3 background service worker) | [`manifest-firefox.json`](manifest-firefox.json) — same capabilities; includes `browser_specific_settings.gecko` for install/signing. |

The same `service_worker.js`, `resolve_core.js`, `content/`, and `icons/` are used for both; only the manifest differs.

## Install from source

### Chrome

1. Clone or download this repository.
2. Open `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the folder that contains **`manifest.json`** (the Chrome manifest at repo root).

### Firefox

1. Clone or download this repository.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**.
3. Choose **`manifest.json`** in the repo root **only if** it is the Firefox build: for development from git, temporarily use the Firefox manifest by copying `manifest-firefox.json` to `manifest.json` in a separate folder with the rest of the extension files, **or** use a **release ZIP** (below), which already contains the correct `manifest.json` for Firefox.

After code changes: reload the extension and refresh the tab.

## GitHub Releases (CI)

On each push to **`main`**, [`.github/workflows/release-on-main.yml`](.github/workflows/release-on-main.yml) publishes a release with **two ZIPs**:

- **`show-country-chrome-{version}-{run}.zip`** — contains Chrome `manifest.json` and extension files; load unpacked in Chrome.
- **`show-country-firefox-{version}-{run}.zip`** — ships **`manifest.json`** copied from `manifest-firefox.json` so Firefox can load the folder without manual renaming.

Release tags use **`v{version}-build.{run_number}`** so repeated pushes do not collide on the same semantic version.

## Permissions

| Permission / access | Why |
|---------------------|-----|
| **Host permissions** (in each manifest) | Allow the service worker to call DoH and geolocation endpoints and to load flag images. |
| **Content scripts** on `<all_urls>` | Inject the small overlay on normal web pages. |

The extension does **not** read passwords, form data, or browsing history. Network requests are limited to resolving the **current tab’s document hostname** and the resulting **IP** for display.

## Privacy & data flows

When a page is loaded, the extension may send:

- The **hostname** (and DNS query type) to **DNS-over-HTTPS** providers.
- The **resolved IP address** to **IP geolocation** services.

Those requests are made by the extension’s **service worker**, not by the web page. No separate analytics or telemetry are implemented in this repository; any logging depends on the browser and OS.

### Third-party endpoints (manifest host permissions)

DNS / DoH (examples): Google, Quad9, OpenDNS, AdGuard, Cloudflare, `1.1.1.1`.

Geolocation (examples): reallyfreegeoip.org, ipinfo.io, ipwho.is, ipapi.co, geojs.io, ip-api.com (HTTP fallback).

Flags: flagcdn.com.

## Legal notices & limitations (important)

This section is **general information** only and **not legal advice**.

1. **No warranty.** The software is provided “as is”. DNS answers, IP geolocation, and flags may be **wrong, outdated, or unavailable**. The extension must not be relied on for **legal evidence**, **security decisions**, **compliance**, or **critical operations**.
2. **No affiliation.** This project is **not** affiliated with, endorsed by, or sponsored by Google, Cloudflare, Quad9, Cisco/OpenDNS, AdGuard, ipinfo, ipwho, ipapi, GeoJS, ip-api, flagcdn, Mozilla, or any other third-party service.
3. **Third-party terms.** Use of the extension sends data to third parties as described above. Applicable **laws** and service **terms** apply.
4. **Flags & geography.** Flag images and country labels are **informational** and may not reflect political or territorial disputes. Country detection is **approximate** (IP-based) and may show the location of a **CDN, VPN, or hosting provider** rather than an intuitive “origin”.
5. **Icon.** The product icon uses a **stylized, simplified map silhouette** for recognition only; it is **not** an authoritative geographic or cartographic product.
6. **Liability.** To the extent permitted by law, the authors and contributors disclaim liability for damages arising from use of this software.

## Development

Regenerate PNG icons (requires [Pillow](https://pypi.org/project/pillow/)):

```bash
python3 scripts/generate_icons.py
```

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) (`PolyForm-Noncommercial-1.0.0`). See `LICENSE`. Commercial use is not permitted; the license text also allows specific nonprofit, educational, and government uses.
