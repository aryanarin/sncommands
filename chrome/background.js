'use strict';

// ── Background Service Worker ─────────────────────────────────────────────────
// Everything that has to happen outside a page lives here:
//
//   1. Running a command's script in the page's MAIN world.
//   2. Registering a dynamic content script for on-prem / custom instance hosts.
//   3. Seeding a small set of generic, instance-agnostic commands on first install.
//   4. Keeping the per-command usage counter (`uses` / `lastUsedAt`) up to date.
//
// Three callers ask for a script to run, and all of them funnel into runInTab():
//
//   • popup.js     → msg.source = 'SN_COMMANDS_EXEC_TAB'  (knows the tabId)
//   • settings.js  → msg.source = 'SN_COMMANDS_EXEC_TAB'  (knows the tabId)
//   • content.js   → msg.source = 'SN_COMMANDS_EXEC'      (tabId comes from sender)
//
// Whenever the message carries a command `id`, the run is counted. Counting is
// deliberately done here rather than in the caller: the palette can be open in
// several frames or tabs at once, and a read-modify-write in each one would
// lose updates.

const STORE_COMMANDS    = 'snCommands';
const DYNAMIC_SCRIPT_ID = 'sn-commands-dynamic';

// ── Seed commands ─────────────────────────────────────────────────────────────
// Deliberately generic: every one of these works on any ServiceNow instance,
// cloud or on-prem, because they read the host from the page rather than having
// one baked in. They are written as self-contained IIFEs since each is eval'd on
// its own in the page's MAIN world, with no shared helpers to lean on.
//
// Only ever written on a fresh install (see onInstalled) so nobody's existing
// library gets entries injected into it on update.

const NOTIFY_HELPER = `
    function notify(msg) {
        try {
            if (typeof g_form !== 'undefined' && g_form.addInfoMessage) { g_form.addInfoMessage(msg); return; }
        } catch (e) {}
        var t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;bottom:22px;right:22px;z-index:2147483647;' +
            'background:#0f172a;color:#f1f5f9;padding:11px 16px;border-radius:8px;' +
            'font:600 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
            'box-shadow:0 6px 22px rgba(0,0,0,.35);max-width:420px;transition:opacity .4s;';
        document.body.appendChild(t);
        setTimeout(function () { t.style.opacity = '0'; }, 2600);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3100);
    }`;

// Shared preamble for the record-aware commands: works out the table and sys_id
// of whatever record is open, from g_form first and the URL as a fallback.
const RECORD_HELPER = `
    function currentRecord() {
        var table = '', sysId = '';
        try {
            if (typeof g_form !== 'undefined') {
                if (g_form.getTableName)   table = g_form.getTableName()   || '';
                if (g_form.getUniqueValue) sysId = g_form.getUniqueValue() || '';
            }
        } catch (e) {}
        var href = decodeURIComponent(window.location.href);
        if (!table) {
            var m = href.match(/\\/([a-z0-9_]+)\\.do/i);
            if (m) table = m[1];
        }
        if (!sysId) {
            var s = href.match(/sys_id[=%3D]+([a-f0-9]{32})/i);
            if (s) sysId = s[1];
        }
        return { table: table, sysId: sysId };
    }`;

const DEFAULT_COMMANDS = [
  {
    id:    'seed-copysysid',
    name:  'copysysid',
    hint:  'Copy the current record\u2019s sys_id to the clipboard',
    order: 10,
    script:
`(function () {${RECORD_HELPER}${NOTIFY_HELPER}
    var rec = currentRecord();
    if (!rec.sysId) { notify('No sys_id found \u2014 open a record first.'); return; }

    function done() { notify('sys_id copied: ' + rec.sysId); }
    function manual() { prompt('Copy the sys_id with Ctrl+C:', rec.sysId); }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(rec.sysId).then(done).catch(manual);
    } else {
        manual();
    }
})();`
  },
  {
    id:    'seed-sysinfo',
    name:  'sysinfo',
    hint:  'Show the table, sys_id and number of the current record',
    order: 20,
    script:
`(function () {${RECORD_HELPER}${NOTIFY_HELPER}
    var rec = currentRecord();
    var number = '';
    try {
        if (typeof g_form !== 'undefined' && g_form.getValue) number = g_form.getValue('number') || '';
    } catch (e) {}

    var bits = [];
    if (number)    bits.push('Number: ' + number);
    if (rec.table) bits.push('Table: ' + rec.table);
    if (rec.sysId) bits.push('sys_id: ' + rec.sysId);
    bits.push('Instance: ' + window.location.hostname);

    notify(bits.join('  \u00b7  '));
    console.log('[SN Commands] record', rec);
})();`
  },
  {
    id:    'seed-email',
    name:  'email',
    hint:  'Open the email client for the current record',
    order: 30,
    script:
`(function () {${RECORD_HELPER}${NOTIFY_HELPER}
    var rec = currentRecord();
    if (!rec.table || !rec.sysId) {
        notify('Could not work out the record \u2014 open a record form first.');
        return;
    }

    var url = '/email_client.do' +
        '?sysparm_table='       + encodeURIComponent(rec.table) +
        '&sysparm_sys_id='      + encodeURIComponent(rec.sysId) +
        '&sysparm_target='      + encodeURIComponent(rec.table) +
        '&sys_target='          + encodeURIComponent(rec.table) +
        '&sys_uniqueValue='     + encodeURIComponent(rec.sysId) +
        '&sys_row=0&sysparm_encoded_record=&sysparm_domain_restore=false&sysparm_stack=no';

    window.open(window.location.origin + url, '_blank', 'width=980,height=760');
})();`
  },
  {
    id:    'seed-myprofile',
    name:  'myprofile',
    hint:  'Open your own user profile record',
    order: 40,
    script:
`(function () {${NOTIFY_HELPER}
    var userId = '';
    try { if (typeof g_user !== 'undefined' && g_user.userID) userId = g_user.userID; } catch (e) {}
    try { if (!userId && window.NOW && NOW.user && NOW.user.sysId) userId = NOW.user.sysId; } catch (e) {}
    try { if (!userId && window.top && top.g_user && top.g_user.userID) userId = top.g_user.userID; } catch (e) {}

    // Falls back to the same trick the out-of-box "My Profile" module uses:
    // the server resolves the sys_id for the session.
    var target = userId
        ? '/sys_user.do?sys_id=' + encodeURIComponent(userId)
        : '/sys_user.do?sys_id=javascript:gs.getUserID()';

    notify(userId ? 'Opening your profile\u2026' : 'Opening your profile (resolved server-side)\u2026');
    window.open(window.location.origin + '/nav_to.do?uri=' + encodeURIComponent(target), '_blank');
})();`
  },
  {
    id:    'seed-sowview',
    name:  'sowview',
    hint:  'Switch the current record to the Service Operations Workspace view',
    order: 50,
    script:
`(function () {${RECORD_HELPER}${NOTIFY_HELPER}
    var rec = currentRecord();
    if (!rec.table || !rec.sysId) {
        notify('Could not work out the record \u2014 open a record form first.');
        return;
    }

    // origin, never a hardcoded host, so this works on any instance.
    window.location.href = window.location.origin + '/' + rec.table + '.do' +
        '?sys_id='  + encodeURIComponent(rec.sysId) +
        '&sysparm_view=sow' +
        '&sysparm_stack=' +
        '&sysparm_userpref.' + rec.table + '.view=sow' +
        '&sysparm_userpref.' + rec.table + '_list.view=sow';
})();`
  },
  {
    id:    'seed-defaultview',
    name:  'defaultview',
    hint:  'Switch the current record back to the Default view',
    order: 60,
    script:
`(function () {${RECORD_HELPER}${NOTIFY_HELPER}
    var rec = currentRecord();
    if (!rec.table || !rec.sysId) {
        notify('Could not work out the record \u2014 open a record form first.');
        return;
    }

    window.location.href = window.location.origin + '/' + rec.table + '.do' +
        '?sys_id='  + encodeURIComponent(rec.sysId) +
        '&sysparm_view=' +
        '&sysparm_stack=' +
        '&sysparm_userpref.' + rec.table + '.view=' +
        '&sysparm_userpref.' + rec.table + '_list.view=';
})();`
  },
  {
    id:    'seed-excel',
    name:  'excel',
    hint:  'Export the current list to Excel \u2014 all or just your visible columns',
    order: 70,
    script:
`(function () {${NOTIFY_HELPER}
    var MENU_ID = 'sn-cmd-xls-menu';

    function findList() {
        var frame = document.querySelector('#gsft_main');
        var win = frame ? frame.contentWindow  : window;
        var doc = frame ? frame.contentDocument : document;

        var listName = doc.querySelector('#sys_target') && doc.querySelector('#sys_target').value;
        if (!listName || typeof win.GlideList2 === 'undefined') return null;

        var list = win.GlideList2.get(listName);
        if (!list) return null;

        var table = list.getTableName ? list.getTableName() : list.tableName;
        if (!table) return null;

        var query = '';
        try   { query = list.getQuery ? list.getQuery(true, true, false, true) : (list.filter || ''); }
        catch (e) { query = list.filter || ''; }

        var scope  = doc.getElementById(listName + '_table') || doc;
        var fields = [];
        Array.prototype.forEach.call(scope.querySelectorAll('th[name]'), function (th) {
            var name = th.getAttribute('name');
            if (!name || name === 'search' || th.offsetParent === null) return;
            if (fields.indexOf(name) === -1) fields.push(name);
        });

        return { table: table, query: query, fields: fields };
    }

    function closeMenu() {
        var el = document.getElementById(MENU_ID);
        if (el) el.remove();
    }

    function exportNow(mode) {
        closeMenu();
        var info = findList();
        if (!info) { notify('No classic list found on this page.'); return; }

        var params = new URLSearchParams();
        params.set('sysparm_query', info.query);
        if (mode === 'visible' && info.fields.length) params.set('sysparm_fields', info.fields.join(','));
        else params.set('sysparm_default_export_fields', 'all');

        var url = window.location.origin + '/' + info.table + '_list.do?EXCEL&' + params.toString();
        var frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;';
        frame.src = url;
        document.body.appendChild(frame);
        setTimeout(function () { frame.remove(); }, 20000);
        notify('Export started \u2014 check your downloads.');
    }

    closeMenu();
    var menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.style.cssText = 'position:fixed;bottom:60px;right:18px;z-index:2147483647;' +
        'background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:9px;' +
        'display:flex;gap:7px;box-shadow:0 8px 28px rgba(15,23,42,.24);' +
        'font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

    function button(label, primary, mode) {
        var b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer;border:1px solid ' +
            (primary ? '#0070d2;background:#0070d2;color:#fff' : '#cbd5e1;background:#fff;color:#0f172a');
        b.onclick = function () { exportNow(mode); };
        return b;
    }

    menu.appendChild(button('All columns',     false, 'all'));
    menu.appendChild(button('Visible columns', true,  'visible'));
    document.body.appendChild(menu);

    setTimeout(function () {
        document.addEventListener('click', function outside(e) {
            if (!menu.contains(e.target)) { closeMenu(); document.removeEventListener('click', outside); }
        });
    }, 0);
    setTimeout(closeMenu, 15000);
})();`
  },
  {
    id:    'seed-reload',
    name:  'reload',
    hint:  'Reload the current record, bypassing the browser cache',
    order: 80,
    script:
`(function () {${NOTIFY_HELPER}
    var frame = document.querySelector('#gsft_main');
    try {
        if (frame && frame.contentWindow) { frame.contentWindow.location.reload(true); return; }
    } catch (e) {}
    notify('Reloading\u2026');
    window.location.reload(true);
})();`
  }
];

// ── Custom / on-prem instance support ────────────────────────────────────────
// The static content_scripts entry in manifest.json only covers
// *.service-now.com. To support on-prem or differently-named cloud instances,
// the settings page lets the user either:
//   a) grant the extension access to a specific list of hostnames, or
//   b) grant access to all sites ("<all_urls>")
// Whichever host permissions get approved, we register a *dynamic* content
// script (content.js) for those origins so the palette works there too.

async function syncDynamicContentScript() {
    const { snAllUrls, snCustomDomains } = await chrome.storage.local.get(['snAllUrls', 'snCustomDomains']);
    const patterns = snAllUrls ? ['<all_urls>'] : (snCustomDomains || []);

    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
    if (existing.length) {
        await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
    }
    if (!patterns.length) return;

    await chrome.scripting.registerContentScripts([{
        id: DYNAMIC_SCRIPT_ID,
        matches: patterns,
        // themes.js and helpers.js first — they define what content.js consumes.
        // Keep this list in step with content_scripts in manifest.json.
        js: ['themes.js', 'helpers.js', 'content.js'],
        runAt: 'document_idle',
        allFrames: true,
        persistAcrossSessions: true
    }]);
}

// Re-sync whenever the settings page changes the stored domain list, and
// once on install/startup so a browser restart doesn't lose custom domains.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.snAllUrls || changes.snCustomDomains)) {
        syncDynamicContentScript();
    }
});

chrome.runtime.onInstalled.addListener(async (details) => {
    syncDynamicContentScript();

    // Fresh installs only. An update must never inject entries into a library
    // someone has already curated, and someone who deliberately cleared theirs
    // shouldn't find the samples back after the next version ships.
    if (details.reason !== 'install') return;

    const stored = await chrome.storage.local.get(STORE_COMMANDS);
    const existing = stored[STORE_COMMANDS];
    if (Array.isArray(existing) && existing.length) return;

    const now = Date.now();
    await chrome.storage.local.set({
        [STORE_COMMANDS]: DEFAULT_COMMANDS.map(c => ({ ...c, createdAt: now, uses: 0 }))
    });
});

chrome.runtime.onStartup.addListener(() => { syncDynamicContentScript(); });

// ── Usage counting ────────────────────────────────────────────────────────────
// Batched and serialised through a single writer. The palette can be open in
// multiple frames, and a read-modify-write performed in each caller would lose
// increments when two runs land close together.

let usageQueue = [];
let usageTimer = null;

function flushUsage() {
    usageTimer = null;
    const batch = usageQueue;
    usageQueue = [];
    if (!batch.length) return;

    chrome.storage.local.get(STORE_COMMANDS, (res) => {
        const commands = Array.isArray(res[STORE_COMMANDS]) ? res[STORE_COMMANDS] : [];
        let touched = false;

        batch.forEach(({ id, at }) => {
            const cmd = commands.find(c => c.id === id);
            if (!cmd) return;
            cmd.uses       = (cmd.uses || 0) + 1;
            cmd.lastUsedAt = at;
            touched = true;
        });

        if (touched) chrome.storage.local.set({ [STORE_COMMANDS]: commands });
    });
}

function countUse(id) {
    if (!id) return;
    usageQueue.push({ id, at: Date.now() });
    if (!usageTimer) usageTimer = setTimeout(flushUsage, 800);
}

// ── Script execution ─────────────────────────────────────────────────────────
// One implementation, three callers. `id` is optional: an unsaved script being
// tried out from the editor has no id yet, and simply isn't counted.

function runInTab({ tabId, frameId, script, id }, sendResponse) {
    if (!tabId) {
        sendResponse({ ok: false, error: 'No target tab' });
        return;
    }

    chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId != null ? frameId : 0] },
        world:  'MAIN',
        func:   (code) => { (0, eval)(code); },
        args:   [script]
    }).then(() => {
        countUse(id);
        sendResponse({ ok: true });
    }).catch(err => {
        console.error('[SN Commands] executeScript error:', err);
        sendResponse({ ok: false, error: err.message });
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.source) return false;

    if (msg.source === 'SN_COMMANDS_SYNC_DOMAINS') {
        syncDynamicContentScript().then(() => sendResponse({ ok: true }))
                                  .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // From popup.js / settings.js — the caller already resolved the tab.
    if (msg.source === 'SN_COMMANDS_EXEC_TAB') {
        runInTab({ tabId: msg.tabId, frameId: msg.frameId, script: msg.script, id: msg.id }, sendResponse);
        return true;
    }

    // From content.js (the palette) — a content script can't see its own tabId,
    // so it comes off the sender instead.
    if (msg.source === 'SN_COMMANDS_EXEC') {
        runInTab({
            tabId:   sender.tab && sender.tab.id,
            frameId: sender.frameId || 0,
            script:  msg.script,
            id:      msg.id
        }, sendResponse);
        return true;
    }

    return false;
});
