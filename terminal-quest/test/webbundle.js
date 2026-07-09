'use strict';
/*
 * Terminal Quest — Android/web bundle boot test.
 * Evaluates the generated bundle.js inside a minimal fake DOM + localStorage,
 * proving the module loader resolves every module, the fs/path/electron shims
 * work, the renderer boots, and commands execute — i.e. what the Android
 * WebView will run actually runs. Regenerates the bundle first.
 *
 *   node test/webbundle.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-web.js')], { stdio: 'inherit' });

const bundle = fs.readFileSync(path.join(__dirname, '..', 'webdist', 'bundle.js'), 'utf8');

// ---- minimal fake DOM --------------------------------------------------------

function makeElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    _class: new Set(),
    innerHTML: '',
    textContent: '',
    title: '',
    scrollTop: 0,
    scrollHeight: 100,
    parentNode: null,
    onclick: null,
    classList: {
      add(c) { el._class.add(c); },
      remove(c) { el._class.delete(c); },
      toggle(c, force) {
        const want = force === undefined ? !el._class.has(c) : force;
        want ? el._class.add(c) : el._class.delete(c);
      },
      contains(c) { return el._class.has(c); }
    },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    remove() {
      if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(c => c !== el);
      el.parentNode = null;
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    setAttribute() {},
    getAttribute() { return null; },
    closest() { return null; }
  };
  return el;
}

const byId = {};
const IDS = ['screen', 'compendium', 'rank-name', 'xp-fill', 'xp-label', 'level-box',
  'cmd-list', 'ach-list', 'sb-prompt', 'sb-rank', 'sb-xp', 'sb-level', 'sb-clock',
  'btn-close', 'btn-min', 'btn-max', 'btn-compendium', 'suggestions', 'sug-chips', 'softkb', 'keybar', 'kb-ctrl'];
for (const id of IDS) byId[id] = makeElement('div');
byId['compendium']._class.add('hidden');
byId['suggestions']._class.add('hidden');

const lsData = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Math, Date, JSON, Object, Array, String, Number, RegExp, Error, Set, Map,
  document: {
    getElementById: (id) => byId[id] || (byId[id] = makeElement('div')),
    createElement: (t) => makeElement(t),
    title: '',
    addEventListener() {}
  },
  window: null,
  localStorage: {
    getItem: (k) => (k in lsData ? lsData[k] : null),
    setItem: (k, v) => { lsData[k] = String(v); },
    removeItem: (k) => { delete lsData[k]; }
  },
  getSelection: () => ({ toString: () => '' })
};
sandbox.window = sandbox;
sandbox.window.getSelection = sandbox.getSelection;
sandbox.window.addEventListener = () => {};
sandbox.window.TQ_PLATFORM = 'android';

let failed = 0;
const ok = (name, cond) => {
  if (cond) console.log('ok', name);
  else { failed++; console.error('XX FAIL:', name); }
};

(async () => {
  vm.createContext(sandbox);
  try {
    vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
  } catch (e) {
    console.error('bundle threw during boot:\n', e.stack);
    process.exit(1);
  }

  ok('renderer booted (window.TQ exists)', !!sandbox.TQ && typeof sandbox.TQ.insertText === 'function');
  const collect = (el) => el.innerHTML + el.textContent + el.children.map(collect).join('\n');
  const screenText = () => collect(byId['screen']);
  ok('boot banner rendered', /TERMINAL|OMNICORP|QUEST|█/i.test(screenText()));
  ok('level 1 briefing rendered', /LEVEL 1|First Login/i.test(screenText()));
  ok('status bar populated', byId['sb-rank'].textContent === 'Trainee' && /XP/.test(byId['sb-xp'].textContent));
  ok('suggestion chips visible for level 1', !byId['suggestions']._class.has('hidden') && byId['sug-chips'].children.length >= 3);

  // type a command through the public API and let the async exec settle
  sandbox.TQ.insertText('whoami');
  sandbox.TQ.pressKey('Enter');
  await new Promise(r => setTimeout(r, 100));
  ok('command executed via TQ API', /whoami[\s\S]*player/.test(screenText()));

  // level completion through the same path the phone will use
  sandbox.TQ.insertText('echo OMNI-player-player > /dev/exit');
  sandbox.TQ.pressKey('Enter');
  await new Promise(r => setTimeout(r, 150));
  ok('level 1 completes in web bundle', /LEVEL 2|Moving Around|GATE UNLOCKED/i.test(screenText()));

  // saves persisted through the localStorage-backed fs shim
  ok('save written to localStorage fs shim', Object.keys(lsData).some(k => k.includes('terminal-quest-save')));

  console.log(failed ? `\n${failed} FAILED` : '\nweb bundle: all checks passed');
  process.exit(failed ? 1 : 0);
})();
