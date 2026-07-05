'use strict';

// ── Background Service Worker ─────────────────────────────────────────────────
// Two code paths:
//
//   1. FROM POPUP  → msg.source = 'SN_COMMANDS_EXEC_TAB'
//      Popup knows the tabId; background just calls executeScript.
//
//   2. FROM CONTENT SCRIPT  → msg.source = 'SN_COMMANDS_EXEC'
//      Content script doesn't know its own tabId; we get it from sender.tab.id.

// ── Custom / on-prem instance support ───────────────────────────────────────
// The static content_scripts entry in manifest.json only covers
// *.service-now.com. To support on-prem or
// differently-named cloud instances, the settings page lets the user either:
//   a) grant the extension access to a specific list of hostnames, or
//   b) grant access to all sites ("<all_urls>")
// Whichever host permissions get approved, we register a *dynamic* content
// script (content.js) for those origins so the palette works there too.
const DYNAMIC_SCRIPT_ID = 'sn-commands-dynamic';

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
        js: ['content.js'],
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
chrome.runtime.onInstalled.addListener(() => { syncDynamicContentScript(); });
chrome.runtime.onStartup.addListener(() => { syncDynamicContentScript(); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.source === 'SN_COMMANDS_SYNC_DOMAINS') {
        syncDynamicContentScript().then(() => sendResponse({ ok: true }))
                                   .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    // Path 1: popup already resolved the tab
    if (msg && msg.source === 'SN_COMMANDS_EXEC_TAB') {
        const { tabId, frameId, script } = msg;
        chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId != null ? frameId : 0] },
            world:  'MAIN',
            func:   (code) => { (0, eval)(code); },
            args:   [script]
        }).then(() => sendResponse({ ok: true }))
          .catch(err => {
              console.error('[SN Commands] executeScript error:', err);
              sendResponse({ ok: false, error: err.message });
          });
        return true;
    }

    // Path 2: content script (palette) triggered the run — sender has tabId
    if (msg && msg.source === 'SN_COMMANDS_EXEC') {
        const tabId   = sender.tab && sender.tab.id;
        const frameId = sender.frameId || 0;
        const { script } = msg;

        if (!tabId) {
            sendResponse({ ok: false, error: 'No sender tabId' });
            return false;
        }

        chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            world:  'MAIN',
            func:   (code) => { (0, eval)(code); },
            args:   [script]
        }).then(() => sendResponse({ ok: true }))
          .catch(err => {
              console.error('[SN Commands] executeScript error:', err);
              sendResponse({ ok: false, error: err.message });
          });
        return true;
    }

    return false;
});
