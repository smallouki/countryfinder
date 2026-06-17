# Mozilla (AMO) signing for Firefox / LibreWolf

Release Firefox builds from GitHub Actions can attach a **Mozilla-signed `.xpi`** so you can use **Add-ons → Install Add-on From File** in Firefox, **LibreWolf**, and other variants that require verification.

Signing uses Mozilla’s **Add-ons** site API ([`web-ext sign`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign)) in **unlisted** mode: the extension is **not** published on the public store, but Mozilla still signs it for self-distribution.

## Privacy

Submitting a build for signing uploads the **extension package** (the same files as the Firefox ZIP) to **Mozilla’s servers** for automated checks and signing. See Mozilla’s privacy policy for how they handle developer submissions.

## What you must do (once)

These steps cannot be automated for you: they bind the extension to **your** Mozilla account.

### 1. Mozilla account and API credentials

1. Create or use a [Firefox Account](https://accounts.firefox.com/).
2. Open **[Generate API keys](https://addons.mozilla.org/en-US/developers/addon/api/key/)** (Addons “Developer Hub” → tools; you may need to accept the developer agreement once).
3. Create **new** JWT credentials. You will get:
   - **JWT issuer** (sometimes labelled “API key”)
   - **JWT secret** (“API secret”)

Keep the secret private.

### 2. GitHub repository secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|-------------|--------|
| `AMO_JWT_ISSUER` | Paste the **JWT issuer** from step 1 |
| `AMO_JWT_SECRET` | Paste the **JWT secret** from step 1 |

After the next push to **`main`**, the release workflow will:

1. Build the same **`pack-firefox`** directory as the unsigned ZIP.
2. Run `web-ext sign --channel unlisted` against Mozilla’s API.
3. Attach **`show-country-firefox-signed-{version}-{run}.xpi`** to the same GitHub Release (in addition to the Chrome ZIP and unsigned Firefox ZIP).

If the secrets are **missing**, the workflow **skips** signing and only publishes the two ZIPs (same as before).

### Version numbers and AMO

Mozilla rejects a new upload if the **`version` in `manifest.json` matches a version you already submitted** for that add-on id.

In this repo:

- **Source** [`manifest-firefox.json`](manifest-firefox.json) carries the human-facing base version (e.g. `1.1.1`).
- **CI** rewrites the copy under `pack-firefox/manifest.json` to **`{base}.{github_run_number}`** (e.g. `1.1.1.184`) before zipping and calling `web-ext sign`, so each Actions run gets a **unique** AMO version without hand-editing files every push.

If AMO still reports a version conflict, bump the **base** version in **both** [`manifest.json`](manifest.json) and [`manifest-firefox.json`](manifest-firefox.json) so it is **greater than any version already accepted** for this add-on (AMO may reject a “downgrade” even with a unique string).

### 3. First submission and add-on id

The Firefox manifest sets a fixed Gecko id:

`countryfinder@smallouki.github` in [`manifest-firefox.json`](../manifest-firefox.json).

The **first** successful `web-ext sign` call creates an **unlisted** add-on on AMO with that id. If AMO ever reports the id as already taken, change the `id` in `browser_specific_settings.gecko` to another email-shaped string you control, then sign again.

### 4. License and AMO

This project uses **PolyForm Noncommercial**. Mozilla may run automated checks on upload; **unlisted** signing is usually suitable for personal/self-hosted distribution. If AMO rejects a build, read the validation message and adjust metadata or contact Mozilla support as needed.

## Local signing (optional)

From the repo root (requires Node and the same `AMO_*` credentials in your environment):

```bash
export AMO_JWT_ISSUER='your-issuer-here'
export AMO_JWT_SECRET='your-secret-here'
npm install
npm run pack:firefox
npx web-ext sign -s build/firefox-addon -a web-ext-artifacts --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"
```

Signed artifacts appear under `web-ext-artifacts/`. Add `web-ext-artifacts/` to your local ignore if you do not want them in git (the repo `.gitignore` already ignores this path).

## References

- [Signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [Temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) (unsigned ZIP / folder, no AMO)
