'use strict';

// NOTE (MV3): Script execution is now handled by the background service worker.
// Popup sends directly to background via chrome.runtime.sendMessage (SN_COMMANDS_EXEC_TAB).
// The palette's runCmd() below also sends directly to background (SN_COMMANDS_EXEC).
// No content-script relay is needed.

// ── Backslash command palette ─────────────────────────────────────────────────
(function() {
    let palette   = null;
    let input     = null;
    let listEl    = null;
    let header    = null;
    let hint      = null;
    let commands  = [];
    let filtered  = [];
    let activeIdx = 0;
    let isOpen    = false;

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
            textMuted: '#64748b',
            textDim:   '#4a5568',
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
            textDim:   '#94a3b8',
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
    function applyThemeToPalette() {
        if (!palette) return;
        const t = THEMES[currentTheme];
        Object.assign(palette.style, {
            background: t.bg,
            border:     '1px solid ' + t.accent,
        });
        if (header)  Object.assign(header.style,  { background: t.bg2, borderBottom: '1px solid ' + t.border });
        if (input)   Object.assign(input.style,   { color: t.text });
        if (hint)    Object.assign(hint.style,     { color: t.textDim, background: t.border2 });
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
            const nameEl = item.querySelector('.sn-item-name');
            const hintEl = item.querySelector('.sn-item-hint');
            if (nameEl) nameEl.style.color = t.textMono;
            if (hintEl) hintEl.style.color = t.textMuted;
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
            display:      'none'
        });

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
            fontSize: '10px', color: t.textDim,
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
                color: t.textDim, fontSize: '10px',
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
            // Ask background service worker to execute in MAIN world (MV3-safe)
            chrome.runtime.sendMessage({
                source: 'SN_COMMANDS_EXEC',
                script: cmd.script,
                name:   cmd.name
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
