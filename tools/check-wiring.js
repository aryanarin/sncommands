#!/usr/bin/env node
'use strict';

// Static checks for both builds. No dependencies — runs on a bare Node install:
//
//     node tools/check-wiring.js
//
// What it catches:
//   1. Malformed manifests, or the two builds claiming different versions.
//   2. Files referenced from a manifest or an HTML page that aren't there.
//   3. document.getElementById('x') with no matching id="x" in the page.
//   4. A message being sent with a `source` no listener handles. This is the
//      class of bug that left the settings page's Run button silently dead:
//      it posted 'SN_COMMANDS_RUN', which nothing ever listened for.
//   5. chrome/ and firefox/ drifting apart on the files that must stay identical.
//   6. JavaScript that doesn't parse.
//   7. Any reference to a specific customer or employer.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT   = path.join(__dirname, '..');
const BUILDS = ['chrome', 'firefox'];

// Shared between the builds byte for byte — only manifest.json may differ.
const SHARED = ['background.js', 'content.js', 'themes.js', 'helpers.js',
                'popup.html', 'popup.js', 'settings.html', 'settings.js'];

// Files loaded ahead of content.js that publish the globals it consumes.
const PRELUDE = ['themes.js', 'helpers.js'];

// Created at runtime by buildEditor(), so they're deliberately not in the HTML.
const DYNAMIC_IDS = new Set(['fieldName', 'fieldHint', 'fieldOrder', 'fieldScript']);

// Names that must not appear anywhere in a shipped build.
const FORBIDDEN = ['mercedes', 'benz', 'infosys'];

let failures = [];
let checks   = 0;

function check(ok, label, detail) {
  checks++;
  if (!ok) failures.push(detail ? `${label} — ${detail}` : label);
}

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function exists(...parts) {
  return fs.existsSync(path.join(ROOT, ...parts));
}

// ── 1. Manifests ──────────────────────────────────────────────────────────────
const manifests = {};
BUILDS.forEach(build => {
  let m = null;
  try {
    m = JSON.parse(read(build, 'manifest.json'));
    check(true, `${build}/manifest.json parses`);
  } catch (err) {
    check(false, `${build}/manifest.json parses`, err.message);
    return;
  }
  manifests[build] = m;

  check(m.manifest_version === 3, `${build} is Manifest V3`, `got ${m.manifest_version}`);
  check(!!m.name && !!m.version, `${build} has name and version`);

  // 2. Every referenced file is actually present.
  const refs = [];
  Object.values(m.icons || {}).forEach(p => refs.push(p));
  Object.values((m.action && m.action.default_icon) || {}).forEach(p => refs.push(p));
  if (m.action && m.action.default_popup) refs.push(m.action.default_popup);
  if (m.background && m.background.service_worker) refs.push(m.background.service_worker);
  ((m.background && m.background.scripts) || []).forEach(p => refs.push(p));
  (m.content_scripts || []).forEach(cs => (cs.js || []).forEach(p => refs.push(p)));

  [...new Set(refs)].forEach(rel => {
    check(exists(build, rel), `${build}/${rel} exists (manifest reference)`);
  });
});

const versions = BUILDS.map(b => manifests[b] && manifests[b].version);
check(new Set(versions).size === 1, 'both manifests declare the same version', versions.join(' vs '));

// ── 3. HTML assets + getElementById wiring ────────────────────────────────────
BUILDS.forEach(build => {
  ['popup', 'settings'].forEach(page => {
    const htmlRel = `${page}.html`;
    const jsRel   = `${page}.js`;
    if (!exists(build, htmlRel) || !exists(build, jsRel)) {
      check(false, `${build}/${htmlRel} and ${jsRel} both exist`);
      return;
    }

    const html = read(build, htmlRel);
    const js   = read(build, jsRel);

    // Local assets referenced by the page must resolve.
    const assetRe = /(?:src|href)="(?!https?:|mailto:|data:|#)([^"]+)"/g;
    let a;
    while ((a = assetRe.exec(html)) !== null) {
      check(exists(build, a[1]), `${build}/${a[1]} exists (referenced by ${htmlRel})`);
    }

    // Every id the script reaches for must exist in the markup.
    const ids = new Set(html.match(/id="([^"]+)"/g)?.map(s => s.slice(4, -1)) || []);
    const idRe = /getElementById\('([^']+)'\)/g;
    let g;
    while ((g = idRe.exec(js)) !== null) {
      const id = g[1];
      if (DYNAMIC_IDS.has(id)) continue;
      check(ids.has(id), `${build}/${htmlRel} defines id="${id}"`, `used by ${jsRel}`);
    }
  });
});

// ── 4. Message wiring ─────────────────────────────────────────────────────────
// Collect every `source: 'X'` that gets sent, and every 'X' the background
// worker or a content script compares against.
BUILDS.forEach(build => {
  const senders  = ['popup.js', 'settings.js', 'content.js'];
  const handlers = read(build, 'background.js') + read(build, 'content.js');

  const handled = new Set(
    [...handlers.matchAll(/source\s*===\s*'([A-Z_]+)'/g)].map(m => m[1])
  );

  senders.forEach(file => {
    const src  = read(build, file);
    const sent = new Set(
      [...src.matchAll(/source:\s*'([A-Z_]+)'/g)].map(m => m[1])
    );
    sent.forEach(name => {
      check(handled.has(name), `${build}: message '${name}' has a listener`, `sent from ${file}`);
    });
  });
});

// ── 5. Build drift ────────────────────────────────────────────────────────────
SHARED.forEach(file => {
  const a = read('chrome', file);
  const b = read('firefox', file);
  check(a === b, `chrome/${file} and firefox/${file} are identical`,
        'run tools/sync-firefox.ps1');
});

// ── 6. JavaScript parses ──────────────────────────────────────────────────────
BUILDS.forEach(build => {
  ['background.js', 'content.js', 'themes.js', 'helpers.js', 'popup.js', 'settings.js'].forEach(file => {
    try {
      new vm.Script(read(build, file), { filename: `${build}/${file}` });
      check(true, `${build}/${file} parses`);
    } catch (err) {
      check(false, `${build}/${file} parses`, err.message);
    }
  });
});

// ── 7. No customer or employer references ─────────────────────────────────────
BUILDS.forEach(build => {
  [...SHARED, 'manifest.json'].forEach(file => {
    const lower = read(build, file).toLowerCase();
    FORBIDDEN.forEach(word => {
      check(!lower.includes(word), `${build}/${file} has no "${word}" reference`);
    });
  });
});

// ── 8. Seed commands ──────────────────────────────────────────────────────────
// The scripts shipped on first install are stored as strings, so a syntax error
// in one would only surface when a user actually ran it. Parse them here, and
// confirm none of them has an instance hostname baked in.
BUILDS.forEach(build => {
  const noop     = () => {};
  const listener = { addListener: noop };
  const sandbox  = {
    console,
    setTimeout,
    chrome: {
      storage:   { local: { get: async () => ({}), set: async () => {} }, onChanged: listener },
      scripting: {
        getRegisteredContentScripts: async () => [],
        unregisterContentScripts:    async () => {},
        registerContentScripts:      async () => {}
      },
      runtime: { onInstalled: listener, onStartup: listener, onMessage: listener }
    }
  };

  let seeds;
  try {
    const context = vm.createContext(sandbox);
    new vm.Script(read(build, 'background.js') + '\n;globalThis.__seeds = DEFAULT_COMMANDS;',
                  { filename: `${build}/background.js` }).runInContext(context);
    seeds = sandbox.__seeds;
    check(Array.isArray(seeds) && seeds.length > 0, `${build}: DEFAULT_COMMANDS is a non-empty array`);
  } catch (err) {
    check(false, `${build}: DEFAULT_COMMANDS is readable`, err.message);
    return;
  }
  if (!Array.isArray(seeds)) return;

  const names = seeds.map(c => c.name);
  check(new Set(names).size === names.length, `${build}: seed command names are unique`);

  seeds.forEach(cmd => {
    check(!!cmd.id && !!cmd.name && !!cmd.hint && !!cmd.script,
          `${build}: seed \\${cmd.name} has id, name, hint and script`);
    try {
      new vm.Script(cmd.script, { filename: `seed:${cmd.name}` });
      check(true, `${build}: seed \\${cmd.name} parses`);
    } catch (err) {
      check(false, `${build}: seed \\${cmd.name} parses`, err.message);
    }
    check(!/https?:\/\/[a-z0-9.-]+/i.test(cmd.script),
          `${build}: seed \\${cmd.name} has no hardcoded host`,
          'use window.location.origin so it works on any instance');
  });
});

// ── 9. Page themes ────────────────────────────────────────────────────────────
// themes.js is shared by content.js and settings.js. If a palette loses a field
// or a colour stops carrying white text, the damage only shows up on a live
// ServiceNow page, so it gets checked here instead.
//
// Distinctness is measured as CIE76 dE in Lab space, not RGB distance: euclidean
// RGB badly under-reports hue differences and flags perfectly distinct colours.
function toLab(hex) {
  const h = hex.replace('#', '');
  const lin = (v) => {
    const s = parseInt(v, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = lin(h.slice(0, 2)), g = lin(h.slice(2, 4)), b = lin(h.slice(4, 6));
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function luminance(hex) {
  const h = hex.replace('#', '');
  const lin = (v) => {
    const s = parseInt(v, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(h.slice(0, 2)) + 0.7152 * lin(h.slice(2, 4)) + 0.0722 * lin(h.slice(4, 6));
}
function whiteContrast(hex) { return 1.05 / (luminance(hex) + 0.05); }
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function isHex(value) { return /^#[0-9a-f]{6}$/i.test(value || ''); }
function deltaE(a, b) {
  const x = toLab(a), y = toLab(b);
  return Math.sqrt((x.L - y.L) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2);
}

BUILDS.forEach(build => {
  let palettes, order, dflt;
  try {
    const ctx = vm.createContext({});
    new vm.Script(read(build, 'themes.js') + `
      ;globalThis.__p = SN_PAGE_THEMES;
      globalThis.__o = SN_PAGE_THEME_ORDER;
      globalThis.__d = SN_PAGE_THEME_DEFAULT;
      globalThis.__resolve = snResolvePageTheme;
      globalThis.__clean = snCleanHost;
      globalThis.__norm = snNormalisePageThemeSettings;
      globalThis.__base = snPageThemeBaseCss;
      globalThis.__head = snPageThemeHeaderCss;
      globalThis.__cloud = snIsServiceNowCloudHost;
      globalThis.__known = snHostIsKnownInstance;
      globalThis.__looks = snDocumentLooksLikeServiceNow;
      globalThis.__markers = SN_SERVICENOW_DOM_MARKERS;
    `, { filename: `${build}/themes.js` }).runInContext(ctx);
    palettes = ctx.__p; order = ctx.__o; dflt = ctx.__d;
    check(true, `${build}/themes.js evaluates`);

    // The default must exist, or every unmapped instance falls back to nothing.
    check(!!palettes[dflt], `${build}: default theme "${dflt}" exists`);

    // CSS builders must not throw and must actually mention the palette colours.
    const sample = palettes[dflt];
    const baseCss = ctx.__base(sample);
    const headCss = ctx.__head(sample);
    check(baseCss.includes(sample.accent), `${build}: base CSS uses the accent colour`);
    check(headCss.includes(sample.header), `${build}: header CSS uses the header colour`);
    check(!/@import/.test(baseCss) && !/https?:\/\//.test(baseCss),
          `${build}: page-theme CSS makes no remote requests`,
          'a webfont @import here would break the no-network promise');

    // Host resolution: exact beats parent, parent beats default, unmatched falls back.
    const cfg = { enabled: true, theme: 'steel-teal',
                  hosts: { 'service-now.com': 'sage-moss', 'acme.service-now.com': 'ash-clay' } };
    check(ctx.__resolve(cfg, 'acme.service-now.com').key === 'ash-clay',
          `${build}: exact host mapping wins`);
    check(ctx.__resolve(cfg, 'other.service-now.com').key === 'sage-moss',
          `${build}: parent-domain mapping applies to subdomains`);
    check(ctx.__resolve(cfg, 'snow.internal.corp').key === 'steel-teal',
          `${build}: unmapped host falls back to the default`);
    check(ctx.__clean('https://acme.service-now.com:443/nav_to.do') === 'acme.service-now.com',
          `${build}: hostnames are normalised`);

    // Is-this-ServiceNow gate. Getting this wrong in the permissive direction means
    // the page theme repaints unrelated websites, which is how a GitHub code view
    // ended up rendered as two overlapping copies of itself.
    check(ctx.__cloud('acme.service-now.com') === true,
          `${build}: cloud instances are recognised`);
    check(ctx.__cloud('acme.servicenowservices.com') === true,
          `${build}: government cloud instances are recognised`);
    check(ctx.__cloud('github.com') === false,
          `${build}: an unrelated host is not a cloud instance`);
    check(ctx.__cloud('not-service-now.com.evil.example') === false,
          `${build}: a lookalike host is not a cloud instance`);

    check(ctx.__known('snow.internal.corp', {}, ['*://snow.internal.corp/*']) === true,
          `${build}: a domain added under Instances counts as an instance`);
    check(ctx.__known('snow.internal.corp', { 'snow.internal.corp': 'sage-moss' }, []) === true,
          `${build}: a host mapped to a theme counts as an instance`);
    check(ctx.__known('app.internal.corp', {}, ['*://*.internal.corp/*']) === true,
          `${build}: a wildcard instance pattern covers its subdomains`);
    check(ctx.__known('github.com', { 'snow.internal.corp': 'sage-moss' },
                      ['*://snow.internal.corp/*']) === false,
          `${build}: an unconfigured host is not an instance`);
    check(ctx.__known('github.com', undefined, undefined) === false,
          `${build}: missing configuration does not make a host an instance`);

    // Markers have to be specific enough that no ordinary website trips them.
    check(ctx.__looks(null) === false, `${build}: no document means no markers`);
    check(ctx.__looks({ querySelector: () => null }) === false,
          `${build}: a document without markers is not ServiceNow`);
    check(ctx.__looks({ querySelector: (s) => s === 'input[name="sysparm_ck"]' ? {} : null }) === true,
          `${build}: a ServiceNow marker is recognised`);
    check(Array.isArray(ctx.__markers) && ctx.__markers.length > 0,
          `${build}: ServiceNow DOM markers are declared`);
    ['div', 'body', 'form', 'table', 'textarea', 'input', '*'].forEach(generic =>
      check(!ctx.__markers.includes(generic),
            `${build}: "${generic}" is not used as a ServiceNow marker`,
            'a marker this generic would match every website'));

    // Defaults must be off, so installing a command palette never restyles anyone.
    check(ctx.__norm(undefined).enabled === false,
          `${build}: page theming defaults to off`);
    check(Object.keys(ctx.__norm({ enabled: true, hosts: { 'a.com': 'no-such-theme' } }).hosts).length === 0,
          `${build}: mappings to unknown themes are dropped`);
  } catch (err) {
    check(false, `${build}/themes.js evaluates`, err.message);
    return;
  }

  check(Array.isArray(order) && order.length === 5, `${build}: five page themes`,
        order ? order.length + ' found' : 'none');

  order.forEach(key => {
    const t = palettes[key];
    if (!t) { check(false, `${build}: theme "${key}" is defined`); return; }
    ['label', 'note'].forEach(f => check(!!t[f], `${build}: ${key} has ${f}`));
    ['header', 'border', 'accent', 'tint'].forEach(f =>
      check(/^#[0-9a-f]{6}$/i.test(t[f] || ''), `${build}: ${key}.${f} is a 6-digit hex`, String(t[f])));

    const c = whiteContrast(t.header);
    check(c >= 4.5, `${build}: ${key} carries white nav text at 4.5:1`, c.toFixed(2) + ':1');
    check(luminance(t.border) < luminance(t.header), `${build}: ${key} border is darker than header`);
    check(luminance(t.tint) > 0.85, `${build}: ${key} workspace tint stays near-white`);
  });

  let closest = { d: Infinity, pair: '' };
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const d = deltaE(palettes[order[i]].header, palettes[order[j]].header);
      if (d < closest.d) closest = { d, pair: order[i] + ' / ' + order[j] };
    }
  }
  check(closest.d >= 15, `${build}: every pair of page themes is clearly distinct (dE >= 15)`,
        `closest ${closest.pair} at dE ${closest.d.toFixed(1)}`);
});

// ── 10. Shared prelude files — check both halves of the contract ─────────────
// themes.js and helpers.js publish globals that content.js and settings.js rely
// on. A rename or typo on either side is only visible as a ReferenceError on a
// live ServiceNow page, so it gets caught here instead.
BUILDS.forEach(build => {
  // Everything the prelude publishes, across all of its files.
  const declared = new Set();
  PRELUDE.forEach(file => {
    const src = read(build, file);
    [...src.matchAll(/^var\s+(SN_[A-Z_]+|sn[A-Za-z]\w*)/gm)].forEach(m => declared.add(m[1]));
    [...src.matchAll(/^function\s+(sn[A-Za-z]\w*)/gm)].forEach(m => declared.add(m[1]));
  });

  ['content.js', 'settings.js'].forEach(file => {
    const used = new Set(
      [...read(build, file).matchAll(
        /\b(SN_(?:PAGE_|HELPER|KEEPALIVE|REOPEN|QUICK|SERVICENOW)[A-Z_]*|sn(?:Default|Normalise|Clean|Resolve|Apply|Hex|Clamp|Host|Document|Is)[A-Za-z]\w*)\b/g
      )].map(m => m[1])
    );
    used.forEach(name =>
      check(declared.has(name), `${build}: prelude exports ${name}`, `used by ${file}`));
  });

  // Load order in the manifest: the prelude must precede content.js, or it runs
  // against undefined globals.
  const js = ((manifests[build].content_scripts || [])[0] || {}).js || [];
  PRELUDE.forEach(file => {
    check(js.indexOf(file) !== -1 && js.indexOf(file) < js.indexOf('content.js'),
          `${build}: manifest loads ${file} before content.js`, js.join(', '));
  });

  // Same for the settings page, where <script> tag order decides it.
  //
  // Ordered from the actual <script src> tags rather than raw filename positions:
  // a prose mention of a filename in a comment is not a load, and matching on bare
  // occurrences reports the wrong order the moment one appears.
  const scriptOrder = [...read(build, 'settings.html')
    .matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  const loadedAt = (file) => scriptOrder.indexOf(file);

  PRELUDE.forEach(file => {
    const at = loadedAt(file);
    check(at !== -1 && at < loadedAt('settings.js'),
          `${build}: settings.html loads ${file} before settings.js`,
          scriptOrder.join(', '));
  });

  // Scripts registered dynamically for custom/on-prem domains need the same list,
  // or these features fail on on-prem instances only — the hardest case to notice.
  const reg = read(build, 'background.js').match(/js:\s*\[([^\]]+)\]/);
  check(!!reg, `${build}: dynamic registration has a js: [] list`);
  if (reg) {
    PRELUDE.concat('content.js').forEach(file => {
      check(reg[1].includes(file),
            `${build}: dynamic content-script registration includes ${file}`, reg[1].trim());
    });
  }
});

// ── 11. Page helpers ──────────────────────────────────────────────────────────
// The two injected helpers are stored as strings and executed in the page's MAIN
// world, so a syntax error in either would only surface when a user switched it on.
BUILDS.forEach(build => {
  let ctx;
  try {
    ctx = vm.createContext({ console });
    new vm.Script(read(build, 'helpers.js') + `
      ;globalThis.__meta = SN_HELPER_META;
      globalThis.__attr = SN_HELPER_ATTR;
      globalThis.__def = snDefaultHelperSettings;
      globalThis.__norm = snNormaliseHelperSettings;
      globalThis.__clamp = snClampKeepAliveMinutes;
      globalThis.__endpoints = SN_KEEPALIVE_ENDPOINTS;
      globalThis.__scripts = { reopenCount: SN_REOPEN_COUNT_SCRIPT, quickPost: SN_QUICK_POST_SCRIPT };
    `, { filename: `${build}/helpers.js` }).runInContext(ctx);
    check(true, `${build}/helpers.js evaluates`);
  } catch (err) {
    check(false, `${build}/helpers.js evaluates`, err.message);
    return;
  }

  // Every helper must default to off. Nobody gets background network activity or
  // rebound keyboard shortcuts because they installed a command palette.
  const defaults = ctx.__def();
  Object.keys(defaults).forEach(key =>
    check(defaults[key].enabled === false, `${build}: helper "${key}" defaults to off`));
  check(ctx.__norm(undefined).keepAlive.enabled === false,
        `${build}: helpers default to off when storage is empty`);

  // Interval clamping, including the junk cases a number input can produce.
  check(ctx.__clamp(0) >= 1,          `${build}: keep-alive interval floors at 1 minute`);
  check(ctx.__clamp(9999) <= 60,      `${build}: keep-alive interval caps at 60 minutes`);
  check(ctx.__clamp('') === 2,        `${build}: blank keep-alive interval falls back to 2`);
  check(ctx.__clamp('abc') === 2,     `${build}: non-numeric keep-alive interval falls back to 2`);
  check(ctx.__clamp(undefined) === 2, `${build}: missing keep-alive interval falls back to 2`);

  check(Array.isArray(ctx.__endpoints) && ctx.__endpoints.length > 0,
        `${build}: keep-alive has at least one endpoint`);
  ctx.__endpoints.forEach(ep => {
    check(ep.startsWith('/') && !/^https?:/i.test(ep),
          `${build}: keep-alive endpoint "${ep}" is instance-relative`,
          'an absolute URL would pin this to one instance');
    check(!/^\/api\//i.test(ep),
          `${build}: keep-alive endpoint "${ep}" is a UI page, not a REST route`,
          'ServiceNow answers REST calls with 200 without extending the session');
  });

  // Every meta entry must correspond to a real setting, or the settings page
  // renders a toggle that writes nowhere.
  check(Array.isArray(ctx.__meta) && ctx.__meta.length === 3, `${build}: three helpers declared`);
  (ctx.__meta || []).forEach(m => {
    check(!!m.key && !!m.title && !!m.desc, `${build}: helper meta "${m.key}" is complete`);
    check(Object.prototype.hasOwnProperty.call(defaults, m.key),
          `${build}: helper "${m.key}" has matching default settings`);
  });

  // The injected scripts: must parse, must be guarded against double-injection,
  // and must honour the live on/off attribute.
  Object.keys(ctx.__scripts).forEach(key => {
    const src = ctx.__scripts[key];
    try {
      new vm.Script(src, { filename: `helper:${key}` });
      check(true, `${build}: injected helper "${key}" parses`);
    } catch (err) {
      check(false, `${build}: injected helper "${key}" parses`, err.message);
    }
    check(/__snCmd/.test(src), `${build}: injected helper "${key}" guards against re-injection`);
    check(src.includes(ctx.__attr[key]),
          `${build}: injected helper "${key}" checks its live on/off attribute`,
          `expected ${ctx.__attr[key]}`);
    check(!/https?:\/\//.test(src), `${build}: injected helper "${key}" makes no remote requests`);
  });

  // content.js has to mirror the toggles onto the DOM, or switching one off would
  // do nothing until a reload.
  const content = read(build, 'content.js');
  Object.keys(ctx.__attr).forEach(key =>
    check(content.includes('SN_HELPER_ATTR'), `${build}: content.js mirrors helper toggles to the DOM`));
});

// ── 12. Theme tokens ──────────────────────────────────────────────────────────
// A missing or washed-out token only shows up as unreadable text in one theme,
// on one control. Check every token pair that is actually used as text, plus the
// explicit colours that fixed the dark-mode editor bug.
const REQUIRED_TOKENS = ['bg', 'bg2', 'bg3', 'border', 'border2', 'text', 'text-muted',
                         'text-dim', 'text-mono', 'accent', 'accent-h', 'accent-fg',
                         'danger', 'danger-solid'];
const TEXT_ON_SURFACES = ['text', 'text-muted', 'text-dim', 'text-mono', 'accent-fg', 'danger'];

function parseThemeTokens(html, theme) {
  const re = new RegExp(':root\\[data-theme="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\}', 'g');
  const tokens = {};
  let block;
  while ((block = re.exec(html)) !== null) {
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
    css.split(';').forEach(decl => {
      const at = decl.indexOf(':');
      if (at === -1) return;
      const prop = decl.slice(0, at).trim();
      const value = decl.slice(at + 1).trim();
      if (prop.startsWith('--')) tokens[prop.slice(2)] = value;
      else if (prop === 'color-scheme') tokens[prop] = value;
    });
  }
  return tokens;
}

function objectBody(src, marker) {
  const at = src.indexOf(marker);
  if (at === -1) return null;
  const open = src.indexOf('{', at + marker.length);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

function objectProps(body) {
  const out = {};
  [...String(body || '').matchAll(/(\w+):\s*'([^']+)'/g)].forEach(m => { out[m[1]] = m[2]; });
  return out;
}

BUILDS.forEach(build => {
  ['popup.html', 'settings.html'].forEach(page => {
    const html = read(build, page);
    const themes = { dark: parseThemeTokens(html, 'dark'), light: parseThemeTokens(html, 'light') };

    Object.keys(themes).forEach(theme => {
      const t = themes[theme];
      check(t['color-scheme'] === theme,
            `${build}/${page} ${theme}: color-scheme is ${theme}`, t['color-scheme']);
      REQUIRED_TOKENS.forEach(name =>
        check(isHex(t[name]), `${build}/${page} ${theme}: --${name} is a hex colour`, t[name]));

      TEXT_ON_SURFACES.forEach(fg => ['bg', 'bg2', 'bg3'].forEach(bg => {
        if (!isHex(t[fg]) || !isHex(t[bg])) return;
        const c = contrast(t[fg], t[bg]);
        check(c >= 4.5, `${build}/${page} ${theme}: --${fg} on --${bg} clears 4.5:1`,
              c.toFixed(2) + ':1');
      }));

      ['accent', 'accent-h', 'danger-solid'].forEach(bg => {
        if (!isHex(t[bg])) return;
        const c = whiteContrast(t[bg]);
        check(c >= 4.5, `${build}/${page} ${theme}: white on --${bg} clears 4.5:1`,
              c.toFixed(2) + ':1');
      });
    });

    // Placeholders sit on --bg2 and must not fall back to the UA grey.
    check(/::placeholder[^{]*\{[^}]*color:\s*var\(--text-dim\)/.test(html),
          `${build}/${page}: placeholders use --text-dim`);

    if (page === 'popup.html') {
      const area = /\.script-area\s*\{([^}]*)\}/.exec(html);
      check(!!area && /(^|[;\s])color:\s*var\(--text\)/.test(area[1]),
            `${build}/${page}: .script-area sets an explicit text colour`,
            'without it Chrome and Firefox paint UA black on the dark surface');
      check(!!area && /caret-color:\s*var\(--text\)/.test(area[1]),
            `${build}/${page}: .script-area sets the caret colour`);

      const fsArea = /\.fullscreen-textarea\s*\{([^}]*)\}/.exec(html);
      check(!!fsArea && /(^|[;\s])color:\s*var\(--text\)/.test(fsArea[1]),
            `${build}/${page}: .fullscreen-textarea sets an explicit text colour`);
    }
  });

  // CodeMirror: gutters, comments and (light-theme) matching brackets.
  const settings = read(build, 'settings.html');
  const dark  = parseThemeTokens(settings, 'dark');
  const light = parseThemeTokens(settings, 'light');
  [['dark', dark, dark.bg2], ['light', light, light.bg2]].forEach(([theme, t, surface]) => {
    if (!isHex(t['cm-gutter-fg']) || !isHex(surface)) return;
    const c = contrast(t['cm-gutter-fg'], surface);
    check(c >= 4.5, `${build}: ${theme} CodeMirror line numbers clear 4.5:1`, c.toFixed(2) + ':1');
  });
  const comment = /\.cm-s-dracula span\.cm-comment\s*\{\s*color:\s*(#[0-9a-f]{6})/i.exec(settings);
  check(!!comment && isHex(dark.bg2) && contrast(comment[1], dark.bg2) >= 4.5,
        `${build}: dark CodeMirror comments clear 4.5:1`,
        comment ? contrast(comment[1], dark.bg2).toFixed(2) + ':1' : 'rule missing');
  const bracket = /\[data-theme="light"\][^{]*\.CodeMirror-matchingbracket\s*\{\s*color:\s*(#[0-9a-f]{6})/i.exec(settings);
  check(!!bracket && isHex(light.bg2) && contrast(bracket[1], light.bg2) >= 4.5,
        `${build}: light CodeMirror matching brackets clear 4.5:1`,
        bracket ? contrast(bracket[1], light.bg2).toFixed(2) + ':1' : 'override missing');
  const nonBracket = /\[data-theme="light"\][^{]*\.CodeMirror-nonmatchingbracket\s*\{\s*color:\s*(#[0-9a-f]{6})/i.exec(settings);
  check(!!nonBracket && isHex(light.bg2) && contrast(nonBracket[1], light.bg2) >= 4.5,
        `${build}: light CodeMirror non-matching brackets clear 4.5:1`);

  // Support button: white label on a two-stop gradient, so both stops must pass.
  const support = /\.btn-support\s*\{([^}]*)\}/.exec(settings);
  const gradient = support && /linear-gradient\(([^)]*)\)/.exec(support[1]);
  const stops = gradient ? [...gradient[1].matchAll(/#[0-9a-f]{6}/gi)].map(m => m[0]) : [];
  check(stops.length >= 2, `${build}: support button uses a gradient`, 'gradient not found');
  stops.forEach(hex => {
    const c = whiteContrast(hex);
    check(c >= 4.5, `${build}: white support text on ${hex} clears 4.5:1`, c.toFixed(2) + ':1');
  });

  // The in-page palette builds its colours in content.js, where CSS variables
  // aren't available. Parse its theme literals and check the same pairs.
  const content = read(build, 'content.js');
  const palettesBody = objectBody(content, 'const THEMES =');
  const paletteThemes = palettesBody ? {
    dark:  objectProps(objectBody(palettesBody, 'dark:')),
    light: objectProps(objectBody(palettesBody, 'light:'))
  } : null;
  check(!!paletteThemes, `${build}: content.js palette themes are readable`);
  if (paletteThemes) {
    Object.keys(paletteThemes).forEach(theme => {
      const t = paletteThemes[theme];
      ['bg', 'bg2', 'bg3', 'border', 'border2', 'text', 'textMuted', 'textDim', 'textMono', 'accent']
        .forEach(name => check(isHex(t[name]), `${build}: palette ${theme}.${name} is a hex colour`, t[name]));

      [['text', 'bg2'], ['text', 'bg3'], ['textMuted', 'bg'], ['textMuted', 'bg3'],
       ['textDim', 'bg'], ['textDim', 'bg2'], ['textMono', 'bg'], ['textMono', 'bg3'],
       ['text', 'border2']].forEach(([fg, bg]) => {
        if (!isHex(t[fg]) || !isHex(t[bg])) return;
        const c = contrast(t[fg], t[bg]);
        check(c >= 4.5, `${build}: palette ${theme} ${fg} on ${bg} clears 4.5:1`, c.toFixed(2) + ':1');
      });
      if (isHex(t.accent)) {
        const c = whiteContrast(t.accent);
        check(c >= 4.5, `${build}: palette ${theme} white on accent clears 4.5:1`, c.toFixed(2) + ':1');
      }
    });
  }
  check(/paletteCss/.test(content) && /::placeholder/.test(content) && /caret-color/.test(content),
        `${build}: palette styles its placeholder and caret`);

  // The pinned dock builds its own theme map. It must stay in lockstep with the
  // palette, or a colour fixed in one place silently regresses in the other.
  const dockBody = objectBody(content, 'const PIN_THEMES =');
  check(!!dockBody, `${build}: content.js dock themes are readable`);
  if (palettesBody && dockBody) {
    ['dark', 'light'].forEach(theme => {
      const palette = objectProps(objectBody(palettesBody, theme + ':'));
      const dock    = objectProps(objectBody(dockBody, theme + ':'));
      Object.keys(palette).forEach(name => {
        check(dock[name] === palette[name],
              `${build}: dock ${theme}.${name} matches the palette`, dock[name] + ' vs ' + palette[name]);
      });
    });
  }
});

// ── Report ────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n${failures.length} of ${checks} checks failed:\n`);
  failures.forEach(f => console.error('  ✗ ' + f));
  console.error('');
  process.exit(1);
}

console.log(`\n  All ${checks} checks passed.\n`);
