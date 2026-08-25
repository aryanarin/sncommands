# Changelog

All notable changes to this project are documented here.

## [4.8.0]
### Added
- **Page helpers**, three independent conveniences with a toggle each, all **off by
  default**. Settings page → ⚡ Helpers.
  - **Keep my session alive** — pings a lightweight endpoint on the instance in that
    tab every *N* minutes (1–60, default 2), plus once whenever you return to a
    backgrounded tab, which is where sessions tend to quietly expire. Interval is
    configurable in the same panel.
  - **Show reopen count on incidents** — reads the record's `reopen_count` when an
    incident form loads and reports it as a native banner, green at zero and red
    above it. Tracks the last record it announced so it won't repeat itself, and
    follows SPA navigation between records.
  - **Ctrl+Enter posts a work note** (`Cmd+Enter` on macOS) — routed through
    Angular's own handler, falling back to a plain click, so the activity stream
    doesn't end up with a stale scope.
- `helpers.js`, holding the helper definitions and the two injected scripts, shared
  by the content script and the settings page. The settings rows are generated from
  its metadata, so adding a helper is a one-file change.
- `check-wiring.js` grew a page-helper section: both injected scripts must parse,
  must guard against double-injection, and must honour their live on/off attribute;
  every helper must default to off; the keep-alive interval clamp is exercised with
  blank, non-numeric, zero and absurd input; keep-alive endpoints must be
  instance-relative, not absolute; and every entry in the helper metadata must have
  matching default settings.

### Changed
- Content scripts are now registered as
  `['themes.js', 'helpers.js', 'content.js']` in both manifests and in the dynamic
  registration used for custom and on-prem domains.
- **Privacy policy revised, and this one is substantive.** The previous blanket
  claim of "no network requests of any kind" stops being unconditionally true once
  keep-alive or the reopen-count banner is switched on. The policy now states that
  the extension makes no requests at all out of the box, that enabling a helper
  causes requests **to your own instance only**, and describes exactly what each
  helper does on the network. Nothing goes to us or any third party in any case —
  there is still no server.

### Notes
- Two of the three helpers run in the page's MAIN world via the existing background
  execution path, because a content script's isolated world can't reach `g_form`,
  `g_ck` or `angular`. Keep-alive stays in the content script, where its timer
  survives as long as the tab — an MV3 service worker is torn down after ~30s idle
  and would never reach a minutes-long interval.
- The injected helpers run in every frame, since classic UI keeps the form and the
  Post button inside the `gsft_main` iframe. Keep-alive is top-frame only, so its
  pings aren't multiplied by the frame count.
- Switching an injected helper off doesn't un-inject it — the content script mirrors
  each toggle onto `<html>` as an attribute and the resident script checks it before
  acting. Same effect, reversible without a reload.
- Helpers live in their own IIFE with independent error handling, so a failure there
  can't take down the command palette or the page theme.

## [4.7.0]
### Added
- **Optional ServiceNow page theme.** Restyles ServiceNow itself: coloured and
  subtly patterned header, white workspace, tighter lists with a coloured column
  underline and faint row hover, unmistakably inert read-only fields, and the date
  picker explicitly shielded from the list rules that would otherwise wreck its
  layout. Five faded palettes — Steel Teal, Info Azure, Slate Indigo, Sage Moss,
  Ash Clay — all carrying white header text at 4.5:1 or better.

  **Off by default.** Installing a command palette shouldn't restyle anyone's
  instance. Settings page → 🎨 Page Theme.
- **Per-instance theme mapping.** Set a default palette, then override individual
  instances. Matching is by hostname with specificity precedence, so mapping
  `service-now.com` covers everything on it while a mapping for one instance still
  wins. Full URLs are accepted and normalised. Handy for making production visually
  distinct from dev.
- **Alt+Shift+T** cycles palettes on any themed ServiceNow page, and saves the
  result as that instance's mapping — the shortcut and the settings table are two
  views of one setting rather than competing ones. Changes reach open tabs
  immediately via a `storage.onChanged` listener; no reload, no save button.
- `themes.js`, holding the palettes and CSS builders, loaded by both the content
  script and the settings page so the colours are defined exactly once.
- `check-wiring.js` grew checks for that shared dependency: every identifier the
  consumers use is actually exported, load order is correct in the manifest / in
  `settings.html` / in the dynamic registration, all five palettes pass contrast,
  host resolution honours specificity, theming defaults to off, and the generated
  CSS contains no remote URLs.

### Changed
- The palette-hosting content script is now registered as
  `['themes.js', 'content.js']` in both manifests and in the dynamic registration
  used for custom and on-prem domains.
- Privacy policy updated: host access and `scripting` now also cover applying the
  page theme, and the locally-stored settings list mentions the theme choice and
  its per-instance mappings. No new data leaves the device — the policy's "no
  network requests of any kind" claim still holds, and now says so explicitly about
  the theme.

### Notes
- The design this was ported from imported DM Sans from Google Fonts. That would
  have meant an outbound request from every ServiceNow page, contradicting the
  extension's no-network guarantee, so it was dropped. `Product Sans` and
  `Google Sans` are used when locally installed; otherwise the platform UI font.
- Page theming is wrapped in its own IIFE with independent error handling, so a
  Polaris DOM change or a locked-down frame can't take the command palette down
  with it.

## [4.6.0]
### Added
- **Usage tracking.** Every command now records how often it has run, plus its
  creation, last-edited and last-run dates. Shown as
  `used 12 times · created 25/08/2026 · edited 25/08/2026` beneath the editor in
  both the popup and the settings page. Counting happens in the background
  worker rather than the caller, so the palette running in several frames or
  tabs at once can't lose increments. Commands saved before this version read
  `used 0 times` and start counting from their next run.
- **🔥 Most used** sort option, alongside custom order, name and date created.
- **Eight sample commands** seeded on a fresh install: `\copysysid`, `\sysinfo`,
  `\email`, `\myprofile`, `\sowview`, `\defaultview`, `\excel` and `\reload`.
  All of them read the instance host from the page, so they work on any
  instance, cloud or on-prem, with no configuration. Seeding runs on install
  only — an update never injects entries into an existing library, and a
  deliberately cleared library stays cleared.
- **✉️ Contact Us** in the settings page and the popup, going to
  `contact@davagni.eu.org`.
- `tools/check-wiring.js` and `tools/sync-firefox.ps1`. The check validates both
  manifests, asset and DOM wiring, message wiring, seed-script syntax, and
  hashes the shared files in both builds so `chrome/` and `firefox/` can't drift
  apart unnoticed.
- Firefox build (`firefox/`), Manifest V3, linted clean with `web-ext lint`
  (0 errors). See `docs/CROSS_BROWSER.md` for what differs from the Chrome
  manifest and why. Now published on addons.mozilla.org.

### Fixed
- **The ▶ Run button on the settings page never actually ran anything.** It sent
  a `SN_COMMANDS_RUN` message to the tab with `chrome.tabs.sendMessage`, but
  `content.js` has no `onMessage` listener — the message was dropped and the
  "Running…" toast appeared regardless. It now goes through the background
  worker's `chrome.scripting.executeScript` path, the same one the popup and the
  palette use. All three callers share a single implementation.
- Import → Merge no longer resets the usage count on a command it replaces; the
  script is updated, the history is kept.
- Duplicating a command now carries its **Order** value across instead of
  dropping it.
- Hardened the "No results for …" empty-state message in the popup and settings
  command list — it was interpolating the raw search box value into `innerHTML`,
  which `web-ext lint` flagged as an unsafe assignment. Now inserted as plain
  text via `Node.append()`, so it can never be parsed as HTML.

### Changed
- **Sort is a single dropdown** instead of one button per mode. With a fourth
  mode added, the row of buttons made the header read as a wall of controls. The
  chosen mode is now remembered between visits.
- Muted and dim text colours lifted in both themes so hints, placeholders and
  the new meta line clear 4.5:1 against the surface behind them — several were
  closer to 2.5:1 before. The accent blue and the toolbar icon are unchanged.
- Header logo tile given a subtle gradient and shadow, in the same blue as the
  extension icon.
- Keyboard focus rings (`:focus-visible`) added across buttons, inputs and the
  sort dropdown, so tabbing through either page is actually followable.
- 💬 Community replaced by ✉️ Contact Us; the community site link is gone from
  the README too.
- The palette now follows theme changes live, instead of showing the old colours
  on already-open tabs until they were reloaded.
- README documents the published Chrome Web Store and Firefox Add-ons listings.

## [4.5.0]
### Added
- ❤️ Support panel (Ko-fi for international, UPI QR + copyable ID for India,
  GitHub star link), reachable from Settings and via a shortcut in the popup.
- 💬 Community button linking out to the community site.
### Changed
- Support button restyled (pink → violet gradient) to be clearly distinct
  from the red "Clear All" button; heart icon switched from emoji to inline
  SVG for consistent rendering across platforms.
- "Order" sort button made icon-only for a more compact header.
- Removed a hardcoded corporate instance domain from the default permissions and
  code — no specific organisation's host is auto-granted any more. Any instance
  can still be added manually as a custom domain via Instances.

## [4.4.0]
### Fixed
- Clicking a command in the palette list sometimes did nothing — hovering
  was rebuilding the entire list mid-click, occasionally clicking a
  dead/replaced element. Hover now updates styling in place instead, and
  command execution also fires on `mousedown` (capture phase) so it can't be
  swallowed by ServiceNow's own page-level click handlers.
- Importing a command with the same name as an existing one was silently
  skipped instead of replacing it. Import → Merge now replaces matching
  commands and reports how many were added vs. replaced.
### Added
- Settings → 🌐 Instances panel: enable the extension on all websites, or
  grant access to a specific list of on-prem/custom ServiceNow domains,
  without needing a new extension build. Uses `chrome.permissions.request`
  and dynamic content-script registration.

## [4.3.3] and earlier
- Migrated from Firefox MV2 to Chrome MV3 (service worker, `chrome.scripting`,
  `world: 'MAIN'` script injection).
- Core palette, command editor (CodeMirror), and import/export functionality.
