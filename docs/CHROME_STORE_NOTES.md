# Chrome Web Store — submission notes for SN Commands

A few things the Developer Dashboard will ask for that aren't part of the
extension package itself. Have these ready before you submit.

## 1. Privacy policy (required)

Because the extension requests broad host permissions (`*://*.service-now.com/*`
required, `<all_urls>` optional), Google requires a published privacy policy
URL in the "Privacy practices" tab. You can host a simple one at
`https://sncommands.ysaryan.eu.org/privacy` (or a GitHub Pages page) once that
site exists — for now, a plain page in the GitHub repo works too
(`https://github.com/aryanarin/sncommands/blob/main/PRIVACY.md`).

Key points to state (all true based on how the extension works):
- SN Commands does not collect, transmit, or sell any personal data.
- All commands, scripts, and settings are stored locally via
  `chrome.storage.local` on the user's own device/browser profile.
- The extension does not run any of its own remote servers or analytics.
- Host permissions are used only to inject the command palette and run the
  user's own saved scripts on ServiceNow pages the user visits — no page
  content is read or sent anywhere by the extension itself.

## 2. Permission justifications (fill in during submission)

| Permission | Why it's needed |
|---|---|
| `activeTab` / `tabs` | Find the ServiceNow tab to run a command against, from the popup. |
| `storage` | Save the user's custom commands and settings locally. |
| `scripting` | Inject the command palette and execute the user's saved scripts on the page. |
| `*://*.service-now.com/*` | Default supported domain for ServiceNow cloud instances. |
| `<all_urls>` (optional) | Only requested if the user explicitly enables it in Settings → Instances, to support on-prem or custom-domain ServiceNow instances that don't use `service-now.com`. |

Since `<all_urls>` is optional and user-triggered, mention this explicitly in
the justification text — reviewers look favorably on optional/opt-in broad
permissions vs. requesting them upfront.

## 3. Suggested store listing copy

**Short description (132 char max):**
Backslash (\) command palette for ServiceNow — run your own editable scripts instantly, on cloud or on-prem instances.

**Category:** Productivity

**Support / links:**
- Homepage: https://github.com/aryanarin/sncommands
- Support the project: https://ko-fi.com/ysaryan
- Community: https://sncommands.ysaryan.eu.org

## 4. Assets you'll still need to prepare separately

- Store icon: 128×128 (already have `icons/icon128.png` — check it looks
  good at small sizes before reusing).
- At least one 1280×800 (or 640×400) screenshot of the palette in action.
- Optional: a small promo tile (440×280) — the marketing-style screenshot
  you shared earlier is a good template for this.
