# Show Country

Minimal **Chrome** and **Firefox** extension (Manifest V3): resolves the **top-level page hostname** to an IP (via DNS-over-HTTPS), looks up **approximate country** using public IP geolocation APIs, and shows a **small flag** in the bottom-right of the page. **Country name and IP appear only on hover.**

## Browser support

| Browser | Minimum | Manifest |
|---------|---------|----------|
| **Chrome** / Chromium | Current stable channel practices (MV3) | [`manifest.json`](manifest.json) |
| **Firefox** | **121.0** (MV3; background uses **`scripts`**, not `service_worker`) | [`manifest-firefox.json`](manifest-firefox.json) — same logic as Chrome; Gecko id for signing/temporary install. |

The same `service_worker.js`, `resolve_core.js`, `content/`, and `icons/` are used for both; only the manifest differs.

## Install from source

### Chrome

1. Clone or download this repository.
2. Open `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the folder that contains **`manifest.json`** (the Chrome manifest at repo root).

### Firefox (local / unsigned)

Firefox **does not** install unsigned extensions from **Add-ons → Install Add-on From File** the way you might expect a `.zip`: that path expects a **Mozilla-signed `.xpi`**, and an unsigned archive often fails with **“corrupt”** or verification errors even though the files are fine.

For day‑to‑day testing, use a **temporary** install:

1. Download **`show-country-firefox-…zip`** from [GitHub Releases](https://github.com/smallouki/countryfinder/releases) (or build the folder yourself).
2. **Extract** the ZIP so you have a folder that contains **`manifest.json`** next to `service_worker.js`, `content/`, `icons/`, etc. (Do **not** point Firefox at the `.zip` file for this flow.)
3. Open **`about:debugging#/runtime/this-firefox`**.
4. Click **Load Temporary Add-on…**.
5. In the file picker, open that folder and select **`manifest.json`** (Firefox expects a **file**, not the parent folder; if needed, set the dialog filter to **All Files**).

The add-on stays loaded until you restart Firefox or remove it from the debugging page.

After code changes: use **Reload** on `about:debugging`, then refresh the tab.

## GitHub Releases (CI)

On each push to **`main`**, [`.github/workflows/release-on-main.yml`](.github/workflows/release-on-main.yml) publishes a release with **two ZIPs**, and optionally a **signed Firefox `.xpi`**:

- **`show-country-chrome-{version}-{run}.zip`** — contains Chrome `manifest.json` and extension files; load unpacked in Chrome.
- **`show-country-firefox-{version}-{run}.zip`** — ships **`manifest.json`** copied from `manifest-firefox.json` so Firefox can load the folder without manual renaming. **Unpack the ZIP**, then use **Load Temporary Add-on…** and choose that **`manifest.json`** (see Firefox section above). This is **not** a signed XPI for permanent “Install from file” on release Firefox.
- **`show-country-firefox-signed-{version}-{run}.xpi`** (when configured) — Mozilla‑signed **unlisted** add-on for **Add-ons → Install Add-on From File** in Firefox, **LibreWolf**, etc. Requires repository secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`; see **[docs/MOZILLA_SIGNING.md](docs/MOZILLA_SIGNING.md)** for one-time setup.

Release tags use **`v{version}-build.{run_number}`** so repeated pushes do not collide on the same semantic version.

### Firefox: “corrupt” or install failures

| Symptom | Cause |
|--------|--------|
| **“Corrupt”** when using **Install Add-on From File** on the `.zip` | Normal **release** Firefox requires **AMO-signed** packages for that entry point. Use **temporary add-on** (above), **Developer Edition** with signing disabled for local use, or [sign the XPI](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). |
| **Cannot select the folder** in **Load Temporary Add-on** | The picker wants a **file** — choose **`manifest.json`** inside the extracted folder. |
| **“Corrupt”** even for temporary load (older builds) | Firefox MV3 does **not** use Chrome’s `background.service_worker` alone; this repo’s Firefox manifest uses **`background.scripts`** so the add-on validates. Use the latest **`show-country-firefox-…zip`**. |
| **“Has not been verified”** (unsigned add-on) | You are using **Add-ons → Install Add-on From File** (or similar) with an **unsigned** package. That path requires a **Mozilla-signed** `.xpi`. Use **`about:debugging` → Load Temporary Add-on… → `manifest.json`**, download the **`show-country-firefox-signed-…xpi`** from [Releases](https://github.com/smallouki/countryfinder/releases) after [AMO signing is configured](docs/MOZILLA_SIGNING.md), or sign yourself via AMO. |

### LibreWolf (and similar Firefox forks)

**LibreWolf** is built to treat add-on signing like a hardened Firefox: **`about:config` → `xpinstall.signatures.required = false` often does nothing** for “Install add-on from file”, because signing can be enforced at **build time** (`MOZ_REQUIRE_SIGNING`), not only by that preference.

- **Still use** **`about:debugging#/runtime/this-firefox`** → **Load Temporary Add-on…** → select **`manifest.json`** from the **extracted** `show-country-firefox-…` folder. That path is for **development** and does **not** require a Mozilla signature (same idea as Firefox).
- To **install permanently** from a file in LibreWolf (or normal release Firefox), download the **`show-country-firefox-signed-…xpi`** from [Releases](https://github.com/smallouki/countryfinder/releases) once [CI signing is set up](docs/MOZILLA_SIGNING.md), then **Install add-on from file**. Without that signed artifact, you need a **signed** `.xpi` from Mozilla ([self-distribution / unlisted signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)), not the raw unsigned ZIP.

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

### Firefox: pack folder and AMO signing (local)

```bash
npm install
npm run pack:firefox   # writes build/firefox-addon/ (same layout as CI)
```

Signing locally (needs `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` in the environment — see **[docs/MOZILLA_SIGNING.md](docs/MOZILLA_SIGNING.md)**):

```bash
export AMO_JWT_ISSUER='…'
export AMO_JWT_SECRET='…'
npm run sign:firefox
```

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) (`PolyForm-Noncommercial-1.0.0`). See `LICENSE`. Commercial use is not permitted; the license text also allows specific nonprofit, educational, and government uses.
