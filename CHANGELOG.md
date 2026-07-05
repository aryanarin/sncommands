# Changelog

All notable changes to this project are documented here.

# Changelog

All notable changes to this project are documented here.

## [Unreleased]
### Added
- Firefox build (`firefox/`), Manifest V3, linted clean with `web-ext lint`
  (0 errors). See `docs/CROSS_BROWSER.md` for what differs from the Chrome
  manifest and why.
### Fixed
- Hardened the "No results for …" empty-state message in the popup and
  settings command list — it was interpolating the raw search box value into
  `innerHTML`, which `web-ext lint` flagged as an unsafe assignment. Now
  inserted as plain text via `Node.append()`, so it can never be parsed as
  HTML. Applied to both the Chrome and Firefox builds.

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
- Removed all references to the `mercedes-benz.com` domain from the default
  permissions and code — it's no longer auto-granted; can still be added
  manually as a custom domain via Instances if needed.

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
