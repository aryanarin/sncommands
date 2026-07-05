# SN Commands

A backslash (`\`) command palette for ServiceNow — save your own editable scripts
as named commands, and run any of them instantly from anywhere on the page.

Works on ServiceNow cloud instances (`*.service-now.com`) out of the box, and
can be configured to run on on-prem or custom-domain instances too.

> 📸 *Add a screenshot of the palette in action here — e.g. `docs/screenshot-palette.png` — once you have one.*

---

## Features

- **`\` command palette** — press the trigger anywhere on a ServiceNow page to
  open a searchable list of your saved commands, then hit Enter (or click) to
  run one instantly.
- **Editable scripts** — every command is just a small piece of JavaScript you
  write and can edit any time, with a full-screen CodeMirror editor, syntax
  highlighting, and auto-formatting.
- **Import / Export** — back up your command library as JSON, or share it with
  teammates. Importing merges by name (a duplicate name *replaces* the
  existing command) or can fully replace your library.
- **Works globally, including on-prem** — turn on "all websites" access with
  one toggle, or grant access to a specific list of on-prem/custom domains from
  Settings → Instances, without needing a new extension build.
- **Light / dark theme**, resizable panels, sort by custom order / name / date.
- **Chrome MV3** — service-worker background script, no remote code execution.

## Installation

### From source (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the folder you downloaded.

### Chrome Web Store

Coming soon — this repo will be updated with the store link once it's live.

## Usage

1. Open the extension popup (toolbar icon) or the full settings page (⚙️) to
   create a command: give it a name, an optional hint, and the script to run.
2. On any supported ServiceNow page, type `\` to open the palette.
3. Type to filter, use ↑/↓ to navigate, and press **Enter** (or click a row)
   to run a command.

### Running on an on-prem or custom-domain instance

By default, SN Commands only runs on `*.service-now.com`. To use it on an
on-prem instance or a differently-named cloud instance:

1. Open the full settings page → **🌐 Instances**.
2. Either:
   - Turn on **Enable on all websites** (simplest — works everywhere), or
   - Add your instance's domain under **Add specific instance domains**
     (least-privilege — Chrome will ask you to confirm access to just that
     domain).
3. Reload any already-open ServiceNow tabs.

## Project structure

```
sncommands/
├── manifest.json        # MV3 manifest
├── background.js        # Service worker: script execution, dynamic content-script registration
├── content.js            # Injected into ServiceNow pages: the \ command palette
├── popup.html/.js        # Toolbar popup: quick command list + editor
├── settings.html/.js     # Full settings page: command library, import/export, Instances, Support
├── icons/                # Extension icons + UPI QR asset
└── lib/                  # Bundled CodeMirror + js-beautify for the script editor
```

## Contributing

Issues and pull requests are welcome. If you run into a bug, please include:
the ServiceNow version/theme you're on (UI16 / Now Experience), the browser
and version, and steps to reproduce.

## Support this project

SN Commands is built and maintained in spare time. If it saves you time:

- ☕ **International:** [ko-fi.com/ysaryan](https://ko-fi.com/ysaryan)
- 🇮🇳 **India (UPI):** `ysaryanraj@okaxis` — QR code is in the Support panel
  inside the extension's settings page.
- ⭐ Starring this repo also helps a lot — it costs nothing and helps others
  discover the project.

## Community

Join the community / follow updates at
[sncommands.ysaryan.eu.org](https://sncommands.ysaryan.eu.org).

## License

MIT — see [LICENSE](LICENSE).
