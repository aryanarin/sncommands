#!/usr/bin/env node
'use strict';

// Renders the real popup, settings page and in-page palette in headless Chrome
// and Firefox, with seeded storage, and fails when visible text falls below
// WCAG AA contrast (4.5:1, or 3:1 for large text).
//
// No dependencies: Chrome is driven over the DevTools protocol and Firefox over
// WebDriver BiDi, both through the WebSocket/fetch built into Node 22+.
//
//     node tools/theme-audit.js
//     node tools/theme-audit.js --browser=chrome --theme=dark
//     node tools/theme-audit.js --shots=./audit-shots
//
// The colour checks run inside each browser against computed styles, so this
// covers UA form-control colours, native scrollbars' colour-scheme, CodeMirror
// token colours and hover/active backgrounds that a CSS-only check would miss.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const net  = require('net');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL }    = require('url');

const ROOT  = path.join(__dirname, '..');
const BUILD = 'chrome';

// ── Scenarios ─────────────────────────────────────────────────────────────────
const SCENARIOS = [
  { id: 'popup-dark-empty',       page: 'popup',    theme: 'dark',  setup: 'empty',            viewport: [780, 520] },
  { id: 'popup-light-empty',      page: 'popup',    theme: 'light', setup: 'empty',            viewport: [780, 520] },
  { id: 'popup-dark-editor',      page: 'popup',    theme: 'dark',  setup: 'editor',           viewport: [780, 520] },
  { id: 'popup-light-editor',     page: 'popup',    theme: 'light', setup: 'editor',           viewport: [780, 520] },
  { id: 'popup-dark-fullscreen',  page: 'popup',    theme: 'dark',  setup: 'popup-fullscreen', viewport: [780, 520] },
  { id: 'popup-light-fullscreen', page: 'popup',    theme: 'light', setup: 'popup-fullscreen', viewport: [780, 520] },
  { id: 'popup-dark-search-empty',page: 'popup',    theme: 'dark',  setup: 'search-empty',     viewport: [780, 520] },
  { id: 'popup-dark-pin',         page: 'popup',    theme: 'dark',  setup: 'popup-pin',        viewport: [780, 520] },
  { id: 'palette-dark',           page: 'palette',  theme: 'dark',  setup: 'palette',          viewport: [900, 600], scope: '#sn-cmd-palette' },
  { id: 'palette-light',          page: 'palette',  theme: 'light', setup: 'palette',          viewport: [900, 600], scope: '#sn-cmd-palette' },
  { id: 'dock-dark',              page: 'dock',     theme: 'dark',  setup: 'dock',             viewport: [900, 600], scope: '#sn-pinned-dock' },
  { id: 'dock-light',             page: 'dock',     theme: 'light', setup: 'dock',             viewport: [900, 600], scope: '#sn-pinned-dock' },
  { id: 'dock-dark-dragged',      page: 'dock',     theme: 'dark',  setup: 'dock-drag',        viewport: [900, 600], scope: '#sn-pinned-dock' },
  { id: 'dock-dark-live',         page: 'dock',     theme: 'dark',  setup: 'dock-live',        viewport: [900, 600], scope: '#sn-pinned-dock' },
  { id: 'dock-dark-frameset',     page: 'dock-frameset', theme: 'dark', setup: 'dock',          viewport: [900, 600], scope: '#sn-pinned-dock' },
  { id: 'settings-dark-editor',   page: 'settings', theme: 'dark',  setup: 'settings-editor',  viewport: [1280, 800] },
  { id: 'settings-light-editor',  page: 'settings', theme: 'light', setup: 'settings-editor',  viewport: [1280, 800] },
  { id: 'settings-dark-bulk',     page: 'settings', theme: 'dark',  setup: 'settings-bulk',    viewport: [1280, 800] },
  { id: 'settings-light-bulk',    page: 'settings', theme: 'light', setup: 'settings-bulk',    viewport: [1280, 800] },
  { id: 'settings-dark-instances',page: 'settings', theme: 'dark',  setup: 'instances',        viewport: [1280, 800] },
  { id: 'settings-dark-pagetheme',page: 'settings', theme: 'dark',  setup: 'pagetheme',        viewport: [1280, 800] },
  { id: 'settings-light-pagetheme',page:'settings', theme: 'light', setup: 'pagetheme',        viewport: [1280, 800] },
  { id: 'settings-dark-helpers',  page: 'settings', theme: 'dark',  setup: 'helpers',          viewport: [1280, 800] },
  { id: 'settings-light-support', page: 'settings', theme: 'light', setup: 'support',          viewport: [1280, 800] },
  { id: 'settings-dark-fullscreen',page:'settings', theme: 'dark',  setup: 'settings-fullscreen', viewport: [1280, 800] },
  { id: 'settings-light-fullscreen',page:'settings',theme: 'light', setup: 'settings-fullscreen', viewport: [1280, 800] }
];

// ── Seeded data ───────────────────────────────────────────────────────────────
// Deliberately includes long hints, a missing hint, punctuation, emoji and
// numbers, because those are the rows that tend to expose a washed-out theme.
const MOCK_DATA_JS = String.raw`
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var theme  = params.get('theme') === 'light' ? 'light' : 'dark';
  var now    = 1770000000000;

  // Collect errors thrown by popup.js/settings.js before the audit runner has
  // attached its own listeners, so a broken fixture is reported with a reason
  // instead of just "timed out".
  window.__auditEarlyErrors = [];
  window.addEventListener('error', function (e) {
    window.__auditEarlyErrors.push(String((e && e.message) || 'script error'));
  });

  // The palette fixture has no theme stylesheet of its own, so it needs the
  // attribute to tell the audit that the seeded theme has been applied. The
  // popup and settings pages set the same value themselves.
  document.documentElement.setAttribute('data-theme', theme);

  var scripts = [
    '(function () {\n' +
    '    // Copy the current record sys_id\n' +
    '    var id = g_form.getValue("sys_id");\n' +
    '    if (!id) { console.warn("No sys_id on this form"); return; }\n' +
    '    navigator.clipboard.writeText(id);\n' +
    '})();',
    '(function () {\n' +
    '    /* Show the table and record */\n' +
    '    var table = g_form.getTableName();\n' +
    '    var number = g_form.getValue("number");\n' +
    '    alert(table + " / " + number);\n' +
    '})();',
    '(function () {\n' +
    '    window.location.href = "/sys_user.do?sys_id=" + g_user.userID;\n' +
    '})();',
    '(function () {\n' +
    '    var re = /^[a-f0-9]{32}$/i;\n' +
    '    var limit = 2147483647;\n' +
    '    return re.test(String(limit));\n' +
    '})();',
    '(function () {\n' +
    '    // Format the current view\n' +
    '    var parts = ["default", "sow", "workspace"];\n' +
    '    parts.forEach(function (p, i) { console.log(i, p); });\n' +
    '})();'
  ];

  var rows = [
    ['copysysid',   'Copy the current record sys_id to the clipboard'],
    ['sysinfo',     'Show the table, sys_id and number of the current record'],
    ['email',       'Open the email client for the current record'],
    ['myprofile',   'Open your own user profile record'],
    ['sowview',     'Switch the current record to the Service Operations Workspace view'],
    ['defaultview', 'Switch the current record back to the Default view'],
    ['excel',       'Export the current list to Excel — all rows or just the selection'],
    ['reload',      'Reload the current record, bypassing the browser cache'],
    ['qa-checklist', '']
  ];

  var commands = rows.map(function (row, i) {
    return {
      id: 'cmd-' + i,
      name: row[0],
      hint: row[1],
      script: scripts[i % scripts.length],
      order: i * 10,
      uses: i * 3,
      pinned: i < 3,
      createdAt: now - (rows.length - i) * 86400000,
      updatedAt: now - i * 3600000
    };
  });

  var store = {
    snTheme: theme,
    snCommands: commands,
    snSortMode: 'order',
    snAllUrls: false,
    snCustomDomains: ['snow.internal.example', '*.onprem.example.com'],
    snHelpers: {
      keepAlive:   { enabled: true, minutes: 5 },
      reopenCount: { enabled: true },
      quickPost:   { enabled: true }
    },
    snPageTheme: {
      enabled: true,
      theme: 'steel-teal',
      hosts: {
        'acme.service-now.com': 'ash-clay',
        'dev.service-now.com':  'sage-moss'
      }
    }
  };

  function read(keys) {
    var out = {};
    if (keys == null) {
      Object.keys(store).forEach(function (k) { out[k] = store[k]; });
    } else if (typeof keys === 'string') {
      out[keys] = store[keys];
    } else if (Array.isArray(keys)) {
      keys.forEach(function (k) { out[k] = store[k]; });
    } else if (typeof keys === 'object') {
      Object.keys(keys).forEach(function (k) {
        out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : keys[k];
      });
    }
    return out;
  }

  // Like the real API, every write notifies listeners. Pinning/unpinning a
  // command relies on this to update an already-open ServiceNow tab.
  var changeListeners = [];
  function emitChanges(changes) {
    if (!Object.keys(changes).length) return;
    setTimeout(function () {
      changeListeners.slice().forEach(function (fn) {
        try { fn(changes, 'local'); } catch (e) { /* a listener's problem */ }
      });
    }, 0);
  }

  var area = {
    get: function (keys, cb) {
      var out = read(keys);
      if (typeof cb === 'function') { setTimeout(function () { cb(out); }, 0); return; }
      return Promise.resolve(out);
    },
    set: function (obj, cb) {
      var changes = {};
      Object.keys(obj || {}).forEach(function (k) {
        changes[k] = { oldValue: store[k], newValue: obj[k] };
        store[k] = obj[k];
      });
      emitChanges(changes);
      if (typeof cb === 'function') { setTimeout(cb, 0); return; }
      return Promise.resolve();
    },
    remove: function (keys, cb) {
      var changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
        changes[k] = { oldValue: store[k], newValue: undefined };
        delete store[k];
      });
      emitChanges(changes);
      if (typeof cb === 'function') { setTimeout(cb, 0); return; }
      return Promise.resolve();
    },
    clear: function (cb) {
      var changes = {};
      Object.keys(store).forEach(function (k) {
        changes[k] = { oldValue: store[k], newValue: undefined };
      });
      store = {};
      emitChanges(changes);
      if (typeof cb === 'function') { setTimeout(cb, 0); return; }
      return Promise.resolve();
    }
  };

  // Chrome exposes its own read-only window.chrome, so mutate that object
  // instead of replacing it: assigning a whole new object throws in strict
  // mode there, which used to leave the extension with no storage API at all.
  var chromeApi = (window.chrome && typeof window.chrome === 'object') ? window.chrome : {};
  chromeApi.storage = {
    local: area,
    session: area,
    onChanged: {
      addListener: function (fn) { if (typeof fn === 'function') changeListeners.push(fn); },
      removeListener: function (fn) {
        var i = changeListeners.indexOf(fn);
        if (i !== -1) changeListeners.splice(i, 1);
      }
    }
  };
  chromeApi.runtime = {
    id: 'sncommands-audit',
    getURL: function (p) { return p; },
    sendMessage: function () { return Promise.resolve({ ok: true }); },
    onMessage: { addListener: function () {} },
    lastError: null
  };
  chromeApi.tabs = {
    create: function () {},
    query: function () { return Promise.resolve([{ id: 1, url: 'https://acme.service-now.com/nav_to.do' }]); }
  };
  chromeApi.permissions = {
    request:  function () { return Promise.resolve(true); },
    contains: function () { return Promise.resolve(true); },
    remove:   function () { return Promise.resolve(true); },
    onAdded:   { addListener: function () {} },
    onRemoved: { addListener: function () {} }
  };
  try { window.chrome = chromeApi; } catch (e) { /* read-only in Chrome; mutated above */ }
})();
`;

// ── In-page audit ─────────────────────────────────────────────────────────────
// Runs after the page's own scripts. Builds a JSON report in window.__auditResult.
const AUDIT_JS = String.raw`
(function () {
  'use strict';

  var params   = new URLSearchParams(location.search);
  var scenario = params.get('scenario') || '';
  var theme    = params.get('theme') === 'light' ? 'light' : 'dark';
  var scopeSel = params.get('scope') || '';

  var pageErrors = (window.__auditEarlyErrors || []).slice();
  window.addEventListener('error', function (e) {
    pageErrors.push(String((e && e.message) || 'script error'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    pageErrors.push(String((r && r.message) || r || 'unhandled rejection'));
  });

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function until(fn, ms, label) {
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        var value = null;
        try { value = fn(); } catch (e) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - start > (ms || 5000)) return reject(new Error('timed out waiting for ' + label));
        setTimeout(tick, 100);
      })();
    });
  }

  function click(sel) {
    var el = document.querySelector(sel);
    if (!el) throw new Error('missing element: ' + sel);
    el.click();
    return el;
  }

  async function setup() {
    await until(function () {
      return document.documentElement.getAttribute('data-theme') === theme;
    }, 5000, 'theme ' + theme);

    // scenario now carries the setup name (editor, settings-bulk, …), not the
    // picture id, so each case is matched exactly.
    var popupSetup = scenario === 'empty' || scenario === 'editor' ||
                     scenario === 'popup-fullscreen' || scenario === 'search-empty' ||
                     scenario === 'popup-pin';

    if (popupSetup) {
      await until(function () {
        return document.querySelector('.cmd-item') || document.querySelector('.empty-list');
      }, 5000, 'popup list');

      if (scenario === 'editor' || scenario === 'popup-fullscreen') {
        await until(function () { return document.querySelector('.cmd-item'); }, 5000, 'popup commands');
        click('.cmd-item');
        await until(function () { return document.getElementById('fieldScript'); }, 5000, 'popup editor');
      }
      if (scenario === 'popup-fullscreen') {
        click('.btn-maximize');
        await until(function () { return document.querySelector('#fullscreenOverlay.visible'); }, 3000, 'popup fullscreen');
      }
      if (scenario === 'search-empty') {
        var search = document.getElementById('searchInput');
        search.value = 'zzz-no-such-command';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await until(function () { return document.querySelector('.empty-list'); }, 3000, 'empty search');
      }
      if (scenario === 'popup-pin') {
        var pin = await until(function () {
          return document.querySelector('.cmd-item .cmd-pin');
        }, 5000, 'pin button');
        var before = pin.getAttribute('aria-pressed');
        pin.click();
        await until(function () {
          var el = document.querySelector('.cmd-item .cmd-pin');
          return el && el.getAttribute('aria-pressed') !== before;
        }, 3000, 'pin state to toggle');

        var pinStore = await new Promise(function (resolve) {
          chrome.storage.local.get('snCommands', resolve);
        });
        var pinnedCount = (pinStore.snCommands || []).filter(function (c) {
          return c.pinned === true;
        }).length;
        if (pinnedCount !== 2) {
          throw new Error('pin toggle did not persist (pinned=' + pinnedCount + ')');
        }
        if (document.getElementById('fieldScript')) {
          throw new Error('clicking the pin button also selected the command');
        }
      }
    }

    if (scenario === 'palette') {
      await sleep(200);
      if (document.getElementById('sn-pinned-dock')) {
        throw new Error('pinned dock was built on a page that is not ServiceNow');
      }
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '\\', bubbles: true, cancelable: true
      }));
      await until(function () {
        var el = document.getElementById('sn-cmd-palette');
        return el && getComputedStyle(el).display !== 'none';
      }, 5000, 'palette');
    }

    if (scenario === 'dock' || scenario === 'dock-drag' || scenario === 'dock-live') {
      var dock = await until(function () {
        var el = document.getElementById('sn-pinned-dock');
        return el && getComputedStyle(el).display !== 'none' &&
               el.querySelectorAll('.sn-pin-cmd').length >= 3 ? el : null;
      }, 5000, 'pinned dock');

      var rect = dock.getBoundingClientRect();
      if (Math.abs(rect.left - 8) > 1) {
        throw new Error('dock did not start at the left edge (left=' + rect.left + ')');
      }
      var centreDelta = Math.abs((rect.top + rect.height / 2) - window.innerHeight / 2);
      if (centreDelta > 2) {
        throw new Error('dock did not start vertically centred (delta=' + centreDelta + 'px)');
      }

      if (scenario === 'dock-live') {
        var got = await new Promise(function (resolve) {
          chrome.storage.local.get('snCommands', resolve);
        });
        var cmds = got.snCommands;

        cmds[0].pinned = false;
        await new Promise(function (resolve) {
          chrome.storage.local.set({ snCommands: cmds }, resolve);
        });
        await until(function () {
          return document.querySelectorAll('#sn-pinned-dock .sn-pin-cmd').length === 2;
        }, 3000, 'dock to drop an unpinned command');

        cmds[1].pinned = false;
        cmds[2].pinned = false;
        await new Promise(function (resolve) {
          chrome.storage.local.set({ snCommands: cmds }, resolve);
        });
        await until(function () {
          var el = document.getElementById('sn-pinned-dock');
          return el && getComputedStyle(el).display === 'none';
        }, 3000, 'dock to hide with nothing pinned');

        cmds[0].pinned = true;
        await new Promise(function (resolve) {
          chrome.storage.local.set({ snCommands: cmds }, resolve);
        });
        await until(function () {
          var el = document.getElementById('sn-pinned-dock');
          return el && getComputedStyle(el).display !== 'none' &&
                 el.querySelectorAll('.sn-pin-cmd').length === 1;
        }, 3000, 'dock to return when a command is pinned');
      }

      if (scenario === 'dock-drag') {
        var head = dock.querySelector('.sn-pin-head');
        if (!head) throw new Error('dock has no drag handle');
        function pointer(type, x, y, buttons) {
          head.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse',
            isPrimary: true, button: 0, buttons: buttons, clientX: x, clientY: y
          }));
        }
        var sx = rect.left + 20, sy = rect.top + 12;
        pointer('pointerdown', sx, sy, 1);
        pointer('pointermove', sx + 300, sy + 120, 1);
        pointer('pointerup',   sx + 300, sy + 120, 0);

        var dragged = dock.getBoundingClientRect();
        if (Math.abs(dragged.left - (rect.left + 300)) > 1 ||
            Math.abs(dragged.top  - (rect.top + 120)) > 1) {
          throw new Error('dragging did not move the dock (left=' + dragged.left + ', top=' + dragged.top + ')');
        }

        head.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowRight', bubbles: true, cancelable: true
        }));
        var keyed = dock.getBoundingClientRect();
        if (Math.abs(keyed.left - (dragged.left + 12)) > 1) {
          throw new Error('arrow keys did not move the dock (left=' + keyed.left + ')');
        }

        await sleep(350); // the arrow-key save is debounced
        var saved = await new Promise(function (resolve) {
          chrome.storage.local.get('snPinnedPos', resolve);
        });
        var p = saved && saved.snPinnedPos;
        if (!p || Math.abs(p.left - keyed.left) > 1 || Math.abs(p.top - keyed.top) > 1) {
          throw new Error('dock position was not saved (got ' + JSON.stringify(p) + ')');
        }
      }
    }

    var settingsSetup = scenario.indexOf('settings-') === 0 ||
                        scenario === 'instances' || scenario === 'pagetheme' ||
                        scenario === 'helpers' || scenario === 'support';

    if (settingsSetup) {
      await until(function () {
        return document.querySelector('.cmd-item-body') || document.querySelector('.empty-list');
      }, 5000, 'settings list');

      if (scenario === 'settings-editor' || scenario === 'settings-fullscreen') {
        await until(function () { return document.querySelector('.cmd-item-body'); }, 5000, 'settings commands');
        click('.cmd-item-body');
        await until(function () { return document.querySelector('.CodeMirror'); }, 5000, 'CodeMirror');
      }
      if (scenario === 'settings-fullscreen') {
        click('.script-actions button[title="Open fullscreen editor"]');
        await until(function () {
          return document.querySelector('#fullscreenOverlay.visible .CodeMirror');
        }, 3000, 'settings fullscreen');
      }
      if (scenario === 'settings-bulk') {
        await until(function () {
          return document.querySelector('.cmd-item-check input');
        }, 5000, 'bulk checkboxes');
        click('.cmd-item-check input');
        await until(function () { return document.querySelector('#bulkBar.visible'); }, 3000, 'bulk bar');
      }
      if (scenario === 'instances') {
        click('#btnInstances');
        await until(function () { return document.querySelector('#instancesOverlay.visible'); }, 3000, 'instances modal');
      }
      if (scenario === 'pagetheme') {
        click('#btnPageTheme');
        await until(function () {
          return document.querySelector('#pageThemeOverlay.visible') &&
                 document.querySelectorAll('.theme-card').length >= 5;
        }, 3000, 'page theme modal');
      }
      if (scenario === 'helpers') {
        click('#btnHelpers');
        await until(function () {
          return document.querySelector('#helpersOverlay.visible') &&
                 document.querySelectorAll('.helper-row').length === 3;
        }, 3000, 'helpers modal');
      }
      if (scenario === 'support') {
        click('#btnSupport');
        await until(function () { return document.querySelector('#supportOverlay.visible'); }, 3000, 'support modal');
      }
    }

    await sleep(300);
  }

  function parseColor(value) {
    var m = String(value).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+%?))?\s*\)/);
    if (!m) return null;
    var a = m[4] === undefined ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a: isNaN(a) ? 1 : a };
  }

  function composite(fg, bg) {
    var a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1
    };
  }

  function luminance(c) {
    function channel(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  function ratio(a, b) {
    var x = luminance(a), y = luminance(b);
    var hi = Math.max(x, y), lo = Math.min(x, y);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Walk up to the first opaque colour, compositing semi-transparent layers.
  // A gradient with no colour behind it is unknowable from computed styles, so
  // it is reported as risky and skipped (the gradient buttons are checked by the
  // static token checks in check-wiring.js).
  function effectiveBackground(el) {
    var node = el;
    var riskyImage = false;
    while (node && node.nodeType === 1) {
      var cs = getComputedStyle(node);
      var bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0) {
        if (bg.a >= 0.999) return { color: bg, risky: riskyImage };
        var under = effectiveBackground(node.parentElement);
        return { color: composite(bg, under.color), risky: riskyImage || under.risky };
      }
      if (cs.backgroundImage !== 'none') riskyImage = true;
      node = node.parentElement;
    }
    return { color: { r: 255, g: 255, b: 255, a: 1 }, risky: riskyImage };
  }

  function rendered(el) {
    if (!el || !el.isConnected) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var node = el;
    while (node && node.nodeType === 1) {
      var cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      if (node.matches && node.matches('.disabled, [aria-disabled="true"], [disabled]')) return false;
      node = node.parentElement;
    }
    return true;
  }

  function describe(el) {
    var out = el.tagName.toLowerCase();
    if (el.id) out += '#' + el.id;
    var classes = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (classes.length) out += '.' + classes.join('.');
    var parent = el.parentElement;
    if (parent && parent !== document.body) {
      var p = parent.tagName.toLowerCase();
      if (parent.id) p += '#' + parent.id;
      out = p + ' > ' + out;
    }
    return out;
  }

  function thresholdFor(cs) {
    var size = parseFloat(cs.fontSize) || 13;
    var weight = parseInt(cs.fontWeight, 10) || 400;
    return (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
  }

  function run(root) {
    var failures = [];
    var checkedText = 0;
    var checkedControls = 0;
    var skippedGradients = 0;

    // Direct text nodes only: each element's own computed colour applies to them.
    var elements = new Map();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TITLE' || tag === 'OPTION') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      var el = walker.currentNode.parentElement;
      elements.set(el, (elements.get(el) || '') + walker.currentNode.nodeValue);
    }

    elements.forEach(function (text, el) {
      if (!rendered(el)) return;
      var cs = getComputedStyle(el);
      var fg = parseColor(cs.color);
      if (!fg) return;
      var bg = effectiveBackground(el);
      if (bg.risky) { skippedGradients++; return; }
      var fgSolid = fg.a < 1 ? composite(fg, bg.color) : fg;
      var required = thresholdFor(cs);
      var actual = ratio(fgSolid, bg.color);
      checkedText++;
      if (actual + 0.005 < required) {
        failures.push({
          kind: 'text',
          selector: describe(el),
          text: text.replace(/\s+/g, ' ').trim().slice(0, 70),
          ratio: +actual.toFixed(2),
          required: required,
          color: cs.color,
          background: 'rgb(' + Math.round(bg.color.r) + ', ' + Math.round(bg.color.g) + ', ' + Math.round(bg.color.b) + ')',
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight
        });
      }
    });

    var controls = root.querySelectorAll('input, textarea, select');
    Array.prototype.forEach.call(controls, function (el) {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'button', 'submit', 'reset', 'image'].indexOf(type) !== -1) return;
      if (!rendered(el)) return;
      var cs = getComputedStyle(el);
      var fg = parseColor(cs.color);
      if (!fg) return;
      var bg = effectiveBackground(el);
      if (bg.risky) { skippedGradients++; return; }
      var required = thresholdFor(cs);
      var value = String(el.value || '');
      var label = value || el.getAttribute('placeholder') || '(empty)';
      var fgSolid = fg.a < 1 ? composite(fg, bg.color) : fg;
      var actual = ratio(fgSolid, bg.color);
      checkedControls++;
      if (actual + 0.005 < required) {
        failures.push({
          kind: type === 'select' ? 'select' : 'control',
          selector: describe(el),
          text: label.slice(0, 70),
          ratio: +actual.toFixed(2),
          required: required,
          color: cs.color,
          background: 'rgb(' + Math.round(bg.color.r) + ', ' + Math.round(bg.color.g) + ', ' + Math.round(bg.color.b) + ')'
        });
      }

      // Placeholder text has to be readable too, and it often uses a separate
      // UA colour that the control's own colour doesn't reveal.
      if (el.getAttribute('placeholder')) {
        var ph = null;
        try { ph = parseColor(getComputedStyle(el, '::placeholder').color); } catch (e) { ph = null; }
        if (ph) {
          var phSolid = ph.a < 1 ? composite(ph, bg.color) : ph;
          var phRatio = ratio(phSolid, bg.color);
          checkedControls++;
          if (phRatio + 0.005 < required) {
            failures.push({
              kind: 'placeholder',
              selector: describe(el),
              text: el.getAttribute('placeholder').slice(0, 70),
              ratio: +phRatio.toFixed(2),
              required: required,
              color: getComputedStyle(el, '::placeholder').color,
              background: 'rgb(' + Math.round(bg.color.r) + ', ' + Math.round(bg.color.g) + ', ' + Math.round(bg.color.b) + ')'
            });
          }
        }
      }
    });

    return {
      done: true,
      scenario: scenario,
      theme: theme,
      scope: root === document.body ? 'body' : scopeSel,
      checkedText: checkedText,
      checkedControls: checkedControls,
      skippedGradients: skippedGradients,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      failures: failures,
      errors: pageErrors
    };
  }

  (async function () {
    try {
      await setup();
      var root = scopeSel ? document.querySelector(scopeSel) : document.body;
      if (!root) throw new Error('scope not found: ' + scopeSel);
      window.__auditResult = JSON.stringify(run(root));
    } catch (err) {
      window.__auditResult = JSON.stringify({
        done: true,
        scenario: scenario,
        theme: theme,
        error: String((err && err.message) || err),
        errors: pageErrors
      });
    }
  })();
})();
`;

// ── Harness ───────────────────────────────────────────────────────────────────
function readBuild(...parts) {
  return fs.readFileSync(path.join(ROOT, BUILD, ...parts), 'utf8');
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function instrument(html, pageScript) {
  const tag = `<script src="${pageScript}"></script>`;
  if (!html.includes(tag)) throw new Error(`could not find ${tag} in the page`);
  return html.replace(
    tag,
    `<script src="__audit-mock.js"></script>\n${tag}\n<script src="__audit-run.js"></script>`
  );
}

function makeHarness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sncommands-audit-'));
  const src = path.join(ROOT, BUILD);
  const libDir = path.join(src, 'lib');

  ['themes.js', 'helpers.js', 'popup.js', 'settings.js', 'content.js']
    .forEach(f => copyFile(path.join(src, f), path.join(dir, f)));
  for (const f of fs.readdirSync(libDir)) copyFile(path.join(libDir, f), path.join(dir, 'lib', f));
  for (const f of fs.readdirSync(path.join(src, 'icons'))) {
    copyFile(path.join(src, 'icons', f), path.join(dir, 'icons', f));
  }

  fs.writeFileSync(path.join(dir, '__audit-mock.js'), MOCK_DATA_JS);
  fs.writeFileSync(path.join(dir, '__audit-run.js'), AUDIT_JS);

  fs.writeFileSync(
    path.join(dir, 'popup.audit.html'),
    instrument(readBuild('popup.html'), 'popup.js')
  );
  fs.writeFileSync(
    path.join(dir, 'settings.audit.html'),
    instrument(readBuild('settings.html'), 'settings.js')
  );
  fs.writeFileSync(path.join(dir, 'palette.audit.html'), `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Palette audit</title></head>
<body style="margin:0;padding:24px;font:14px/1.5 sans-serif;background:#ffffff;color:#111827">
<h1 style="font-size:18px">A page that is not ServiceNow</h1>
<p>The palette is opened by the same keydown path a user triggers.</p>
<script src="__audit-mock.js"></script>
<script src="themes.js"></script>
<script src="helpers.js"></script>
<script src="content.js"></script>
<script src="__audit-run.js"></script>
</body>
</html>`);
  fs.writeFileSync(path.join(dir, 'dock.audit.html'), `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Pinned dock audit</title></head>
<body style="margin:0;padding:24px;font:14px/1.5 sans-serif;background:#ffffff;color:#111827">
<sn-polaris-layout></sn-polaris-layout>
<h1 style="font-size:18px">A ServiceNow instance page</h1>
<p>The pinned commands dock is mounted by content.js when the page gate accepts the page.</p>
<script src="__audit-mock.js"></script>
<script src="themes.js"></script>
<script src="helpers.js"></script>
<script src="content.js"></script>
<script src="__audit-run.js"></script>
</body>
</html>`);
  // Classic UI's top frame has no <body> at all — it is a <frameset> document.
  // The dock must still mount, and paint above the frames. Scripts are loaded
  // after DOMContentLoaded to match document_idle injection: a content script
  // never runs while the parser is still building the frameset.
  fs.writeFileSync(path.join(dir, 'dock-frameset.audit.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><title>Classic UI frameset audit</title>
<link rel="stylesheet" href="/styles/heisenberg/fixture.css">
<script>
window.addEventListener('DOMContentLoaded', function () {
  ['__audit-mock.js', 'themes.js', 'helpers.js', 'content.js', '__audit-run.js']
    .forEach(function (src) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      document.head.appendChild(s);
    });
});
</script>
</head>
<frameset cols="200,*">
<frame src="about:blank">
<frame src="about:blank">
</frameset>
</html>`);

  return {
    dir,
    url(scenario) {
      const page = scenario.page === 'settings' ? 'settings.audit.html'
                 : scenario.page === 'palette'  ? 'palette.audit.html'
                 : scenario.page === 'dock'     ? 'dock.audit.html'
                 : scenario.page === 'dock-frameset' ? 'dock-frameset.audit.html'
                 : 'popup.audit.html';
      const file = path.join(dir, page);
      const params = [
        'theme=' + scenario.theme,
        'scenario=' + encodeURIComponent(scenario.setup)
      ];
      if (scenario.scope) params.push('scope=' + encodeURIComponent(scenario.scope));
      return pathToFileURL(file).href + '?' + params.join('&');
    },
    cleanup() { rmrf(dir); }
  };
}

// ── Small utilities ───────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (e) { /* a browser may still hold a lock; the OS will reap the temp dir */ }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPortOrExit(port, proc, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (proc.exitCode !== null) return false;
    const open = await new Promise(resolve => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
    if (open) return true;
    await sleep(200);
  }
  return false;
}

function wsConnect(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      reject(new Error('timeout opening ' + url));
    }, timeoutMs || 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cannot open ' + url)); });
  });
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      proc.kill('SIGKILL');
    }
  } catch (e) { /* already gone */ }
}

function findBrowser(kind) {
  const env = process.env[kind === 'chrome' ? 'CHROME_PATH' : 'FIREFOX_PATH'];
  const candidates = [];
  if (env) candidates.push(env);

  if (process.platform === 'win32') {
    if (kind === 'chrome') {
      candidates.push(
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
      );
    } else {
      candidates.push(
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Mozilla Firefox', 'firefox.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Mozilla Firefox', 'firefox.exe')
      );
    }
  } else if (process.platform === 'darwin') {
    if (kind === 'chrome') candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    else candidates.push('/Applications/Firefox.app/Contents/MacOS/firefox');
  } else if (kind === 'chrome') {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  } else {
    candidates.push('/usr/bin/firefox');
  }

  return candidates.find(p => p && fs.existsSync(p)) || null;
}

// ── DevTools protocol ────────────────────────────────────────────────────────
function makeCdp(ws) {
  let nextId = 0;
  const pending = new Map();

  ws.addEventListener('message', event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (!msg.id || !pending.has(msg.id)) return;
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else entry.resolve(msg.result);
  });

  function send(method, params, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(payload));
    });
  }

  return { send, close() { try { ws.close(); } catch (e) {} } };
}

async function auditChrome(harness, scenarios, shotsDir) {
  const exe = findBrowser('chrome');
  if (!exe) return { browser: 'chrome', skipped: 'Chrome not found (set CHROME_PATH)' };

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sncommands-chrome-'));
  const port = await freePort();
  const proc = spawn(exe, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--force-color-profile=srgb',
    '--window-size=1280,800',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  let cdp = null;
  try {
    let version = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/json/version');
        if (res.ok) { version = await res.json(); break; }
      } catch (e) { /* not up yet */ }
      await sleep(150);
    }
    if (!version || !version.webSocketDebuggerUrl) throw new Error('Chrome DevTools endpoint did not come up');

    cdp = makeCdp(await wsConnect(version.webSocketDebuggerUrl, 15000));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const session = attached.sessionId;
    const call = (method, params) => cdp.send(method, params, session);

    await call('Page.enable', {});
    await call('Runtime.enable', {});

    const results = [];
    for (const scenario of scenarios) {
      const [width, height] = scenario.viewport;
      await call('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false
      });
      await call('Page.navigate', { url: harness.url(scenario) });

      let raw = '';
      const start = Date.now();
      let lastError = '';
      while (Date.now() - start < 20000) {
        try {
          const evalResult = await call('Runtime.evaluate', {
            expression: 'window.__auditResult || ""',
            returnByValue: true,
            awaitPromise: true
          });
          if (evalResult.exceptionDetails) {
            lastError = evalResult.exceptionDetails.text || 'page evaluation failed';
          } else if (evalResult.result && evalResult.result.value) {
            raw = evalResult.result.value;
            break;
          }
        } catch (e) {
          lastError = e.message;
        }
        await sleep(150);
      }
      if (!raw) {
        let early = '';
        try {
          const er = await call('Runtime.evaluate', {
            expression: 'JSON.stringify(window.__auditEarlyErrors || [])',
            returnByValue: true
          });
          if (er.result && er.result.value && er.result.value !== '[]') early = ' page errors: ' + er.result.value;
        } catch (e) { /* diagnostics only */ }
        results.push({ scenario, error: 'timed out waiting for audit' + (lastError ? ': ' + lastError : '') + early });
        continue;
      }

      let audit;
      try { audit = JSON.parse(raw); }
      catch (e) { results.push({ scenario, error: 'bad audit JSON: ' + e.message }); continue; }
      results.push({ scenario, audit });

      if (shotsDir) {
        try {
          const shot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(shotsDir, 'chrome-' + scenario.id + '.png'), Buffer.from(shot.data, 'base64'));
        } catch (e) { /* screenshots are a debugging aid */ }
      }
    }

    return { browser: 'chrome', version: version.Browser, results };
  } finally {
    if (cdp) cdp.close();
    killTree(proc);
    await sleep(200);
    rmrf(profile);
  }
}

// ── WebDriver BiDi (Firefox) ─────────────────────────────────────────────────
function unwrapBidiResult(res) {
  return (res && res.type === 'success' && res.result) ? res.result : res;
}

function makeBidi(ws) {
  let nextId = 0;
  const pending = new Map();

  ws.addEventListener('message', event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (!msg.id || !pending.has(msg.id)) return;
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.type === 'error') entry.reject(new Error(msg.error + (msg.message ? ': ' + msg.message : '')));
    else entry.resolve(msg.result);
  });

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('BiDi timeout: ' + method));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  return { send, close() { try { ws.close(); } catch (e) {} } };
}

async function auditFirefox(harness, scenarios, shotsDir) {
  const exe = findBrowser('firefox');
  if (!exe) return { browser: 'firefox', skipped: 'Firefox not found (set FIREFOX_PATH)' };

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sncommands-firefox-'));
  fs.writeFileSync(path.join(profile, 'user.js'), [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("app.update.auto", false);',
    'user_pref("browser.tabs.warnOnClose", false);'
  ].join('\n'));

  const port = await freePort();
  const logPath = path.join(profile, 'launch.log');
  const logFd = fs.openSync(logPath, 'w');
  const proc = spawn(exe, [
    '-headless',
    '-no-remote',
    '-profile', profile,
    '--remote-debugging-port', String(port),
    'about:blank'
  ], { stdio: ['ignore', logFd, logFd], windowsHide: true });

  let bidi = null;
  try {
    const portOpen = await waitForPortOrExit(port, proc, 45000);
    if (!portOpen) {
      let tail = '';
      try {
        tail = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).slice(-6).join(' | ');
      } catch (e) { /* diagnostics only */ }
      throw new Error('Firefox remote agent did not open port ' + port +
        (proc.exitCode !== null ? ' (exited ' + proc.exitCode + ')' : '') +
        (tail ? ' — log: ' + tail : ''));
    }

    let ws = null;
    let last = null;
    for (let i = 0; i < 30 && !ws; i++) {
      try { ws = await wsConnect('ws://127.0.0.1:' + port + '/session', 5000); }
      catch (e) { last = e; await sleep(200); }
    }
    if (!ws) throw new Error('could not connect to Firefox BiDi' + (last ? ': ' + last.message : ''));

    bidi = makeBidi(ws);
    const session = await bidi.send('session.new', { capabilities: {} });
    const context = (await bidi.send('browsingContext.create', { type: 'tab' })).context;

    const results = [];
    for (const scenario of scenarios) {
      const [width, height] = scenario.viewport;
      try {
        await bidi.send('browsingContext.setViewport', {
          context, viewport: { width, height }, devicePixelRatio: 1
        });
      } catch (e) { /* older BiDi builds: default viewport is fine for the audit */ }

      try {
        await bidi.send('browsingContext.navigate', {
          context, url: harness.url(scenario), wait: 'complete'
        });
      } catch (e) {
        results.push({ scenario, error: 'navigation failed: ' + e.message });
        continue;
      }

      let raw = '';
      const start = Date.now();
      let lastError = '';
      while (Date.now() - start < 20000) {
        try {
          const res = unwrapBidiResult(await bidi.send('script.evaluate', {
            expression: 'window.__auditResult || ""',
            target: { context },
            awaitPromise: true,
            resultOwnership: 'none'
          }));
          if (res && res.type === 'string' && res.value) { raw = res.value; break; }
        } catch (e) {
          lastError = e.message;
        }
        await sleep(150);
      }
      if (!raw) {
        let diag = '';
        try {
          const er = unwrapBidiResult(await bidi.send('script.evaluate', {
            expression: 'JSON.stringify({ready:document.readyState,theme:document.documentElement.getAttribute("data-theme"),scripts:document.scripts.length,early:window.__auditEarlyErrors||null})',
            target: { context },
            awaitPromise: true,
            resultOwnership: 'none'
          }));
          if (er && er.type === 'string' && er.value) diag = ' state: ' + er.value;
        } catch (e) { /* diagnostics only */ }
        results.push({ scenario, error: 'timed out waiting for audit' + (lastError ? ': ' + lastError : '') + diag });
        continue;
      }

      let audit;
      try { audit = JSON.parse(raw); }
      catch (e) { results.push({ scenario, error: 'bad audit JSON: ' + e.message }); continue; }
      results.push({ scenario, audit });

      if (shotsDir) {
        try {
          const shot = await bidi.send('browsingContext.captureScreenshot', { context });
          fs.writeFileSync(path.join(shotsDir, 'firefox-' + scenario.id + '.png'), Buffer.from(shot.data, 'base64'));
        } catch (e) { /* helps debugging only */ }
      }
    }

    try { await bidi.send('browser.close', {}); } catch (e) {}
    return { browser: 'firefox', version: session && session.capabilities && session.capabilities.browserVersion, results };
  } finally {
    if (bidi) bidi.close();
    killTree(proc);
    await sleep(300);
    try { fs.closeSync(logFd); } catch (e) { /* already closed */ }
    rmrf(profile);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
function report(outcome) {
  if (outcome.skipped) {
    console.log(`  - ${outcome.browser}: skipped — ${outcome.skipped}`);
    return { fail: 0, pass: 0, skip: 1 };
  }

  console.log(`\n${outcome.browser} ${outcome.version || ''}`.trim());
  let pass = 0, fail = 0;

  for (const entry of outcome.results) {
    const id = entry.scenario.id;
    const audit = entry.audit;
    if (!audit) {
      fail++;
      console.log(`  ✗ ${id} — ${entry.error}`);
      continue;
    }
    if (audit.error) {
      fail++;
      console.log(`  ✗ ${id} — ${audit.error}`);
      (audit.errors || []).forEach(e => console.log(`      page error: ${e}`));
      continue;
    }

    const errors = audit.errors || [];
    if (audit.failures.length || errors.length) {
      fail++;
      console.log(`  ✗ ${id} (${audit.theme}) — ${audit.failures.length} contrast, ${errors.length} page error(s)`);
      audit.failures.forEach(f => {
        console.log(`      ${f.ratio}:1 < ${f.required}:1  ${f.kind}  ${f.selector}`);
        console.log(`        "${f.text}"  ${f.color} on ${f.background}`);
      });
      errors.forEach(e => console.log(`      page error: ${e}`));
    } else {
      pass++;
      console.log(`  ✓ ${id} — ${audit.checkedText} text, ${audit.checkedControls} control/placeholder checks`);
    }
  }

  return { pass, fail, skip: 0 };
}

function parseArgs(argv) {
  const opts = { browsers: ['chrome', 'firefox'], theme: null, shots: null, scenario: null };
  argv.forEach(arg => {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) return;
    if (m[1] === 'browser')  opts.browsers = m[2].split(',').map(s => s.trim()).filter(Boolean);
    if (m[1] === 'theme')    opts.theme = m[2];
    if (m[1] === 'shots')    opts.shots = path.resolve(m[2]);
    if (m[1] === 'scenario') opts.scenario = m[2];
  });
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let scenarios = opts.theme ? SCENARIOS.filter(s => s.theme === opts.theme) : SCENARIOS;
  if (opts.scenario) scenarios = scenarios.filter(s => s.id === opts.scenario);
  if (!scenarios.length) throw new Error('no scenarios match the given filters');

  let shotsDir = null;
  if (opts.shots) { shotsDir = opts.shots; fs.mkdirSync(shotsDir, { recursive: true }); }

  const harness = makeHarness();
  const outcomes = [];
  try {
    for (const browser of opts.browsers) {
      if (browser === 'chrome') outcomes.push(await auditChrome(harness, scenarios, shotsDir));
      else if (browser === 'firefox') outcomes.push(await auditFirefox(harness, scenarios, shotsDir));
      else console.log(`  - ${browser}: unknown browser, skipping`);
    }
  } finally {
    if (process.env.SN_AUDIT_KEEP) console.log('Harness kept at ' + harness.dir);
    else harness.cleanup();
  }

  const totals = { pass: 0, fail: 0, skip: 0 };
  outcomes.forEach(o => {
    const t = report(o);
    totals.pass += t.pass;
    totals.fail += t.fail;
    totals.skip += t.skip;
  });

  console.log(`\n${totals.pass} passed, ${totals.fail} failed, ${totals.skip} skipped.`);
  if (shotsDir) console.log('Screenshots: ' + shotsDir);
  if (totals.fail > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('\nAudit failed to run:', err.message);
  process.exitCode = 1;
});
