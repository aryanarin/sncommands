# Changelog

All notable changes to this project are documented here.

## [4.8.3]
### Fixed
- **Keep-alive could report success without actually keeping the session
  alive.** It pinged a rotating list of endpoints that began with the REST route
  `/api/now/session`, and stopped rotating as soon as one answered 200.
  ServiceNow returns 200 from REST calls without pushing the session timeout
  back, so the helper looked healthy while the session still expired. It now
  requests a tiny classic UI page — `/incident_list.do` with a query that can
  never match, then `/stats.do`, then `/now/nav/header` — because only
  UI-level page loads count as activity for ServiceNow's session timer. The
  next page is tried only when the request actually fails.

### Improved
- Keep-alive pings no longer overlap, time out after 20 seconds, treat a
  redirect to the login page as a failure, cancel the response body once the
  status is known, and cache-bust every request. The timer is re-armed after
  each tick instead of using `setInterval`, so a slow request cannot stack up
  behind the next one, and a ping now also fires when a tab regains focus, not
  just when it becomes visible again.

### Notes
- No settings change: the helper is still off by default and still honours the
  configured 1–60 minute interval.

## [4.8.2]
### Fixed
- **Script text was invisible in dark mode, in both Chrome and Firefox.** The
  popup's `.script-area` textarea never set `color`, so it fell back to the
  browser's default field colour — black — on the dark `#161b22` editor surface.
  It now uses the theme's text token (and caret colour), and both themes declare
  `color-scheme` so native controls and scrollbars stop guessing at the theme.
- **Other text that sat below WCAG AA in one theme or the other:**
  - Light theme's dim grey and danger red were darkened; the dark theme's filled
    danger button now uses a solid red that carries white text.
  - Placeholders in the popup, settings fields and palette no longer use the UA
    grey; they follow `--text-dim`.
  - The in-page palette's hint text, `ESC`/`↵` chips, placeholder and caret were
    retuned for both themes; the palette also exposes its `color-scheme`.
  - CodeMirror line numbers, Dracula comments and the light theme's matching
    brackets are now readable; the support button gradient was darkened so its
    white label clears 4.5:1.
- Light and dark token sets in `popup.html`/`settings.html` now carry the same
  names, so a control can't accidentally inherit a colour that only exists in
  one theme.

### Added
- `tools/theme-audit.js` — a dependency-free cross-browser contrast audit. It
  renders the real popup, settings page and in-page palette in headless Chrome
  (DevTools protocol) and Firefox (WebDriver BiDi), with seeded commands and
  storage, and checks every visible text node, control value and placeholder
  against its computed background. 20 scenarios × both themes = 40 checks per
  browser, covering editors, fullscreen, bulk mode, modals and console errors.
- Static theme checks in `tools/check-wiring.js`: both themes must define every
  token, every text/surface pair must clear 4.5:1, white-on-accent/danger pairs
  must pass, the code editor must set an explicit text colour, and the palette's
  inline theme literals are checked the same way.

## [4.8.1]
### Fixed
- **Adding a custom instance domain always failed with "Permission not granted."**
  Settings → 🌐 Instances read the stored domain list *before* calling
  `chrome.permissions.request()`. A permission request is only honoured while the
  click that triggered it is still the active user gesture, and the first `await`
  in a handler spends that gesture — so the browser refused the request outright,
  before any prompt was shown, and every on-prem domain came back rejected. The
  request is now the first `await` in the handler, with the duplicate check done
  against an in-memory mirror of the list. The "enable on all websites" toggle
  already had the ordering right and was unaffected.
- **Unreadable, doubled-up text on unrelated websites.** With the extension enabled
  on all websites — or on a host added as an instance — the page theme applied
  itself to every page the content script reached, not just ServiceNow. Its rules
  reach generic elements including `textarea`, and a site that relies on a textarea
  being invisible breaks badly: GitHub's code viewer stacks a transparent one over
  the highlighted source, so forcing a colour onto it rendered every file as two
  offset copies of itself. The page theme, `Alt+Shift+T` and the page helpers now
  run only where the page is actually a ServiceNow instance.
- The keep-alive helper no longer pings ServiceNow session endpoints, with
  credentials, on non-ServiceNow hosts. Same root cause as above.

### Added
- `snPageGate` in `content.js`, the single answer to "is this page a ServiceNow
  instance?", consulted by the page theme and the page helpers. A page qualifies
  when configuration says so — a `service-now.com` (or `servicenowservices.com`)
  host, a domain added under Instances, or a host mapped to a theme — or when the
  document carries ServiceNow's own markers, which is what covers an on-prem host
  reached under "enable on all websites" that was never named anywhere. Markers are
  re-checked for ~18s after load, because Polaris finishes booting well after
  `document_idle` and the answer can legitimately change from no to yes.
- `check-wiring.js` covers the new gate: lookalike hostnames must not pass, wildcard
  instance patterns must cover their subdomains, an unconfigured host must be
  rejected even when other hosts are configured, and no marker may be a selector
  generic enough to match an ordinary website.

### Notes
- The `\` palette is deliberately *not* gated. It only appears when you type `\`
  into an empty field, so it costs an unrelated page nothing, and gating it would
  break the on-prem case the "all websites" option exists to serve.

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
