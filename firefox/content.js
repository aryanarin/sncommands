'use strict';

// NOTE (MV3): Script execution is now handled by the background service worker.
// Popup sends directly to background via chrome.runtime.sendMessage (SN_COMMANDS_EXEC_TAB).
// The palette's runCmd() below also sends directly to background (SN_COMMANDS_EXEC).
// No content-script relay is needed.

// ── Backslash command palette ─────────────────────────────────────────────────
(function() {
    let palette      = null;
    let paletteStyle = null;
    let input        = null;
    let listEl       = null;
    let header       = null;
    let hint         = null;
    let commands     = [];
    let filtered     = [];
    let activeIdx    = 0;
    let isOpen       = false;

    function loadCmds(cb) {
        chrome.storage.local.get('snCommands', (res) => {
            commands = res.snCommands || [];
            cb && cb();
        });
    }

    // ── Theme colours ─────────────────────────────────────────────────────────
    const THEMES = {
        dark: {
            bg:        '#0d1117',
            bg2:       '#161b22',
            bg3:       '#0d2137',
            border:    '#1f2937',
            border2:   '#2d3748',
            text:      '#e2e8f0',
            textMuted: '#94a3b8',
            textDim:   '#7d8b9c',
            textMono:  '#38bdf8',
            accent:    '#0070d2',
        },
        light: {
            bg:        '#f1f5f9',
            bg2:       '#ffffff',
            bg3:       '#dbeafe',
            border:    '#e2e8f0',
            border2:   '#cbd5e1',
            text:      '#0f172a',
            textMuted: '#475569',
            textDim:   '#55657a',
            textMono:  '#1d4ed8',
            accent:    '#0070d2',
        }
    };
    let currentTheme = 'dark';
    // Load once; update palette if already open
    chrome.storage.local.get('snTheme', (r) => {
        currentTheme = (r.snTheme === 'light') ? 'light' : 'dark';
        if (palette) applyThemeToPalette();
    });
    // Follow the theme live, so flipping it in the popup doesn't leave already-open
    // ServiceNow tabs showing the old palette colours until they're reloaded.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.snTheme) return;
        currentTheme = (changes.snTheme.newValue === 'light') ? 'light' : 'dark';
        applyThemeToPalette();
        if (isOpen) renderPalette(input ? input.value : '');
    });
    // The placeholder is the only text inside the palette that can't take an
    // inline colour, so it needs a scoped rule. Rebuilt whenever the theme flips.
    function paletteCss(t) {
        return '#sn-cmd-palette input::placeholder{color:' + t.textDim + ';opacity:1}' +
               '#sn-cmd-palette input{caret-color:' + t.text + '}';
    }
    function applyThemeToPalette() {
        if (!palette) return;
        const t = THEMES[currentTheme];
        Object.assign(palette.style, {
            background:  t.bg,
            border:      '1px solid ' + t.accent,
            colorScheme: currentTheme,
        });
        if (paletteStyle) paletteStyle.textContent = paletteCss(t);
        if (header)  Object.assign(header.style,  { background: t.bg2, borderBottom: '1px solid ' + t.border });
        if (input)   Object.assign(input.style,   { color: t.text });
        if (hint)    Object.assign(hint.style,     { color: t.text, background: t.border2 });
        if (listEl)  applyThemeToList();
    }
    function applyThemeToList() {
        if (!listEl) return;
        const t = THEMES[currentTheme];
        listEl.querySelectorAll('.sn-cmd-item').forEach((item, idx) => {
            const isActive = parseInt(item.dataset.idx) === activeIdx;
            Object.assign(item.style, {
                background:  isActive ? t.bg3       : 'transparent',
                borderLeft:  isActive ? '3px solid ' + t.accent : '3px solid transparent',
                borderBottom: '1px solid ' + t.border,
            });
            const nameEl  = item.querySelector('.sn-item-name');
            const hintEl  = item.querySelector('.sn-item-hint');
            const enterEl = item.querySelector('.sn-item-enter');
            if (nameEl)  nameEl.style.color  = t.textMono;
            if (hintEl)  hintEl.style.color  = t.textMuted;
            if (enterEl) enterEl.style.color = t.text;
        });
    }

    // Updates just the "↵" indicator on rows in place (no DOM rebuild),
    // used when hovering so we never destroy the element under the cursor.
    function markActiveRow() {
        if (!listEl) return;
        listEl.querySelectorAll('.sn-cmd-item').forEach((item) => {
            const isActive = parseInt(item.dataset.idx, 10) === activeIdx;
            const enterEl = item.querySelector('.sn-item-enter');
            if (enterEl) enterEl.textContent = isActive ? '↵' : '';
        });
    }

    function buildPalette() {
        if (palette) return;
        const t = THEMES[currentTheme];

        palette = document.createElement('div');
        palette.id = 'sn-cmd-palette';
        Object.assign(palette.style, {
            position:     'fixed',
            top:          '80px',
            left:         '50%',
            transform:    'translateX(-50%)',
            width:        '460px',
            background:   t.bg,
            border:       '1px solid ' + t.accent,
            borderRadius: '10px',
            boxShadow:    '0 16px 48px rgba(0,0,0,0.7)',
            zIndex:       '2147483647',
            fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            overflow:     'hidden',
            display:      'none',
            colorScheme:  currentTheme
        });

        paletteStyle = document.createElement('style');
        paletteStyle.textContent = paletteCss(t);
        palette.appendChild(paletteStyle);

        // Header
        header = document.createElement('div');
        Object.assign(header.style, {
            background: t.bg2, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: '8px',
            borderBottom: '1px solid ' + t.border
        });

        const logo = document.createElement('div');
        Object.assign(logo.style, {
            background: t.accent, borderRadius: '4px', width: '22px',
            height: '22px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#fff',
            fontWeight: '900', fontSize: '13px', flexShrink: '0'
        });
        logo.textContent = '\\';

        input = document.createElement('input');
        // Make it inert when hidden so it can never silently hold focus
        input.setAttribute('tabindex', '-1');
        Object.assign(input.style, {
            flex: '1', background: 'transparent', border: 'none',
            color: t.text, fontSize: '13px', outline: 'none',
            fontFamily: 'monospace'
        });
        input.placeholder = 'Type command name... (↑↓ navigate, Enter run, Esc close)';

        hint = document.createElement('span');
        hint.textContent = 'ESC';
        Object.assign(hint.style, {
            fontSize: '10px', color: t.text,
            background: t.border2, padding: '2px 6px',
            borderRadius: '3px'
        });

        header.appendChild(logo);
        header.appendChild(input);
        header.appendChild(hint);

        listEl = document.createElement('div');
        Object.assign(listEl.style, { maxHeight: '300px', overflowY: 'auto' });

        palette.appendChild(header);
        palette.appendChild(listEl);
        document.body.appendChild(palette);

        input.addEventListener('input', () => { activeIdx = 0; renderPalette(input.value); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape')    { e.preventDefault(); closePalette(); return; }
            if (e.key === 'Backspace' && input.value === '') { e.preventDefault(); closePalette(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); renderPalette(input.value); }
            if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderPalette(input.value); }
            if (e.key === 'Enter' && filtered[activeIdx]) { e.preventDefault(); runCmd(filtered[activeIdx]); }
        });
    }

    function renderPalette(filter) {
        filter   = (filter || '').toLowerCase();
        filtered = commands.filter(c =>
            c.name.toLowerCase().includes(filter) ||
            (c.hint || '').toLowerCase().includes(filter)
        ).sort((a, b) => {
            const aHas = a.order != null && a.order !== '';
            const bHas = b.order != null && b.order !== '';
            if (aHas && bHas) return a.order - b.order;
            if (aHas) return -1;
            if (bHas) return 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        listEl.innerHTML = '';
        const t = THEMES[currentTheme];

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            Object.assign(empty.style, {
                padding: '20px', textAlign: 'center',
                color: t.textDim, fontSize: '12px'
            });
            empty.textContent = commands.length === 0
                ? 'No commands yet — create them in the extension popup!'
                : 'No commands match "' + filter + '"';
            listEl.appendChild(empty);
            return;
        }

        filtered.forEach((cmd, idx) => {
            const item = document.createElement('div');
            item.className = 'sn-cmd-item';
            item.dataset.idx = idx;
            Object.assign(item.style, {
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 14px', cursor: 'pointer',
                borderBottom: '1px solid ' + t.border,
                background:   idx === activeIdx ? t.bg3        : 'transparent',
                borderLeft:   idx === activeIdx ? '3px solid ' + t.accent : '3px solid transparent',
                transition:   'background 0.1s'
            });

            const nameEl = document.createElement('span');
            nameEl.className = 'sn-item-name';
            Object.assign(nameEl.style, {
                color: t.textMono, fontFamily: 'monospace',
                fontWeight: '700', fontSize: '13px', minWidth: '130px'
            });
            nameEl.textContent = '\\' + cmd.name;

            const hintEl = document.createElement('span');
            hintEl.className = 'sn-item-hint';
            Object.assign(hintEl.style, {
                color: t.textMuted, fontSize: '11px', flex: '1',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            });
            hintEl.textContent = cmd.hint || '';

            const enterEl = document.createElement('span');
            enterEl.className = 'sn-item-enter';
            Object.assign(enterEl.style, {
                color: t.text, fontSize: '10px',
                background: t.border2, padding: '2px 6px',
                borderRadius: '3px', flexShrink: '0'
            });
            enterEl.textContent = idx === activeIdx ? '↵' : '';

            item.appendChild(nameEl);
            item.appendChild(hintEl);
            item.appendChild(enterEl);

            // Hover just updates the active index/styling in place — it must NOT
            // tear down and rebuild the list (that was destroying/recreating the
            // very node the pointer was over mid-hover, which could make the
            // subsequent click never land on a live element).
            item.addEventListener('mouseenter', () => { activeIdx = idx; applyThemeToList(); markActiveRow(); });

            // Some ServiceNow (UI16/Now Experience) pages install their own
            // document-level click handlers that can swallow the event before
            // it reaches us. Fire on mousedown (capture) as the primary trigger —
            // it happens earlier in the sequence and is far less likely to be
            // intercepted — and stop it from propagating into the page. Keep a
            // click listener too as a harmless fallback for normal pages.
            let firedByMouseDown = false;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                firedByMouseDown = true;
                runCmd(cmd);
            }, true);
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (firedByMouseDown) { firedByMouseDown = false; return; }
                runCmd(cmd);
            });
            listEl.appendChild(item);
        });
    }

    function openPalette() {
        if (isOpen) return;
        loadCmds(() => {
            buildPalette();
            // Sort by custom order, then alphabetically
        filtered  = commands.slice().sort((a, b) => {
            const aHas = a.order != null && a.order !== '';
            const bHas = b.order != null && b.order !== '';
            if (aHas && bHas) return a.order - b.order;
            if (aHas) return -1;
            if (bHas) return 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
            activeIdx = 0;
            isOpen    = true;
            input.value = '';
            // Re-enable focus now that we're opening
            input.setAttribute('tabindex', '0');
            renderPalette('');
            palette.style.display = 'block';
            setTimeout(() => { try { input.focus(); } catch(e) {} }, 60);
        });
    }

    function closePalette() {
        if (!isOpen) return;
        isOpen = false;
        if (palette) palette.style.display = 'none';
        // Critically: blur the input and set tabindex=-1 so it can
        // never silently hold focus while the palette is hidden
        if (input) {
            input.blur();
            input.setAttribute('tabindex', '-1');
        }
        // Return focus to the page body so the keydown guard
        // (INPUT/TEXTAREA check) doesn't block future shortcut presses
        try { document.body.focus(); } catch(e) {}
    }

    function runCmd(cmd) {
        closePalette();
        setTimeout(function() {
            // Ask background service worker to execute in MAIN world (MV3-safe).
            // `id` lets background bump the usage counter for this command.
            chrome.runtime.sendMessage({
                source: 'SN_COMMANDS_EXEC',
                script: cmd.script,
                name:   cmd.name,
                id:     cmd.id
                // tabId/frameId resolved by background using sender info
            }).catch(e => console.error('[SN Commands] Error running:', cmd.name, e));
        }, 50);
    }

    // ── Key listener ─────────────────────────────────────────────────────────
    document.addEventListener('keydown', function(e) {
        // Don't trigger if the user is typing in any real page input
        const tag      = (document.activeElement || {}).tagName || '';
        const editable = document.activeElement && document.activeElement.isContentEditable;

        // Allow through if the focused element is INSIDE our own palette
        // (the palette input should handle its own keys via its own listener)
        const inPalette = palette && palette.contains(document.activeElement);

        if (!inPalette && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable)) return;

        // Trigger 1: Backslash
        if (e.key === '\\' && !e.ctrlKey && !e.altKey && !e.metaKey && !inPalette) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openPalette();
            return;
        }

        // Trigger 2: Ctrl+Shift+Space
        if (e.key === ' ' && e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isOpen) closePalette(); else openPalette();
            return;
        }

        // Trigger 3: F2
        if (e.key === 'F2' && !inPalette) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openPalette();
            return;
        }

        // Close on Escape (when palette is open but focus is outside it)
        if (e.key === 'Escape' && isOpen && !inPalette) {
            e.preventDefault();
            closePalette();
        }

    }, true); // useCapture=true

    // Close on outside click
    document.addEventListener('click', function(e) {
        if (isOpen && palette && !palette.contains(e.target)) {
            closePalette();
        }
    }, true);

})();


// ── ServiceNow page theme ─────────────────────────────────────────────────────
// Restyles ServiceNow itself: header colour and pattern, white workspace, compact
// lists, clearer read-only fields. Off unless the user switches it on.
//
// Kept in its own IIFE with its own error handling so that if anything in here
// throws — a Polaris DOM change, a locked-down frame — the command palette above
// carries on working regardless. Palettes and helpers come from themes.js, which
// the manifest loads first.
// ── Is this page actually a ServiceNow instance? ──────────────────────────────
// Settings → Instances can register this content script on <all_urls>, since an
// on-prem instance can be on any hostname. The palette copes with that — it only
// opens when you ask it to. The page theme and the keep-alive ping cannot:
//
//   • The theme's rules are written against ServiceNow's DOM but reach generic
//     elements, `textarea` among them. An unrelated site may be relying on a
//     textarea being invisible: GitHub's code viewer stacks a transparent one on
//     top of the highlighted source, so forcing a colour onto it rendered every
//     file as two offset copies of itself, unreadable.
//   • The keep-alive would otherwise request ServiceNow session endpoints, with
//     credentials, against whatever host the tab happens to be on.
//
// So both ask here first. Configuration answers it outright in most cases. The DOM
// markers cover an unnamed on-prem host under "enable on all websites", and get
// re-checked for a short while because Polaris finishes booting some way after
// document_idle — the verdict can legitimately flip from no to yes.
var snPageGate = (function() {
    'use strict';

    const PROBE_MS    = 1500;
    const PROBE_LIMIT = 12;    // ~18s of looking, then stop bothering

    let customDomains = [];
    let themeHosts    = {};
    let verdict       = false;
    let listeners     = [];
    let timer         = null;
    let triesLeft     = 0;

    function decide() {
        return snHostIsKnownInstance(location.hostname, themeHosts, customDomains) ||
               snDocumentLooksLikeServiceNow(document);
    }

    function stopProbe() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    function startProbe() {
        if (timer || verdict) return;
        triesLeft = PROBE_LIMIT;
        timer = setInterval(function() {
            if (triesLeft-- <= 0) { stopProbe(); return; }
            reevaluate();
        }, PROBE_MS);
    }

    function reevaluate() {
        const next = decide();
        if (next === verdict) return;
        verdict = next;
        if (verdict) stopProbe();
        listeners.forEach(function(fn) {
            try { fn(verdict); } catch (e) { /* a listener's problem, not ours */ }
        });
    }

    // Answer synchronously first, so a ServiceNow page that's already recognisable
    // doesn't flash unthemed while storage is read.
    verdict = decide();

    try {
        chrome.storage.local.get('snCustomDomains', function(res) {
            customDomains = (res && res.snCustomDomains) || [];
            reevaluate();
            startProbe();
        });

        chrome.storage.onChanged.addListener(function(changes, area) {
            if (area !== 'local' || !changes.snCustomDomains) return;
            customDomains = changes.snCustomDomains.newValue || [];
            reevaluate();
        });
    } catch (e) { /* extension context invalidated */ }

    startProbe();

    return {
        allowed: function() { return verdict; },

        // The theme settings own the host → theme map. A host listed there is the
        // user pointing at an instance, so it counts as an answer here too.
        setThemeHosts: function(hosts) {
            themeHosts = (hosts && typeof hosts === 'object') ? hosts : {};
            reevaluate();
        },

        onChange: function(fn) { if (typeof fn === 'function') listeners.push(fn); }
    };
})();


(function() {
    'use strict';

    const STYLE_BASE   = 'sn-cmd-theme-base';
    const STYLE_HEADER = 'sn-cmd-theme-header';
    const TOAST_ID     = 'sn-cmd-theme-toast';
    const PIERCE_MS    = 1000;

    // Only the top frame owns the Polaris header and should handle the shortcut.
    // The workspace CSS still needs applying inside gsft_main, hence the split.
    let isTop = true;
    try { isTop = (window.top === window); } catch (e) { isTop = false; }

    let settings = null;      // normalised snPageTheme
    let activeKey = null;     // theme currently painted
    let timer = null;

    // Hibernating developer instances render a plain notice page. Theming it is
    // pointless and the selectors aren't there anyway.
    function isHibernating() {
        const text = document.body ? document.body.textContent || '' : '';
        return text.indexOf('instance is hibernating') !== -1;
    }

    // Own <style> elements rather than appending new ones, so switching a theme
    // replaces the rules instead of stacking another copy on top each time.
    function setStyle(id, css, root) {
        const container = root || document.head || document.documentElement;
        if (!container) return;
        const scope = root || document;
        let el = scope.querySelector('#' + id);
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            container.appendChild(el);
        }
        if (el.textContent !== css) el.textContent = css;
    }

    function removeStyle(id, root) {
        const scope = root || document;
        const el = scope.querySelector('#' + id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    // Polaris re-renders its header on navigation and discards anything we set, so
    // this is re-run on a timer. Every call is idempotent, so repeating costs a
    // handful of property writes and nothing else.
    function pierce(theme) {
        snApplyPolarisVars(document.documentElement, theme);
        snApplyPolarisVars(document.querySelector('sn-polaris-layout'), theme);

        const header = document.querySelector('sn-polaris-header');
        if (!header || !header.shadowRoot) return;

        snApplyPolarisVars(header, theme);
        setStyle(STYLE_HEADER, snPageThemeHeaderCss(theme), header.shadowRoot);

        // A few nodes get their colour set inline by Polaris itself, which no
        // stylesheet can outrank. Those need inline styles of our own.
        header.shadowRoot
            .querySelectorAll('.sn-polaris-tab, div[role="menuitem"], .experience-title, .snupicker')
            .forEach(function(node) {
                node.style.setProperty('color', '#ffffff', 'important');
                node.style.setProperty('opacity', '1', 'important');
            });
    }

    function stopTheming() {
        if (timer) { clearInterval(timer); timer = null; }
        removeStyle(STYLE_BASE);
        const header = document.querySelector('sn-polaris-header');
        if (header && header.shadowRoot) removeStyle(STYLE_HEADER, header.shadowRoot);
        activeKey = null;
    }

    function applyTheming() {
        if (!settings || !settings.enabled) { stopTheming(); return; }
        // Not a ServiceNow instance — leave the page exactly as its author built it.
        if (!snPageGate.allowed()) { stopTheming(); return; }
        if (isHibernating()) return;

        const resolved = snResolvePageTheme(settings, location.hostname);
        activeKey = resolved.key;

        setStyle(STYLE_BASE, snPageThemeBaseCss(resolved.theme));

        if (isTop) {
            pierce(resolved.theme);
            if (!timer) {
                timer = setInterval(function() {
                    try {
                        if (!settings || !settings.enabled) return;
                        pierce(snResolvePageTheme(settings, location.hostname).theme);
                    } catch (e) { /* transient DOM state */ }
                }, PIERCE_MS);
            }
        }
    }

    // ── Switcher ─────────────────────────────────────────────────────────────
    // Alt+Shift+T cycles and saves the result against this hostname, so the choice
    // sticks and shows up as a per-instance mapping in Settings. Shift reverses.
    function toast(theme, key) {
        let el = document.getElementById(TOAST_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = TOAST_ID;
            document.body.appendChild(el);
        }
        const idx = SN_PAGE_THEME_ORDER.indexOf(key) + 1;
        el.textContent = theme.label + '  (' + idx + '/' + SN_PAGE_THEME_ORDER.length + ')  \u00b7  ' +
                         location.hostname;
        el.style.cssText =
            'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;' +
            'background:' + theme.header + ';color:#fff;padding:11px 18px;border-radius:9px;' +
            'border:1px solid ' + theme.border + ';max-width:min(640px,92vw);text-align:center;' +
            'font:600 13px/1.45 ' + SN_PAGE_THEME_FONT + ';box-shadow:0 10px 30px rgba(0,0,0,.3);' +
            'opacity:1;transition:opacity .4s;pointer-events:none;';
        clearTimeout(el._snT);
        el._snT = setTimeout(function() { el.style.opacity = '0'; }, 2200);
    }

    function cycle(step) {
        if (!settings || !settings.enabled) return;
        // Alt+Shift+T on a random site must not turn it into a ServiceNow instance.
        if (!snPageGate.allowed()) return;

        const current = snResolvePageTheme(settings, location.hostname).key;
        const at = SN_PAGE_THEME_ORDER.indexOf(current);
        const next = SN_PAGE_THEME_ORDER[
            (at + step + SN_PAGE_THEME_ORDER.length) % SN_PAGE_THEME_ORDER.length
        ];

        const hosts = Object.assign({}, settings.hosts);
        hosts[snCleanHost(location.hostname)] = next;
        const updated = Object.assign({}, settings, { hosts: hosts });

        // Paint immediately, then persist. storage.onChanged will land the same
        // value again, which is a no-op because applyTheming is idempotent.
        settings = updated;
        applyTheming();
        toast(SN_PAGE_THEMES[next], next);

        const payload = {};
        payload[SN_PAGE_THEME_STORE] = updated;
        chrome.storage.local.set(payload);
    }

    if (isTop) {
        document.addEventListener('keydown', function(e) {
            if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
            const k = (e.key || '').toLowerCase();
            if (k !== 't') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            cycle(1);
        }, true);
    }

    // ── Init + live updates ──────────────────────────────────────────────────
    try {
        chrome.storage.local.get(SN_PAGE_THEME_STORE, function(res) {
            try {
                settings = snNormalisePageThemeSettings(res && res[SN_PAGE_THEME_STORE]);
                snPageGate.setThemeHosts(settings.hosts);
                applyTheming();
            } catch (e) { console.error('[SN Commands] theme init failed:', e); }
        });

        // Changing the theme in Settings repaints open tabs, no reload needed.
        chrome.storage.onChanged.addListener(function(changes, area) {
            if (area !== 'local' || !changes[SN_PAGE_THEME_STORE]) return;
            try {
                settings = snNormalisePageThemeSettings(changes[SN_PAGE_THEME_STORE].newValue);
                snPageGate.setThemeHosts(settings.hosts);
                applyTheming();
            } catch (e) { console.error('[SN Commands] theme update failed:', e); }
        });

        // A host that only became recognisable once Polaris finished booting still
        // gets painted, without waiting for a reload.
        snPageGate.onChange(function() {
            try { applyTheming(); }
            catch (e) { console.error('[SN Commands] theme re-check failed:', e); }
        });
    } catch (e) {
        console.error('[SN Commands] theme unavailable:', e);
    }

})();


// ── Page helpers ──────────────────────────────────────────────────────────────
// Session keep-alive, incident reopen-count banner, and Ctrl+Enter to post a work
// note. All three are off until switched on, and each is independent.
//
// Own IIFE with its own error handling, so a failure here can't affect the command
// palette or the page theme above. Settings and the injected scripts come from
// helpers.js, which the manifest loads first.
(function() {
    'use strict';

    let isTop = true;
    try { isTop = (window.top === window); } catch (e) { isTop = false; }

    let helpers          = null;
    let keepAliveTimer   = null;
    let keepAliveActive  = false;
    let keepAlivePinging = false;
    let keepAliveLastPing = 0;
    let endpointIdx      = 0;
    const injected       = { reopenCount: false, quickPost: false };

    // ── Keep-alive ───────────────────────────────────────────────────────────
    // Top frame only. ServiceNow's classic UI nests a form iframe, and running
    // this everywhere would multiply every ping by the number of frames.
    //
    // Stays in the content script rather than moving to the background worker: a
    // service worker is torn down after ~30s idle, which a minutes-long interval
    // would not survive. A content script's timer lives as long as the tab.
    //
    // The request must be one the UI itself would make. ServiceNow's REST
    // endpoints answer 200 without pushing the session timeout back; only
    // UI-level page loads count as activity, so SN_KEEPALIVE_ENDPOINTS lists
    // classic UI pages rather than API routes.
    function keepAliveUrl(endpoint) {
        return endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') +
               'sysparm_cache=' + Date.now();
    }

    function ping() {
        if (keepAlivePinging) return;   // never run two checks at once
        keepAlivePinging = true;
        keepAliveLastPing = Date.now();

        const endpoint = SN_KEEPALIVE_ENDPOINTS[endpointIdx];
        const ctrl  = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = setTimeout(function() { if (ctrl) ctrl.abort(); }, SN_KEEPALIVE_TIMEOUT_MS);
        let settled = false;

        function settle(ok) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            keepAlivePinging = false;
            // Not every instance exposes every UI page — rotate and retry with
            // the next one on the following tick.
            if (!ok) endpointIdx = (endpointIdx + 1) % SN_KEEPALIVE_ENDPOINTS.length;
        }

        try {
            fetch(keepAliveUrl(endpoint), {
                method: 'GET',
                credentials: 'same-origin',
                redirect: 'manual',
                cache: 'no-store',
                headers: { 'Accept': 'text/html' },
                signal: ctrl ? ctrl.signal : undefined
            }).then(function(res) {
                // Only the status line matters; cancel the body download at once.
                try { if (res.body && res.body.cancel) res.body.cancel().catch(function() {}); } catch (e) {}
                // opaqueredirect means ServiceNow sent us to a login page: the
                // session is already gone and no ping can restore it.
                settle(res.type !== 'opaqueredirect' && res.ok);
            }).catch(function() { settle(false); });
        } catch (e) {
            settle(false);
        }
    }

    function scheduleKeepAlive() {
        clearTimeout(keepAliveTimer);
        const period = snClampKeepAliveMinutes(helpers.keepAlive.minutes) * 60000;
        // setTimeout re-armed after each tick, not setInterval: a slow request
        // must not overlap the next one, and background tabs throttle long-lived
        // intervals unpredictably.
        keepAliveTimer = setTimeout(function() {
            keepAliveTimer = null;
            if (!keepAliveActive) return;
            ping();
            scheduleKeepAlive();
        }, period);
    }

    function syncKeepAlive() {
        const on = isTop && snPageGate.allowed() && helpers && helpers.keepAlive.enabled;
        const wasActive = keepAliveActive;

        if (!on) {
            keepAliveActive = false;
            clearTimeout(keepAliveTimer);
            keepAliveTimer = null;
            return;
        }
        keepAliveActive = true;
        // Re-arm from scratch so an interval change takes effect straight away.
        scheduleKeepAlive();
        if (!wasActive) ping();
    }

    // A tab that's been in the background — or just out of focus — is exactly
    // where a session quietly expires, so send one on the way back in. The 15s
    // guard stops focus and visibilitychange pinging twice together.
    function pokeKeepAlive() {
        if (!isTop || !snPageGate.allowed()) return;
        if (!helpers || !helpers.keepAlive.enabled) return;
        if (keepAlivePinging || Date.now() - keepAliveLastPing < 15000) return;
        ping();
        scheduleKeepAlive();
    }
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) pokeKeepAlive();
    });
    window.addEventListener('focus', pokeKeepAlive);

    // ── Injected helpers ─────────────────────────────────────────────────────
    // These run in every frame, not just the top one: in classic UI the form,
    // g_form and the Post button all live inside the gsft_main iframe. Each
    // injected script guards against double-injection per document, so a frame
    // that isn't a form simply does nothing.
    function runInMain(script) {
        try {
            chrome.runtime.sendMessage({ source: 'SN_COMMANDS_EXEC', script: script })
                  .catch(function() { /* frame went away, or no host permission */ });
        } catch (e) { /* extension context invalidated */ }
    }

    // Mirror each toggle onto <html> so the already-injected MAIN-world scripts —
    // which cannot read chrome.storage — can see it. This is what makes switching
    // one off take effect immediately instead of on next reload.
    function syncAttributes() {
        const el = document.documentElement;
        if (!el || !helpers) return;
        el.setAttribute(SN_HELPER_ATTR.reopenCount, helpers.reopenCount.enabled ? 'on' : 'off');
        el.setAttribute(SN_HELPER_ATTR.quickPost,   helpers.quickPost.enabled   ? 'on' : 'off');
    }

    function syncInjected() {
        if (!helpers) return;

        if (helpers.reopenCount.enabled && !injected.reopenCount) {
            injected.reopenCount = true;
            runInMain(SN_REOPEN_COUNT_SCRIPT);
        }
        if (helpers.quickPost.enabled && !injected.quickPost) {
            injected.quickPost = true;
            runInMain(SN_QUICK_POST_SCRIPT);
        }
        // Switching off deliberately doesn't un-inject: the attribute set above
        // makes the resident script inert, which is equivalent and reversible
        // without a reload. Re-enabling just flips the attribute back.
    }

    function applyHelpers() {
        // On a site that isn't a ServiceNow instance these have nothing to act on,
        // so nothing is injected, no attributes are written and no pings go out.
        if (!snPageGate.allowed()) { syncKeepAlive(); return; }
        syncAttributes();
        syncKeepAlive();
        syncInjected();
    }

    // ── Init + live updates ──────────────────────────────────────────────────
    try {
        chrome.storage.local.get(SN_HELPERS_STORE, function(res) {
            try {
                helpers = snNormaliseHelperSettings(res && res[SN_HELPERS_STORE]);
                applyHelpers();
            } catch (e) { console.error('[SN Commands] helpers init failed:', e); }
        });

        chrome.storage.onChanged.addListener(function(changes, area) {
            if (area !== 'local' || !changes[SN_HELPERS_STORE]) return;
            try {
                helpers = snNormaliseHelperSettings(changes[SN_HELPERS_STORE].newValue);
                applyHelpers();
            } catch (e) { console.error('[SN Commands] helpers update failed:', e); }
        });

        // Same late-recognition case as the theme: a host only identified as an
        // instance after Polaris booted still gets its helpers.
        snPageGate.onChange(function() {
            try { applyHelpers(); }
            catch (e) { console.error('[SN Commands] helpers re-check failed:', e); }
        });
    } catch (e) {
        console.error('[SN Commands] helpers unavailable:', e);
    }

})();


// ── Pinned command dock ───────────────────────────────────────────────────────
// Commands starred in the popup or settings appear on the page itself, so the
// ones you run all day are one click away without opening the palette. The dock
// starts at the left edge, vertically centred, and the header can be dragged
// (or moved with the arrow keys) anywhere on screen; the position is remembered
// across reloads and tabs.
//
// Top frame only — the same rule the keep-alive follows — and only once the page
// gate recognises the page as an instance, so a random site is never altered.
// Own IIFE so a page that fights the dock can't affect the palette or helpers.
(function() {
    'use strict';

    const DOCK_ID   = 'sn-pinned-dock';
    const STYLE_ID  = 'sn-pinned-dock-style';
    const POS_STORE = 'snPinnedPos';
    const EDGE      = 8;

    let isTop = true;
    try { isTop = (window.top === window); } catch (e) { isTop = false; }

    // Same tokens as the palette's THEMES. Kept as a separate object because the
    // static audit parses `const THEMES =` for the palette's own colour literals.
    const PIN_THEMES = {
        dark: {
            bg:        '#0d1117',
            bg2:       '#161b22',
            bg3:       '#0d2137',
            border:    '#1f2937',
            border2:   '#2d3748',
            text:      '#e2e8f0',
            textMuted: '#94a3b8',
            textDim:   '#7d8b9c',
            textMono:  '#38bdf8',
            accent:    '#0070d2',
        },
        light: {
            bg:        '#f1f5f9',
            bg2:       '#ffffff',
            bg3:       '#dbeafe',
            border:    '#e2e8f0',
            border2:   '#cbd5e1',
            text:      '#0f172a',
            textMuted: '#475569',
            textDim:   '#55657a',
            textMono:  '#1d4ed8',
            accent:    '#0070d2',
        }
    };

    let dock      = null;
    let head      = null;
    let listEl    = null;
    let styleEl   = null;
    let commands  = [];
    let pos       = null;         // {left, top}; null = default left-centre
    let theme     = 'dark';
    let rowsKey   = '';
    let saveTimer = null;
    let drag      = null;

    function dockCss(t) {
        const id = '#' + DOCK_ID;
        return id + '{position:fixed;z-index:2147483646;display:flex;flex-direction:column;' +
            'width:200px;max-height:min(62vh,460px);background:' + t.bg + ';color:' + t.text + ';' +
            'border:1px solid ' + t.border2 + ';border-radius:9px;overflow:hidden;' +
            'box-shadow:0 10px 30px rgba(0,0,0,.45);color-scheme:' + theme + ';' +
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
            id + ' .sn-pin-head{display:flex;align-items:center;gap:6px;padding:7px 10px;' +
            'background:' + t.bg2 + ';border-bottom:1px solid ' + t.border + ';cursor:grab;' +
            'touch-action:none;user-select:none;-webkit-user-select:none}' +
            id + '.sn-pin-dragging .sn-pin-head{cursor:grabbing}' +
            id + ' .sn-pin-head:focus-visible{outline:2px solid ' + t.accent + ';outline-offset:-2px}' +
            id + ' .sn-pin-grip{color:' + t.textDim + ';font-size:12px;line-height:1}' +
            id + ' .sn-pin-title{color:' + t.textMuted + ';font-size:10px;font-weight:700;' +
            'letter-spacing:.6px;text-transform:uppercase}' +
            id + ' .sn-pin-list{overflow-y:auto;scrollbar-width:thin;' +
            'scrollbar-color:' + t.border2 + ' transparent}' +
            id + ' .sn-pin-cmd{display:block;width:100%;margin:0;padding:7px 10px;' +
            'background:transparent;border:0;border-bottom:1px solid ' + t.border + ';' +
            'border-radius:0;box-shadow:none;text-align:left;font-family:inherit;' +
            'cursor:pointer;appearance:none;-webkit-appearance:none}' +
            id + ' .sn-pin-cmd:hover{background:' + t.bg3 + '}' +
            id + ' .sn-pin-cmd:focus-visible{outline:2px solid ' + t.accent + ';outline-offset:-2px}' +
            id + ' .sn-pin-cmd:last-child{border-bottom:0}' +
            id + ' .sn-pin-name{display:block;color:' + t.textMono + ';font-family:monospace;' +
            'font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis}' +
            id + ' .sn-pin-hint{display:block;margin-top:1px;color:' + t.textMuted + ';' +
            'font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
    }

    // A classic-UI top frame is a frameset document, where document.body IS the
    // <frameset> element and renders only <frame> children — anything appended
    // there never gets laid out. Mount on <html> instead; fixed positioning
    // still paints over the frames, which is what makes classic UI usable.
    function mountPoint() {
        const body = document.body;
        if (body && body.nodeName !== 'FRAMESET') return body;
        return document.documentElement;
    }

    function build() {
        // A workspace page can replace <body> during navigation; a detached dock
        // is re-attached rather than rebuilt, so rows and listeners survive.
        const root = mountPoint();
        if (!root) return;
        if (dock) {
            if (!dock.isConnected) root.appendChild(dock);
            if (styleEl && !styleEl.isConnected) {
                (document.head || document.documentElement).appendChild(styleEl);
            }
            return;
        }

        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = dockCss(PIN_THEMES[theme]);
        (document.head || document.documentElement).appendChild(styleEl);

        dock = document.createElement('div');
        dock.id = DOCK_ID;
        dock.setAttribute('role', 'toolbar');
        dock.setAttribute('aria-label', 'Pinned commands');
        dock.setAttribute('aria-orientation', 'vertical');

        head = document.createElement('div');
        head.className = 'sn-pin-head';
        head.tabIndex = 0;
        head.setAttribute('role', 'button');
        head.setAttribute('aria-label', 'Move pinned commands — drag, or use the arrow keys');
        head.title = 'Drag to move';

        const grip = document.createElement('span');
        grip.className = 'sn-pin-grip';
        grip.setAttribute('aria-hidden', 'true');
        grip.textContent = '⠿';

        const label = document.createElement('span');
        label.className = 'sn-pin-title';
        label.textContent = 'Pinned';

        head.appendChild(grip);
        head.appendChild(label);

        listEl = document.createElement('div');
        listEl.className = 'sn-pin-list';

        dock.appendChild(head);
        dock.appendChild(listEl);
        root.appendChild(dock);

        head.addEventListener('pointerdown', onDragStart);
        head.addEventListener('pointermove', onDragMove);
        head.addEventListener('pointerup', onDragEnd);
        head.addEventListener('pointercancel', onDragEnd);
        head.addEventListener('keydown', onHeadKey);
        window.addEventListener('resize', onResize);
    }

    function pinnedList() {
        return commands.filter(function(c) { return c && c.pinned === true; })
            .sort(function(a, b) {
                const aHas = a.order != null && a.order !== '';
                const bHas = b.order != null && b.order !== '';
                if (aHas && bHas) return a.order - b.order;
                if (aHas) return -1;
                if (bHas) return 1;
                return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
            });
    }

    function makeRow(cmd) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sn-pin-cmd';
        btn.title = '\\' + cmd.name + (cmd.hint ? ' — ' + cmd.hint : '') + '\nClick to run';
        btn.setAttribute('aria-label', 'Run \\' + cmd.name + (cmd.hint ? ': ' + cmd.hint : ''));

        const name = document.createElement('span');
        name.className = 'sn-pin-name';
        name.textContent = '\\' + cmd.name;
        btn.appendChild(name);

        if (cmd.hint) {
            const hint = document.createElement('span');
            hint.className = 'sn-pin-hint';
            hint.textContent = cmd.hint;
            btn.appendChild(hint);
        }

        // Same defence as the palette: some ServiceNow pages swallow document
        // clicks, so mousedown (capture phase) runs the command first and click
        // remains as the keyboard/normal-page fallback.
        let firedByMouseDown = false;
        btn.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            firedByMouseDown = true;
            run(cmd);
        }, true);
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (firedByMouseDown) { firedByMouseDown = false; return; }
            run(cmd);
        });

        return btn;
    }

    function render() {
        if (!isTop || !snPageGate.allowed()) { hide(); return; }
        const pinned = pinnedList();
        if (!pinned.length) { hide(); return; }
        if (!mountPoint()) return;

        build();
        dock.style.display = 'flex';

        // Commands update whenever one runs (the usage counter is stored in the
        // same array). Rebuilding rows for that would throw away the very button
        // under the pointer, so only touch the DOM when something visible moved.
        const key = pinned.map(function(c) {
            return [c.id, c.name, c.hint || '', c.script || '',
                    c.order == null ? '' : c.order].join('\u0001');
        }).join('\u0002');
        if (key !== rowsKey) {
            rowsKey = key;
            listEl.innerHTML = '';
            pinned.forEach(function(cmd) { listEl.appendChild(makeRow(cmd)); });
        }

        if (!pos) pos = defaultPos();
        pos = clampPos(pos);
        applyPos();
    }

    function hide() {
        if (dock) dock.style.display = 'none';
    }

    function defaultPos() {
        const w = dock ? dock.offsetWidth : 200;
        const h = dock ? dock.offsetHeight : 220;
        return { left: EDGE, top: Math.max(EDGE, Math.round((window.innerHeight - h) / 2)) };
    }

    function clampPos(p) {
        const w = dock ? dock.offsetWidth : 200;
        const h = dock ? dock.offsetHeight : 220;
        const maxLeft = Math.max(EDGE, window.innerWidth - w - EDGE);
        const maxTop  = Math.max(EDGE, window.innerHeight - h - EDGE);
        return {
            left: Math.min(Math.max(Number(p.left), EDGE), maxLeft),
            top:  Math.min(Math.max(Number(p.top), EDGE), maxTop)
        };
    }

    function applyPos() {
        if (!dock || !pos) return;
        dock.style.left = pos.left + 'px';
        dock.style.top  = pos.top + 'px';
    }

    function validPos(p) {
        return p && typeof p.left === 'number' && typeof p.top === 'number' &&
               isFinite(p.left) && isFinite(p.top);
    }

    function persistPos() {
        saveTimer = null;
        if (!pos) return;
        const payload = {};
        payload[POS_STORE] = { left: Math.round(pos.left), top: Math.round(pos.top) };
        try { chrome.storage.local.set(payload); } catch (e) { /* context invalidated */ }
    }

    function savePos(delay) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persistPos, delay || 0);
    }

    function onDragStart(e) {
        if (e.button !== 0 || !dock) return;
        e.preventDefault();
        e.stopPropagation();

        const rect = dock.getBoundingClientRect();
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
        pos = { left: rect.left, top: rect.top };
        dock.classList.add('sn-pin-dragging');
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* older browser */ }
    }

    function onDragMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        e.preventDefault();
        pos = clampPos({
            left: drag.left + (e.clientX - drag.x),
            top:  drag.top  + (e.clientY - drag.y)
        });
        applyPos();
    }

    function onDragEnd(e) {
        if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
        drag = null;
        if (dock) dock.classList.remove('sn-pin-dragging');
        try { head.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        savePos(0);
    }

    function onHeadKey(e) {
        const step = e.shiftKey ? 40 : 12;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft')       dx = -step;
        else if (e.key === 'ArrowRight') dx =  step;
        else if (e.key === 'ArrowUp')    dy = -step;
        else if (e.key === 'ArrowDown')  dy =  step;
        else return;

        e.preventDefault();
        e.stopPropagation();
        if (!dock) return;
        if (!pos) {
            const rect = dock.getBoundingClientRect();
            pos = { left: rect.left, top: rect.top };
        }
        pos = clampPos({ left: pos.left + dx, top: pos.top + dy });
        applyPos();
        savePos(250);
    }

    function onResize() {
        if (!pos || !dock) return;
        pos = clampPos(pos);
        applyPos();
    }

    function applyTheme() {
        if (styleEl) styleEl.textContent = dockCss(PIN_THEMES[theme]);
    }

    function run(cmd) {
        try {
            const p = chrome.runtime.sendMessage({
                source: 'SN_COMMANDS_EXEC',
                script: cmd.script,
                name:   cmd.name,
                id:     cmd.id
            });
            if (p && typeof p.catch === 'function') {
                p.catch(function(e) { console.error('[SN Commands] Pinned command failed:', cmd.name, e); });
            }
        } catch (e) {
            console.error('[SN Commands] Pinned command failed:', cmd.name, e);
        }
    }

    if (isTop) {
        try {
            chrome.storage.local.get(['snCommands', 'snTheme', POS_STORE], function(res) {
                commands = Array.isArray(res && res.snCommands) ? res.snCommands : [];
                theme    = res && res.snTheme === 'light' ? 'light' : 'dark';
                pos      = validPos(res && res[POS_STORE])
                    ? { left: res[POS_STORE].left, top: res[POS_STORE].top }
                    : null;
                render();
            });

            chrome.storage.onChanged.addListener(function(changes, area) {
                if (area !== 'local') return;
                if (changes.snCommands) {
                    commands = Array.isArray(changes.snCommands.newValue) ? changes.snCommands.newValue : [];
                    render();
                }
                if (changes.snTheme) {
                    theme = changes.snTheme.newValue === 'light' ? 'light' : 'dark';
                    applyTheme();
                }
                if (changes[POS_STORE] && !drag) {
                    const next = changes[POS_STORE].newValue;
                    if (validPos(next)) {
                        pos = clampPos({ left: next.left, top: next.top });
                        applyPos();
                    } else if (next == null) {
                        pos = null;
                        render();
                    }
                }
            });

            // Polaris can finish booting after document_idle; the dock appears
            // the moment the gate accepts the page, with no reload.
            snPageGate.onChange(function() {
                try { render(); }
                catch (e) { console.error('[SN Commands] pinned dock re-check failed:', e); }
            });
        } catch (e) {
            console.error('[SN Commands] pinned dock unavailable:', e);
        }
    }

})();
