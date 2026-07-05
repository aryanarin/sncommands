# Cross-browser notes (Chrome vs Firefox)

`chrome/` and `firefox/` share every `.js`/`.html`/asset file — only
`manifest.json` differs. This is intentional: Firefox's `chrome.*` /
`browser.*` WebExtension APIs are Promise-based the same way Chrome's MV3
APIs are, so the same `async`/`await` code runs unmodified on both.

## What's different in `firefox/manifest.json`

| Key | Chrome | Firefox | Why |
|---|---|---|---|
| `background` | `{ "service_worker": "background.js" }` | `{ "scripts": ["background.js"] }` | Firefox's MV3 implementation doesn't support the `service_worker` key — it runs background scripts as an event page instead. Behavior for this extension (message listeners, no persistent state) is equivalent either way. |
| `browser_specific_settings` | not present | `gecko.id`, `gecko.strict_min_version`, `gecko.data_collection_permissions`, `gecko_android.strict_min_version` | Required by Firefox/AMO: a stable extension ID, a minimum version that supports the manifest features used (`optional_host_permissions` needs 128+, `data_collection_permissions` needs 140+), and the new mandatory data-collection disclosure (this extension collects nothing, hence `"required": ["none"]`). |

Everything else — `permissions`, `host_permissions`, `optional_host_permissions`,
`content_scripts`, `action`, `icons` — is identical.

## Linting

The Firefox build was validated with Mozilla's official linter:

```
cd firefox
npx web-ext lint --self-hosted
```

Result: **0 errors**, 2 warnings — both `DANGEROUS_EVAL`, both in
`background.js`, both inherent to the extension's core feature (running the
user's own saved scripts on the page via `chrome.scripting.executeScript`
with a `MAIN`-world `eval`). This is expected for developer-tool-style
extensions and doesn't block self-distribution or AMO submission, but AMO's
manual reviewers may ask for a short explanation — see
[CHROME_STORE_NOTES.md](CHROME_STORE_NOTES.md) for the equivalent Chrome
justification, which applies here too.

An earlier lint pass also flagged two `UNSAFE_VAR_ASSIGNMENT` warnings: the
"No results for '…'" empty-state message was built by concatenating the raw
search box value into `innerHTML`. Fixed in both `settings.js` and `popup.js`
by using `Node.append()` with plain strings instead, so the text is always
inserted as text, never parsed as HTML.

## Testing a Firefox build locally

```
cd firefox
about:debugging#/runtime/this-firefox   # in Firefox's address bar
# → Load Temporary Add-on… → select firefox/manifest.json
```

To produce a distributable package:

```
cd firefox
npx web-ext build
```
