'use strict';
/*
 * Terminal Quest — renderer / terminal front-end.
 * Owns the DOM terminal: input line, blinking cursor, scrollback,
 * command history (persisted), tab completion, and the compendium panel.
 * Delegates all command execution to the game engine.
 */

// Safety net: if anything below throws during load, paint the error into the
// terminal instead of leaving a silent blank screen. Registered first so it
// catches even a failed require().
window.addEventListener('error', (ev) => {
  try {
    const s = document.getElementById('screen');
    if (!s) return;
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:#ff6b6b;white-space:pre-wrap;padding:10px;font-size:13px;';
    const detail = (ev.error && ev.error.stack) || ev.message || String(ev);
    pre.textContent = 'Terminal Quest could not start:\n\n' + detail +
      '\n\n(If you can, screenshot this — it says exactly what went wrong.)';
    s.appendChild(pre);
  } catch (e) { /* nothing more we can do */ }
});

const path = require('path');
const fs = require('fs');
const { ipcRenderer } = require('electron');

const { Game, ACHIEVEMENTS } = require(path.join(__dirname, '..', 'engine', 'game.js'));
const { ansiToHtml } = require(path.join(__dirname, 'ansi.js'));
const { MAN_PAGES } = require(path.join(__dirname, '..', 'engine', 'man.js'));

// ---- persistence -----------------------------------------------------------

let saveDir;
try { saveDir = ipcRenderer.sendSync('tq:get-save-dir'); }
catch (e) { saveDir = path.join(__dirname, '..', '..', '.saves'); }
try { fs.mkdirSync(saveDir, { recursive: true }); } catch (e) {}
const savePath = path.join(saveDir, 'terminal-quest-save.json');
const historyPath = path.join(saveDir, 'history.json');

const storage = {
  load() {
    try { return JSON.parse(fs.readFileSync(savePath, 'utf8')); }
    catch (e) { return null; }
  },
  save(data) {
    try { fs.writeFileSync(savePath, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('save failed', e); }
  }
};

let history = [];
try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')) || []; } catch (e) {}
function persistHistory() {
  try { fs.writeFileSync(historyPath, JSON.stringify(history.slice(-500))); } catch (e) {}
}

// ---- DOM -------------------------------------------------------------------

const screen = document.getElementById('screen');
const compendium = document.getElementById('compendium');

let outputBuffer = document.createElement('div');
screen.appendChild(outputBuffer);

let inputLine = null;   // the live prompt+input DOM node
let cursorSpan = null;
let currentInput = '';
let cursorPos = 0;
let histIndex = history.length;
let histDraft = '';
let busy = false;

function writeRaw(text) {
  const { html, clear } = ansiToHtml(text);
  if (clear) { outputBuffer.innerHTML = ''; }
  if (html) {
    const frag = document.createElement('span');
    frag.innerHTML = html;
    outputBuffer.appendChild(frag);
  }
  scrollToBottom();
}

function scrollToBottom() { screen.scrollTop = screen.scrollHeight; }

// ---- game ------------------------------------------------------------------

const game = new Game({ storage });
// real-filesystem home for the exported cheatsheet (desktop only — on Android
// the in-game ~/cheatsheet.md copy is the deliverable)
game.exportDir = window.TQ_PLATFORM === 'android' ? null : saveDir;
game.history = history.slice();
game.attachPrinter(writeRaw);
game.onStateChange = () => { refreshCompendium(); refreshSuggestions(); };
game.init();
// keep renderer history and game history in sync
game.history = history;

// give the game a way to re-render the input prompt after async prints
function promptString() { return game.shell.prompt(); }

// ---- input line rendering --------------------------------------------------

function renderInputLine() {
  if (inputLine) inputLine.remove();
  inputLine = document.createElement('div');
  inputLine.className = 'input-line';
  const promptSpan = document.createElement('span');
  const isRoot = game.shell.user.name === 'root';
  promptSpan.innerHTML = ansiToHtml(
    `\x1b[1;32m${game.shell.user.name}@omnicorp\x1b[0m:\x1b[1;34m${promptDir()}\x1b[0m${isRoot ? '# ' : '$ '}`
  ).html;
  const before = document.createElement('span');
  const after = document.createElement('span');
  cursorSpan = document.createElement('span');
  cursorSpan.className = 'cursor';
  before.textContent = currentInput.slice(0, cursorPos);
  const atCursor = currentInput.slice(cursorPos, cursorPos + 1);
  cursorSpan.textContent = atCursor || ' ';
  after.textContent = currentInput.slice(cursorPos + (atCursor ? 1 : 0));
  inputLine.appendChild(promptSpan);
  inputLine.appendChild(before);
  inputLine.appendChild(cursorSpan);
  inputLine.appendChild(after);
  screen.appendChild(inputLine);
  scrollToBottom();
}

function promptDir() {
  let dir = game.shell.cwd;
  const home = game.shell.env.HOME;
  if (dir === home) return '~';
  if (dir.startsWith(home + '/')) return '~' + dir.slice(home.length);
  return dir;
}

function hideInputLine() { if (inputLine) { inputLine.remove(); inputLine = null; } }

// ---- command submission ----------------------------------------------------

async function submitLine() {
  const line = currentInput;
  hideInputLine();
  // echo the entered command into scrollback
  const promptEcho = document.createElement('div');
  promptEcho.innerHTML =
    ansiToHtml(`\x1b[1;32m${game.shell.user.name}@omnicorp\x1b[0m:\x1b[1;34m${promptDir()}\x1b[0m${game.shell.user.name === 'root' ? '# ' : '$ '}`).html +
    escapeHtml(line);
  outputBuffer.appendChild(promptEcho);

  currentInput = '';
  cursorPos = 0;

  if (line.trim()) {
    history.push(line);
    game.history = history;
    game.recordHistory(line);
    persistHistory();
  }
  histIndex = history.length;

  if (line.trim()) {
    busy = true;
    try {
      await game.shell.exec(line, { out: writeRaw, err: (s) => writeRaw('\x1b[31m' + s + '\x1b[0m') });
    } catch (e) {
      writeRaw('\x1b[31minternal error: ' + (e && e.message) + '\x1b[0m\n');
    }
    busy = false;
    game.save();
    refreshCompendium();
    refreshStatus();
    refreshSuggestions();
  }
  renderInputLine();
  screen.focus();
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---- tab completion --------------------------------------------------------

function complete() {
  const upto = currentInput.slice(0, cursorPos);
  const tokens = upto.split(/\s+/);
  const frag = tokens[tokens.length - 1];
  const isFirst = tokens.filter(Boolean).length <= 1 && !/\s$/.test(upto);
  let candidates = [];
  if (isFirst && !frag.includes('/')) {
    candidates = Object.keys(game.shell.commands).filter(c => c.startsWith(frag));
  } else {
    candidates = completePath(frag);
  }
  if (candidates.length === 0) return;
  if (candidates.length === 1) {
    const completion = candidates[0];
    const rest = currentInput.slice(cursorPos);
    const head = upto.slice(0, upto.length - frag.length);
    currentInput = head + completion + rest;
    cursorPos = (head + completion).length;
  } else {
    const common = commonPrefix(candidates);
    if (common.length > frag.length) {
      const head = upto.slice(0, upto.length - frag.length);
      const rest = currentInput.slice(cursorPos);
      currentInput = head + common + rest;
      cursorPos = (head + common).length;
    } else {
      hideInputLine();
      writeRaw('\n' + candidates.map(c => c.split('/').pop() || c).join('   ') + '\n');
    }
  }
  renderInputLine();
}

function completePath(frag) {
  const shell = game.shell;
  let dir, prefix;
  let expanded = frag;
  if (expanded.startsWith('~')) expanded = shell.env.HOME + expanded.slice(1);
  const slash = expanded.lastIndexOf('/');
  if (slash === -1) { dir = shell.cwd; prefix = expanded; }
  else { dir = expanded.slice(0, slash) || '/'; prefix = expanded.slice(slash + 1); }
  let entries;
  try { entries = shell.vfs.list(dir, shell.cwd, shell.user); }
  catch (e) { return []; }
  const dirBase = frag.slice(0, frag.length - prefix.length);
  return entries
    .filter(e => e.name.startsWith(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.')))
    .map(e => dirBase + e.name + (e.node.type === 'dir' ? '/' : ''));
}

function commonPrefix(arr) {
  if (!arr.length) return '';
  let p = arr[0];
  for (const s of arr) {
    while (!s.startsWith(p)) p = p.slice(0, -1);
  }
  return p;
}

// ---- keyboard --------------------------------------------------------------
// handleKeyEvent is the single entry point for keystrokes: real keydown events
// AND synthetic ones from the mobile toolbar (window.TQ.pressKey).

function handleKeyEvent(e) {
  if (busy) { e.preventDefault(); return; }

  if (e.key === 'F1') { e.preventDefault(); toggleCompendium(); return; }

  // allow copy
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    if (window.getSelection().toString()) return; // let browser copy
    // Ctrl+C cancels current line
    e.preventDefault();
    hideInputLine();
    const echo = document.createElement('div');
    echo.innerHTML = ansiToHtml(`\x1b[1;32m${game.shell.user.name}@omnicorp\x1b[0m:\x1b[1;34m${promptDir()}\x1b[0m$ `).html + escapeHtml(currentInput) + '^C';
    outputBuffer.appendChild(echo);
    currentInput = ''; cursorPos = 0; histIndex = history.length;
    renderInputLine();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return; // paste handled below
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); outputBuffer.innerHTML = ''; renderInputLine(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); cursorPos = 0; renderInputLine(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); cursorPos = currentInput.length; renderInputLine(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'u') { e.preventDefault(); currentInput = currentInput.slice(cursorPos); cursorPos = 0; renderInputLine(); return; }

  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      submitLine();
      return;
    case 'Backspace':
      e.preventDefault();
      if (cursorPos > 0) { currentInput = currentInput.slice(0, cursorPos - 1) + currentInput.slice(cursorPos); cursorPos--; }
      break;
    case 'Delete':
      e.preventDefault();
      currentInput = currentInput.slice(0, cursorPos) + currentInput.slice(cursorPos + 1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (cursorPos > 0) cursorPos--;
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (cursorPos < currentInput.length) cursorPos++;
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (histIndex > 0) {
        if (histIndex === history.length) histDraft = currentInput;
        histIndex--;
        currentInput = history[histIndex] || '';
        cursorPos = currentInput.length;
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (histIndex < history.length) {
        histIndex++;
        currentInput = histIndex === history.length ? histDraft : (history[histIndex] || '');
        cursorPos = currentInput.length;
      }
      break;
    case 'Home': e.preventDefault(); cursorPos = 0; break;
    case 'End': e.preventDefault(); cursorPos = currentInput.length; break;
    case 'Tab': e.preventDefault(); complete(); return;
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        currentInput = currentInput.slice(0, cursorPos) + e.key + currentInput.slice(cursorPos);
        cursorPos++;
      } else {
        return;
      }
  }
  renderInputLine();
}

screen.addEventListener('keydown', handleKeyEvent);

// Public input API for non-keyboard front-ends (Android toolbar + soft
// keyboard bridge). Same code paths as physical typing.
window.TQ = {
  insertText(text) {
    if (busy || !text) return;
    text = String(text).replace(/\r/g, '');
    const parts = text.split('\n');
    currentInput = currentInput.slice(0, cursorPos) + parts[0] + currentInput.slice(cursorPos);
    cursorPos += parts[0].length;
    renderInputLine();
    if (parts.length > 1) {
      (async () => {
        for (let i = 0; i < parts.length - 1; i++) {
          await submitLine();
          currentInput = parts[i + 1] || '';
          cursorPos = currentInput.length;
          renderInputLine();
        }
      })();
    }
  },
  pressKey(key, mods = {}) {
    handleKeyEvent({
      key,
      ctrlKey: !!mods.ctrl,
      metaKey: false,
      altKey: false,
      preventDefault() {}
    });
  },
  isBusy() { return busy; },
  toggleCompendium() { toggleCompendium(); }
};

screen.addEventListener('paste', (e) => {
  if (busy) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\r/g, '');
  const parts = text.split('\n');
  currentInput = currentInput.slice(0, cursorPos) + parts[0] + currentInput.slice(cursorPos);
  cursorPos += parts[0].length;
  renderInputLine();
  // if multiple lines were pasted, execute all but the last immediately
  if (parts.length > 1) {
    (async () => {
      for (let i = 0; i < parts.length - 1; i++) { await submitLine(); currentInput = parts[i + 1] || ''; cursorPos = currentInput.length; renderInputLine(); }
    })();
  }
});

screen.addEventListener('click', () => { if (!window.getSelection().toString()) screen.focus(); });

// ---- compendium & status ---------------------------------------------------

function toggleCompendium() { compendium.classList.toggle('hidden'); refreshCompendium(); screen.focus(); }

function refreshCompendium() {
  if (compendium.classList.contains('hidden')) { refreshStatus(); return; }
  document.getElementById('rank-name').textContent = game.rank();
  const rankThresh = { Trainee: 400, Operator: 1100, Sysadmin: 2000, 'Root Wizard': game.xp || 1 };
  const nextAt = rankThresh[game.rank()] || 1;
  document.getElementById('xp-fill').style.width = Math.min(100, (game.xp / nextAt) * 100) + '%';
  document.getElementById('xp-label').textContent = game.xp + ' XP';

  const lvl = game.level();
  document.getElementById('level-box').innerHTML =
    `<div><span class="lv-name">Level ${lvl.id}: ${escapeHtml(lvl.name)}</span></div>` +
    `<div style="color:#6bbf8c">${game.finished ? 'Campaign complete 🎉' : 'Objective active — type <b>mission</b></b>'}</div>`;

  const cmdList = document.getElementById('cmd-list');
  cmdList.innerHTML = '';
  const tierMark = ['<span class="m-new">○</span>', '<span class="m-fam">◑</span>', '<span class="m-pro">●</span>'];
  for (const c of game.learnedCommands()) {
    const man = MAN_PAGES[c];
    let one = '';
    if (man) { const m = /- (.*)/.exec(man.split('\n')[3] || ''); one = m ? m[1] : ''; }
    const uses = (game.mastery && game.mastery[c]) || 0;
    const tier = game.masteryTier ? game.masteryTier(uses) : 0;
    const li = document.createElement('li');
    li.innerHTML = `${tierMark[tier]} <code>${escapeHtml(c)}</code> <span class="desc">${escapeHtml(one)}</span>`;
    li.title = uses ? `used ${uses}×` : 'not used yet';
    cmdList.appendChild(li);
  }

  const achList = document.getElementById('ach-list');
  achList.innerHTML = '';
  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    const got = game.achievements.has(id);
    const li = document.createElement('li');
    li.className = got ? 'ach-got' : 'ach-locked';
    li.innerHTML = `${got ? '🏆' : '🔒'} ${escapeHtml(a.name)}`;
    li.title = got ? a.desc : 'Locked';
    achList.appendChild(li);
  }
  refreshStatus();
}

function refreshStatus() {
  document.getElementById('sb-prompt').textContent = `${game.shell.user.name}@omnicorp`;
  document.getElementById('sb-rank').textContent = game.rank();
  document.getElementById('sb-xp').textContent = game.xp + ' XP';
  const lvl = game.level();
  document.getElementById('sb-level').textContent = game.finished ? 'COMPLETE' : ('Level ' + lvl.id);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const d = days[Math.floor(game.gameMinutes / (24 * 60)) % 7];
  document.getElementById('sb-clock').textContent = `${d} ${game.clockString().slice(0, 5)}`;
  document.title = `Terminal Quest — ${game.rank()} — Level ${lvl.id}`;
}

// ---- suggestion chips ------------------------------------------------------

function refreshSuggestions() {
  const bar = document.getElementById('suggestions');
  const chips = document.getElementById('sug-chips');
  const sug = game.finished ? [] : game.currentSuggestions();
  chips.innerHTML = '';
  if (!sug.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  for (const s of sug) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.innerHTML = escapeHtml(s.cmd) + (s.desc ? `<span class="chip-desc">${escapeHtml(s.desc)}</span>` : '');
    chip.title = s.desc || s.cmd;
    // Clicking auto-types the command into the input (does NOT run it), so the
    // player sees exactly what they're about to execute and can edit it first.
    chip.addEventListener('click', () => {
      if (busy) return;
      currentInput = s.cmd;
      cursorPos = currentInput.length;
      renderInputLine();
      screen.focus();
    });
    chips.appendChild(chip);
  }
}

// ---- window controls -------------------------------------------------------

document.getElementById('btn-close').onclick = () => ipcRenderer.send('tq:window', 'close');
document.getElementById('btn-min').onclick = () => ipcRenderer.send('tq:window', 'minimize');
document.getElementById('btn-max').onclick = () => ipcRenderer.send('tq:window', 'maximize');
document.getElementById('btn-compendium').onclick = toggleCompendium;

// ---- boot ------------------------------------------------------------------

// ---- ANSI-Shadow logo (green TERMINAL over cyan QUEST) ----
writeRaw('\n');
writeRaw('\x1b[1;38;2;60;255;150m' + "  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557     " + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;45;235;135m' + "  \u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551     " + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;35;210;120m' + "     \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551     " + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;30;190;110m' + "     \u2588\u2588\u2551   \u2588\u2588\u2554\u2550\u2550\u255d  \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u255a\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2551\u255a\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551     " + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;25;170;100m' + "     \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551 \u255a\u2550\u255d \u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557" + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;20;150;90m' + "     \u255a\u2550\u255d   \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u255d     \u255a\u2550\u255d\u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d" + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;120;230;255m' + "   \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557" + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;95;215;255m' + "  \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d" + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;70;200;255m' + "  \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2551   " + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;55;185;245m' + "  \u2588\u2588\u2551\u2584\u2584 \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2588\u2588\u2551   \u2588\u2588\u2551   " + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;45;165;225m' + "  \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2551   " + '\x1b[0m\n');
writeRaw('\x1b[1;38;2;35;150;210m' + "   \u255a\u2550\u2550\u2580\u2580\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d   \u255a\u2550\u255d   " + '\x1b[0m\n');
writeRaw('  \x1b[1;33m' + "\u25b8 The Linux Sysadmin RPG \u2014 learn real Linux, one puzzle at a time." + '\x1b[0m\n');
writeRaw('\x1b[38;2;20;150;90m  ' + '━'.repeat(66) + '\x1b[0m\n\n');
writeRaw('\x1b[90m  Type \x1b[0m\x1b[1;32mhelp\x1b[0m\x1b[90m for basics \u00b7 \x1b[0m\x1b[1;32mmission\x1b[0m\x1b[90m for your objective \u00b7 \x1b[0m\x1b[1;32mman <cmd>\x1b[0m\x1b[90m for a manual.\x1b[0m\n');
writeRaw('\x1b[90m  Tap a \x1b[0m\x1b[1;33mSUGGESTED\x1b[0m\x1b[90m chip below to auto-type a command \u00b7 \x1b[0m\x1b[1;32mF1\x1b[0m\x1b[90m opens the Compendium.\x1b[0m\n');
writeRaw('\x1b[90m  \u00a9 OmniCorp Junior Sysadmin Training Sim \u00b7 progress saves automatically.\x1b[0m\n\n');

refreshStatus();
refreshCompendium();
refreshSuggestions();
renderInputLine();
screen.focus();
