'use strict';

// ── ServiceNow page themes ───────────────────────────────────────────────────
// Shared by content.js (applies the theme) and settings.js (configures it), so
// the palettes exist in exactly one place. Loaded ahead of content.js in the
// manifest's content_scripts, and via a <script> tag in settings.html.
//
// Declared with `var` on purpose: content scripts of the same extension share one
// isolated-world global scope, and `var` reliably publishes these bindings into it.

// Storage key for everything on this page's feature.
var SN_PAGE_THEME_STORE = 'snPageTheme';

// ── Palettes ─────────────────────────────────────────────────────────────────
// All five are identical in structure and behaviour — only the colours differ.
// White header text clears 4.5:1 on every one of them.
//
//   header  — the header bar itself
//   border  — the darker rule beneath it, and menu edges
//   accent  — list-header underline and input focus ring
//   tint    — a barely-there row hover in the workspace
//
// The workspace stays white in all five. These are header themes; the content
// area is not meant to compete with the nav.
var SN_PAGE_THEMES = {
    'steel-teal': {
        label:  'Steel Teal',
        note:   'Cool and clinical, closest to stock ServiceNow.',
        header: '#3d7d91',
        border: '#2b5a69',
        accent: '#3d7d91',
        tint:   '#f4f8f9'
    },
    'info-azure': {
        label:  'Info Azure',
        note:   "Deepened from ServiceNow's own info-banner blue.",
        header: '#395f94',
        border: '#2a4770',
        accent: '#395f94',
        tint:   '#f4f7fb'
    },
    'slate-indigo': {
        label:  'Slate Indigo',
        note:   'Blue-grey and the darkest of the five. The quiet one.',
        header: '#4a566b',
        border: '#353e4e',
        accent: '#4a566b',
        tint:   '#f5f6f8'
    },
    'sage-moss': {
        label:  'Sage Moss',
        note:   'Faded green. Easiest on the eyes over a long shift.',
        header: '#5d7a59',
        border: '#445c41',
        accent: '#5d7a59',
        tint:   '#f5f8f5'
    },
    'ash-clay': {
        label:  'Ash Clay',
        note:   'Dusty terracotta. The only warm one — good for spotting production.',
        header: '#8f6a5f',
        border: '#6e5148',
        accent: '#8f6a5f',
        tint:   '#f9f6f4'
    }
};

var SN_PAGE_THEME_ORDER   = Object.keys(SN_PAGE_THEMES);
var SN_PAGE_THEME_DEFAULT = 'steel-teal';

// Local fonts only. The design this came from pulled DM Sans off Google Fonts,
// which would mean an outbound request from every ServiceNow page you open —
// not something a "nothing leaves your device" extension should be doing. Product
// Sans and Google Sans are used when they happen to be installed; otherwise this
// falls through to the platform UI font.
var SN_PAGE_THEME_FONT =
    "'Product Sans', 'Google Sans', -apple-system, BlinkMacSystemFont, " +
    "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Identical across all five — the pattern is part of the design, not the palette.
var SN_PAGE_THEME_PATTERN =
    'radial-gradient(circle at 20px 20px, rgba(255, 255, 255, 0.08) 2%, transparent 0%), ' +
    'radial-gradient(circle at 70px 70px, rgba(255, 255, 255, 0.08) 2%, transparent 0%)';

// ── Settings shape ───────────────────────────────────────────────────────────
// enabled  — master switch, off by default. Nobody's instance gets restyled
//            because they installed a command palette.
// theme    — the fallback used on any host without its own mapping.
// hosts    — { hostname: themeKey }. Set from the settings page, and also written
//            by the in-page switcher so flipping a theme on an instance sticks.
function snDefaultPageThemeSettings() {
    return { enabled: false, theme: SN_PAGE_THEME_DEFAULT, hosts: {} };
}

function snNormalisePageThemeSettings(raw) {
    const out = snDefaultPageThemeSettings();
    if (!raw || typeof raw !== 'object') return out;

    out.enabled = raw.enabled === true;
    if (raw.theme && SN_PAGE_THEMES[raw.theme]) out.theme = raw.theme;

    if (raw.hosts && typeof raw.hosts === 'object') {
        Object.keys(raw.hosts).forEach(host => {
            const key = raw.hosts[host];
            // Drop mappings pointing at palettes that no longer exist.
            if (SN_PAGE_THEMES[key]) out.hosts[host] = key;
        });
    }
    return out;
}

// Strip protocol, path and port so "https://acme.service-now.com/nav_to.do" and
// "acme.service-now.com" both land on the same key.
function snCleanHost(raw) {
    let host = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!host) return '';
    host = host.replace(/^[a-z]+:\/\//, '');
    host = host.split('/')[0];
    host = host.split(':')[0];
    return host;
}

// Which theme applies on a given hostname?
//
// An exact mapping wins. Failing that, the longest matching parent domain wins, so
// mapping "service-now.com" covers every instance on it while a mapping for one
// specific instance still overrides that. Anything unmatched gets the default.
function snResolvePageTheme(settings, hostname) {
    const s    = snNormalisePageThemeSettings(settings);
    const host = snCleanHost(hostname);

    let matchedKey = null;
    let matchedLen = -1;

    Object.keys(s.hosts).forEach(mapped => {
        const m = snCleanHost(mapped);
        if (!m) return;
        const isMatch = host === m || host.endsWith('.' + m);
        if (isMatch && m.length > matchedLen) {
            matchedLen = m.length;
            matchedKey = s.hosts[mapped];
        }
    });

    const key = (matchedKey && SN_PAGE_THEMES[matchedKey]) ? matchedKey : s.theme;
    return {
        key:      key,
        theme:    SN_PAGE_THEMES[key] || SN_PAGE_THEMES[SN_PAGE_THEME_DEFAULT],
        fromHost: matchedKey != null
    };
}

// Polaris reads its colour custom properties as raw "R, G, B" triples, not hex.
function snHexToRgbTriple(hex) {
    const h = String(hex).replace('#', '');
    return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16)
    ].join(', ');
}

// ── Workspace CSS: lists, forms, the white content area ──────────────────────
function snPageThemeBaseCss(t) {
    return `
:root {
  --now-font-family: ${SN_PAGE_THEME_FONT} !important;
  --now-color_background--primary: 255, 255, 255 !important;
  --now-color_background--secondary: 255, 255, 255 !important;
  --now-color_text--primary: 40, 40, 40 !important;
  --now-color_border--primary: 209, 213, 219 !important;
}

body, input, select, textarea, button, .form-control, * {
  font-family: ${SN_PAGE_THEME_FONT} !important;
  -webkit-font-smoothing: antialiased !important;
}

body, html {
  background-color: #ffffff !important;
  color: #282828 !important;
}

/* ── Compact lists ─────────────────────────────────────────────────────── */
table.list_table th, .list_table_wrap thead th, .list-header,
.list_header_cell, [role="columnheader"] {
  background: #ffffff !important;
  color: #282828 !important;
  font-weight: 700 !important;
  padding: 8px 10px !important;
  border-bottom: 2px solid ${t.accent} !important;
  font-size: 12px !important;
}

table.list_table td, [role="cell"] {
  padding: 6px 10px !important;
  border-bottom: 1px solid #f1f3f5 !important;
  color: #282828 !important;
  max-width: 350px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Number and short-description columns need room to breathe. */
table.list_table td:nth-child(1), table.list_table td:nth-child(2) {
  max-width: none !important;
  overflow: visible !important;
}

table.list_table tr:hover td, .data_lookup_table tr:hover td {
  background-color: ${t.tint} !important;
}

/* ── Form controls ─────────────────────────────────────────────────────── */
.form-control, input[type="text"], select, textarea {
  background-color: #ffffff !important;
  border: 1px solid #d1d5db !important;
  border-radius: 4px !important;
  color: #282828 !important;
}

.form-control:focus, input[type="text"]:focus, select:focus, textarea:focus {
  border-color: ${t.accent} !important;
  outline: none !important;
  box-shadow: 0 0 0 2px ${t.accent}33 !important;
}

/* Read-only and disabled fields have to look unmistakably inert. */
.form-control[readonly], .form-control[disabled],
input[type="text"][readonly], input[type="text"][disabled],
select[readonly], select[disabled],
textarea[readonly], textarea[disabled],
.disabled, .readonly {
  background-color: #e9ecef !important;
  color: #495057 !important;
  border-color: #d1d5db !important;
}

/* ── Date picker ───────────────────────────────────────────────────────── */
/* The list rules above otherwise bleed into the calendar widget and wreck its
   layout, so every inherited property is explicitly handed back. */
#GwtDateTimePicker_table th,
#GwtDateTimePicker_table td,
#GwtDateTimePicker_table tr:hover td,
.datePickerCalendar th,
.datePickerCalendar td,
.datePickerCalendar tr:hover td,
td.calText, td.calNav, td.calHead {
  background-color: inherit !important;
  color: inherit !important;
  border-bottom: inherit !important;
  font-size: inherit !important;
  font-weight: inherit !important;
  padding: inherit !important;
  max-width: none !important;
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: unset !important;
}
`;
}

// ── Header CSS, injected into the Polaris shadow root ────────────────────────
function snPageThemeHeaderCss(t) {
    return `
.polaris-layout, .polaris-header, .starting-header-zone,
.center-header-zone, .ending-header-zone, .sn-polaris-navigation {
  background-color: ${t.header} !important;
  background-image: ${SN_PAGE_THEME_PATTERN} !important;
  background-size: 100px 100px !important;
  border-bottom: 1px solid ${t.border} !important;
}

.polaris-header-menu, .sn-polaris-menu {
  background-color: ${t.header} !important;
  border: 1px solid ${t.border} !important;
}

/* High specificity on purpose: Polaris ships its own colour rules and these have
   to outrank them without inlining a style on every single node. */
div.polaris-header div.sn-polaris-tab,
div.polaris-header div[role="menuitem"],
.sn-polaris-navigation .sn-polaris-tab {
  color: #ffffff !important;
  opacity: 1 !important;
}

/* Leave the instance logo alone — recolouring it just looks broken. */
#header-logo-image { filter: none !important; }

now-icon svg, now-icon svg path, .now-icon-presence path, svg {
  fill: #ffffff !important;
  color: #ffffff !important;
}

.sn-polaris-tab:hover, .contextual-zone-button:hover, div[role="menuitem"]:hover {
  background-color: rgba(255, 255, 255, 0.15) !important;
  color: #ffffff !important;
}
`;
}

// Polaris custom properties, set inline on the elements that own them.
function snApplyPolarisVars(el, t) {
    if (!el || !el.style) return;
    const bg    = snHexToRgbTriple(t.header);
    const white = '255, 255, 255';
    const vars = {
        '--now-color_chrome--brand':                     bg,
        '--now-unified-nav_header--background-color':     bg,
        '--now-unified-nav_header--color':               white,
        '--now-unified-nav_button--color':               white,
        '--now-unified-nav_button--color--hover':        white,
        '--now-unified-nav_menu-item--color':            white,
        '--now-unified-nav_menu-item--color--hover':     white,
        '--now-unified-nav_utility-menu-trigger--color': white,
        '--now-unified-nav_app-title--color':            white
    };
    Object.keys(vars).forEach(k => el.style.setProperty(k, vars[k], 'important'));
}
