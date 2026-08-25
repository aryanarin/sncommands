'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let commands   = [];
let activeId   = null;
let selectedIds = new Set();
let sortMode = 'order'; // 'order' | 'name' | 'date' | 'uses'

// ── CodeMirror instances ──────────────────────────────────────────────────────
let inlineCM  = null;   // the inline script editor
let fullCM    = null;   // the fullscreen editor

function cmTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dracula';
}

function makeCM(container, value) {
  return CodeMirror(container, {
    value:            value || '',
    mode:             'javascript',
    theme:            cmTheme(),
    lineNumbers:      true,
    matchBrackets:    true,
    autoCloseBrackets:true,
    indentUnit:       4,
    tabSize:          4,
    indentWithTabs:   false,
    lineWrapping:     false,
    extraKeys: {
      'Tab': cm => cm.execCommand('insertSoftTab'),
    },
  });
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const btnNew             = document.getElementById('btnNew');
const btnImport          = document.getElementById('btnImport');
const btnExport          = document.getElementById('btnExport');
const btnClearAll        = document.getElementById('btnClearAll');
const btnTheme           = document.getElementById('btnTheme');
const searchInput        = document.getElementById('searchInput');
const cmdList            = document.getElementById('cmdList');
const bulkBar            = document.getElementById('bulkBar');
const bulkCount          = document.getElementById('bulkCount');
const btnSelectAll       = document.getElementById('btnSelectAll');
const btnExportSelected  = document.getElementById('btnExportSelected');
const btnDeleteSelected  = document.getElementById('btnDeleteSelected');
const rightPanel         = document.getElementById('rightPanel');
const cmdCount           = document.getElementById('cmdCount');
const toast              = document.getElementById('toast');
const fullscreenOverlay  = document.getElementById('fullscreenOverlay');
const fullscreenTitle    = document.getElementById('fullscreenTitle');
const fsCMContainer      = document.getElementById('fsCMContainer');
const btnFullscreenX     = document.getElementById('btnFullscreenX');
const btnFullscreenClose = document.getElementById('btnFullscreenClose');
const btnFullscreenFormat= document.getElementById('btnFullscreenFormat');
const btnFullscreenSave  = document.getElementById('btnFullscreenSave');
const btnFullscreenFind  = document.getElementById('btnFullscreenFind');
const fsFindBar          = document.getElementById('fsFindBar');
const fsFindQuery        = document.getElementById('fsFindQuery');
const fsFindCount        = document.getElementById('fsFindCount');
const fsFindPrev         = document.getElementById('fsFindPrev');
const fsFindNext         = document.getElementById('fsFindNext');
const fsFindCase         = document.getElementById('fsFindCase');
const fsFindClose        = document.getElementById('fsFindClose');
const fsFindReplace      = document.getElementById('fsFindReplace');
const fsBtnReplaceOne    = document.getElementById('fsBtnReplaceOne');
const fsBtnReplaceAll    = document.getElementById('fsBtnReplaceAll');
const importFile         = document.getElementById('importFile');
const sortSelect         = document.getElementById('sortSelect');
const leftPanel          = document.getElementById('leftPanel');
const resizeHandle       = document.getElementById('resizeHandle');

// Instances modal
const btnInstances       = document.getElementById('btnInstances');
const instancesOverlay   = document.getElementById('instancesOverlay');
const btnInstancesX      = document.getElementById('btnInstancesX');
const btnInstancesDone   = document.getElementById('btnInstancesDone');
const chkAllUrls         = document.getElementById('chkAllUrls');
const customDomainsSection = document.getElementById('customDomainsSection');
const newDomainInput     = document.getElementById('newDomainInput');
const btnAddDomain       = document.getElementById('btnAddDomain');
const domainList         = document.getElementById('domainList');

// Page theme modal
const btnPageTheme       = document.getElementById('btnPageTheme');
const pageThemeOverlay   = document.getElementById('pageThemeOverlay');
const btnPageThemeX      = document.getElementById('btnPageThemeX');
const btnPageThemeDone   = document.getElementById('btnPageThemeDone');
const chkPageTheme       = document.getElementById('chkPageTheme');
const pageThemeBody      = document.getElementById('pageThemeBody');
const themeGrid          = document.getElementById('themeGrid');
const newThemeHost       = document.getElementById('newThemeHost');
const newThemeChoice     = document.getElementById('newThemeChoice');
const btnAddThemeHost    = document.getElementById('btnAddThemeHost');
const themeHostList      = document.getElementById('themeHostList');

// Helpers modal
const btnHelpers         = document.getElementById('btnHelpers');
const helpersOverlay     = document.getElementById('helpersOverlay');
const btnHelpersX        = document.getElementById('btnHelpersX');
const btnHelpersDone     = document.getElementById('btnHelpersDone');
const helpersBody        = document.getElementById('helpersBody');

// Support modal
const btnSupport         = document.getElementById('btnSupport');
const supportOverlay     = document.getElementById('supportOverlay');
const btnSupportX        = document.getElementById('btnSupportX');
const btnSupportDone     = document.getElementById('btnSupportDone');
const btnCopyUpi         = document.getElementById('btnCopyUpi');
const upiIdText          = document.getElementById('upiIdText');

// ── Small helpers ─────────────────────────────────────────────────────────────
function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

// "used 3 times · created 25/08/2026 · edited 25/08/2026"
// Commands saved before usage tracking existed have no `uses`, so they read
// "used 0 times" and start counting from the next run.
function metaLine(cmd) {
  const bits = ['used ' + plural(cmd.uses || 0, 'time')];
  if (cmd.createdAt)  bits.push('created ' + new Date(cmd.createdAt).toLocaleDateString());
  if (cmd.updatedAt)  bits.push('edited '  + new Date(cmd.updatedAt).toLocaleDateString());
  if (cmd.lastUsedAt) bits.push('last run ' + new Date(cmd.lastUsedAt).toLocaleDateString());
  return bits.join(' \u00b7 ');
}

// ── Sort ─────────────────────────────────────────────────────────────────────
// A single dropdown, and the choice is remembered between visits.
function setSortMode(mode, persist) {
  sortMode = ['order', 'name', 'date', 'uses'].includes(mode) ? mode : 'order';
  if (sortSelect.value !== sortMode) sortSelect.value = sortMode;
  if (persist !== false) chrome.storage.local.set({ snSortMode: sortMode });
  renderList();
}
sortSelect.addEventListener('change', () => setSortMode(sortSelect.value));

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
  btnTheme.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  const t = cmTheme();
  if (inlineCM) inlineCM.setOption('theme', t);
  if (fullCM)   fullCM.setOption('theme', t);
}
function loadTheme() {
  chrome.storage.local.get('snTheme', r => applyTheme(r.snTheme || 'dark'));
}
btnTheme.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  chrome.storage.local.set({ snTheme: next });
  applyTheme(next);
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

// ── Storage ───────────────────────────────────────────────────────────────────
function load(cb) {
  chrome.storage.local.get('snCommands', r => { commands = r.snCommands || []; cb(); });
}
function save(cb) {
  chrome.storage.local.set({ snCommands: commands }, cb);
}

// ── Bulk bar ──────────────────────────────────────────────────────────────────
function updateBulkBar() {
  const n = selectedIds.size;
  if (n > 0) {
    bulkBar.classList.add('visible');
    bulkCount.textContent = n + ' selected';
    btnSelectAll.textContent = selectedIds.size === commands.length ? 'Deselect All' : 'Select All';
  } else {
    bulkBar.classList.remove('visible');
  }
}

// ── Render command list ───────────────────────────────────────────────────────
// ── Sort helper ───────────────────────────────────────────────────────────────
function sortedCommands(list) {
  return list.slice().sort((a, b) => {
    const byName = () => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (sortMode === 'name') return byName();
    if (sortMode === 'date') return (a.createdAt || 0) - (b.createdAt || 0);
    if (sortMode === 'uses') {
      // Busiest first; ties fall back to alphabetical so the order is stable.
      const d = (b.uses || 0) - (a.uses || 0);
      return d !== 0 ? d : byName();
    }
    // 'order': items with an order number first (ascending), then the rest by name
    const aHas = a.order != null && a.order !== '';
    const bHas = b.order != null && b.order !== '';
    if (aHas && bHas) return a.order - b.order;
    if (aHas) return -1;
    if (bHas) return 1;
    return byName();
  });
}

function renderList() {
  const filter   = searchInput.value.toLowerCase();
  const filtered = sortedCommands(commands.filter(c =>
    c.name.toLowerCase().includes(filter) ||
    (c.hint || '').toLowerCase().includes(filter)
  ));
  cmdCount.textContent = commands.length + ' command' + (commands.length !== 1 ? 's' : '');
  cmdList.innerHTML = '';

  if (filtered.length === 0) {
    const el = document.createElement('div');
    el.className = 'empty-list';
    if (commands.length === 0) {
      el.innerHTML = 'No commands yet.<br>Click <strong>+ New Command</strong>';
    } else {
      el.textContent = '';
      el.append('No results for “', filter, '”');
    }
    cmdList.appendChild(el);
    updateBulkBar();
    return;
  }

  filtered.forEach(cmd => {
    const item = document.createElement('div');
    item.className = 'cmd-item' + (cmd.id === activeId ? ' active' : '');
    item.dataset.id = cmd.id;

    // Checkbox
    const checkWrap = document.createElement('label');
    checkWrap.className = 'cmd-item-check' + (selectedIds.has(cmd.id) ? ' checked' : '');
    checkWrap.title = 'Select for bulk action';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.has(cmd.id);
    cb.addEventListener('change', e => {
      e.stopPropagation();
      if (cb.checked) { selectedIds.add(cmd.id); checkWrap.classList.add('checked'); }
      else            { selectedIds.delete(cmd.id); checkWrap.classList.remove('checked'); }
      updateBulkBar();
    });
    checkWrap.appendChild(cb);
    checkWrap.addEventListener('click', e => e.stopPropagation());

    // Body
    const body = document.createElement('div');
    body.className = 'cmd-item-body';
    const nameEl = document.createElement('div');
    nameEl.className = 'cmd-item-name';
    nameEl.textContent = '\\' + cmd.name;
    const hintEl = document.createElement('div');
    hintEl.className = 'cmd-item-hint';
    hintEl.textContent = cmd.hint || '—';
    body.appendChild(nameEl);
    body.appendChild(hintEl);
    body.addEventListener('click', () => selectCommand(cmd.id));

    item.appendChild(checkWrap);
    item.appendChild(body);
    cmdList.appendChild(item);
  });

  updateBulkBar();
}

// ── Editor builder ────────────────────────────────────────────────────────────
function buildEditor(cmd) {
  if (inlineCM) { inlineCM.getWrapperElement().remove(); inlineCM = null; }
  rightPanel.className = 'right-panel';
  rightPanel.innerHTML = '';

  // Name + Hint
  const fieldRow  = document.createElement('div');
  fieldRow.className = 'field-row';

  const nameGroup = document.createElement('div');
  nameGroup.className = 'field-group';
  nameGroup.style.maxWidth = '200px';
  const nameLbl = document.createElement('div');
  nameLbl.className = 'field-label';
  nameLbl.textContent = 'Command Name';
  const nameInput = document.createElement('input');
  nameInput.className = 'field-input mono';
  nameInput.id        = 'fieldName';
  nameInput.value     = cmd ? cmd.name : '';
  nameInput.placeholder = 'e.g. email';
  nameGroup.append(nameLbl, nameInput);

  const hintGroup = document.createElement('div');
  hintGroup.className = 'field-group';
  const hintLbl = document.createElement('div');
  hintLbl.className = 'field-label';
  hintLbl.textContent = 'Hint';
  const hintInput = document.createElement('input');
  hintInput.className   = 'field-input';
  hintInput.id          = 'fieldHint';
  hintInput.value       = cmd ? (cmd.hint || '') : '';
  hintInput.placeholder = 'Short description';
  hintGroup.append(hintLbl, hintInput);

  const orderGroup = document.createElement('div');
  orderGroup.className = 'field-group';
  orderGroup.style.maxWidth = '90px';
  const orderLbl = document.createElement('div');
  orderLbl.className = 'field-label';
  orderLbl.textContent = 'Order';
  const orderInput = document.createElement('input');
  orderInput.className   = 'field-input';
  orderInput.id          = 'fieldOrder';
  orderInput.type        = 'number';
  orderInput.min         = '0';
  orderInput.step        = '1';
  orderInput.value       = cmd ? (cmd.order != null ? cmd.order : '') : '';
  orderInput.placeholder = 'e.g. 10';
  orderInput.title       = 'Custom palette order — lower numbers appear first. Leave blank to sort by name.';
  orderGroup.append(orderLbl, orderInput);

  fieldRow.append(nameGroup, hintGroup, orderGroup);

  // ── Script section ──────────────────────────────────────────────────────
  const scriptSection = document.createElement('div');
  scriptSection.className = 'script-section';

  // Label row with action buttons
  const scriptLabelRow = document.createElement('div');
  scriptLabelRow.className = 'script-label-row';
  const scriptLbl = document.createElement('div');
  scriptLbl.className = 'field-label';
  scriptLbl.textContent = 'Script';

  const scriptActions = document.createElement('div');
  scriptActions.className = 'script-actions';

  function makeBtn(label, title, cls) {
    const b = document.createElement('button');
    b.className = 'btn btn-secondary btn-icon ' + (cls || '');
    b.textContent = label;
    b.title = title;
    return b;
  }

  const findBtn  = makeBtn('🔍 Find',   'Find in script (Ctrl+F)');
  const fmtBtn   = makeBtn('✦ Format',  'Auto-format / indent script');
  const copyBtn  = makeBtn('📋 Copy',   'Copy script to clipboard');
  const clearBtn = makeBtn('✕ Clear',   'Clear script');
  const dupeBtn  = makeBtn('⧉ Dupe',    'Duplicate command');
  const maxBtn   = makeBtn('⤢ Expand',  'Open fullscreen editor');
  if (!cmd) dupeBtn.style.display = 'none';

  scriptActions.append(findBtn, fmtBtn, copyBtn, clearBtn);
  if (cmd) scriptActions.appendChild(dupeBtn);
  scriptActions.appendChild(maxBtn);

  scriptLabelRow.append(scriptLbl, scriptActions);

  // Find bar
  const findBar = document.createElement('div');
  findBar.className = 'find-bar';
  findBar.innerHTML = `
    <div class="find-bar-row">
      <input class="find-bar-query" placeholder="Find…" />
      <span class="find-bar-count"></span>
      <div class="find-nav">
        <button title="Previous (Shift+Enter)">▲</button>
        <button title="Next (Enter)">▼</button>
      </div>
      <label class="find-bar-toggle" title="Match case">
        <input type="checkbox" class="find-case-check" /> Aa
      </label>
      <button class="find-close" title="Close (Esc)">✕</button>
    </div>
    <div class="find-bar-row find-replace-row">
      <input class="find-bar-replace" placeholder="Replace with…" />
      <button class="btn-replace-one" title="Replace current match (Enter)">Replace</button>
      <button class="btn-replace-all" title="Replace all matches">All</button>
    </div>
  `;

  // CM container div
  const cmContainer = document.createElement('div');
  cmContainer.className = 'cm-container';

  scriptSection.append(scriptLabelRow, findBar, cmContainer);

  // ── Action bar ──────────────────────────────────────────────────────────
  const actionBar   = document.createElement('div');
  actionBar.className = 'action-bar';
  const actionLeft  = document.createElement('div');
  actionLeft.className = 'action-left';
  const actionRight = document.createElement('div');
  actionRight.className = 'action-right';

  const runBtn  = document.createElement('button');
  runBtn.className = 'btn btn-secondary';
  runBtn.textContent = '▶ Run';
  runBtn.title = 'Run on current ServiceNow tab';
  actionLeft.appendChild(runBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = '🗑 Delete';
  if (cmd) actionLeft.appendChild(delBtn);

  if (cmd) {
    const meta = document.createElement('span');
    meta.className = 'meta-note';
    meta.textContent = metaLine(cmd);
    meta.title = 'Usage count goes up each time this command runs — from the palette or the Run button';
    actionLeft.appendChild(meta);
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '💾 Save Command';
  actionRight.appendChild(saveBtn);

  actionBar.append(actionLeft, actionRight);

  rightPanel.append(fieldRow, scriptSection, actionBar);
  if (!cmd) setTimeout(() => nameInput.focus(), 50);

  // ── Mount CodeMirror ────────────────────────────────────────────────────
  const initialScript = cmd ? (cmd.script || '') : '(function() {\n    // your code here\n    \n})();';
  inlineCM = makeCM(cmContainer, initialScript);
  inlineCM.setSize('100%', '100%');
  setTimeout(() => inlineCM.refresh(), 50);

  function getScript() { return inlineCM.getValue(); }

  // ── Find & Replace bar logic ─────────────────────────────────────────────
  const fQuery      = findBar.querySelector('.find-bar-query');
  const fCount      = findBar.querySelector('.find-bar-count');
  const fPrev       = findBar.querySelectorAll('.find-nav button')[0];
  const fNext       = findBar.querySelectorAll('.find-nav button')[1];
  const fClose      = findBar.querySelector('.find-close');
  const fCaseCheck  = findBar.querySelector('.find-case-check');
  const fReplace    = findBar.querySelector('.find-bar-replace');
  const fReplaceOne = findBar.querySelector('.btn-replace-one');
  const fReplaceAll = findBar.querySelector('.btn-replace-all');

  function searchOpts() { return { caseFold: !fCaseCheck.checked }; }

  function countMatches(q) {
    if (!q) return 0;
    let n = 0;
    const cur = inlineCM.getSearchCursor(q, {line:0,ch:0}, searchOpts());
    while (cur.findNext()) n++;
    return n;
  }

  // Holds the last cursor used so Replace knows where the current match is
  let lastSearchCursor = null;

  function findInCM(q, forward) {
    if (!q) { fCount.textContent = ''; lastSearchCursor = null; return; }
    const startPos = forward ? inlineCM.getCursor('to') : inlineCM.getCursor('from');
    let cur = inlineCM.getSearchCursor(q, startPos, searchOpts());
    const found = forward ? cur.findNext() : cur.findPrevious();
    if (!found) {
      // wrap around
      cur = inlineCM.getSearchCursor(q, forward ? {line:0,ch:0} : {line:inlineCM.lastLine()+1,ch:0}, searchOpts());
      if (forward) cur.findNext(); else cur.findPrevious();
    }
    if (cur.from() && cur.to()) {
      inlineCM.setSelection(cur.from(), cur.to());
      inlineCM.scrollIntoView({from:cur.from(), to:cur.to()}, 60);
      lastSearchCursor = cur;
    }
    const n = countMatches(q);
    fCount.textContent = n ? n + ' match' + (n!==1?'es':'') : 'No match';
  }

  function openFindBar() {
    findBar.classList.add('visible');
    // Pre-fill with selected text if any
    const sel = inlineCM.getSelection();
    if (sel && !sel.includes('\n')) { fQuery.value = sel; }
    fQuery.focus(); fQuery.select();
    if (fQuery.value) findInCM(fQuery.value, true);
  }
  function closeFindBar() {
    findBar.classList.remove('visible');
    lastSearchCursor = null;
    inlineCM.focus();
  }

  // Replace current highlighted match, then advance to the next
  fReplaceOne.addEventListener('click', () => {
    const q = fQuery.value;
    if (!q) return;
    const sel = inlineCM.getSelection();
    const matchesSel = fCaseCheck.checked
      ? sel === q
      : sel.toLowerCase() === q.toLowerCase();
    if (lastSearchCursor && matchesSel) {
      // Replace the current selection
      inlineCM.replaceSelection(fReplace.value, 'around');
      showToast('Replaced 1 match');
    }
    // Advance to next match
    findInCM(q, true);
    const n = countMatches(q);
    fCount.textContent = n ? n + ' match' + (n!==1?'es':'') : 'No match';
  });

  // Replace all matches at once
  fReplaceAll.addEventListener('click', () => {
    const q = fQuery.value;
    if (!q) return;
    let count = 0;
    inlineCM.operation(() => {
      const cur = inlineCM.getSearchCursor(q, {line:0,ch:0}, searchOpts());
      while (cur.findNext()) { cur.replace(fReplace.value); count++; }
    });
    lastSearchCursor = null;
    fCount.textContent = count ? 'Replaced ' + count : 'No match';
    if (count) showToast('✦ Replaced ' + count + ' match' + (count!==1?'es':''));
  });

  fQuery.addEventListener('input',   () => findInCM(fQuery.value, true));
  fCaseCheck.addEventListener('change', () => findInCM(fQuery.value, true));
  fNext.addEventListener('click',    () => findInCM(fQuery.value, true));
  fPrev.addEventListener('click',    () => findInCM(fQuery.value, false));
  fClose.addEventListener('click',   closeFindBar);
  fQuery.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
    if (e.key === 'Enter')  { e.preventDefault(); findInCM(fQuery.value, !e.shiftKey); }
  });
  fReplace.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
    if (e.key === 'Enter')  { e.preventDefault(); fReplaceOne.click(); }
  });
  findBtn.onclick = openFindBar;
  inlineCM.on('keydown', (_cm, e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openFindBar(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); openFindBar(); }
  });

  // ── Format ──────────────────────────────────────────────────────────────
  fmtBtn.onclick = () => {
    const raw = getScript().trim();
    if (!raw) { showToast('⚠️ Nothing to format!'); return; }
    try {
      const out = js_beautify(raw, {
        indent_size: 4, indent_char: ' ',
        preserve_newlines: true, max_preserve_newlines: 2,
        brace_style: 'collapse', end_with_newline: false,
      });
      inlineCM.setValue(out);
      showToast('✦ Formatted!');
    } catch(err) { showToast('❌ Format failed: ' + err.message); }
  };

  // ── Copy ────────────────────────────────────────────────────────────────
  copyBtn.onclick = () => {
    const text = getScript();
    if (!text.trim()) { showToast('⚠️ Nothing to copy!'); return; }
    navigator.clipboard.writeText(text)
      .then(() => showToast('📋 Copied!'))
      .catch(() => { showToast('📋 Copied!'); });
  };

  // ── Clear ────────────────────────────────────────────────────────────────
  clearBtn.onclick = () => {
    if (!getScript().trim()) return;
    if (!confirm('Clear the script content?')) return;
    inlineCM.setValue('');
    inlineCM.focus();
    showToast('✕ Script cleared');
  };

  // ── Duplicate ────────────────────────────────────────────────────────────
  dupeBtn.onclick = () => {
    if (!cmd) return;
    const base = nameInput.value.trim().replace(/^\\/, '') || cmd.name;
    let name = base + '_copy'; let c = 1;
    while (commands.find(x => x.name.toLowerCase() === name.toLowerCase())) name = base + '_copy' + (++c);
    const newCmd = {
      id: Date.now() + '' + Math.random(),
      name,
      hint: hintInput.value.trim(),
      script: getScript(),
      order: orderInput.value.trim() !== '' ? parseInt(orderInput.value, 10) : null,
      createdAt: Date.now(),
      uses: 0
    };
    commands.push(newCmd);
    activeId = newCmd.id;
    save(() => { showToast('⧉ Duplicated — rename and save'); renderList(); buildEditor(newCmd); setTimeout(() => { const nf = document.getElementById('fieldName'); if (nf) { nf.focus(); nf.select(); } }, 80); });
  };

  // ── Expand (fullscreen) ──────────────────────────────────────────────────
  maxBtn.onclick = () => {
    fullscreenTitle.textContent = '\\' + (nameInput.value || 'command');
    openFullscreen(getScript());
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  saveBtn.onclick = () => {
    const name   = nameInput.value.trim().replace(/^\\/, '');
    const hint   = hintInput.value.trim();
    const script = getScript().trim();
    const orderVal = orderInput.value.trim();
    const order  = orderVal !== '' ? parseInt(orderVal, 10) : null;

    nameInput.classList.remove('error');
    if (!name)   { nameInput.classList.add('error'); nameInput.focus(); return; }
    if (!script) { inlineCM.getWrapperElement().style.outline = '2px solid var(--danger)'; inlineCM.focus(); setTimeout(() => { inlineCM.getWrapperElement().style.outline = ''; }, 1500); return; }

    const dupe = commands.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== activeId);
    if (dupe) { nameInput.classList.add('error'); showToast('⚠️ Name already exists!'); return; }

    if (activeId) {
      const idx = commands.findIndex(c => c.id === activeId);
      if (idx !== -1) commands[idx] = { ...commands[idx], name, hint, script, order, updatedAt: Date.now() };
    } else {
      const newId = Date.now() + '';
      commands.push({ id: newId, name, hint, script, order, createdAt: Date.now(), uses: 0 });
      activeId = newId;
    }
    save(() => {
      showToast('✅ Saved!');
      renderList();
      // Rebuild so the meta line shows up on a brand-new command and refreshes
      // its "edited" date on an existing one.
      const fresh = commands.find(c => c.id === activeId);
      if (fresh) buildEditor(fresh);
    });
  };

  // ── Run ───────────────────────────────────────────────────────────────────
  runBtn.onclick = async () => {
    const script = getScript().trim();
    if (!script) { showToast('⚠️ Script is empty!'); return; }
    // Only count the run when it's a saved command — an unsaved draft has no id.
    await runScript(script, nameInput.value, cmd ? cmd.id : null);
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  if (cmd) {
    delBtn.onclick = () => {
      if (!confirm('Delete "\\' + cmd.name + '"?')) return;
      commands = commands.filter(c => c.id !== cmd.id);
      activeId = null;
      save(() => { showToast('🗑 Deleted'); showEmptyState(); renderList(); });
    };
  }
}

function showEmptyState() {
  activeId = null;
  if (inlineCM) { inlineCM.getWrapperElement().remove(); inlineCM = null; }
  rightPanel.className = 'right-panel empty-state';
  rightPanel.innerHTML = '<div class="empty-icon">⚡</div><div class="empty-text">Select a command to edit<br>or click <strong>+ New Command</strong></div>';
}

function selectCommand(id) {
  activeId = id;
  const cmd = commands.find(c => c.id === id);
  if (cmd) buildEditor(cmd);
  renderList();
}

// ── Fullscreen editor ─────────────────────────────────────────────────────────
let fsFindLastCursor = null;

function fsFindOpts()  { return { caseFold: !fsFindCase.checked }; }

function fsCountMatches(q) {
  if (!q || !fullCM) return 0;
  let n = 0;
  const cur = fullCM.getSearchCursor(q, {line:0,ch:0}, fsFindOpts());
  while (cur.findNext()) n++;
  return n;
}

function fsFindInCM(q, forward) {
  if (!q || !fullCM) { fsFindCount.textContent = ''; fsFindLastCursor = null; return; }
  const startPos = forward ? fullCM.getCursor('to') : fullCM.getCursor('from');
  let cur = fullCM.getSearchCursor(q, startPos, fsFindOpts());
  const found = forward ? cur.findNext() : cur.findPrevious();
  if (!found) {
    cur = fullCM.getSearchCursor(q, forward ? {line:0,ch:0} : {line:fullCM.lastLine()+1,ch:0}, fsFindOpts());
    if (forward) cur.findNext(); else cur.findPrevious();
  }
  if (cur.from() && cur.to()) {
    fullCM.setSelection(cur.from(), cur.to());
    fullCM.scrollIntoView({from:cur.from(), to:cur.to()}, 80);
    fsFindLastCursor = cur;
  }
  const n = fsCountMatches(q);
  fsFindCount.textContent = n ? n + ' match' + (n!==1?'es':'') : 'No match';
}

function openFsFindBar() {
  fsFindBar.classList.add('visible');
  const sel = fullCM && fullCM.getSelection();
  if (sel && !sel.includes('\n')) fsFindQuery.value = sel;
  fsFindQuery.focus(); fsFindQuery.select();
  if (fsFindQuery.value) fsFindInCM(fsFindQuery.value, true);
}
function closeFsFindBar() {
  fsFindBar.classList.remove('visible');
  fsFindLastCursor = null;
  if (fullCM) fullCM.focus();
}

fsFindQuery.addEventListener('input',    () => fsFindInCM(fsFindQuery.value, true));
fsFindCase.addEventListener('change',    () => fsFindInCM(fsFindQuery.value, true));
fsFindNext.addEventListener('click',     () => fsFindInCM(fsFindQuery.value, true));
fsFindPrev.addEventListener('click',     () => fsFindInCM(fsFindQuery.value, false));
fsFindClose.addEventListener('click',    closeFsFindBar);
fsFindQuery.addEventListener('keydown',  e => {
  if (e.key === 'Escape') { e.preventDefault(); closeFsFindBar(); }
  if (e.key === 'Enter')  { e.preventDefault(); fsFindInCM(fsFindQuery.value, !e.shiftKey); }
});
fsFindReplace.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeFsFindBar(); }
  if (e.key === 'Enter')  { e.preventDefault(); fsBtnReplaceOne.click(); }
});

fsBtnReplaceOne.addEventListener('click', () => {
  const q = fsFindQuery.value; if (!q || !fullCM) return;
  const sel = fullCM.getSelection();
  const matches = fsFindCase.checked ? sel === q : sel.toLowerCase() === q.toLowerCase();
  if (fsFindLastCursor && matches) {
    fullCM.replaceSelection(fsFindReplace.value, 'around');
    showToast('Replaced 1 match');
  }
  fsFindInCM(q, true);
  const n = fsCountMatches(q);
  fsFindCount.textContent = n ? n + ' match' + (n!==1?'es':'') : 'No match';
});

fsBtnReplaceAll.addEventListener('click', () => {
  const q = fsFindQuery.value; if (!q || !fullCM) return;
  let count = 0;
  fullCM.operation(() => {
    const cur = fullCM.getSearchCursor(q, {line:0,ch:0}, fsFindOpts());
    while (cur.findNext()) { cur.replace(fsFindReplace.value); count++; }
  });
  fsFindLastCursor = null;
  fsFindCount.textContent = count ? 'Replaced ' + count : 'No match';
  if (count) showToast('✦ Replaced ' + count + ' match' + (count!==1?'es':''));
});

function openFullscreen(script) {
  if (fullCM) { fullCM.getWrapperElement().remove(); fullCM = null; }
  fsCMContainer.innerHTML = '';
  closeFsFindBar();
  fullCM = makeCM(fsCMContainer, script || '');
  fullCM.setSize('100%', '100%');
  fullscreenOverlay.classList.add('visible');
  setTimeout(() => { fullCM.refresh(); fullCM.focus(); }, 60);
  // Ctrl+F / Ctrl+H inside fullscreen editor
  fullCM.on('keydown', (_cm, e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h')) {
      e.preventDefault(); openFsFindBar();
    }
  });
}
function closeFullscreen() {
  closeFsFindBar();
  fullscreenOverlay.classList.remove('visible');
}

btnFullscreenX.addEventListener('click', closeFullscreen);
btnFullscreenClose.addEventListener('click', closeFullscreen);
btnFullscreenFind.addEventListener('click', openFsFindBar);

btnFullscreenFormat.addEventListener('click', () => {
  if (!fullCM) return;
  try {
    const out = js_beautify(fullCM.getValue().trim(), { indent_size:4, indent_char:' ', preserve_newlines:true, max_preserve_newlines:2, brace_style:'collapse' });
    fullCM.setValue(out);
    showToast('✦ Formatted!');
  } catch(err) { showToast('❌ Format failed: ' + err.message); }
});

btnFullscreenSave.addEventListener('click', () => {
  if (fullCM && inlineCM) inlineCM.setValue(fullCM.getValue());
  closeFullscreen();
  showToast('📋 Script updated — click Save Command to persist');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && fullscreenOverlay.classList.contains('visible')) closeFullscreen();
});

// ── New / Search ──────────────────────────────────────────────────────────────
btnNew.addEventListener('click', () => { activeId = null; buildEditor(null); renderList(); });
searchInput.addEventListener('input', renderList);

// ── Export All ────────────────────────────────────────────────────────────────
btnExport.addEventListener('click', () => {
  if (!commands.length) { showToast('⚠️ No commands to export!'); return; }
  exportJSON(commands, 'sn-commands-export.json');
  showToast('⬇ Exported ' + commands.length + ' commands');
});

// ── Export Selected ───────────────────────────────────────────────────────────
btnExportSelected.addEventListener('click', () => {
  const sel = commands.filter(c => selectedIds.has(c.id));
  if (!sel.length) { showToast('⚠️ Nothing selected!'); return; }
  exportJSON(sel, 'sn-commands-selected.json');
  showToast('⬇ Exported ' + sel.length + ' command' + (sel.length!==1?'s':''));
});

function exportJSON(cmds, filename) {
  const blob = new Blob([JSON.stringify({ version:1, commands:cmds }, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Import ────────────────────────────────────────────────────────────────────
btnImport.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data     = JSON.parse(ev.target.result);
      const imported = data.commands || data;
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      const valid = imported.filter(c => c.name && c.script);
      if (!valid.length) throw new Error('No valid commands found');
      const merge = confirm('Import ' + valid.length + ' commands?\n\nOK = Merge with existing\nCancel = Replace all');
      if (merge) {
        let added = 0, replaced = 0;
        valid.forEach(c => {
          const existingIdx = commands.findIndex(ex => ex.name.toLowerCase() === c.name.toLowerCase());
          if (existingIdx !== -1) {
            // Same name already exists — the imported command replaces it
            // (keep the original id/createdAt, refresh the rest + updatedAt).
            // Keep the local id, creation date and usage history — an import
            // updates the script, it doesn't reset how often you've run it.
            commands[existingIdx] = {
              ...commands[existingIdx],
              ...c,
              id: commands[existingIdx].id,
              createdAt: commands[existingIdx].createdAt,
              uses: commands[existingIdx].uses || 0,
              lastUsedAt: commands[existingIdx].lastUsedAt,
              updatedAt: Date.now()
            };
            replaced++;
          } else {
            commands.push({ ...c, id: Date.now() + '' + Math.random(), createdAt: Date.now(), uses: c.uses || 0 });
            added++;
          }
        });
        save(() => {
          const parts = [];
          if (added)    parts.push(added + ' added');
          if (replaced) parts.push(replaced + ' replaced');
          showToast('⬆ Merged — ' + (parts.join(', ') || 'no changes'));
          renderList();
        });
      } else {
        commands = valid.map(c => ({
          ...c, id: Date.now() + '' + Math.random(), createdAt: Date.now(), uses: c.uses || 0
        }));
        save(() => { showToast('⬆ Replaced with ' + commands.length + ' commands'); renderList(); });
      }
    } catch(err) { showToast('❌ Import failed: ' + err.message); }
    importFile.value = '';
  };
  reader.readAsText(file);
});

// ── Clear All ─────────────────────────────────────────────────────────────────
btnClearAll.addEventListener('click', () => {
  if (!commands.length) { showToast('⚠️ No commands to clear!'); return; }
  if (!confirm('Delete ALL ' + commands.length + ' command' + (commands.length!==1?'s':'') + '?\n\nThis cannot be undone.')) return;
  commands = []; selectedIds.clear(); activeId = null;
  save(() => { showToast('🗑 All cleared'); showEmptyState(); renderList(); });
});

// ── Select All / Deselect All ─────────────────────────────────────────────────
btnSelectAll.addEventListener('click', () => {
  if (selectedIds.size === commands.length) selectedIds.clear();
  else commands.forEach(c => selectedIds.add(c.id));
  renderList();
});

// ── Delete Selected ───────────────────────────────────────────────────────────
btnDeleteSelected.addEventListener('click', () => {
  const n = selectedIds.size; if (!n) return;
  if (!confirm('Delete ' + n + ' selected command' + (n!==1?'s':'') + '?\n\nThis cannot be undone.')) return;
  commands = commands.filter(c => !selectedIds.has(c.id));
  if (selectedIds.has(activeId)) { activeId = null; showEmptyState(); }
  selectedIds.clear();
  save(() => { showToast('🗑 Deleted ' + n + ' command' + (n!==1?'s':'')); renderList(); });
});

// ── Run script on SN tab ──────────────────────────────────────────────────────
// A tab counts as a "ServiceNow tab" if it's on the built-in domains, one of
// the user's configured custom/on-prem domains, or "all sites" is enabled.
async function isKnownSNTab(tab) {
  if (!tab || !tab.url) return false;
  if (tab.url.includes('service-now.com')) return true;
  try {
    const { snAllUrls, snCustomDomains } = await chrome.storage.local.get(['snAllUrls', 'snCustomDomains']);
    if (snAllUrls) return true;
    const host = new URL(tab.url).hostname;
    return (snCustomDomains || []).some(pattern => {
      const domain = patternToDomain(pattern).replace(/^\*\./, '');
      return host === domain || host.endsWith('.' + domain);
    });
  } catch (err) { return false; }
}

// Goes through the background service worker, which runs the script with
// chrome.scripting.executeScript in the page's MAIN world — the same path the
// popup and the palette use.
//
// This previously sent 'SN_COMMANDS_RUN' straight to the tab with
// chrome.tabs.sendMessage. content.js has no onMessage listener, so nothing ever
// received it: the message was dropped and the toast claimed success anyway.
async function runScript(script, name, id) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let tab = tabs[0];
    if (!(await isKnownSNTab(tab))) {
      const all = await chrome.tabs.query({});
      tab = null;
      for (const t of all) { if (await isKnownSNTab(t)) { tab = t; break; } }
    }
    if (!tab) { showToast('❌ No ServiceNow tab found!'); return; }

    const resp = await chrome.runtime.sendMessage({
      source:  'SN_COMMANDS_EXEC_TAB',
      tabId:   tab.id,
      frameId: 0,
      script,
      name,
      id
    });
    if (resp && resp.ok === false) throw new Error(resp.error || 'Unknown error');
    showToast('▶ Running: \\' + (name || 'command'));
  } catch(err) { showToast('❌ ' + err.message); }
}

// ── Instances (global / on-prem support) ──────────────────────────────────────
// The static manifest only whitelists *.service-now.com.
// This panel lets the user either flip on "all websites" (broadest, easiest —
// works on any on-prem host with zero config) or grant access to a specific
// list of domains (least-privilege, good for locked-down corporate policies).
// Either way, background.js registers a dynamic content script for whatever
// gets approved, so the \ palette starts working there too.

function domainToPattern(raw) {
  let host = (raw || '').trim();
  if (!host) return null;
  host = host.replace(/^[a-z]+:\/\//i, '');   // strip protocol if pasted
  host = host.split('/')[0];                   // strip any path
  host = host.split(':')[0];                   // strip any port
  if (!host) return null;
  return '*://' + host + '/*';
}
function patternToDomain(pattern) {
  return pattern.replace(/^\*:\/\//, '').replace(/\/\*$/, '');
}

function notifyBackgroundToSync() {
  chrome.runtime.sendMessage({ source: 'SN_COMMANDS_SYNC_DOMAINS' }).catch(() => {});
}

function renderDomainList(domains) {
  domainList.innerHTML = '';
  if (!domains.length) {
    domainList.innerHTML = '<div class="instances-empty">No custom domains added yet.</div>';
    return;
  }
  domains.forEach(pattern => {
    const row = document.createElement('div');
    row.className = 'instances-domain-item';
    const label = document.createElement('span');
    label.textContent = patternToDomain(pattern);
    const rm = document.createElement('button');
    rm.className = 'btn btn-danger';
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => removeDomain(pattern));
    row.appendChild(label);
    row.appendChild(rm);
    domainList.appendChild(row);
  });
}

async function loadInstancesUI() {
  const { snAllUrls, snCustomDomains } = await chrome.storage.local.get(['snAllUrls', 'snCustomDomains']);
  chkAllUrls.checked = !!snAllUrls;
  customDomainsSection.classList.toggle('disabled', !!snAllUrls);
  renderDomainList(snCustomDomains || []);
}

chkAllUrls.addEventListener('change', async () => {
  if (chkAllUrls.checked) {
    let granted = false;
    try { granted = await chrome.permissions.request({ origins: ['<all_urls>'] }); }
    catch (err) { granted = false; }
    if (!granted) {
      chkAllUrls.checked = false;
      showToast('❌ Permission not granted');
      return;
    }
    await chrome.storage.local.set({ snAllUrls: true });
    customDomainsSection.classList.add('disabled');
    notifyBackgroundToSync();
    showToast('✅ Enabled on all websites');
  } else {
    try { await chrome.permissions.remove({ origins: ['<all_urls>'] }); } catch (err) {}
    await chrome.storage.local.set({ snAllUrls: false });
    customDomainsSection.classList.remove('disabled');
    notifyBackgroundToSync();
    showToast('Disabled — back to configured domains only');
  }
});

btnAddDomain.addEventListener('click', async () => {
  const pattern = domainToPattern(newDomainInput.value);
  if (!pattern) { showToast('⚠️ Enter a valid domain'); return; }

  const { snCustomDomains } = await chrome.storage.local.get('snCustomDomains');
  const list = snCustomDomains || [];
  if (list.includes(pattern)) { showToast('⚠️ Already added'); return; }

  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [pattern] }); }
  catch (err) { granted = false; }
  if (!granted) { showToast('❌ Permission not granted'); return; }

  list.push(pattern);
  await chrome.storage.local.set({ snCustomDomains: list });
  notifyBackgroundToSync();
  renderDomainList(list);
  newDomainInput.value = '';
  showToast('✅ Added ' + patternToDomain(pattern));
});
newDomainInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnAddDomain.click(); });

async function removeDomain(pattern) {
  const { snCustomDomains } = await chrome.storage.local.get('snCustomDomains');
  const list = (snCustomDomains || []).filter(p => p !== pattern);
  try { await chrome.permissions.remove({ origins: [pattern] }); } catch (err) {}
  await chrome.storage.local.set({ snCustomDomains: list });
  notifyBackgroundToSync();
  renderDomainList(list);
  showToast('🗑 Removed ' + patternToDomain(pattern));
}

btnInstances.addEventListener('click', () => {
  loadInstancesUI();
  instancesOverlay.classList.add('visible');
});
btnInstancesX.addEventListener('click', () => instancesOverlay.classList.remove('visible'));
btnInstancesDone.addEventListener('click', () => instancesOverlay.classList.remove('visible'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && instancesOverlay.classList.contains('visible')) {
    instancesOverlay.classList.remove('visible');
  }
});

// ── Support modal ──────────────────────────────────────────────────────────────
btnSupport.addEventListener('click', () => supportOverlay.classList.add('visible'));
btnSupportX.addEventListener('click', () => supportOverlay.classList.remove('visible'));
btnSupportDone.addEventListener('click', () => supportOverlay.classList.remove('visible'));
btnCopyUpi.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(upiIdText.textContent.trim());
    showToast('📋 UPI ID copied');
  } catch (err) {
    showToast('❌ Could not copy — select and copy manually');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && supportOverlay.classList.contains('visible')) {
    supportOverlay.classList.remove('visible');
  }
});
if (new URLSearchParams(location.search).get('openSupport') === '1') {
  supportOverlay.classList.add('visible');
}

// ── Page theme ────────────────────────────────────────────────────────────────
// Palettes and helpers live in themes.js, shared with content.js so the colours
// are defined exactly once.
//
// Everything writes straight to storage; content.js watches for the change and
// repaints open ServiceNow tabs, so there's no save button and no reload.

let pageTheme = snDefaultPageThemeSettings();

function savePageTheme() {
  const payload = {};
  payload[SN_PAGE_THEME_STORE] = pageTheme;
  return chrome.storage.local.set(payload);
}

// A small live sample of the header: real colour, real border, real dot pattern.
function themeChip(t) {
  const chip = document.createElement('span');
  chip.className = 'theme-chip';
  chip.textContent = '\\';
  chip.style.background      = t.header;
  chip.style.backgroundImage = SN_PAGE_THEME_PATTERN;
  chip.style.backgroundSize  = '100px 100px';
  chip.style.border          = '1px solid ' + t.border;
  return chip;
}

function renderThemeGrid() {
  themeGrid.innerHTML = '';

  SN_PAGE_THEME_ORDER.forEach(key => {
    const t = SN_PAGE_THEMES[key];

    const card = document.createElement('label');
    card.className = 'theme-card' + (pageTheme.theme === key ? ' selected' : '');

    const radio = document.createElement('input');
    radio.type    = 'radio';
    // Not "sn"-prefixed on purpose: that prefix is reserved for the shared
    // exports in themes.js, and reusing it here makes the two indistinguishable.
    radio.name    = 'pageThemeDefault';
    radio.value   = key;
    radio.checked = pageTheme.theme === key;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      pageTheme.theme = key;
      savePageTheme().then(() => {
        renderThemeGrid();
        showToast('🎨 Default theme: ' + t.label);
      });
    });

    const text = document.createElement('div');
    text.className = 'theme-card-text';
    const name = document.createElement('div');
    name.className = 'theme-card-name';
    name.textContent = t.label;
    const note = document.createElement('div');
    note.className = 'theme-card-note';
    note.textContent = t.note;
    text.append(name, note);

    card.append(radio, themeChip(t), text);
    themeGrid.appendChild(card);
  });
}

function themeSelect(selected) {
  const sel = document.createElement('select');
  sel.className = 'field-input';
  SN_PAGE_THEME_ORDER.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = SN_PAGE_THEMES[key].label;
    if (key === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

function renderThemeHosts() {
  themeHostList.innerHTML = '';
  const hosts = Object.keys(pageTheme.hosts).sort();

  if (!hosts.length) {
    const empty = document.createElement('div');
    empty.className = 'instances-empty';
    empty.textContent = 'No per-instance mappings yet.';
    themeHostList.appendChild(empty);
    return;
  }

  hosts.forEach(host => {
    const row = document.createElement('div');
    row.className = 'theme-host-item';

    row.appendChild(themeChip(SN_PAGE_THEMES[pageTheme.hosts[host]]));

    const name = document.createElement('span');
    name.className = 'theme-host-name';
    name.textContent = host;
    name.title = host;
    row.appendChild(name);

    // Changing a mapping in place beats deleting and re-adding it.
    const sel = themeSelect(pageTheme.hosts[host]);
    sel.addEventListener('change', () => {
      pageTheme.hosts[host] = sel.value;
      savePageTheme().then(() => {
        renderThemeHosts();
        showToast('🎨 ' + host + ' → ' + SN_PAGE_THEMES[sel.value].label);
      });
    });
    row.appendChild(sel);

    const rm = document.createElement('button');
    rm.className = 'btn btn-danger';
    rm.textContent = 'Remove';
    rm.title = 'Fall back to the default theme on this instance';
    rm.addEventListener('click', () => {
      delete pageTheme.hosts[host];
      savePageTheme().then(() => {
        renderThemeHosts();
        showToast('🗑 Removed mapping for ' + host);
      });
    });
    row.appendChild(rm);

    themeHostList.appendChild(row);
  });
}

function renderPageThemeUI() {
  chkPageTheme.checked = pageTheme.enabled;
  pageThemeBody.classList.toggle('disabled', !pageTheme.enabled);
  renderThemeGrid();
  renderThemeHosts();
}

function loadPageTheme(cb) {
  chrome.storage.local.get(SN_PAGE_THEME_STORE, r => {
    pageTheme = snNormalisePageThemeSettings(r[SN_PAGE_THEME_STORE]);
    if (cb) cb();
  });
}

chkPageTheme.addEventListener('change', () => {
  pageTheme.enabled = chkPageTheme.checked;
  savePageTheme().then(() => {
    pageThemeBody.classList.toggle('disabled', !pageTheme.enabled);
    showToast(pageTheme.enabled
      ? '🎨 Page theme on — open ServiceNow tabs update now'
      : 'Page theme off — ServiceNow back to its own styling');
  });
});

btnAddThemeHost.addEventListener('click', () => {
  const host = snCleanHost(newThemeHost.value);
  if (!host || host.indexOf('.') === -1) {
    newThemeHost.classList.add('error');
    showToast('⚠️ Enter an instance hostname');
    setTimeout(() => newThemeHost.classList.remove('error'), 1500);
    return;
  }
  pageTheme.hosts[host] = newThemeChoice.value || SN_PAGE_THEME_DEFAULT;
  savePageTheme().then(() => {
    newThemeHost.value = '';
    renderThemeHosts();
    showToast('✅ ' + host + ' → ' + SN_PAGE_THEMES[pageTheme.hosts[host]].label);
  });
});
newThemeHost.addEventListener('keydown', e => { if (e.key === 'Enter') btnAddThemeHost.click(); });

// Populated once — rebuilding it on every render would throw away the user's
// in-progress choice while they're still typing the hostname next to it.
function fillNewThemeChoice() {
  newThemeChoice.innerHTML = '';
  SN_PAGE_THEME_ORDER.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = SN_PAGE_THEMES[key].label;
    newThemeChoice.appendChild(opt);
  });
}

btnPageTheme.addEventListener('click', () => {
  loadPageTheme(() => {
    renderPageThemeUI();
    pageThemeOverlay.classList.add('visible');
  });
});
btnPageThemeX.addEventListener('click',    () => pageThemeOverlay.classList.remove('visible'));
btnPageThemeDone.addEventListener('click', () => pageThemeOverlay.classList.remove('visible'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && pageThemeOverlay.classList.contains('visible')) {
    pageThemeOverlay.classList.remove('visible');
  }
});

// The in-page Alt+Shift+T switcher writes mappings too. If this page is open at
// the same time, reflect that rather than showing a stale list.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SN_PAGE_THEME_STORE]) return;
  pageTheme = snNormalisePageThemeSettings(changes[SN_PAGE_THEME_STORE].newValue);
  if (pageThemeOverlay.classList.contains('visible')) renderPageThemeUI();
});

// ── Page helpers ──────────────────────────────────────────────────────────────
// Definitions live in helpers.js, shared with content.js. Rows are generated from
// SN_HELPER_META so adding a helper is a one-file change.
//
// Writes straight to storage; content.js picks the change up and applies it to
// open ServiceNow tabs, so there's no save button here either.

let helperSettings = snDefaultHelperSettings();

function saveHelpers() {
  const payload = {};
  payload[SN_HELPERS_STORE] = helperSettings;
  return chrome.storage.local.set(payload);
}

function renderHelpers() {
  helpersBody.innerHTML = '';

  SN_HELPER_META.forEach(meta => {
    const conf = helperSettings[meta.key];
    if (!conf) return;

    const row = document.createElement('div');
    row.className = 'helper-row' + (conf.enabled ? ' on' : '');

    const label = document.createElement('label');
    label.className = 'instances-toggle-row';

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = conf.enabled;

    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'instances-option-title';
    title.textContent = meta.title;
    const desc = document.createElement('div');
    desc.className = 'instances-option-desc';
    desc.textContent = meta.desc;
    text.append(title, desc);

    label.append(cb, text);
    row.appendChild(label);

    // Keep-alive is the only one with a setting of its own.
    let extra = null;
    if (meta.key === 'keepAlive') {
      extra = document.createElement('div');
      extra.className = 'helper-extra' + (conf.enabled ? ' visible' : '');

      const pre = document.createElement('span');
      pre.textContent = 'Ping every';

      const mins = document.createElement('input');
      mins.className = 'field-input';
      mins.type  = 'number';
      mins.min   = String(SN_KEEPALIVE_MIN_MINUTES);
      mins.max   = String(SN_KEEPALIVE_MAX_MINUTES);
      mins.step  = '1';
      mins.value = String(conf.minutes);
      mins.title = SN_KEEPALIVE_MIN_MINUTES + '\u2013' + SN_KEEPALIVE_MAX_MINUTES + ' minutes';

      const post = document.createElement('span');
      post.textContent = 'minutes';

      // Clamp on commit rather than per-keystroke, so typing "10" doesn't fight
      // the field by snapping to 1 the moment the "1" lands.
      function commitMinutes() {
        const next = snClampKeepAliveMinutes(mins.value);
        mins.value = String(next);
        if (next === helperSettings.keepAlive.minutes) return;
        helperSettings.keepAlive.minutes = next;
        saveHelpers().then(() => showToast('⏱ Keep-alive every ' + next + ' min'));
      }
      mins.addEventListener('change', commitMinutes);
      mins.addEventListener('blur',   commitMinutes);

      extra.append(pre, mins, post);
      row.appendChild(extra);
    }

    if (meta.key === 'quickPost') {
      const note = document.createElement('div');
      note.className = 'helper-note';
      note.textContent = 'Cmd+Enter works too on macOS.';
      row.appendChild(note);
    }

    cb.addEventListener('change', () => {
      helperSettings[meta.key].enabled = cb.checked;
      saveHelpers().then(() => {
        row.classList.toggle('on', cb.checked);
        if (extra) extra.classList.toggle('visible', cb.checked);
        showToast((cb.checked ? '⚡ On — ' : 'Off — ') + meta.title);
      });
    });

    helpersBody.appendChild(row);
  });
}

function loadHelpers(cb) {
  chrome.storage.local.get(SN_HELPERS_STORE, r => {
    helperSettings = snNormaliseHelperSettings(r[SN_HELPERS_STORE]);
    if (cb) cb();
  });
}

btnHelpers.addEventListener('click', () => {
  loadHelpers(() => {
    renderHelpers();
    helpersOverlay.classList.add('visible');
  });
});
btnHelpersX.addEventListener('click',    () => helpersOverlay.classList.remove('visible'));
btnHelpersDone.addEventListener('click', () => helpersOverlay.classList.remove('visible'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && helpersOverlay.classList.contains('visible')) {
    helpersOverlay.classList.remove('visible');
  }
});

// ── Resizable left panel ──────────────────────────────────────────────────────
(function initResize() {
  let startX, startW;
  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = leftPanel.offsetWidth;
    resizeHandle.classList.add('dragging');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  });
  function onMouseMove(e) {
    const dx = e.clientX - startX;
    const newW = Math.max(160, Math.min(500, startW + dx));
    leftPanel.style.width = newW + 'px';
  }
  function onMouseUp() {
    resizeHandle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    if (inlineCM) inlineCM.refresh();
  }
})();

// ── Live sync ─────────────────────────────────────────────────────────────────
// The background worker bumps `uses` when a command runs from the palette, and
// the popup can save changes while this page is open. Pick both up without a
// manual refresh.
//
// Only the list and the usage meta line are touched — the editor's own fields
// are left exactly as the user left them, so this can't discard unsaved edits.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.snCommands) return;
  const incoming = changes.snCommands.newValue;
  if (!Array.isArray(incoming)) return;

  commands = incoming;
  renderList();

  const active = commands.find(c => c.id === activeId);
  const meta   = rightPanel.querySelector('.meta-note');
  if (active && meta) meta.textContent = metaLine(active);
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadTheme();
fillNewThemeChoice();
loadPageTheme();
loadHelpers();
chrome.storage.local.get('snSortMode', r => setSortMode(r.snSortMode || 'order', false));
load(() => renderList());
