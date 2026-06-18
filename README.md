# Show Country

Minimal **Chrome** and **Firefox** extension (Manifest V3): resolves the **top-level page hostname** to an IP, looks up **approximate country** using public IP geolocation APIs, and shows a **small flag** in the bottom-right of the page. **Country name and IP appear only on hover.**

**DNS:** On **Firefox / LibreWolf**, hostname resolution uses the **`dns` WebExtension API** (`browser.dns.resolve` with `disable_trr`), i.e. **your normal system / network DNS** (not extension `fetch` to public DoH URLs). On **Chrome**, MV3 extensions have no equivalent API, so the extension still uses **DNS-over-HTTPS** for that step.

## Browser support

| Browser | Minimum | Manifest |
|---------|---------|----------|
| **Chrome** / Chromium | Current stable channel practices (MV3) | [`manifest.json`](manifest.json) |
| **Firefox** | **128.0** (MV3; `dns` + `optional_host_permissions`; background uses **`scripts`**, not `service_worker`) | [`manifest-firefox.json`](manifest-firefox.json) — same logic as Chrome; Gecko id for signing/temporary install. |

The same `service_worker.js`, **`resolve_core.js`** (shared hostname→IP + geo logic for both engines), `content/`, `options.html`, `options.js`, `options.css`, and `icons/` are used for both; only the manifest differs. On Firefox, hostname resolution uses **`browser.dns.resolve`** inside `resolve_core.js`; Chrome still uses the DoH helpers in that file — there is no separate “Firefox-only” script.

## Extension options (optional self-hosted geo)

You can point the extension at a **small HTTP(S) service** you control (for example [cloud66-oss/geo](https://github.com/cloud66-oss/geo) behind `http://geoip.tma` or a reverse proxy). Open the extension **options** page:

| Browser | Where to open options |
|---------|-------------------------|
| **Chrome** / Chromium | `chrome://extensions` → **Show Country** → **Details** → **Extension options** (or the gear / “Extension options” entry, depending on version). |
| **Firefox** | `about:addons` → **Show Country** → **⋯** / preferences → opens `options.html`. |

**Configured request shape (only this variant is implemented):** `GET {base URL}/{resolved public IP}` — for example base `http://geoip.tma` becomes `http://geoip.tma/8.8.8.8`. If your upstream expects a path prefix (e.g. `/v1/ip`), include it in the base URL, e.g. `http://geoip.tma/v1/ip` → `http://geoip.tma/v1/ip/8.8.8.8`.

**JSON:** The response must be JSON the extension can map to a country, either:

- A thin object: `{ "country": "…", "countryCode": "DE" }` (`countryCode` must be a two-letter ISO code), or  
- A [cloud66-oss/geo](https://github.com/cloud66-oss/geo)-style object with `country.iso_code` and optional `country.names` (e.g. `names.en`).

**Behaviour:** If a base URL is saved, the service worker tries your endpoint first (short timeout). On failure (network, timeout, HTTP error, or unrecognised JSON), it falls back to the **same public geo providers** as before. After a failed homelab attempt, homelab is **skipped for about 5 minutes** (persisted in `storage`) so every page load does not wait on the homelab timeout; homelab is tried again after that window. A successful homelab response clears that backoff. Host resolves from the service worker run **one at a time** so backoff updates from parallel tabs/frames cannot overwrite a success.

**Permissions:** Saving a non-empty URL triggers a **host permission** prompt for that origin (via `optional_host_permissions` patterns `http://*/*` and `https://*/*`). Saving also **clears homelab backoff** (`homelabGeo`) so the next page loads try your endpoint again. Clearing the field removes the stored URL and backoff state (it does not revoke already granted origins).

**Storage:** If you use **“Delete extension storage”** (or similar) in `about:debugging`, that wipes **`customGeoBaseUrl`** too — the extension will **not** call your homelab until you open **options** again and **save** `http://geoip.tma` (and accept the host permission prompt if shown).

**Troubleshooting:** If the Network tab of the **service worker** still shows only public geo hosts (e.g. ipwho.is) after saving your base URL: (1) confirm the host permission was **allowed** when saving; (2) if homelab failed once, wait **~5 minutes** or clear the URL and save again to reset backoff; (3) reload the extension or revisit the page — the in-memory cache is keyed by your saved base URL and cleared when options change, so you should see `GET` to your host for **public** (non-RFC1918) resolved IPs. Homelab calls use **exactly** the URL you saved (`https://geoip.tma/…` or `http://…`), never a rewritten IP host. If DevTools still show `https://<LAN-IP>/…`, check that **options** do not use a literal-IP base URL and that your **server does not redirect** the browser to an IP URL (redirects bypass ingress host routing). **Firefox / LibreWolf:** if `fetch` to an internal hostname fails while `browser.dns.resolve` works, fix **split-horizon / extension DNS** so the hostname request succeeds; the add-on does not substitute an IP for the host anymore.

**Self-hosted data licensing:** If your backend uses **MaxMind GeoLite2** or similar databases, you are responsible for **license compliance** (for example GeoLite2 **CC BY-SA 4.0** attribution and redistribution rules). This repository does not ship MMDB files.

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
| **“Corrupt”** even for temporary load (older builds) | Firefox MV3 does **not** use Chrome’s `background.service_worker` alone; this repo’s Firefox manifest uses **`background.scripts`** so the add-on validates. Use the latest **`show-country-firefox-…zip`**. Versions of **Firefox below 128** are not supported for this package because **`optional_host_permissions`** (self-hosted geo URL) requires newer Firefox. |
| **“Has not been verified”** (unsigned add-on) | You are using **Add-ons → Install Add-on From File** (or similar) with an **unsigned** package. That path requires a **Mozilla-signed** `.xpi`. Use **`about:debugging` → Load Temporary Add-on… → `manifest.json`**, download the **`show-country-firefox-signed-…xpi`** from [Releases](https://github.com/smallouki/countryfinder/releases) after [AMO signing is configured](docs/MOZILLA_SIGNING.md), or sign yourself via AMO. |

### LibreWolf (and similar Firefox forks)

**LibreWolf** is built to treat add-on signing like a hardened Firefox: **`about:config` → `xpinstall.signatures.required = false` often does nothing** for “Install add-on from file”, because signing can be enforced at **build time** (`MOZ_REQUIRE_SIGNING`), not only by that preference.

- **Still use** **`about:debugging#/runtime/this-firefox`** → **Load Temporary Add-on…** → select **`manifest.json`** from the **extracted** `show-country-firefox-…` folder. That path is for **development** and does **not** require a Mozilla signature (same idea as Firefox).
- To **install permanently** from a file in LibreWolf (or normal release Firefox), download the **`show-country-firefox-signed-…xpi`** from [Releases](https://github.com/smallouki/countryfinder/releases) once [CI signing is set up](docs/MOZILLA_SIGNING.md), then **Install add-on from file**. Without that signed artifact, you need a **signed** `.xpi` from Mozilla ([self-distribution / unlisted signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)), not the raw unsigned ZIP.

## Permissions

| Permission / access | Why |
|---------------------|-----|
| **Host permissions** | **Chrome:** DoH resolvers plus geolocation and flag CDN (see manifest). **Firefox:** `http://*/*` (HTTP homelab on LAN, including a **literal-IP** base URL in options if you use one), geolocation, flags, and optional self-hosted HTTPS — **no** public DoH hosts for DNS (`dns` API instead). |
| **`dns`** (Firefox / LibreWolf manifest only) | Resolve the tab hostname with **`browser.dns.resolve`** (flags include **`disable_trr`** so Firefox’s own DoH/TRR is not used). That follows **your OS / network DNS** (e.g. the server you configured in system settings), not extension-initiated DoH `fetch` calls. |
| **`storage`** | Save the optional custom geo base URL and homelab retry/backoff timestamps. |
| **`optional_host_permissions`** (`http://*/*`, `https://*/*`) | Allow granting **only the origins you configure** in options (self-hosted geo). Nothing is prefetched automatically beyond your saved URL. |
| **Content scripts** on `<all_urls>` | Inject the small overlay on normal web pages. |

The extension does **not** read passwords, form data, or browsing history. Network requests are limited to resolving the **current tab’s document hostname** and the resulting **IP** for display.

## Privacy & data flows

When a page is loaded, the extension may send:

- **Firefox / LibreWolf:** The **hostname** to the browser’s **native DNS resolver** via `browser.dns.resolve` (with **`disable_trr`**, so Firefox’s **Trusted Recursive Resolver / browser DoH** is not used). That uses the same path as normal name resolution for your configured **system / network DNS** — **not** HTTPS requests to Quad9 etc. from this add-on.
- **Chrome / Chromium:** The **hostname** to **DNS-over-HTTPS** endpoints listed in [`manifest.json`](manifest.json) (there is no supported way for MV3 extensions to call only the OS resolver for arbitrary hostnames). Resolvers are tried **in order**; **Quad9 is first**. **Google Public DNS is not used.**
- **All browsers:** The **resolved IP address** to **IP geolocation** services (and optionally your **custom geo base URL**).

If you configure a **custom geo base URL** in options, the **resolved public IP** is also sent to **that** origin (first), using `GET {your base}/{ip}` as documented above. Those requests are made by the extension’s **service worker**, not by the web page. No separate analytics or telemetry are implemented in this repository; any logging depends on the browser and OS.

### Third-party endpoints (manifest host permissions)

**Chrome — DNS / DoH (hostname → IP):** Quad9, OpenDNS, AdGuard, Cloudflare, `1.1.1.1` (no Google Public DNS).

**Firefox:** No DoH hosts in the manifest for DNS; hostname resolution uses the **`dns`** permission and **`browser.dns.resolve`** instead.

**All — Geolocation (fallback order):** ipwho.is, ipinfo.io, ipapi.co, geojs.io, ip-api.com (HTTP). `NS_ERROR_CONNECTION_REFUSED` (or similar) on a host usually means a **firewall, DNS filter, or Pi-hole** is blocking that domain — a later provider in the chain may still succeed.

**All — Flags:** flagcdn.com.

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

**CI note:** `package-lock.json` must list tarball URLs on **`https://registry.npmjs.org/`** (the public registry). If `npm install` was run behind a corporate npm mirror, regenerate the lockfile before pushing, for example:

```bash
rm -rf node_modules package-lock.json
NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ npm install
```

Otherwise GitHub Actions can fail with `npm error code E401` when `npm ci` cannot reach that mirror.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) (`PolyForm-Noncommercial-1.0.0`). See `LICENSE`. Commercial use is not permitted; the license text also allows specific nonprofit, educational, and government uses.
