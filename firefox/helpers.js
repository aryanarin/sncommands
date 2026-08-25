'use strict';

// ── Page helpers ─────────────────────────────────────────────────────────────
// Three small always-on conveniences, each independently switchable and each off
// until the user turns it on:
//
//   keepAlive    Pings a lightweight endpoint on a timer so the session doesn't
//                time out while you're reading a long ticket.
//   reopenCount  On an incident form, reports reopen_count as a native banner —
//                green when it's zero, red when it isn't.
//   quickPost    Ctrl+Enter posts the work note you're typing.
//
// Shared by content.js (runs them) and settings.js (configures them), loaded
// ahead of content.js in the manifest. `var` on purpose: content scripts of one
// extension share a single isolated-world global scope.
//
// ── Why two of these are injected rather than just run ──────────────────────
// Content scripts live in an isolated world with no access to the page's
// JavaScript globals. reopenCount needs `g_form` and `g_ck`; quickPost needs
// `angular`. Neither is reachable from a content script, so both are handed to
// the background worker and executed in the page's MAIN world — the same path a
// saved command takes. keepAlive only needs `fetch`, so it stays in the content
// script where its timer lives as long as the tab does.

var SN_HELPERS_STORE = 'snHelpers';

var SN_KEEPALIVE_DEFAULT_MINUTES = 2;
var SN_KEEPALIVE_MIN_MINUTES     = 1;
var SN_KEEPALIVE_MAX_MINUTES     = 60;

// Tried in order; on a non-OK response or a network error the next one is used
// for the following ping. Instances differ in what they expose, so there's no
// single endpoint that's safe to rely on.
var SN_KEEPALIVE_ENDPOINTS = ['/api/now/session', '/now/nav/header', '/stats.do'];

// Injected MAIN-world scripts can't read chrome.storage, so the content script
// mirrors each toggle onto <html> as an attribute. The scripts check it before
// acting, which means switching a helper off takes effect immediately on pages
// that already have it injected instead of waiting for a reload.
var SN_HELPER_ATTR = {
    reopenCount: 'data-sn-reopen-count',
    quickPost:   'data-sn-quick-post'
};

// Drives the settings UI, so adding a helper doesn't mean editing two files.
var SN_HELPER_META = [
    {
        key:   'keepAlive',
        title: 'Keep my session alive',
        desc:  'Quietly pings your instance on a timer so you don\u2019t get logged out mid-ticket. ' +
               'Uses a lightweight endpoint and reads nothing from the page.'
    },
    {
        key:   'reopenCount',
        title: 'Show reopen count on incidents',
        desc:  'When an incident form loads, shows its reopen count as a banner \u2014 green at zero, ' +
               'red above it, so a repeat offender is obvious before you start typing.'
    },
    {
        key:   'quickPost',
        title: 'Ctrl+Enter posts a work note',
        desc:  'Saves reaching for the Post button every time. Works in the activity stream on ' +
               'any form that has one.'
    }
];

function snDefaultHelperSettings() {
    return {
        keepAlive:   { enabled: false, minutes: SN_KEEPALIVE_DEFAULT_MINUTES },
        reopenCount: { enabled: false },
        quickPost:   { enabled: false }
    };
}

function snClampKeepAliveMinutes(value) {
    const n = parseInt(value, 10);
    if (!isFinite(n)) return SN_KEEPALIVE_DEFAULT_MINUTES;
    return Math.min(SN_KEEPALIVE_MAX_MINUTES, Math.max(SN_KEEPALIVE_MIN_MINUTES, n));
}

function snNormaliseHelperSettings(raw) {
    const out = snDefaultHelperSettings();
    if (!raw || typeof raw !== 'object') return out;

    out.keepAlive.enabled   = !!(raw.keepAlive   && raw.keepAlive.enabled);
    out.keepAlive.minutes   = snClampKeepAliveMinutes(raw.keepAlive && raw.keepAlive.minutes);
    out.reopenCount.enabled = !!(raw.reopenCount && raw.reopenCount.enabled);
    out.quickPost.enabled   = !!(raw.quickPost   && raw.quickPost.enabled);
    return out;
}

// ── reopenCount, MAIN world ──────────────────────────────────────────────────
// Guarded so re-injection on the same document is a no-op, and it won't report
// the same record twice in a row.
var SN_REOPEN_COUNT_SCRIPT = `(function () {
    if (window.__snCmdReopenWatch) return;
    window.__snCmdReopenWatch = true;

    var lastReported = '';

    function switchedOff() {
        var el = document.documentElement;
        return !el || el.getAttribute('data-sn-reopen-count') === 'off';
    }

    function token() {
        if (window.g_ck) return window.g_ck;
        var el = document.querySelector('input[name="sysparm_ck"]');
        return (el && el.value) || '';
    }

    function check() {
        if (switchedOff()) return;

        var href = decodeURIComponent(window.location.href);
        if (href.indexOf('incident') === -1) return;

        var match = href.match(/sys_id[=%3D]+([a-f0-9]{32})/i);
        if (!match) return;

        var sysId = match[1];
        if (sysId === lastReported) return;   // already announced this record

        var tok = token();
        if (!tok) return;

        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/now/table/incident/' + sysId +
                        '?sysparm_fields=reopen_count,number', true);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-UserToken', tok);

        xhr.onload = function () {
            if (xhr.status !== 200) return;
            if (switchedOff()) return;

            var result;
            try { result = JSON.parse(xhr.responseText).result; } catch (e) { return; }
            if (!result) return;

            var count  = parseInt(result.reopen_count, 10);
            var number = result.number || '';
            if (!isFinite(count)) return;

            lastReported = sysId;
            var msg = number + ' \\u2014 Reopen Count: ' + count;

            if (typeof g_form !== 'undefined' && g_form.addInfoMessage && g_form.addErrorMessage) {
                if (count > 0) g_form.addErrorMessage('\\u26a0\\ufe0f ' + msg);
                else           g_form.addInfoMessage('\\u2705 ' + msg);
                return;
            }

            // No g_form on this page (workspace, or a list view) — say it quietly.
            console.log('[SN Commands] ' + msg);
        };

        xhr.send();
    }

    // ServiceNow swaps records without a full page load, so watch for the URL
    // changing as well as running once on arrival.
    var lastUrl = location.href;
    new MutationObserver(function () {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        setTimeout(check, 1500);
    }).observe(document, { subtree: true, childList: true });

    setTimeout(check, 1200);
})();`;

// ── quickPost, MAIN world ────────────────────────────────────────────────────
var SN_QUICK_POST_SCRIPT = `(function () {
    if (window.__snCmdQuickPost) return;
    window.__snCmdQuickPost = true;

    function switchedOff() {
        var el = document.documentElement;
        return !el || el.getAttribute('data-sn-quick-post') === 'off';
    }

    function findPostButton() {
        return document.querySelector('button.activity-submit') ||
               document.querySelector('button[ng-click*="postJournalEntryForCurrent"]') ||
               document.querySelector('button.btn-default.activity-submit');
    }

    document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
        if (switchedOff()) return;

        var btn = findPostButton();
        if (!btn || btn.disabled || btn.offsetParent === null) return;

        e.preventDefault();
        e.stopPropagation();

        // Going through Angular's own handler keeps the activity stream in step;
        // a raw click can leave its scope stale on some form layouts.
        try {
            var scope = angular.element(btn).scope();
            if (scope && scope.postJournalEntryForCurrent) scope.postJournalEntryForCurrent(e);
            else btn.click();
        } catch (ex) {
            btn.click();
        }

        var previous = btn.style.background;
        btn.style.transition = 'background 0.2s';
        btn.style.background = '#4caf50';
        setTimeout(function () { btn.style.background = previous; }, 300);
    }, false);
})();`;
