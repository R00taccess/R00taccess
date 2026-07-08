'use strict';
/*
 * Terminal Quest — command implementations.
 * Every command operates ONLY on the simulated world (VFS, fake process
 * table, fake network). Behaviour follows the real man pages for the
 * documented subset of flags.
 */

const { FsError } = require('./vfs');
const { runScript } = require('./script');
const { MAN_PAGES } = require('./man');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function splitFlags(args, takesValue = {}) {
  // returns { flags:Set, values:{}, pos:[] } ; supports combined -la
  const flags = new Set();
  const values = {};
  const pos = [];
  let noMore = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { noMore = true; continue; }
    if (!noMore && a.startsWith('--') && a.length > 2) {
      const name = a.slice(2);
      if (takesValue[name]) values[name] = args[++i];
      else flags.add(name);
    } else if (!noMore && a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const chars = a.slice(1);
      let consumed = false;
      for (let c = 0; c < chars.length; c++) {
        const ch = chars[c];
        if (takesValue[ch]) {
          const rest = chars.slice(c + 1);
          values[ch] = rest.length ? rest : args[++i];
          consumed = true;
          break;
        }
        flags.add(ch);
      }
      if (consumed) continue;
    } else {
      pos.push(a);
    }
  }
  return { flags, values, pos };
}

function modeString(node) {
  const t = node.type === 'dir' ? 'd' : node.type === 'link' ? 'l' : '-';
  let s = t;
  for (const shift of [6, 3, 0]) {
    const b = (node.mode >> shift) & 7;
    s += (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-');
  }
  return s;
}

function fmtDate(ms) {
  const d = new Date(ms);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const day = String(d.getDate()).padStart(2, ' ');
  const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${mon} ${day} ${hm}`;
}

function human(n) {
  if (n < 1024) return `${n}`;
  const units = ['K', 'M', 'G', 'T'];
  let u = -1;
  let v = n;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${units[u]}`;
}

function lines(text) {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

function readInput(ctx, pos, cmdName) {
  // Common pattern: operate on files if given, else stdin.
  if (!pos.length) return ctx.stdin || '';
  let buf = '';
  for (const f of pos) {
    buf += ctx.vfs.readFile(f, ctx.shell.cwd, ctx.user);
    if (buf && !buf.endsWith('\n')) buf += '\n';
  }
  return buf;
}

const C = {}; // command registry

// ---------------------------------------------------------------------------
// identity & navigation
// ---------------------------------------------------------------------------

C.whoami = (ctx) => { ctx.out(ctx.user.name + '\n'); };

C.id = (ctx) => {
  const u = ctx.user;
  const uid = u.name === 'root' ? 0 : 1000;
  ctx.out(`uid=${uid}(${u.name}) gid=${uid}(${u.name}) groups=${uid}(${u.name})${u.groups.filter(g => g !== u.name).map((g, i) => `,${1001 + i}(${g})`).join('')}\n`);
};

C.hostname = (ctx) => ctx.out('omnicorp\n');

C.uname = (ctx, args) => {
  const { flags } = splitFlags(args);
  if (flags.has('a')) ctx.out('Linux omnicorp 6.1.0-tq #1 SMP OmniCorp x86_64 GNU/Linux\n');
  else if (flags.has('r')) ctx.out('6.1.0-tq\n');
  else ctx.out('Linux\n');
};

C.pwd = (ctx) => ctx.out(ctx.shell.cwd + '\n');

C.cd = (ctx, args) => {
  let target = args[0];
  if (!target) target = ctx.env.HOME;
  if (target === '-') {
    target = ctx.env.OLDPWD || ctx.shell.cwd;
    ctx.out(target + '\n');
  }
  try {
    ctx.shell.chdir(target);
    return 0;
  } catch (e) {
    ctx.err(`bash: cd: ${args[0]}: ${e.short || e.message}\n`);
    return 1;
  }
};

C.ls = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  const vfs = ctx.vfs;
  let code = 0;
  // Separate file arguments from directory arguments (like real ls):
  // plain files are listed together first, directories get headers after.
  let targets = pos.length ? pos : ['.'];
  const fileArgs = [];
  const dirArgs = [];
  for (const t of targets) {
    const node = vfs.statOrNull(t, ctx.shell.cwd, ctx.user);
    if (!node) { ctx.err(`ls: cannot access '${t}': No such file or directory\n`); code = 2; }
    else if (node.type === 'dir' && !flags.has('d')) dirArgs.push(t);
    else fileArgs.push({ name: t, node }); // -d: list the directory entry itself
  }
  if (fileArgs.length) {
    if (flags.has('l')) {
      for (const e of fileArgs) {
        const n = e.node;
        ctx.out(`${modeString(n)} 1 ${n.owner.padEnd(8)} ${n.group.padEnd(8)} ${String(vfs.sizeOf(n)).padStart(6)} ${fmtDate(n.mtime)} ${e.name}\n`);
      }
    } else {
      ctx.out(fileArgs.map(e => e.name).join('  ') + '\n');
    }
    if (dirArgs.length) ctx.out('\n');
  }
  targets = dirArgs;
  const listDir = (path, showHeader) => {
    let entries;
    try {
      entries = vfs.list(path, ctx.shell.cwd, ctx.user);
      const node = vfs.lookup(path, ctx.shell.cwd, ctx.user).node;
      if (node.type !== 'dir') entries = [{ name: path, node }];
    } catch (e) {
      ctx.err(`ls: cannot access '${path}': ${e.short}\n`);
      code = 2;
      return;
    }
    if (!flags.has('a')) entries = entries.filter(e => !e.name.startsWith('.'));
    else {
      const dirNode = vfs.statOrNull(path, ctx.shell.cwd, ctx.user);
      if (dirNode && dirNode.type === 'dir') {
        entries = [{ name: '.', node: dirNode }, { name: '..', node: dirNode }, ...entries];
      }
    }
    if (showHeader) ctx.out(path + ':\n');
    if (flags.has('l')) {
      let total = 0;
      for (const e of entries) total += Math.ceil(vfs.sizeOf(e.node) / 1024);
      ctx.out(`total ${total}\n`);
      for (const e of entries) {
        const n = e.node;
        const size = String(vfs.sizeOf(n)).padStart(6);
        const nm = n.type === 'link' ? `${e.name} -> ${n.target}` : e.name;
        ctx.out(`${modeString(n)} 1 ${n.owner.padEnd(8)} ${n.group.padEnd(8)} ${size} ${fmtDate(n.mtime)} ${nm}\n`);
      }
    } else {
      if (entries.length) ctx.out(entries.map(e => e.name).join('  ') + '\n');
    }
    if (flags.has('R')) {
      for (const e of entries) {
        if (e.node.type === 'dir' && e.name !== '.' && e.name !== '..') {
          ctx.out('\n');
          listDir(vfs.normalize(path + '/' + e.name, ctx.shell.cwd), true);
        }
      }
    }
  };
  const headers = targets.length > 1 || flags.has('R') || fileArgs.length > 0;
  for (let i = 0; i < targets.length; i++) {
    listDir(targets[i], headers);
    if (i < targets.length - 1) ctx.out('\n');
  }
  return code;
};

C.tree = (ctx, args) => {
  const { pos } = splitFlags(args);
  const start = pos[0] || '.';
  let dirs = 0, files = 0;
  try {
    const r = ctx.vfs.lookup(start, ctx.shell.cwd, ctx.user);
    ctx.out(start + '\n');
    const walk = (node, prefix) => {
      const entries = Object.entries(node.children).filter(([k]) => !k.startsWith('.')).sort((a, b) => a[0].localeCompare(b[0]));
      entries.forEach(([name, child], i) => {
        const last = i === entries.length - 1;
        ctx.out(`${prefix}${last ? '└── ' : '├── '}${name}\n`);
        if (child.type === 'dir') { dirs++; walk(child, prefix + (last ? '    ' : '│   ')); }
        else files++;
      });
    };
    if (r.node.type === 'dir') walk(r.node, '');
    ctx.out(`\n${dirs} directories, ${files} files\n`);
  } catch (e) {
    ctx.err(`tree: ${e.message}\n`);
    return 1;
  }
};

C.clear = (ctx) => { ctx.rawOut('\x1b[2J\x1b[H'); };

C.exit = (ctx) => {
  if (ctx.user.name === 'root' && ctx.game && ctx.game.dropRoot) {
    ctx.game.dropRoot();
    ctx.out('logout\n');
    return 0;
  }
  ctx.out('logout\nThere is no escape from OmniCorp that easily. (Progress is saved — close the window whenever you like.)\n');
};

// ---------------------------------------------------------------------------
// file creation / destruction
// ---------------------------------------------------------------------------

C.mkdir = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (!pos.length) { ctx.err('mkdir: missing operand\n'); return 1; }
  let code = 0;
  for (const p of pos) {
    try {
      if (flags.has('p')) {
        const abs = ctx.vfs.normalize(p, ctx.shell.cwd);
        const segs = ctx.vfs.parts(abs);
        let cur = '';
        for (const s of segs) {
          cur += '/' + s;
          if (!ctx.vfs.exists(cur, '/', ctx.user)) ctx.vfs.mkdir(cur, '/', ctx.user);
        }
      } else {
        ctx.vfs.mkdir(p, ctx.shell.cwd, ctx.user);
      }
    } catch (e) {
      ctx.err(`mkdir: cannot create directory '${p}': ${e.short}\n`);
      code = 1;
    }
  }
  return code;
};

C.touch = (ctx, args) => {
  const { pos } = splitFlags(args);
  if (!pos.length) { ctx.err('touch: missing file operand\n'); return 1; }
  let code = 0;
  for (const p of pos) {
    try { ctx.vfs.touch(p, ctx.shell.cwd, ctx.user); }
    catch (e) { ctx.err(`touch: cannot touch '${p}': ${e.short}\n`); code = 1; }
  }
  return code;
};

C.rm = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (!pos.length) { ctx.err('rm: missing operand\n'); return 1; }
  const recursive = flags.has('r') || flags.has('R');
  let code = 0;
  for (const p of pos) {
    const abs = ctx.vfs.normalize(p, ctx.shell.cwd);
    if (abs === '/' && recursive) {
      if (ctx.game) ctx.game.onRmRfRoot();
      ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe (spoiler: OmniCorp removed that flag from this build)\n");
      return 1;
    }
    try {
      ctx.vfs.unlink(p, ctx.shell.cwd, ctx.user, recursive);
      if (ctx.game) ctx.game.onFileRemoved(abs);
    } catch (e) {
      if (!flags.has('f')) { ctx.err(`rm: cannot remove '${p}': ${e.short}\n`); code = 1; }
    }
  }
  return code;
};

C.rmdir = (ctx, args) => {
  const { pos } = splitFlags(args);
  if (!pos.length) { ctx.err('rmdir: missing operand\n'); return 1; }
  let code = 0;
  for (const p of pos) {
    try { ctx.vfs.rmdir(p, ctx.shell.cwd, ctx.user); }
    catch (e) { ctx.err(`rmdir: failed to remove '${p}': ${e.short}\n`); code = 1; }
  }
  return code;
};

C.cp = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (pos.length < 2) { ctx.err('cp: missing file operand\n'); return 1; }
  const dst = pos[pos.length - 1];
  const srcs = pos.slice(0, -1);
  let code = 0;
  for (const s of srcs) {
    try { ctx.vfs.copy(s, dst, ctx.shell.cwd, ctx.user, flags.has('r') || flags.has('R') || flags.has('a')); }
    catch (e) { ctx.err(`cp: ${e.code === 'EISDIR' ? `-r not specified; omitting directory '${s}'` : `cannot copy '${s}': ${e.short}`}\n`); code = 1; }
  }
  return code;
};

C.mv = (ctx, args) => {
  const { pos } = splitFlags(args);
  if (pos.length < 2) { ctx.err('mv: missing file operand\n'); return 1; }
  const dst = pos[pos.length - 1];
  let code = 0;
  for (const s of pos.slice(0, -1)) {
    try { ctx.vfs.move(s, dst, ctx.shell.cwd, ctx.user); }
    catch (e) { ctx.err(`mv: cannot move '${s}': ${e.short}\n`); code = 1; }
  }
  return code;
};

// ---------------------------------------------------------------------------
// viewing files
// ---------------------------------------------------------------------------

C.cat = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (!pos.length) { ctx.out(ctx.stdin || ''); return 0; }
  let code = 0;
  for (const p of pos) {
    try {
      let content = ctx.vfs.readFile(p, ctx.shell.cwd, ctx.user);
      if (flags.has('n')) {
        content = lines(content).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n') + (content ? '\n' : '');
      }
      ctx.out(content);
      if (content && !content.endsWith('\n')) ctx.out('\n');
    } catch (e) {
      ctx.err(`cat: ${p}: ${e.short}\n`);
      code = 1;
    }
  }
  return code;
};

C.less = (ctx, args) => {
  const { pos } = splitFlags(args);
  try {
    const content = pos.length ? ctx.vfs.readFile(pos[0], ctx.shell.cwd, ctx.user) : (ctx.stdin || '');
    ctx.out(content);
    if (content && !content.endsWith('\n')) ctx.out('\n');
    ctx.out('\x1b[7m(END — in this simulation less prints the whole file; on real Linux, scroll with arrows and quit with q)\x1b[0m\n');
  } catch (e) {
    ctx.err(`less: ${pos[0]}: ${e.short}\n`);
    return 1;
  }
};
C.more = C.less;

C.head = (ctx, args) => {
  args = args.map(a => /^-\d+$/.test(a) ? '-n' + a.slice(1) : a); // -5 -> -n5
  const { values, pos } = splitFlags(args, { n: true });
  const n = values.n !== undefined ? parseInt(values.n, 10) : 10;
  try {
    const content = readInput(ctx, pos, 'head');
    const ls = lines(content).slice(0, n);
    if (ls.length) ctx.out(ls.join('\n') + '\n');
  } catch (e) {
    ctx.err(`head: cannot open '${pos[0]}' for reading: ${e.short}\n`);
    return 1;
  }
};

C.tail = (ctx, args) => {
  args = args.map(a => /^-\d+$/.test(a) ? '-n' + a.slice(1) : a); // -5 -> -n5
  const { flags, values, pos } = splitFlags(args, { n: true });
  const n = values.n !== undefined ? parseInt(values.n, 10) : 10;
  try {
    const content = readInput(ctx, pos, 'tail');
    const ls = lines(content).slice(-n);
    if (ls.length) ctx.out(ls.join('\n') + '\n');
    if (flags.has('f')) ctx.out('tail: -f is simulated as a single read here (Ctrl+C on real Linux to stop following)\n');
  } catch (e) {
    ctx.err(`tail: cannot open '${pos[0]}' for reading: ${e.short}\n`);
    return 1;
  }
};

C.file = (ctx, args) => {
  const { pos } = splitFlags(args);
  for (const p of pos) {
    const n = ctx.vfs.statOrNull(p, ctx.shell.cwd, ctx.user);
    if (!n) { ctx.err(`file: ${p}: No such file or directory\n`); continue; }
    if (n.type === 'dir') ctx.out(`${p}: directory\n`);
    else if (n.content.startsWith('#!')) ctx.out(`${p}: script text executable\n`);
    else if (/^[\x20-\x7e\s]*$/.test(n.content.slice(0, 200))) ctx.out(`${p}: ASCII text\n`);
    else ctx.out(`${p}: data\n`);
  }
};

C.wc = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  const report = (content, label) => {
    const l = (content.match(/\n/g) || []).length;
    const w = content.split(/\s+/).filter(Boolean).length;
    const c = content.length;
    let out = '';
    const want = flags.size === 0 ? ['l', 'w', 'c'] : ['l', 'w', 'c'].filter(f => flags.has(f));
    const vals = { l, w, c };
    out = want.map(f => String(vals[f]).padStart(want.length > 1 ? 7 : 0)).join('');
    ctx.out(`${out}${label ? ' ' + label : ''}\n`);
  };
  if (!pos.length) { report(ctx.stdin || '', ''); return 0; }
  let code = 0;
  for (const p of pos) {
    try { report(ctx.vfs.readFile(p, ctx.shell.cwd, ctx.user), p); }
    catch (e) { ctx.err(`wc: ${p}: ${e.short}\n`); code = 1; }
  }
  return code;
};

// ---------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------

C.echo = (ctx, args) => {
  let newline = true;
  let interpret = false;
  while (args[0] === '-n' || args[0] === '-e') {
    if (args[0] === '-n') newline = false;
    if (args[0] === '-e') interpret = true;
    args = args.slice(1);
  }
  let s = args.join(' ');
  if (interpret) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  ctx.out(s + (newline ? '\n' : ''));
};

C.printf = (ctx, args) => {
  if (!args.length) { ctx.err('printf: usage: printf FORMAT [ARGUMENTS]\n'); return 1; }
  const fmt = args[0].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const rest = args.slice(1);
  const specs = (fmt.match(/%[sd]/g) || []).length;
  let out = '';
  let i = 0;
  // printf reuses the format string until all arguments are consumed
  do {
    out += fmt.replace(/%[sd]/g, () => rest[i++] !== undefined ? rest[i - 1] : '');
  } while (specs > 0 && i < rest.length);
  ctx.out(out);
};

C.sort = (ctx, args) => {
  const { flags, values, pos } = splitFlags(args, { k: true, t: true });
  let content;
  try { content = readInput(ctx, pos, 'sort'); }
  catch (e) { ctx.err(`sort: cannot read: ${pos[0]}: ${e.short}\n`); return 2; }
  let ls = lines(content);
  const keyIdx = values.k ? parseInt(values.k, 10) - 1 : null;
  const sep = values.t || /\s+/;
  const keyOf = (l) => keyIdx === null ? l : (l.split(sep)[keyIdx] || '');
  ls.sort((a, b) => {
    const ka = keyOf(a), kb = keyOf(b);
    if (flags.has('n')) return (parseFloat(ka) || 0) - (parseFloat(kb) || 0);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (flags.has('r')) ls.reverse();
  if (flags.has('u')) ls = ls.filter((l, i) => i === 0 || l !== ls[i - 1]);
  if (ls.length) ctx.out(ls.join('\n') + '\n');
};

C.uniq = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  let content;
  try { content = readInput(ctx, pos, 'uniq'); }
  catch (e) { ctx.err(`uniq: ${pos[0]}: ${e.short}\n`); return 1; }
  const ls = lines(content);
  const out = [];
  let prev = null, count = 0;
  const flush = () => {
    if (prev === null) return;
    if (flags.has('d') && count < 2) return;
    out.push(flags.has('c') ? `${String(count).padStart(7)} ${prev}` : prev);
  };
  for (const l of ls) {
    if (l === prev) count++;
    else { flush(); prev = l; count = 1; }
  }
  flush();
  if (out.length) ctx.out(out.join('\n') + '\n');
};

C.cut = (ctx, args) => {
  const { values, pos } = splitFlags(args, { d: true, f: true, c: true });
  let content;
  try { content = readInput(ctx, pos, 'cut'); }
  catch (e) { ctx.err(`cut: ${pos[0]}: ${e.short}\n`); return 1; }
  const ls = lines(content);
  if (values.f) {
    const delim = values.d || '\t';
    const fields = values.f.split(',').map(x => parseInt(x, 10) - 1);
    for (const l of ls) {
      const parts = l.split(delim);
      ctx.out(fields.map(f => parts[f] || '').join(delim) + '\n');
    }
  } else if (values.c) {
    const [a, b] = values.c.split('-').map(x => parseInt(x, 10));
    for (const l of ls) ctx.out(l.slice(a - 1, b || a) + '\n');
  } else {
    ctx.err('cut: you must specify a list of bytes, characters, or fields\n');
    return 1;
  }
};

C.tr = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  const expand = (s) => {
    s = s.replace(/a-z/g, 'abcdefghijklmnopqrstuvwxyz')
         .replace(/A-Z/g, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
         .replace(/0-9/g, '0123456789');
    return s;
  };
  const input = ctx.stdin || '';
  if (flags.has('d')) {
    const del = new Set(expand(pos[0] || ''));
    ctx.out([...input].filter(c => !del.has(c)).join(''));
    return 0;
  }
  const from = expand(pos[0] || ''), to = expand(pos[1] || '');
  ctx.out([...input].map(c => {
    const i = from.indexOf(c);
    return i === -1 ? c : (to[i] || to[to.length - 1] || c);
  }).join(''));
};

C.grep = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (!pos.length) { ctx.err('usage: grep [-ivcnrlE] PATTERN [FILE...]\n'); return 2; }
  const pattern = pos[0];
  const files = pos.slice(1);
  let re;
  try {
    re = new RegExp(flags.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, flags.has('i') ? 'i' : '');
  } catch (e) {
    ctx.err(`grep: invalid pattern: ${pattern}\n`);
    return 2;
  }
  let matchedAny = false;
  const searchText = (text, label, showLabel) => {
    const ls = lines(text);
    let count = 0;
    const hits = [];
    ls.forEach((l, i) => {
      let m = re.test(l);
      if (flags.has('v')) m = !m;
      if (m) {
        count++;
        hits.push(flags.has('n') ? `${i + 1}:${l}` : l);
      }
    });
    if (count) matchedAny = true;
    if (flags.has('l')) { if (count) ctx.out(label + '\n'); return; }
    if (flags.has('c')) { ctx.out((showLabel ? label + ':' : '') + count + '\n'); return; }
    for (const h of hits) {
      let line = h;
      if (!flags.has('v')) line = line.replace(re.global ? re : new RegExp(re.source, re.flags + 'g'), s => `\x1b[1;31m${s}\x1b[0m`);
      ctx.out((showLabel ? `\x1b[35m${label}\x1b[0m:` : '') + line + '\n');
    }
  };
  if (flags.has('r') || flags.has('R')) {
    const start = files[0] || '.';
    let found = false;
    try {
      ctx.vfs.walk(start, ctx.shell.cwd, ctx.user, (abs, name, node) => {
        if (node.type === 'file' && ctx.vfs.canRead(node, ctx.user)) {
          searchText(node.content, abs, true);
        }
      });
      found = true;
    } catch (e) {
      ctx.err(`grep: ${start}: ${e.short}\n`);
      return 2;
    }
    return matchedAny ? 0 : 1;
  }
  if (!files.length) {
    searchText(ctx.stdin || '', '(standard input)', false);
    return matchedAny ? 0 : 1;
  }
  let code = matchedAny ? 0 : 1;
  for (const f of files) {
    try {
      const node = ctx.vfs.lookup(f, ctx.shell.cwd, ctx.user).node;
      if (node.type === 'dir') { ctx.err(`grep: ${f}: Is a directory\n`); code = 2; continue; }
      searchText(ctx.vfs.readFile(f, ctx.shell.cwd, ctx.user), f, files.length > 1);
    } catch (e) {
      ctx.err(`grep: ${f}: ${e.short}\n`);
      code = 2;
    }
  }
  return matchedAny ? 0 : (code === 2 ? 2 : 1);
};

C.find = (ctx, args) => {
  // find [path...] [-name pat] [-iname pat] [-type f|d] [-size +N[kM]] [-mtime +N|-N] [-delete] [-empty]
  const paths = [];
  let i = 0;
  while (i < args.length && !args[i].startsWith('-')) paths.push(args[i++]);
  if (!paths.length) paths.push('.');
  const preds = [];
  let doDelete = false;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-name' || a === '-iname') {
      const pat = args[++i];
      const { VFS } = require('./vfs');
      const re = VFS.globToRegExp(pat);
      const ci = a === '-iname';
      preds.push((abs, name) => ci ? new RegExp(re.source, 'i').test(name) : re.test(name));
    } else if (a === '-type') {
      const t = args[++i];
      preds.push((abs, name, node) => (t === 'f' ? node.type === 'file' : t === 'd' ? node.type === 'dir' : true));
    } else if (a === '-size') {
      const spec = args[++i];
      const m = /^([+-]?)(\d+)([ckM]?)$/.exec(spec);
      if (!m) { ctx.err(`find: invalid -size argument '${spec}'\n`); return 1; }
      const mult = m[3] === 'M' ? 1024 * 1024 : m[3] === 'k' ? 1024 : m[3] === 'c' ? 1 : 512;
      const bytes = parseInt(m[2], 10) * mult;
      preds.push((abs, name, node) => {
        const s = ctx.vfs.sizeOf(node);
        return m[1] === '+' ? s > bytes : m[1] === '-' ? s < bytes : Math.ceil(s / mult) === parseInt(m[2], 10);
      });
    } else if (a === '-mtime') {
      const spec = args[++i];
      const m = /^([+-]?)(\d+)$/.exec(spec);
      if (!m) { ctx.err(`find: invalid -mtime argument '${spec}'\n`); return 1; }
      const days = parseInt(m[2], 10);
      const DAY = 86400000;
      preds.push((abs, name, node) => {
        const age = (ctx.game ? ctx.game.now() : Date.now()) - node.mtime;
        const d = age / DAY;
        return m[1] === '+' ? d > days : m[1] === '-' ? d < days : Math.floor(d) === days;
      });
    } else if (a === '-empty') {
      preds.push((abs, name, node) => (node.type === 'file' ? node.content.length === 0 : Object.keys(node.children).length === 0));
    } else if (a === '-delete') {
      doDelete = true;
    } else {
      ctx.err(`find: unknown predicate '${a}'\n`);
      return 1;
    }
  }
  let code = 0;
  for (const p of paths) {
    const matches = [];
    try {
      ctx.vfs.walk(p, ctx.shell.cwd, ctx.user, (abs, name, node) => {
        if (preds.every(fn => fn(abs, name, node))) matches.push({ abs, node });
      });
    } catch (e) {
      ctx.err(`find: '${p}': ${e.short}\n`);
      code = 1;
      continue;
    }
    const startAbs = ctx.vfs.normalize(p, ctx.shell.cwd);
    for (const m of matches) {
      // print paths relative to the argument, like real find
      let disp = m.abs;
      if (!p.startsWith('/')) {
        const cwdAbs = ctx.vfs.normalize(ctx.shell.cwd, '/');
        if (m.abs === startAbs) disp = p;
        else if (m.abs.startsWith(startAbs === '/' ? '/' : startAbs + '/')) {
          disp = (p === '.' ? '.' : p.replace(/\/$/, '')) + m.abs.slice(startAbs.length);
        }
      }
      if (doDelete) {
        try {
          ctx.vfs.unlink(m.abs, '/', ctx.user, true);
          if (ctx.game) ctx.game.onFileRemoved(m.abs);
        } catch (e) { ctx.err(`find: cannot delete '${disp}': ${e.short}\n`); code = 1; }
      } else {
        ctx.out(disp + '\n');
      }
    }
  }
  return code;
};

// ---------------------------------------------------------------------------
// disk usage
// ---------------------------------------------------------------------------

C.du = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  const targets = pos.length ? pos : ['.'];
  const fmt = (kb) => flags.has('h') ? human(kb * 1024) : String(kb);
  for (const t of targets) {
    try {
      const r = ctx.vfs.lookup(t, ctx.shell.cwd, ctx.user);
      if (flags.has('s') || r.node.type !== 'dir') {
        ctx.out(`${fmt(Math.ceil(ctx.vfs.sizeOf(r.node) / 1024))}\t${t}\n`);
      } else {
        const rows = [];
        const walk = (node, path) => {
          let total = 4;
          for (const [name, child] of Object.entries(node.children).sort((a, b) => a[0].localeCompare(b[0]))) {
            if (child.type === 'dir') total += walk(child, path + '/' + name);
            else total += Math.ceil(ctx.vfs.sizeOf(child) / 1024);
          }
          rows.push(`${fmt(total)}\t${path}`);
          return total;
        };
        walk(r.node, t.replace(/\/$/, ''));
        ctx.out(rows.join('\n') + '\n');
      }
    } catch (e) {
      ctx.err(`du: cannot access '${t}': ${e.short}\n`);
      return 1;
    }
  }
};

C.df = (ctx, args) => {
  const { flags } = splitFlags(args);
  const size = ctx.vfs.capacityKB;
  const used = Math.min(size, ctx.vfs.usedKB() + (ctx.game ? ctx.game.disk.baseUsedKB : 0));
  const avail = size - used;
  const pct = Math.min(100, Math.round((used / size) * 100));
  const f = (kb) => flags.has('h') ? human(kb * 1024) : String(kb);
  ctx.out('Filesystem     1K-blocks      Used Available Use% Mounted on\n'.replace('1K-blocks', flags.has('h') ? '     Size' : '1K-blocks'));
  ctx.out(`/dev/sda1      ${f(size).padStart(9)} ${f(used).padStart(9)} ${f(avail).padStart(9)} ${String(pct).padStart(3)}% /\n`);
  ctx.out(`tmpfs          ${f(2048).padStart(9)} ${f(0).padStart(9)} ${f(2048).padStart(9)}   0% /dev/shm\n`);
  if (ctx.game) ctx.game.onDfChecked(pct);
};

// ---------------------------------------------------------------------------
// permissions
// ---------------------------------------------------------------------------

function parseSymbolicMode(spec, mode) {
  // supports [ugoa]*[+-=][rwx]+ (comma separated)
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([+\-=])([rwx]+)$/.exec(clause);
    if (!m) return null;
    const who = m[1] || 'a';
    let bits = 0;
    if (m[3].includes('r')) bits |= 4;
    if (m[3].includes('w')) bits |= 2;
    if (m[3].includes('x')) bits |= 1;
    const masks = { u: 6, g: 3, o: 0 };
    const shifts = who === 'a' ? [6, 3, 0] : [...who].map(w => masks[w]);
    for (const sh of shifts) {
      if (m[2] === '+') mode |= bits << sh;
      else if (m[2] === '-') mode &= ~(bits << sh);
      else mode = (mode & ~(7 << sh)) | (bits << sh);
    }
  }
  return mode;
}

C.chmod = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (pos.length < 2) { ctx.err('chmod: missing operand\n'); return 1; }
  const spec = pos[0];
  let code = 0;
  for (const p of pos.slice(1)) {
    try {
      const apply = (path) => {
        const node = ctx.vfs.lookup(path, ctx.shell.cwd, ctx.user).node;
        let mode;
        if (/^[0-7]{3,4}$/.test(spec)) mode = parseInt(spec.slice(-3), 8);
        else {
          mode = parseSymbolicMode(spec, node.mode);
          if (mode === null) throw new Error(`invalid mode: '${spec}'`);
        }
        ctx.vfs.chmod(path, mode, ctx.shell.cwd, ctx.user);
        if ((flags.has('R')) && node.type === 'dir') {
          for (const name of Object.keys(node.children)) apply(ctx.vfs.normalize(path + '/' + name, ctx.shell.cwd));
        }
      };
      apply(p);
      if (ctx.game) ctx.game.onChmod(ctx.vfs.normalize(p, ctx.shell.cwd));
    } catch (e) {
      ctx.err(`chmod: ${e.short ? `cannot access '${p}': ${e.short}` : e.message}\n`);
      code = 1;
    }
  }
  return code;
};

C.chown = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (pos.length < 2) { ctx.err('chown: missing operand\n'); return 1; }
  const [owner, group] = pos[0].split(':');
  let code = 0;
  for (const p of pos.slice(1)) {
    try {
      ctx.vfs.chown(p, owner || null, group || null, ctx.shell.cwd, ctx.user, flags.has('R'));
      if (ctx.game) ctx.game.onChown(ctx.vfs.normalize(p, ctx.shell.cwd));
    } catch (e) {
      ctx.err(`chown: ${e.code === 'EPERM' ? `changing ownership of '${p}': Operation not permitted` : `cannot access '${p}': ${e.short}`}\n`);
      code = 1;
    }
  }
  return code;
};

C.chgrp = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (pos.length < 2) { ctx.err('chgrp: missing operand\n'); return 1; }
  return C.chown(ctx, [flags.has('R') ? '-R' : null, ':' + pos[0], ...pos.slice(1)].filter(Boolean));
};

C.umask = (ctx) => ctx.out('0022\n');

C.su = (ctx, args) => {
  const target = args.filter(a => !a.startsWith('-'))[0] || 'root';
  if (!ctx.game) return 1;
  return ctx.game.tryBecome(ctx, target);
};

C.sudo = async (ctx, args) => {
  if (!args.length) { ctx.err('usage: sudo <command>\n'); return 1; }
  if (!ctx.game.sudoUnlocked) {
    ctx.err(`${ctx.user.name} is not in the sudoers file.  This incident will be reported.\n`);
    ctx.game.note('sudo-denied');
    return 1;
  }
  return ctx.game.runAsRoot(ctx, args);
};

C.passwd = (ctx, args) => {
  const target = args[0] || ctx.user.name;
  if (target !== ctx.user.name && ctx.user.name !== 'root') {
    ctx.err(`passwd: You may not view or modify password information for ${target}.\n`);
    return 1;
  }
  if (ctx.game) ctx.game.onPasswd(target, ctx);
  return 0;
};

// ---------------------------------------------------------------------------
// processes & jobs
// ---------------------------------------------------------------------------

C.ps = (ctx, args) => {
  const all = args.includes('aux') || args.includes('-e') || args.includes('-ef') || args.includes('ax');
  const procs = ctx.game.procs.filter(p => all || p.user === ctx.user.name);
  if (all) {
    ctx.out('USER         PID %CPU %MEM     TIME COMMAND\n');
    for (const p of procs) {
      ctx.out(`${p.user.padEnd(10)} ${String(p.pid).padStart(5)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${p.time.padStart(8)} ${p.cmd}\n`);
    }
  } else {
    ctx.out('    PID TTY          TIME CMD\n');
    for (const p of procs) {
      ctx.out(`${String(p.pid).padStart(7)} pts/0    ${p.time.padStart(8)} ${p.cmd.split(' ')[0].split('/').pop()}\n`);
    }
  }
};

C.top = (ctx) => {
  const g = ctx.game;
  const procs = [...g.procs].sort((a, b) => b.cpu - a.cpu).slice(0, 12);
  const totalCpu = g.procs.reduce((s, p) => s + p.cpu, 0);
  const load = (totalCpu / 100 * 4).toFixed(2);
  ctx.out(`top - ${g.clockString()} up ${g.uptime()},  1 user,  load average: ${load}, ${load}, ${load}\n`);
  ctx.out(`Tasks: ${g.procs.length} total,   1 running, ${g.procs.length - 1} sleeping\n`);
  ctx.out(`%Cpu(s): ${Math.min(totalCpu, 100).toFixed(1)} us,  0.7 sy,  0.0 ni, ${Math.max(0, 100 - totalCpu).toFixed(1)} id\n`);
  ctx.out(`MiB Mem :   7862.4 total,   ${(7862 - g.procs.reduce((s, p) => s + p.mem * 78, 0)).toFixed(1)} free\n\n`);
  ctx.out('    PID USER      %CPU  %MEM COMMAND\n');
  for (const p of procs) {
    const hot = p.cpu > 50;
    ctx.out(`${hot ? '\x1b[1;31m' : ''}${String(p.pid).padStart(7)} ${p.user.padEnd(9)} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)} ${p.cmd}${hot ? '\x1b[0m' : ''}\n`);
  }
  ctx.out('\n(simulated one-shot snapshot — real top refreshes live; press q there to quit)\n');
};

C.kill = (ctx, args) => {
  const { pos, values } = splitFlags(args, { s: true });
  let sig = values.s || '15';
  const sigArg = args.find(a => /^-(9|15|KILL|TERM|SIGKILL|SIGTERM|HUP|SIGHUP)$/.test(a));
  if (sigArg) sig = sigArg.slice(1);
  if (!pos.length) { ctx.err('kill: usage: kill [-9] pid...\n'); return 1; }
  let code = 0;
  for (const pidStr of pos) {
    const pid = parseInt(pidStr, 10);
    const p = ctx.game.procs.find(x => x.pid === pid);
    if (!p) { ctx.err(`bash: kill: (${pidStr}) - No such process\n`); code = 1; continue; }
    if (p.user !== ctx.user.name && ctx.user.name !== 'root') {
      ctx.err(`bash: kill: (${pid}) - Operation not permitted\n`);
      code = 1; continue;
    }
    if (p.critical && !/9|KILL/.test(sig)) {
      ctx.out(`kill: process ${pid} (${p.cmd.split(' ')[0]}) ignored SIGTERM — try SIGKILL (-9)\n`);
      continue;
    }
    if (p.pid === 1) { ctx.err('bash: kill: (1) - Operation not permitted\n'); code = 1; continue; }
    ctx.game.killProc(pid, ctx);
  }
  return code;
};

C.pkill = (ctx, args) => {
  const { pos, flags } = splitFlags(args);
  if (!pos.length) { ctx.err('pkill: no matching criteria specified\n'); return 2; }
  const re = new RegExp(pos[0]);
  const victims = ctx.game.procs.filter(p => re.test(p.cmd) && p.pid !== 1);
  if (!victims.length) return 1;
  for (const v of victims) {
    if (v.user !== ctx.user.name && ctx.user.name !== 'root') continue;
    if (v.critical && !flags.has('9')) continue;
    ctx.game.killProc(v.pid, ctx);
  }
  return 0;
};

C.jobs = (ctx) => {
  ctx.game.jobs.forEach((j, i) => {
    if (!j.done) ctx.out(`[${i + 1}]${i === ctx.game.jobs.length - 1 ? '+' : '-'}  ${j.state.padEnd(22)} ${j.cmd}${j.state === 'Running' ? ' &' : ''}\n`);
  });
};

C.fg = (ctx, args) => {
  const jobs = ctx.game.jobs.filter(j => !j.done);
  if (!jobs.length) { ctx.err('bash: fg: current: no such job\n'); return 1; }
  const idx = args[0] ? parseInt(String(args[0]).replace('%', ''), 10) - 1 : ctx.game.jobs.length - 1;
  const j = ctx.game.jobs[idx];
  if (!j || j.done) { ctx.err(`bash: fg: %${idx + 1}: no such job\n`); return 1; }
  ctx.out(j.cmd + '\n');
  j.state = 'Running';
  j.done = true; // simulated: the job completes when foregrounded
  ctx.game.procs = ctx.game.procs.filter(p => p.pid !== j.pid);
  ctx.out(`(job ${j.pid} finished)\n`);
};

C.bg = (ctx, args) => {
  const idx = args[0] ? parseInt(String(args[0]).replace('%', ''), 10) - 1 : ctx.game.jobs.length - 1;
  const j = ctx.game.jobs[idx];
  if (!j || j.done) { ctx.err(`bash: bg: %${idx + 1}: no such job\n`); return 1; }
  j.state = 'Running';
  ctx.out(`[${idx + 1}]+ ${j.cmd} &\n`);
};

C.sleep = async (ctx, args) => {
  const secs = parseFloat(args[0]);
  if (isNaN(secs)) { ctx.err('sleep: missing operand\n'); return 1; }
  if (ctx.background) return 0; // stays in the job table
  await new Promise(r => setTimeout(r, Math.min(secs, 3) * 1000));
  return 0;
};

C.nice = async (ctx, args) => {
  ctx.out('nice: running at default priority in this simulation\n');
  return 0;
};

C.uptime = (ctx) => {
  const g = ctx.game;
  ctx.out(` ${g.clockString()} up ${g.uptime()},  1 user,  load average: 0.42, 0.35, 0.30\n`);
};

C.free = (ctx, args) => {
  const h = args.includes('-h');
  ctx.out('               total        used        free      shared  buff/cache   available\n');
  ctx.out(h
    ? 'Mem:           7.7Gi       2.1Gi       4.2Gi       112Mi       1.4Gi       5.3Gi\n'
    : 'Mem:         8050944     2202009     4404019      114688     1444916     5556019\n');
};

// ---------------------------------------------------------------------------
// networking (simulated)
// ---------------------------------------------------------------------------

function resolveHost(game, name) {
  const net = game.network;
  if (net.hosts[name]) return { host: net.hosts[name], addr: net.hosts[name].ip, name };
  for (const [n, h] of Object.entries(net.hosts)) {
    if (h.ip === name) return { host: h, addr: h.ip, name: n };
  }
  return null;
}

C.ping = async (ctx, args) => {
  const { values, pos } = splitFlags(args, { c: true });
  const count = values.c ? Math.min(parseInt(values.c, 10), 6) : 4;
  if (!pos.length) { ctx.err('ping: usage error: Destination address required\n'); return 1; }
  const target = pos[0];
  const r = resolveHost(ctx.game, target);
  if (!r) {
    ctx.err(`ping: ${target}: Name or service not known\n`);
    return 2;
  }
  ctx.out(`PING ${target} (${r.addr}) 56(84) bytes of data.\n`);
  let received = 0;
  for (let i = 1; i <= count; i++) {
    await new Promise(res => setTimeout(res, 220));
    if (r.host.up) {
      received++;
      ctx.out(`64 bytes from ${r.addr}: icmp_seq=${i} ttl=64 time=${(0.3 + Math.random() * 2).toFixed(2)} ms\n`);
    }
  }
  if (!r.host.up) ctx.out(`\n--- ${target} ping statistics ---\n${count} packets transmitted, 0 received, 100% packet loss, time ${count * 1000}ms\n`);
  else ctx.out(`\n--- ${target} ping statistics ---\n${count} packets transmitted, ${received} received, 0% packet loss, time ${count * 1000}ms\n`);
  if (ctx.game) ctx.game.onPing(target, r.host.up);
  return r.host.up ? 0 : 1;
};

C.ip = (ctx, args) => {
  const sub = args[0];
  if (sub === 'addr' || sub === 'a' || sub === 'address') {
    const net = ctx.game.network;
    ctx.out('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN\n    inet 127.0.0.1/8 scope host lo\n');
    ctx.out(`2: eth0: <BROADCAST,MULTICAST${net.eth0.up ? ',UP,LOWER_UP' : ''}> mtu 1500 state ${net.eth0.up ? 'UP' : 'DOWN'}\n`);
    if (net.eth0.ip) ctx.out(`    inet ${net.eth0.ip}/24 brd 10.13.37.255 scope global eth0\n`);
    else ctx.out('    (no address assigned)\n');
    return 0;
  }
  if (sub === 'link' && args[1] === 'set' && args[2] === 'eth0' && (args[3] === 'up' || args[3] === 'down')) {
    if (ctx.user.name !== 'root') { ctx.err('ip: RTNETLINK answers: Operation not permitted\n'); return 2; }
    ctx.game.network.eth0.up = args[3] === 'up';
    ctx.game.onIfaceChange();
    return 0;
  }
  ctx.err('Usage: ip addr | ip link set eth0 up|down\n');
  return 255;
};

C.ifconfig = (ctx, args) => {
  const net = ctx.game.network;
  if (args[0] === 'eth0' && (args[1] === 'up' || args[1] === 'down')) {
    if (ctx.user.name !== 'root') { ctx.err('ifconfig: SIOCSIFFLAGS: Operation not permitted\n'); return 1; }
    net.eth0.up = args[1] === 'up';
    ctx.game.onIfaceChange();
    return 0;
  }
  ctx.out(`eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n`);
  ctx.out(net.eth0.ip ? `        inet ${net.eth0.ip}  netmask 255.255.255.0  broadcast 10.13.37.255\n` : '        (no address assigned)\n');
  ctx.out(`        status: ${net.eth0.up ? 'active' : 'DOWN'}\n\n`);
  ctx.out('lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n');
};

C.netstat = (ctx, args) => {
  const conns = ctx.game.network.connections;
  ctx.out('Active Internet connections (servers and established)\n');
  ctx.out('Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\n');
  for (const c of conns) {
    ctx.out(`tcp        0      0 ${c.local.padEnd(23)} ${c.remote.padEnd(23)} ${c.state.padEnd(11)} ${c.pid ? c.pid + '/' + c.prog : '-'}\n`);
  }
};
C.ss = C.netstat;

C.curl = async (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (!pos.length) { ctx.err('curl: try \'curl --help\' for more information\n'); return 2; }
  let url = pos[0];
  const m = /^(?:(https?):\/\/)?([^\/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) { ctx.err(`curl: (3) URL rejected: ${url}\n`); return 3; }
  const [, proto, hostName, portStr, path] = m;
  const port = portStr ? parseInt(portStr, 10) : (proto === 'https' ? 443 : 80);
  const r = resolveHost(ctx.game, hostName);
  await new Promise(res => setTimeout(res, 250));
  if (!r) { ctx.err(`curl: (6) Could not resolve host: ${hostName}\n`); return 6; }
  if (!r.host.up) { ctx.err(`curl: (28) Failed to connect to ${hostName} port ${port}: Connection timed out\n`); return 28; }
  const svc = r.host.ports && r.host.ports[port];
  if (!svc || !svc.responding) { ctx.err(`curl: (7) Failed to connect to ${hostName} port ${port}: Connection refused\n`); return 7; }
  const body = typeof svc.body === 'function' ? svc.body(path || '/') : svc.body;
  if (flags.has('I')) {
    ctx.out(`HTTP/1.1 200 OK\nServer: omnihttpd/2.4\nContent-Type: text/plain\nContent-Length: ${body.length}\n\n`);
  } else {
    ctx.out(body + (body.endsWith('\n') ? '' : '\n'));
  }
  if (ctx.game) ctx.game.onCurl(hostName, port, path || '/');
  return 0;
};
C.wget = async (ctx, args) => {
  ctx.out('wget: this simulation uses curl for HTTP — try: curl <url>\n');
  return 1;
};

C.ssh = async (ctx, args) => {
  const { pos } = splitFlags(args, { i: true, p: true });
  if (!pos.length) { ctx.err('usage: ssh [user@]host [command]\n'); return 255; }
  let [userHost, ...cmdParts] = pos;
  let [ruser, host] = userHost.includes('@') ? userHost.split('@') : [ctx.user.name, userHost];
  const r = resolveHost(ctx.game, host);
  await new Promise(res => setTimeout(res, 300));
  if (!r) { ctx.err(`ssh: Could not resolve hostname ${host}: Name or service not known\n`); return 255; }
  if (!r.host.up || !r.host.ports || !r.host.ports[22]) {
    ctx.err(`ssh: connect to host ${host} port 22: Connection refused\n`);
    return 255;
  }
  const keyOk = ctx.game.sshKeyAuthorized(r.name, ruser);
  if (!keyOk) {
    ctx.err(`${ruser}@${host}: Permission denied (publickey).\n`);
    ctx.out('hint: this host only accepts key authentication. Generate a key with ssh-keygen,\nthen install it with: ssh-copy-id ' + ruser + '@' + host + '\n');
    return 255;
  }
  const remote = r.host;
  if (!cmdParts.length) {
    ctx.out(`Welcome to ${r.name} (OmniCorp remote node)\n`);
    ctx.out(remote.motd || '');
    ctx.out(`\n(Interactive remote sessions are simplified here: run single commands like\n  ssh ${ruser}@${host} ls /\n  ssh ${ruser}@${host} cat /path/to/file\nConnection to ${host} closed.)\n`);
    return 0;
  }
  const cmd = cmdParts.join(' ');
  const out = ctx.game.remoteExec(r.name, ruser, cmd);
  if (out.err) { ctx.err(out.err + '\n'); return 1; }
  if (out.text) ctx.out(out.text + (out.text.endsWith('\n') ? '' : '\n'));
  if (ctx.game) ctx.game.onSsh(r.name, ruser, cmd);
  return 0;
};

C['ssh-keygen'] = (ctx, args) => {
  const home = ctx.env.HOME;
  const vfs = ctx.vfs;
  vfs.mkdirp(home + '/.ssh', '/', ctx.user.name, ctx.user.name, 0o700);
  const priv = home + '/.ssh/id_ed25519';
  if (vfs.exists(priv, '/', ctx.user)) {
    ctx.out(`${priv} already exists.\nOverwrite (y/n)? n  (keeping the existing key)\n`);
    return 0;
  }
  ctx.out('Generating public/private ed25519 key pair.\n');
  ctx.out(`Enter file in which to save the key (${priv}): \nEnter passphrase (empty for no passphrase): \nEnter same passphrase again: \n`);
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  vfs.put(priv, `-----BEGIN OPENSSH PRIVATE KEY-----\nTQSIM${rand}...\n-----END OPENSSH PRIVATE KEY-----\n`, { owner: ctx.user.name, mode: 0o600 });
  vfs.put(priv + '.pub', `ssh-ed25519 AAAATQSIM${rand} ${ctx.user.name}@omnicorp\n`, { owner: ctx.user.name, mode: 0o644 });
  ctx.out(`Your identification has been saved in ${priv}\nYour public key has been saved in ${priv}.pub\n`);
  ctx.out(`The key fingerprint is:\nSHA256:${rand}${rand.split('').reverse().join('')} ${ctx.user.name}@omnicorp\n`);
  if (ctx.game) ctx.game.onSshKeygen();
  return 0;
};

C['ssh-copy-id'] = (ctx, args) => {
  const target = args.filter(a => !a.startsWith('-'))[0];
  if (!target) { ctx.err('usage: ssh-copy-id [user@]host\n'); return 1; }
  let [ruser, host] = target.includes('@') ? target.split('@') : [ctx.user.name, target];
  const r = resolveHost(ctx.game, host);
  if (!r) { ctx.err(`ssh-copy-id: Could not resolve hostname ${host}\n`); return 1; }
  const pub = ctx.vfs.statOrNull(ctx.env.HOME + '/.ssh/id_ed25519.pub', '/', ctx.user);
  if (!pub) {
    ctx.err('ssh-copy-id: ERROR: No identities found — run ssh-keygen first\n');
    return 1;
  }
  ctx.game.authorizeKey(r.name, ruser);
  ctx.out(`Number of key(s) added: 1\n\nNow try logging into the machine with:   "ssh ${ruser}@${host}"\n`);
  return 0;
};

C.scp = async (ctx, args) => {
  const { pos } = splitFlags(args, { i: true });
  if (pos.length < 2) { ctx.err('usage: scp [user@]host:path dest  |  scp src [user@]host:path\n'); return 1; }
  const [src, dst] = pos;
  const parseRemote = (s) => {
    const m = /^(?:([^@:]+)@)?([^:]+):(.*)$/.exec(s);
    return m ? { user: m[1] || ctx.user.name, host: m[2], path: m[3] || '.' } : null;
  };
  const rsrc = parseRemote(src);
  const rdst = parseRemote(dst);
  await new Promise(res => setTimeout(res, 350));
  if (rsrc) {
    const r = resolveHost(ctx.game, rsrc.host);
    if (!r) { ctx.err(`ssh: Could not resolve hostname ${rsrc.host}\n`); return 1; }
    if (!ctx.game.sshKeyAuthorized(r.name, rsrc.user)) { ctx.err(`${rsrc.user}@${rsrc.host}: Permission denied (publickey).\n`); return 1; }
    const content = ctx.game.remoteRead(r.name, rsrc.path);
    if (content === null) { ctx.err(`scp: ${rsrc.path}: No such file or directory\n`); return 1; }
    const base = rsrc.path.split('/').pop();
    let target = dst;
    const dnode = ctx.vfs.statOrNull(dst, ctx.shell.cwd, ctx.user);
    if (dnode && dnode.type === 'dir') target = ctx.vfs.normalize(dst + '/' + base, ctx.shell.cwd);
    ctx.vfs.writeFile(target, content, ctx.shell.cwd, ctx.user, false);
    ctx.out(`${base.padEnd(28)} 100% ${String(content.length).padStart(6)}   ${(content.length / 102.4).toFixed(1)}KB/s   00:00\n`);
    if (ctx.game) ctx.game.onScp(r.name, rsrc.path, 'download');
    return 0;
  }
  if (rdst) {
    const r = resolveHost(ctx.game, rdst.host);
    if (!r) { ctx.err(`ssh: Could not resolve hostname ${rdst.host}\n`); return 1; }
    if (!ctx.game.sshKeyAuthorized(r.name, rdst.user)) { ctx.err(`${rdst.user}@${rdst.host}: Permission denied (publickey).\n`); return 1; }
    const content = ctx.vfs.readFile(src, ctx.shell.cwd, ctx.user);
    ctx.game.remoteWrite(r.name, rdst.path === '.' || rdst.path === '' ? '/home/' + rdst.user + '/' + src.split('/').pop() : rdst.path, content);
    ctx.out(`${src.split('/').pop().padEnd(28)} 100% ${String(content.length).padStart(6)}   ${(content.length / 102.4).toFixed(1)}KB/s   00:00\n`);
    if (ctx.game) ctx.game.onScp(r.name, rdst.path, 'upload');
    return 0;
  }
  ctx.err('scp: at least one side must be remote (host:path)\n');
  return 1;
};

C.who = (ctx) => {
  for (const s of ctx.game.sessions) {
    ctx.out(`${s.user.padEnd(10)} ${s.tty.padEnd(8)} ${s.time}${s.from ? ` (${s.from})` : ''}\n`);
  }
};

C.w = C.who;

C.last = (ctx) => {
  for (const l of ctx.game.lastLog) {
    ctx.out(`${l.user.padEnd(10)} ${l.tty.padEnd(8)} ${(l.from || '').padEnd(18)} ${l.time}\n`);
  }
  ctx.out('\nwtmp begins Mon Jan  5 00:00:01 2026\n');
};

// ---------------------------------------------------------------------------
// scheduling
// ---------------------------------------------------------------------------

C.crontab = (ctx, args) => {
  const g = ctx.game;
  const { flags, pos, values } = splitFlags(args, { u: true });
  const user = values.u || ctx.user.name;
  if (values.u && ctx.user.name !== 'root') { ctx.err('crontab: must be privileged to use -u\n'); return 1; }
  if (flags.has('l')) {
    const tab = g.crontabs[user];
    if (!tab || !tab.length) { ctx.err(`no crontab for ${user}\n`); return 1; }
    ctx.out(tab.join('\n') + '\n');
    if (g) g.onCrontabList(user);
    return 0;
  }
  if (flags.has('r')) {
    delete g.crontabs[user];
    g.onCrontabChange(user);
    return 0;
  }
  if (flags.has('e')) {
    ctx.err("crontab: interactive editing isn't available in this simulation.\nWrite your schedule to a file and install it with:  crontab <file>\n");
    return 1;
  }
  if (pos.length) {
    let content;
    try { content = ctx.vfs.readFile(pos[0], ctx.shell.cwd, ctx.user); }
    catch (e) { ctx.err(`crontab: ${pos[0]}: ${e.short}\n`); return 1; }
    const entries = lines(content).filter(l => l.trim() && !l.trim().startsWith('#'));
    for (const l of entries) {
      const fields = l.trim().split(/\s+/);
      if (fields.length < 6) {
        ctx.err(`"${pos[0]}":${entries.indexOf(l) + 1}: bad minute; crontab lines need 5 time fields + a command\nerrors in crontab file, can't install.\n`);
        return 1;
      }
    }
    g.crontabs[user] = entries;
    g.onCrontabChange(user);
    ctx.out(`crontab: installing new crontab\n`);
    return 0;
  }
  ctx.err('usage: crontab [-u user] file | crontab -l | crontab -r\n');
  return 1;
};

C.at = (ctx, args) => {
  if (!args.length) { ctx.err('at: you must specify a time (e.g. at 02:00)\n'); return 1; }
  const time = args.join(' ');
  const cmd = ctx.stdin ? ctx.stdin.trim() : null;
  if (!cmd) {
    ctx.err('at: interactive mode is simulated — pipe the command in:\n  echo "/opt/scripts/clean.sh" | at 02:00\n');
    return 1;
  }
  ctx.game.atJobs.push({ time, cmd });
  ctx.out(`job ${ctx.game.atJobs.length} at ${time}\n`);
  ctx.game.onAtJob(time, cmd);
  return 0;
};

C.atq = (ctx) => {
  ctx.game.atJobs.forEach((j, i) => ctx.out(`${i + 1}\t${j.time}\t${ctx.user.name}\t${j.cmd}\n`));
};

C.date = (ctx, args) => {
  ctx.out(ctx.game ? ctx.game.dateString() + '\n' : new Date().toString() + '\n');
};

// ---------------------------------------------------------------------------
// text surgery: sed & awk (documented subsets)
// ---------------------------------------------------------------------------

C.sed = (ctx, args) => {
  const { flags, pos, values } = splitFlags(args, { e: true });
  let script = values.e !== undefined ? values.e : pos.shift();
  if (script === undefined) { ctx.err('usage: sed [-n] [-i] \'script\' [file]\n'); return 1; }
  let content;
  const target = pos[0];
  try { content = readInput(ctx, target ? [target] : [], 'sed'); }
  catch (e) { ctx.err(`sed: can't read ${target}: ${e.short}\n`); return 2; }
  const ls = lines(content);
  const out = [];
  // parse commands separated by ';'
  const cmds = [];
  for (const raw of script.split(';')) {
    const c = raw.trim();
    if (!c) continue;
    let m;
    if ((m = /^s(.)(.*?)\1(.*?)\1([gip]*)$/.exec(c))) {
      cmds.push({ type: 's', re: m[2], rep: m[3], flags: m[4] });
    } else if ((m = /^\/(.*)\/d$/.exec(c))) {
      cmds.push({ type: 'd', re: m[1] });
    } else if ((m = /^(\d+)d$/.exec(c))) {
      cmds.push({ type: 'dn', n: parseInt(m[1], 10) });
    } else if ((m = /^\/(.*)\/p$/.exec(c))) {
      cmds.push({ type: 'p', re: m[1] });
    } else if ((m = /^(\d+)(,(\d+))?p$/.exec(c))) {
      cmds.push({ type: 'pn', a: parseInt(m[1], 10), b: m[3] ? parseInt(m[3], 10) : parseInt(m[1], 10) });
    } else {
      ctx.err(`sed: -e expression #1, char 1: unknown command: \`${c[0]}'\n(this simulation supports: s/re/rep/[g], /re/d, Nd, /re/p, N[,M]p)\n`);
      return 1;
    }
  }
  ls.forEach((line, idx) => {
    let cur = line;
    let deleted = false;
    let printed = false;
    for (const c of cmds) {
      if (c.type === 's') {
        try {
          const re = new RegExp(c.re, (c.flags.includes('g') ? 'g' : '') + (c.flags.includes('i') ? 'i' : ''));
          cur = cur.replace(re, c.rep.replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&'));
          if (c.flags.includes('p') && re.test(line)) printed = true;
        } catch (e) { /* bad regex */ }
      } else if (c.type === 'd' && new RegExp(c.re).test(cur)) deleted = true;
      else if (c.type === 'dn' && idx + 1 === c.n) deleted = true;
      else if (c.type === 'p' && new RegExp(c.re).test(cur)) printed = true;
      else if (c.type === 'pn' && idx + 1 >= c.a && idx + 1 <= c.b) printed = true;
    }
    if (deleted) return;
    if (flags.has('n')) { if (printed) out.push(cur); }
    else { out.push(cur); if (printed) out.push(cur); }
  });
  const result = out.length ? out.join('\n') + '\n' : '';
  if (flags.has('i') && target) {
    ctx.vfs.writeFile(target, result, ctx.shell.cwd, ctx.user, false);
  } else {
    ctx.out(result);
  }
  if (ctx.game) ctx.game.onSed(target);
};

C.awk = (ctx, args) => {
  const { values, pos } = splitFlags(args, { F: true });
  const prog = pos.shift();
  if (prog === undefined) { ctx.err("usage: awk [-F sep] 'program' [file]\n"); return 2; }
  let content;
  try { content = readInput(ctx, pos, 'awk'); }
  catch (e) { ctx.err(`awk: can't open file ${pos[0]}\n`); return 2; }
  const sep = values.F !== undefined ? values.F : null;
  // supported: [/pattern/|COND] { print ... } — multiple ;-separated prints, $N, NF, NR, literals
  const m = /^\s*(?:\/(.*?)\/\s*)?(?:\{(.*)\})?\s*$/.exec(prog);
  if (!m || (!m[1] && !m[2])) {
    ctx.err("awk: syntax not supported by this simulation.\nSupported: awk [-F,] '/pattern/ {print $1, $2}'  with $N, NF, NR\n");
    return 2;
  }
  const pattern = m[1] ? new RegExp(m[1]) : null;
  const action = m[2] ? m[2].trim() : 'print $0';
  const ls = lines(content);
  ls.forEach((line, i) => {
    if (pattern && !pattern.test(line)) return;
    const fields = sep !== null ? line.split(sep) : line.trim().split(/\s+/);
    const evalExpr = (expr) => {
      expr = expr.trim();
      if (/^".*"$/.test(expr)) return expr.slice(1, -1);
      if (expr === 'NR') return String(i + 1);
      if (expr === 'NF') return String(fields.length);
      const fm = /^\$(\d+)$/.exec(expr);
      if (fm) {
        const n = parseInt(fm[1], 10);
        return n === 0 ? line : (fields[n - 1] !== undefined ? fields[n - 1] : '');
      }
      return expr;
    };
    for (const stmt of action.split(';')) {
      const s = stmt.trim();
      if (!s) continue;
      const pm = /^print(?:\s+(.*))?$/.exec(s);
      if (pm) {
        if (!pm[1]) { ctx.out(line + '\n'); continue; }
        const parts = pm[1].split(',').map(evalExpr);
        ctx.out(parts.join(' ') + '\n');
      }
    }
  });
  if (ctx.game) ctx.game.onAwk();
};

// ---------------------------------------------------------------------------
// scripting
// ---------------------------------------------------------------------------

C.bash = async (ctx, args) => {
  const { pos, values } = splitFlags(args, { c: true });
  if (values.c) return runScript(ctx, values.c, 'bash', []);
  if (!pos.length) { ctx.err('bash: interactive subshells are not needed here — you are already in one!\n'); return 1; }
  let content;
  try { content = ctx.vfs.readFile(pos[0], ctx.shell.cwd, ctx.user); }
  catch (e) { ctx.err(`bash: ${pos[0]}: ${e.short}\n`); return 127; }
  return runScript(ctx, content, pos[0], pos.slice(1));
};
C.sh = C.bash;
C.source = C.bash;
C['.'] = C.bash;

C.test = (ctx, args) => evalTest(ctx, args);
C['['] = (ctx, args) => {
  if (args[args.length - 1] !== ']') { ctx.err("bash: [: missing `]'\n"); return 2; }
  return evalTest(ctx, args.slice(0, -1));
};

function evalTest(ctx, a) {
  const t = (v) => (v ? 0 : 1);
  if (a.length === 0) return 1;
  if (a.length === 1) return t(a[0] !== '');
  if (a[0] === '!') return evalTest(ctx, a.slice(1)) === 0 ? 1 : 0;
  if (a.length === 2) {
    const [op, v] = a;
    const node = () => ctx.vfs.statOrNull(v, ctx.shell.cwd, ctx.user);
    switch (op) {
      case '-z': return t(v === '');
      case '-n': return t(v !== '');
      case '-e': return t(!!node());
      case '-f': return t(node() && node().type === 'file');
      case '-d': return t(node() && node().type === 'dir');
      case '-s': return t(node() && node().type === 'file' && node().content.length > 0);
      case '-x': return t(node() && ctx.vfs.canExec(node(), ctx.user));
      case '-r': return t(node() && ctx.vfs.canRead(node(), ctx.user));
      case '-w': return t(node() && ctx.vfs.canWrite(node(), ctx.user));
      default: return 2;
    }
  }
  if (a.length === 3) {
    const [x, op, y] = a;
    switch (op) {
      case '=': case '==': return t(x === y);
      case '!=': return t(x !== y);
      case '-eq': return t(parseInt(x, 10) === parseInt(y, 10));
      case '-ne': return t(parseInt(x, 10) !== parseInt(y, 10));
      case '-lt': return t(parseInt(x, 10) < parseInt(y, 10));
      case '-le': return t(parseInt(x, 10) <= parseInt(y, 10));
      case '-gt': return t(parseInt(x, 10) > parseInt(y, 10));
      case '-ge': return t(parseInt(x, 10) >= parseInt(y, 10));
      default: return 2;
    }
  }
  return 2;
}

C.seq = (ctx, args) => {
  let [a, b] = args.length === 1 ? [1, parseInt(args[0], 10)] : [parseInt(args[0], 10), parseInt(args[1], 10)];
  if (isNaN(a) || isNaN(b)) { ctx.err('seq: invalid argument\n'); return 1; }
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  if (out.length) ctx.out(out.join('\n') + '\n');
};

C.export = (ctx, args) => {
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq !== -1) ctx.env[a.slice(0, eq)] = a.slice(eq + 1);
  }
};

C.env = (ctx) => {
  for (const [k, v] of Object.entries(ctx.env)) ctx.out(`${k}=${v}\n`);
};
C.printenv = (ctx, args) => {
  if (args.length) { for (const a of args) ctx.out((ctx.env[a] || '') + '\n'); }
  else C.env(ctx);
};

C.unset = (ctx, args) => { for (const a of args) delete ctx.env[a]; };

C.which = (ctx, args) => {
  let code = 0;
  for (const a of args) {
    if (ctx.shell.commands[a]) ctx.out(`/usr/bin/${a}\n`);
    else code = 1;
  }
  return code;
};
C.type = (ctx, args) => {
  for (const a of args) {
    if (ctx.shell.commands[a]) ctx.out(`${a} is /usr/bin/${a}\n`);
    else { ctx.err(`bash: type: ${a}: not found\n`); return 1; }
  }
};

C.history = (ctx) => {
  const h = ctx.game ? ctx.game.history : [];
  h.forEach((cmd, i) => ctx.out(`${String(i + 1).padStart(5)}  ${cmd}\n`));
};

C.xargs = async (ctx, args) => {
  const items = (ctx.stdin || '').split(/\s+/).filter(Boolean);
  const cmd = args.length ? args : ['echo'];
  const line = [...cmd, ...items].map(w => (/[ *?$]/.test(w) ? `'${w}'` : w)).join(' ');
  return ctx.shell.exec(line, { out: ctx.out, err: ctx.err });
};

C.ln = (ctx, args) => {
  const { flags, pos } = splitFlags(args);
  if (!flags.has('s')) { ctx.err('ln: only symbolic links (-s) are supported in this simulation\n'); return 1; }
  if (pos.length < 2) { ctx.err('ln: missing file operand\n'); return 1; }
  const r = ctx.vfs.lookup(pos[1], ctx.shell.cwd, ctx.user, { parentOk: true });
  if (r.node) { ctx.err(`ln: failed to create symbolic link '${pos[1]}': File exists\n`); return 1; }
  const { S_LINK } = require('./vfs');
  const n = { ino: Date.now(), type: 'link', owner: ctx.user.name, group: ctx.user.name, mode: 0o777, mtime: Date.now(), target: ctx.vfs.normalize(pos[0], ctx.shell.cwd) };
  r.parent.children[r.name] = n;
};

C.diff = (ctx, args) => {
  const { pos } = splitFlags(args);
  if (pos.length !== 2) { ctx.err('diff: missing operand\n'); return 2; }
  try {
    const a = lines(ctx.vfs.readFile(pos[0], ctx.shell.cwd, ctx.user));
    const b = lines(ctx.vfs.readFile(pos[1], ctx.shell.cwd, ctx.user));
    let differs = false;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== b[i]) {
        differs = true;
        if (a[i] !== undefined) ctx.out(`${i + 1}c${i + 1}\n< ${a[i]}\n`);
        if (b[i] !== undefined) ctx.out(`${a[i] !== undefined ? '---\n' : ''}> ${b[i]}\n`);
      }
    }
    return differs ? 1 : 0;
  } catch (e) {
    ctx.err(`diff: ${e.message}\n`);
    return 2;
  }
};

C.tar = (ctx, args) => {
  // simplified: tar -xf archive [-C dir] / tar -tf archive / tar -cf out files
  const a = args.join(' ');
  const g = ctx.game;
  if (/x/.test(args[0] || '')) {
    const file = args.find(x => x.endsWith('.tar') || x.endsWith('.tar.gz') || x.endsWith('.tgz'));
    if (!file) { ctx.err('tar: no archive specified\n'); return 2; }
    try {
      const node = ctx.vfs.lookup(file, ctx.shell.cwd, ctx.user).node;
      const manifest = g && g.tarballs[ctx.vfs.normalize(file, ctx.shell.cwd)];
      if (!manifest) { ctx.err(`tar: ${file}: This archive is opaque in the simulation\n`); return 2; }
      for (const [path, content] of Object.entries(manifest)) {
        ctx.vfs.writeFile(path.startsWith('/') ? path : ctx.shell.cwd + '/' + path, content, ctx.shell.cwd, ctx.user, false);
        if (/v/.test(args[0])) ctx.out(path + '\n');
      }
      if (g) g.onTarExtract(ctx.vfs.normalize(file, ctx.shell.cwd));
      return 0;
    } catch (e) {
      ctx.err(`tar: ${file}: ${e.short || e.message}\n`);
      return 2;
    }
  }
  ctx.err('tar: this simulation supports extraction only: tar -xvf <archive>\n');
  return 2;
};

// ---------------------------------------------------------------------------
// documentation & game meta-commands
// ---------------------------------------------------------------------------

C.man = (ctx, args) => {
  if (!args.length) { ctx.err('What manual page do you want?\nFor example, try \'man ls\'.\n'); return 1; }
  const page = MAN_PAGES[args[args.length - 1]];
  if (!page) { ctx.err(`No manual entry for ${args[args.length - 1]}\n`); return 16; }
  ctx.out(page + '\n');
  if (ctx.game) ctx.game.onManRead(args[args.length - 1]);
  return 0;
};

C.help = (ctx) => {
  ctx.out('\x1b[1mTerminal Quest — quick help\x1b[0m\n');
  ctx.out('  man <command>   full manual for any command you have met\n');
  ctx.out('  hint            a progressively clearer clue (costs a little XP)\n');
  ctx.out('  tutorial        replay this level\'s guided walkthrough\n');
  ctx.out('  mission         re-read the current level briefing\n');
  ctx.out('  mail            read messages from your colleagues\n');
  ctx.out('  progress        XP, rank, level status and achievements\n');
  ctx.out('  skills          your mastery matrix — what you have really practised\n');
  ctx.out('  drill           a quick practice task aimed at your weakest skills\n');
  ctx.out('  exam            the unaided certification test (after you finish)\n');
  ctx.out('  resetlevel      rebuild this level if you broke something\n');
  ctx.out('  F1              toggle the Command Compendium panel\n');
  ctx.out('Solve a level by finding its flag, then run:  echo THE_FLAG > /dev/exit\n');
};

C.hint = (ctx) => ctx.game.giveHint(ctx);
C.skills = (ctx) => ctx.game.showSkills(ctx);
C.exam = (ctx, args) => {
  const sub = (args[0] || 'start').toLowerCase();
  if (sub === 'status' || sub === 'tasks') return ctx.game.showExamStatus(ctx);
  if (sub === 'quit' || sub === 'stop' || sub === 'abandon') return ctx.game.quitExam(ctx);
  return ctx.game.startExam(ctx);
};
C.drill = (ctx, args) => {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'status') return ctx.game.showDrillStatus(ctx);
  if (sub === 'quit' || sub === 'stop' || sub === 'abandon') return ctx.game.quitDrill(ctx);
  if (ctx.game.drill) return ctx.game.showDrillStatus(ctx);
  return ctx.game.startDrill(ctx);
};
C.tutorial = (ctx) => ctx.game.showTutorial(ctx);
C.mission = (ctx) => ctx.game.showBriefing(ctx);
C.resetlevel = (ctx) => ctx.game.resetLevel(ctx);
C.progress = (ctx) => ctx.game.showProgress(ctx);
C.achievements = (ctx) => ctx.game.showAchievements(ctx);
C.submit = (ctx, args) => {
  if (!args.length) { ctx.err('usage: submit <flag>   (or: echo <flag> > /dev/exit)\n'); return 1; }
  ctx.game.trySubmit(args.join(' '), ctx);
};

C.mail = (ctx) => {
  const msgs = ctx.game.mailbox;
  if (!msgs.length) { ctx.out('No mail for ' + ctx.user.name + '\n'); return 0; }
  ctx.out(`Mail version 8.1. Type ? for help.\n"/var/mail/player": ${msgs.length} messages\n\n`);
  msgs.forEach((m, i) => {
    ctx.out(`\x1b[1m>${i + 1}  ${m.from.padEnd(28)} ${m.subject}\x1b[0m\n${m.body}\n\n`);
  });
};

// ---------------------------------------------------------------------------
// easter eggs
// ---------------------------------------------------------------------------

C.cowsay = (ctx, args) => {
  const msg = args.join(' ') || 'Moo? Try giving me something to say.';
  const line = '-'.repeat(msg.length + 2);
  ctx.out(` ${line}\n< ${msg} >\n ${line}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||\n`);
  if (ctx.game) ctx.game.unlock('bovine-intervention');
};

C.fortune = (ctx) => {
  const fortunes = [
    'There is no place like ~',
    'To err is human. To really foul things up requires root.',
    'sudo make me a sandwich.',
    'Unix IS user friendly. It is just selective about who its friends are.',
    'A chmod a day keeps the permission errors away.',
    'Real admins test in production. Real admins also update their CVs often.',
    'grep is the answer. What was the question?',
    'rm -rf / — the fastest way to meet your backup strategy.'
  ];
  ctx.out(fortunes[Math.floor(Math.random() * fortunes.length)] + '\n');
  if (ctx.game) ctx.game.unlock('fortune-teller');
};

C.sl = async (ctx) => {
  const train = [
    '      ====        ________                ___________ ',
    '  _D _|  |_______/        \\__I_I_____===__|_________| ',
    '   |(_)---  |   H\\________/ |   |        =|___ ___|   ',
    '   /     |  |   H  |  |     |   |         ||_| |_||   ',
    '  |      |  |   H  |__--------------------| [___] |   ',
    '  | ________|___H__/__|_____/[][]~\\_______|       |   ',
    '  |/ |   |-----------I_____I [][] []  D   |=======|__ ',
    '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ',
    ' |/-=|___|=    ||    ||    ||    |_____/~\\___/        ',
    '  \\_/      \\O=====O=====O=====O_/      \\_/            '
  ];
  ctx.out('\x1b[33m');
  for (const l of train) { ctx.out(l + '\n'); await new Promise(r => setTimeout(r, 60)); }
  ctx.out('\x1b[0m');
  ctx.out('You have been visited by the Steam Locomotive of typos. ls. L. S.\n');
  if (ctx.game) ctx.game.unlock('all-aboard');
};

C.vim = (ctx) => {
  ctx.out('E37: This simulation ships without vim. (How do you exit vim? Nobody here will ever know.)\nUse echo with > and >> to write files.\n');
};
C.emacs = (ctx) => ctx.out('emacs: operating system too small for this operating system. Use echo redirection to write files.\n');
C.nano = (ctx) => ctx.out("nano: no interactive editors in the simulation. Build files with echo, >> and pipes — it's good practice!\n");

module.exports = { commands: C, splitFlags, modeString };
