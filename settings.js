'use strict';

let commands = [];
let activeId = null;
let selectedIds = new Set();

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
const btnDeleteSelected  = document.getElementById('btnDeleteSelected');
const rightPanel         = document.getElementById('rightPanel');
const cmdCount           = document.getElementById('cmdCount');
const toast              = document.getElementById('toast');
const fullscreenOverlay  = document.getElementById('fullscreenOverlay');
const fullscreenTitle    = document.getElementById('fullscreenTitle');
const fullscreenTextarea = document.getElementById('fullscreenTextarea');
const btnFullscreenX     = document.getElementById('btnFullscreenX');
const btnFullscreenClose = document.getElementById('btnFullscreenClose');
const btnFullscreenSave  = document.getElementById('btnFullscreenSave');
const importFile         = document.getElementById('importFile');

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
  btnTheme.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
function loadTheme() {
  browser.storage.local.get('snTheme', r => applyTheme(r.snTheme || 'dark'));
}
btnTheme.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  browser.storage.local.set({ snTheme: next });
  applyTheme(next);
});

// ── Toast — always dark so readable on both themes ────────────────────────────
function showToast(msg, bgOverride) {
  toast.textContent = msg;
  toast.style.background = bgOverride || '';  // uses var(--toast-bg) from CSS if empty
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

// ── Storage ───────────────────────────────────────────────────────────────────
function load(cb) {
  browser.storage.local.get('snCommands', r => { commands = r.snCommands || []; cb(); });
}
function save(cb) {
  browser.storage.local.set({ snCommands: commands }, cb);
}

// ── Render list ───────────────────────────────────────────────────────────────
function renderList() {
  const filter   = searchInput.value.toLowerCase();
  const filtered = commands.filter(c =>
    c.name.toLowerCase().includes(filter) ||
    (c.hint || '').toLowerCase().includes(filter)
  );
  cmdCount.textContent = commands.length + ' command' + (commands.length !== 1 ? 's' : '');
  cmdList.innerHTML = '';

  if (filtered.length === 0) {
    const el = document.createElement('div');
    el.className = 'empty-list';
    el.innerHTML = commands.length === 0
      ? 'No commands yet.<br>Click <strong>+ New Command</strong>'
      : 'No results for "' + filter + '"';
    cmdList.appendChild(el);
    return;
  }

  filtered.forEach(cmd => {
    const item = document.createElement('div');
    item.className = 'cmd-item' + (cmd.id === activeId ? ' active' : '');
    item.dataset.id = cmd.id;

    // Checkbox wrapper
    const checkWrap = document.createElement('label');
    checkWrap.className = 'cmd-item-check' + (selectedIds.has(cmd.id) ? ' checked' : '');
    checkWrap.title = 'Select for bulk delete';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.has(cmd.id);
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) { selectedIds.add(cmd.id); checkWrap.classList.add('checked'); }
      else            { selectedIds.delete(cmd.id); checkWrap.classList.remove('checked'); }
      updateBulkBar();
    });
    checkWrap.appendChild(cb);
    // Prevent clicking the label from also firing the body click
    checkWrap.addEventListener('click', e => e.stopPropagation());

    // Body (name + hint)
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

// ── Editor ────────────────────────────────────────────────────────────────────
function buildEditor(cmd) {
  rightPanel.className = 'right-panel';
  rightPanel.innerHTML = '';

  // Name + Hint row
  const fieldRow = document.createElement('div');
  fieldRow.className = 'field-row';

  const nameGroup = document.createElement('div');
  nameGroup.className = 'field-group';
  nameGroup.style.maxWidth = '210px';
  const nameLbl = document.createElement('div');
  nameLbl.className = 'field-label';
  nameLbl.textContent = 'Command Name';
  const nameInput = document.createElement('input');
  nameInput.className = 'field-input mono';
  nameInput.id = 'fieldName';
  nameInput.value = cmd ? cmd.name : '';
  nameInput.placeholder = 'e.g. email';
  nameGroup.appendChild(nameLbl);
  nameGroup.appendChild(nameInput);

  const hintGroup = document.createElement('div');
  hintGroup.className = 'field-group';
  const hintLbl = document.createElement('div');
  hintLbl.className = 'field-label';
  hintLbl.textContent = 'Hint';
  const hintInput = document.createElement('input');
  hintInput.className = 'field-input';
  hintInput.id = 'fieldHint';
  hintInput.value = cmd ? (cmd.hint || '') : '';
  hintInput.placeholder = 'Short description';
  hintGroup.appendChild(hintLbl);
  hintGroup.appendChild(hintInput);

  fieldRow.appendChild(nameGroup);
  fieldRow.appendChild(hintGroup);

  // Script
  const scriptSection = document.createElement('div');
  scriptSection.className = 'script-section';

  const scriptLabelRow = document.createElement('div');
  scriptLabelRow.className = 'script-label-row';
  const scriptLbl = document.createElement('div');
  scriptLbl.className = 'field-label';
  scriptLbl.textContent = 'Script';

  const maxBtn = document.createElement('button');
  maxBtn.className = 'btn btn-secondary';
  maxBtn.style.fontSize = '11px';
  maxBtn.style.padding = '4px 10px';
  maxBtn.innerHTML = '&#x2922; Maximize';
  scriptLabelRow.appendChild(scriptLbl);
  scriptLabelRow.appendChild(maxBtn);

  const scriptArea = document.createElement('textarea');
  scriptArea.className = 'script-area';
  scriptArea.id = 'fieldScript';
  scriptArea.spellcheck = false;
  scriptArea.value = cmd ? (cmd.script || '') : '(function() {\n    // your code here\n    \n})();';

  scriptSection.appendChild(scriptLabelRow);
  scriptSection.appendChild(scriptArea);

  // Action bar
  const actionBar = document.createElement('div');
  actionBar.className = 'action-bar';

  const actionLeft = document.createElement('div');
  actionLeft.className = 'action-left';
  const runBtn = document.createElement('button');
  runBtn.className = 'btn btn-secondary';
  runBtn.textContent = '▶ Run';
  runBtn.title = 'Run on current ServiceNow tab';
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = '🗑 Delete';
  actionLeft.appendChild(runBtn);
  if (cmd) actionLeft.appendChild(delBtn);

  const actionRight = document.createElement('div');
  actionRight.className = 'action-right';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '💾 Save Command';
  actionRight.appendChild(saveBtn);

  actionBar.appendChild(actionLeft);
  actionBar.appendChild(actionRight);

  rightPanel.appendChild(fieldRow);
  rightPanel.appendChild(scriptSection);
  rightPanel.appendChild(actionBar);

  if (!cmd) setTimeout(() => nameInput.focus(), 50);

  // Maximize
  maxBtn.addEventListener('click', () => {
    fullscreenTitle.textContent = '\\' + (nameInput.value || 'command');
    fullscreenTextarea.value    = scriptArea.value;
    fullscreenOverlay.classList.add('visible');
    setTimeout(() => fullscreenTextarea.focus(), 50);
  });

  // Save
  saveBtn.addEventListener('click', () => {
    const name   = nameInput.value.trim().replace(/^\\/, '');
    const hint   = hintInput.value.trim();
    const script = scriptArea.value.trim();

    if (!name)   { nameInput.classList.add('error'); nameInput.focus(); return; }
    nameInput.classList.remove('error');
    if (!script) { scriptArea.classList.add('error'); scriptArea.focus(); return; }
    scriptArea.classList.remove('error');

    const dupe = commands.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== activeId);
    if (dupe) { nameInput.classList.add('error'); showToast('⚠️ Name already exists!'); return; }

    if (activeId) {
      const idx = commands.findIndex(c => c.id === activeId);
      if (idx !== -1) commands[idx] = { ...commands[idx], name, hint, script, updatedAt: Date.now() };
    } else {
      const newId = Date.now().toString();
      commands.push({ id: newId, name, hint, script, createdAt: Date.now() });
      activeId = newId;
    }
    save(() => { showToast('✅ Saved!'); renderList(); });
  });

  // Run
  runBtn.addEventListener('click', async () => {
    const script = scriptArea.value.trim();
    if (!script) { showToast('⚠️ Script is empty!'); return; }
    await runScript(script, nameInput.value);
  });

  // Delete
  if (cmd) {
    delBtn.addEventListener('click', () => {
      if (!confirm('Delete "\\' + cmd.name + '"?')) return;
      commands = commands.filter(c => c.id !== cmd.id);
      activeId = null;
      save(() => { showToast('🗑 Deleted'); showEmptyState(); renderList(); });
    });
  }
}

function showEmptyState() {
  activeId = null;
  rightPanel.className = 'right-panel empty-state';
  rightPanel.innerHTML = '<div class="empty-icon">⚡</div><div class="empty-text">Select a command to edit<br>or click <strong>+ New Command</strong></div>';
}

function selectCommand(id) {
  activeId = id;
  const cmd = commands.find(c => c.id === id);
  if (cmd) buildEditor(cmd);
  renderList();
}

// ── Fullscreen editor controls ────────────────────────────────────────────────
function closeFullscreen() {
  fullscreenOverlay.classList.remove('visible');
}

// ✕ button in header — just closes, no save
btnFullscreenX.addEventListener('click', closeFullscreen);

// "Discard & Close" footer button
btnFullscreenClose.addEventListener('click', closeFullscreen);

// "Apply & Close" footer button — copies text back to editor
btnFullscreenSave.addEventListener('click', () => {
  const scriptArea = document.getElementById('fieldScript');
  if (scriptArea) scriptArea.value = fullscreenTextarea.value;
  closeFullscreen();
  showToast('📋 Script updated — click Save Command to persist');
});

// Esc closes fullscreen
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fullscreenOverlay.classList.contains('visible')) {
    closeFullscreen();
  }
});

// ── New / Search / Export / Import ────────────────────────────────────────────
btnNew.addEventListener('click', () => { activeId = null; buildEditor(null); renderList(); });
searchInput.addEventListener('input', renderList);

btnExport.addEventListener('click', () => {
  if (commands.length === 0) { showToast('⚠️ No commands to export!'); return; }
  const blob = new Blob([JSON.stringify({ version: 1, commands }, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'sn-commands-export.json'; a.click();
  URL.revokeObjectURL(url);
  showToast('⬇ Exported ' + commands.length + ' commands');
});

btnImport.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data     = JSON.parse(ev.target.result);
      const imported = data.commands || data;
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      const valid = imported.filter(c => c.name && c.script);
      if (valid.length === 0) throw new Error('No valid commands found');

      const merge = confirm('Import ' + valid.length + ' commands?\n\nOK = Merge\nCancel = Replace all');
      if (merge) {
        let added = 0;
        valid.forEach(c => {
          if (!commands.find(ex => ex.name.toLowerCase() === c.name.toLowerCase())) {
            commands.push({ ...c, id: Date.now().toString() + Math.random(), createdAt: Date.now() });
            added++;
          }
        });
        save(() => { showToast('⬆ Merged ' + added + ' new commands'); renderList(); });
      } else {
        commands = valid.map(c => ({ ...c, id: Date.now().toString() + Math.random(), createdAt: Date.now() }));
        save(() => { showToast('⬆ Replaced with ' + commands.length + ' commands'); renderList(); });
      }
    } catch (err) { showToast('❌ Import failed: ' + err.message); }
    importFile.value = '';
  };
  reader.readAsText(file);
});

// ── Clear All ─────────────────────────────────────────────────────────────────
btnClearAll.addEventListener('click', () => {
  if (commands.length === 0) { showToast('⚠️ No commands to clear!'); return; }
  if (!confirm('Are you sure you want to delete ALL ' + commands.length + ' command' + (commands.length !== 1 ? 's' : '') + '?\n\nThis cannot be undone.')) return;
  commands = [];
  selectedIds.clear();
  activeId = null;
  save(() => { showToast('🗑 All commands cleared'); showEmptyState(); renderList(); });
});

// ── Select All / Deselect All ─────────────────────────────────────────────────
btnSelectAll.addEventListener('click', () => {
  if (selectedIds.size === commands.length) {
    selectedIds.clear();
  } else {
    commands.forEach(c => selectedIds.add(c.id));
  }
  renderList();
});

// ── Delete Selected ───────────────────────────────────────────────────────────
btnDeleteSelected.addEventListener('click', () => {
  const n = selectedIds.size;
  if (n === 0) return;
  if (!confirm('Delete ' + n + ' selected command' + (n !== 1 ? 's' : '') + '?\n\nThis cannot be undone.')) return;
  commands = commands.filter(c => !selectedIds.has(c.id));
  if (selectedIds.has(activeId)) { activeId = null; showEmptyState(); }
  selectedIds.clear();
  save(() => { showToast('🗑 Deleted ' + n + ' command' + (n !== 1 ? 's' : '')); renderList(); });
});


async function runScript(script, name) {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    let tab = tabs[0];
    if (!tab || !tab.url || (!tab.url.includes('service-now.com') && !tab.url.includes('mercedes-benz.com'))) {
      const allTabs = await browser.tabs.query({});
      tab = allTabs.find(t => t.url && (t.url.includes('service-now.com') || t.url.includes('mercedes-benz.com')));
    }
    if (!tab) { showToast('❌ No ServiceNow tab found!'); return; }
    await browser.tabs.sendMessage(tab.id, { source: 'SN_COMMANDS_RUN', script });
    showToast('▶ Running: \\' + (name || 'command'));
  } catch (err) {
    showToast('❌ ' + err.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadTheme();
load(() => renderList());
