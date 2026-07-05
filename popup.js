'use strict';

// ── Lightweight JS syntax highlighter ────────────────────────────────────────
function highlightJS(code) {
  const KW = /^(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|null|true|false|undefined|async|await)\b/;
  let out = '', i = 0;
  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function span(cls, s) { return '<span class="tok-'+cls+'">'+esc(s)+'</span>'; }
  while (i < code.length) {
    // Line comment
    if (code[i]==='/' && code[i+1]==='/') {
      const end = code.indexOf('\n', i); const e = end===-1 ? code.length : end;
      out += span('cmt', code.slice(i, e)); i = e; continue;
    }
    // Block comment
    if (code[i]==='/' && code[i+1]==='*') {
      const end = code.indexOf('*/', i+2); const e = end===-1 ? code.length : end+2;
      out += span('cmt', code.slice(i, e)); i = e; continue;
    }
    // String (single, double, template)
    if (code[i]==='"' || code[i]==="'" || code[i]==='`') {
      const q=code[i]; let j=i+1, s=q;
      while(j<code.length){ const c=code[j]; s+=c; if(c==='\\'){j++;if(j<code.length)s+=code[j];}else if(c===q)break; j++; }
      out += span('str', s); i = j+1; continue;
    }
    // Number
    if (/[0-9]/.test(code[i]) || (code[i]==='.' && /[0-9]/.test(code[i+1]||''))) {
      let j=i; while(j<code.length && /[0-9a-fA-FxX_\.eEbBoO]/.test(code[j]))j++;
      out += span('num', code.slice(i,j)); i=j; continue;
    }
    // Keyword or identifier
    if (/[a-zA-Z_$]/.test(code[i])) {
      let j=i; while(j<code.length && /[\w$]/.test(code[j]))j++;
      const word = code.slice(i,j);
      if (KW.test(word)) { out += span('kw', word); }
      else if (code[j]==='(') { out += span('fn', word); }
      else if (i>0 && code[i-1]==='.') { out += span('prop', word); }
      else { out += esc(word); }
      i=j; continue;
    }
    // Punctuation
    if (/[{}()\[\];,]/.test(code[i])) { out += span('punct', code[i]); i++; continue; }
    // Anything else (operators, whitespace, newlines)
    out += esc(code[i]); i++;
  }
  return out;
}

let commands = [];
let activeId = null;

const btnNew             = document.getElementById('btnNew');
const btnTheme           = document.getElementById('btnTheme');
const btnSettings        = document.getElementById('btnSettings');
const btnPopupSupport    = document.getElementById('btnPopupSupport');
const searchInput        = document.getElementById('searchInput');
const cmdList            = document.getElementById('cmdList');
const rightPanel         = document.getElementById('rightPanel');
const cmdCount           = document.getElementById('cmdCount');
const toast              = document.getElementById('toast');
const fullscreenOverlay  = document.getElementById('fullscreenOverlay');
const fullscreenTitle    = document.getElementById('fullscreenTitle');
const fullscreenTextarea = document.getElementById('fullscreenTextarea');
const btnFullscreenX     = document.getElementById('btnFullscreenX');
const btnFullscreenClose = document.getElementById('btnFullscreenClose');
const btnFullscreenSave  = document.getElementById('btnFullscreenSave');


// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
  btnTheme.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
function loadTheme() {
  chrome.storage.local.get('snTheme', r => applyTheme(r.snTheme || 'dark'));
}
btnTheme.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  chrome.storage.local.set({ snTheme: next });
  applyTheme(next);
});

// ── Open full settings page in a new tab ──────────────────────────────────────
btnSettings.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  window.close();
});
btnPopupSupport.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') + '?openSupport=1' });
  window.close();
});

// ── Toast — always dark bg, readable on both themes ───────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2300);
}

// ── Storage ───────────────────────────────────────────────────────────────────
function load(cb) {
  chrome.storage.local.get('snCommands', r => { commands = r.snCommands || []; cb(); });
}
function save(cb) {
  chrome.storage.local.set({ snCommands: commands }, cb);
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
      ? 'No commands yet.<br>Click <strong>+ New</strong>'
      : 'No results for "' + filter + '"';
    cmdList.appendChild(el);
    return;
  }

  filtered.forEach(cmd => {
    const item = document.createElement('div');
    item.className = 'cmd-item' + (cmd.id === activeId ? ' active' : '');
    item.dataset.id = cmd.id;

    const nameEl = document.createElement('div');
    nameEl.className = 'cmd-item-name';
    nameEl.textContent = '\\' + cmd.name;

    const hintEl = document.createElement('div');
    hintEl.className = 'cmd-item-hint';
    hintEl.textContent = cmd.hint || '—';

    item.appendChild(nameEl);
    item.appendChild(hintEl);
    item.addEventListener('click', () => selectCommand(cmd.id));
    cmdList.appendChild(item);
  });
}

// ── Editor ────────────────────────────────────────────────────────────────────
function buildEditor(cmd) {
  rightPanel.className = 'right-panel';
  rightPanel.innerHTML = '';

  const fieldRow = document.createElement('div');
  fieldRow.className = 'field-row';

  const nameGroup = document.createElement('div');
  nameGroup.className = 'field-group';
  nameGroup.style.maxWidth = '160px';
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

  const scriptSection = document.createElement('div');
  scriptSection.className = 'script-section';

  const scriptLabelRow = document.createElement('div');
  scriptLabelRow.className = 'script-label-row';
  const scriptLbl = document.createElement('div');
  scriptLbl.className = 'field-label';
  scriptLbl.textContent = 'Script';
  const maxBtn = document.createElement('button');
  maxBtn.className = 'btn-maximize';
  maxBtn.innerHTML = '&#x2922; Maximize';
  scriptLabelRow.appendChild(scriptLbl);
  scriptLabelRow.appendChild(maxBtn);

  const scriptSrc = cmd ? (cmd.script || '') : '(function() {\n    // your code here\n    \n})();';
  const scriptArea = document.createElement('textarea');
  scriptArea.className = 'script-area';
  scriptArea.id = 'fieldScript';
  scriptArea.value = scriptSrc;
  scriptArea.spellcheck = false;
  scriptArea.placeholder = '// your code here';

  scriptSection.appendChild(scriptLabelRow);
  scriptSection.appendChild(scriptArea);

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
  saveBtn.textContent = '💾 Save';
  actionRight.appendChild(saveBtn);

  actionBar.appendChild(actionLeft);
  actionBar.appendChild(actionRight);

  rightPanel.appendChild(fieldRow);
  rightPanel.appendChild(scriptSection);
  rightPanel.appendChild(actionBar);

  if (!cmd) setTimeout(() => nameInput.focus(), 50);

  maxBtn.addEventListener('click', () => {
    fullscreenTitle.textContent = '\\' + (nameInput.value || 'command');
    fullscreenTextarea.value    = scriptArea.value;
    fullscreenOverlay.classList.add('visible');
    setTimeout(() => fullscreenTextarea.focus(), 50);
  });

  saveBtn.addEventListener('click', () => {
    const name   = nameInput.value.trim().replace(/^\\/, '');
    const hint   = hintInput.value.trim();
    const script = scriptArea.value.trim();

    if (!name)   { nameInput.classList.add('error'); nameInput.focus(); return; }
    nameInput.classList.remove('error');
    if (!script) { showToast('⚠️ Script is empty!'); return; }

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

  runBtn.addEventListener('click', async () => {
    const script = scriptArea.value.trim();
    if (!script) { showToast('⚠️ Script is empty!'); return; }
    await runScript(script, nameInput.value);
  });

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
  rightPanel.innerHTML = '<div class="empty-icon">⚡</div><div class="empty-text">Select a command to edit<br>or click <strong>+ New</strong></div>';
}

function selectCommand(id) {
  activeId = id;
  const cmd = commands.find(c => c.id === id);
  if (cmd) buildEditor(cmd);
  renderList();
}

// ── Fullscreen script editor ──────────────────────────────────────────────────
function closeFullscreen() {
  fullscreenOverlay.classList.remove('visible');
}

// ✕ in the header corner — just closes, no save
btnFullscreenX.addEventListener('click', closeFullscreen);

// "Discard" button in footer
btnFullscreenClose.addEventListener('click', closeFullscreen);

// "Apply & Close" — copies content back to the normal script area
btnFullscreenSave.addEventListener('click', () => {
  const scriptPre = rightPanel.querySelector('#fieldScript');
  if (scriptPre) {
    scriptPre.value = fullscreenTextarea.value;
  }
  closeFullscreen();
  showToast('📋 Script updated — click Save to persist');
});

// Esc key closes fullscreen
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fullscreenOverlay.classList.contains('visible')) {
    closeFullscreen();
  }
});

// ── New / Search ──────────────────────────────────────────────────────────────
btnNew.addEventListener('click', () => { activeId = null; buildEditor(null); renderList(); });
searchInput.addEventListener('input', renderList);

// ── Run script on SN tab ──────────────────────────────────────────────────────
// A tab counts as a "ServiceNow tab" if it's on the built-in domains, one of
// the user's configured custom/on-prem domains (see Settings → Instances), or
// "all sites" has been enabled there.
async function isKnownSNTab(tab) {
  if (!tab || !tab.url) return false;
  if (tab.url.includes('service-now.com')) return true;
  try {
    const { snAllUrls, snCustomDomains } = await chrome.storage.local.get(['snAllUrls', 'snCustomDomains']);
    if (snAllUrls) return true;
    const host = new URL(tab.url).hostname;
    return (snCustomDomains || []).some(pattern => {
      const domain = pattern.replace(/^\*:\/\//, '').replace(/\/\*$/, '').replace(/^\*\./, '');
      return host === domain || host.endsWith('.' + domain);
    });
  } catch (err) { return false; }
}

// MV3: send to background service worker which uses chrome.scripting.executeScript
// (MAIN world) instead of DOM <script> injection.
async function runScript(script, name) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let tab = tabs[0];
    if (!(await isKnownSNTab(tab))) {
      const allTabs = await chrome.tabs.query({});
      tab = null;
      for (const t of allTabs) { if (await isKnownSNTab(t)) { tab = t; break; } }
    }
    if (!tab) { showToast('❌ No ServiceNow tab found!'); return; }
    const resp = await chrome.runtime.sendMessage({
      source: 'SN_COMMANDS_EXEC_TAB',
      tabId:  tab.id,
      frameId: 0,
      script,
      name
    });
    if (resp && resp.ok === false) throw new Error(resp.error || 'Unknown error');
    showToast('▶ Running: \\' + (name || 'command'));
  } catch (err) {
    showToast('❌ ' + err.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadTheme();
load(() => renderList());
