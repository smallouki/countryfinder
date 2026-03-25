# Show Country

Minimal Chrome extension (Manifest V3): resolves the **top-level page hostname** to an IP (via DNS-over-HTTPS), looks up **approximate country** using public IP geolocation APIs, and shows a **small flag** in the bottom-right of the page. **Country name and IP appear only on hover.**

## Features

- DNS resolution in the **service worker** (multiple DoH providers with fallbacks).
- Geolocation via several **free HTTPS APIs** (with fallbacks); optional HTTP fallback for geolocation only.
- Flag images from a public CDN (ISO 3166-1 alpha-2 codes).
- Special UI for **local / private** hosts and for **errors** (custom SVGs).
- In-memory caching in the background worker to reduce API calls.

## Install from source

1. Clone or download this repository.
2. Open `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the folder that contains `manifest.json`.

After code changes, use **Reload** on the extension card and refresh the tab.

## Permissions (Chrome Web Store)

| Permission / access | Why |
|---------------------|-----|
| **Host permissions** (listed in `manifest.json`) | Allow the service worker to call DoH and geolocation endpoints and to load flag images. |
| **Content scripts** on `<all_urls>` | Inject the small overlay on normal web pages. |

The extension does **not** read passwords, form data, or browsing history. Network requests are limited to resolving the **current tab’s document hostname** and the resulting **IP** for display.

## Privacy & data flows

When you visit a page, the extension may send:

- The **hostname** (and DNS query type) to **DNS-over-HTTPS** providers.
- The **resolved IP address** to **IP geolocation** services.

Those requests are made by the extension’s **service worker**, not by the web page. No separate analytics or telemetry are implemented in this repository; any logging would be subject to your browser and OS.

### Third-party endpoints (current `manifest.json`)

DNS / DoH (examples): Google, Quad9, OpenDNS, AdGuard, Cloudflare, `1.1.1.1`.

Geolocation (examples): reallyfreegeoip.org, ipinfo.io, ipwho.is, ipapi.co, geojs.io, ip-api.com (HTTP fallback).

Flags: flagcdn.com.

**You** (as publisher) are responsible for complying with each provider’s **terms of use**, **rate limits**, and **privacy policies**. Services may change, block, or rate-limit traffic without notice. Consider hosting your own backend or reducing providers if you need stricter control.

## Legal notices & limitations (important)

This section is for **general information only** and is **not legal advice**.

1. **No warranty.** The software is provided “as is”. DNS answers, IP geolocation, and flags may be **wrong, outdated, or unavailable**. Do not rely on this extension for **legal evidence**, **security decisions**, **compliance**, or **critical operations**.
2. **No affiliation.** This project is **not** affiliated with, endorsed by, or sponsored by Google, Cloudflare, Quad9, Cisco/OpenDNS, AdGuard, ipinfo, ipwho, ipapi, GeoJS, ip-api, flagcdn, or any other third-party service.
3. **Third-party terms.** Using the extension causes data to be sent to third parties as described above. Users and publishers must respect applicable **laws** and the **terms** of those services.
4. **Flags & geography.** Flag images and country labels are **informational** and may not reflect political or territorial disputes. Country detection is **approximate** (IP-based) and may show the location of a **CDN, VPN, or hosting provider** rather than the “origin” a user might expect.
5. **Icon.** The product icon uses a **stylized, simplified map silhouette** for recognition only; it is **not** an authoritative geographic or cartographic product.
6. **Liability.** To the extent permitted by law, the authors and contributors disclaim liability for damages arising from use of this software.

For **Chrome Web Store** publication, Google requires accurate disclosures (e.g. **privacy practices**, **single purpose**, **permission justification**). Prepare a **privacy policy** that matches what your shipped build actually does, and host it at a stable URL.

## Development

Regenerate PNG icons (requires [Pillow](https://pypi.org/project/pillow/)):

```bash
python3 scripts/generate_icons.py
```

## License

Add a `LICENSE` file before publishing (e.g. MIT) if you want others to reuse the code under clear terms. If you omit a license, default copyright applies and others have no clear right to reuse the work.

---

**Kurzfassung (DE):** Zeigt Server-IP (per DNS) und ungefähres Herkunftsland mit Flagge; Daten gehen an öffentliche DNS-/Geo- und Flaggen-CDNs — keine Garantie auf Richtigkeit; keine Rechtsberatung; für den Web Store brauchst du u. a. eine passende **Datenschutzerklärung** und korrekte Angaben zu Berechtigungen.
