'use strict';
/*
 * Terminal Quest — shell engine.
 * Tokenizes and executes bash-like command lines: quoting, escapes,
 * $VAR / ${VAR} / $(cmd) expansion, ~, globbing, pipes, redirection
 * (> >> < 2> 2>>), && || ; and background &.
 */

const { FsError } = require('./vfs');

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const OPS = ['&&', '||', '2>>', '2>', '>>', '>', '<', '|', ';', '&'];

function tokenize(line) {
  const tokens = []; // {type:'word', segs:[{text,q}]} | {type:'op', op}
  let i = 0;
  const n = line.length;
  let segs = null;
  const pushSeg = (text, q) => {
    if (!segs) segs = [];
    segs.push({ text, q });
  };
  const endWord = () => {
    if (segs) { tokens.push({ type: 'word', segs }); segs = null; }
  };
  while (i < n) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { endWord(); i++; continue; }
    if (ch === '#' && !segs) break; // comment
    // operators
    const op = OPS.find(o => line.startsWith(o, i));
    if (op) { endWord(); tokens.push({ type: 'op', op }); i += op.length; continue; }
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) throw new Error('syntax error: unterminated single quote');
      pushSeg(line.slice(i + 1, end), "'");
      i = end + 1; continue;
    }
    if (ch === '"') {
      let buf = '';
      i++;
      while (i < n && line[i] !== '"') {
        if (line[i] === '\\' && '"\\$`'.includes(line[i + 1])) {
          // escaped char stays literal — mask $ and ` so later expansion skips them
          const ch2 = line[i + 1];
          buf += ch2 === '$' ? '\x01' : ch2 === '`' ? '\x02' : ch2;
          i += 2;
        }
        else if (line[i] === '$' && line[i + 1] === '(') {
          const [text, ni] = readCmdSub(line, i);
          buf += text; i = ni;
        } else { buf += line[i]; i++; }
      }
      if (i >= n) throw new Error('syntax error: unterminated double quote');
      pushSeg(buf, '"');
      i++; continue;
    }
    if (ch === '\\' && i + 1 < n) { pushSeg(line[i + 1], "'"); i += 2; continue; }
    if (ch === '$' && line[i + 1] === '(') {
      const [text, ni] = readCmdSub(line, i);
      pushSeg(text, null); i = ni; continue;
    }
    if (ch === '`') {
      const end = line.indexOf('`', i + 1);
      if (end === -1) throw new Error('syntax error: unterminated backquote');
      pushSeg('$(' + line.slice(i + 1, end) + ')', null);
      i = end + 1; continue;
    }
    // plain run of characters
    let j = i;
    while (j < n && !' \t\'"\\`#'.includes(line[j]) && !OPS.some(o => line.startsWith(o, j)) && !(line[j] === '$' && line[j + 1] === '(')) j++;
    if (j === i) { pushSeg(ch, null); i++; continue; }
    pushSeg(line.slice(i, j), null);
    i = j;
  }
  endWord();
  return tokens;
}

function readCmdSub(line, i) {
  // line[i] === '$', line[i+1] === '(' — return raw '$(...)' text and new index
  let depth = 0;
  let j = i + 1;
  for (; j < line.length; j++) {
    if (line[j] === '(') depth++;
    else if (line[j] === ')') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('syntax error: unterminated $(');
  return [line.slice(i, j + 1), j + 1];
}

// ---------------------------------------------------------------------------
// Parser: tokens -> list of { pipeline:[simpleCmd], joiner:'&&'|'||'|';', bg }
// simpleCmd = { words:[wordToken], redirs:[{fd,op,targetWord}] }
// ---------------------------------------------------------------------------

function parse(tokens) {
  const list = [];
  let cur = { pipeline: [], joiner: ';', bg: false };
  let cmd = { words: [], redirs: [] };
  const endCmd = () => {
    if (cmd.words.length || cmd.redirs.length) cur.pipeline.push(cmd);
    cmd = { words: [], redirs: [] };
  };
  const endList = (joinerNext) => {
    endCmd();
    if (cur.pipeline.length) list.push(cur);
    cur = { pipeline: [], joiner: joinerNext, bg: false };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'word') { cmd.words.push(t); continue; }
    switch (t.op) {
      case '|': endCmd(); break;
      case '&&': endList('&&'); break;
      case '||': endList('||'); break;
      case ';': endList(';'); break;
      case '&': endCmd(); cur.bg = true; break;
      case '>': case '>>': case '<': case '2>': case '2>>': {
        const target = tokens[++i];
        if (!target || target.type !== 'word') throw new Error(`syntax error near unexpected token \`${t.op}'`);
        const fd = t.op.startsWith('2') ? 2 : (t.op === '<' ? 0 : 1);
        const op = t.op.replace(/^2/, '');
        cmd.redirs.push({ fd, op, targetWord: target });
        break;
      }
    }
  }
  endList(';');
  return list;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

class Shell {
  constructor({ vfs, game, commands, user }) {
    this.vfs = vfs;
    this.game = game;
    this.commands = commands;
    this.user = user; // { name, groups: [] }
    this.cwd = user.name === 'root' ? '/root' : `/home/${user.name}`;
    this.env = {
      HOME: this.cwd,
      USER: user.name,
      LOGNAME: user.name,
      HOSTNAME: 'omnicorp',
      SHELL: '/bin/bash',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      PWD: this.cwd,
      TERM: 'xterm-256color'
    };
    this.lastStatus = 0;
    this.positional = []; // $1.. for scripts
  }

  prompt() {
    let dir = this.cwd;
    const home = this.env.HOME;
    if (dir === home) dir = '~';
    else if (dir.startsWith(home + '/')) dir = '~' + dir.slice(home.length);
    const sym = this.user.name === 'root' ? '#' : '$';
    return `${this.user.name}@omnicorp:${dir}${sym} `;
  }

  getVar(name) {
    if (name === '?') return String(this.lastStatus);
    if (name === '$') return '1337';
    if (name === '#') return String(this.positional.length);
    if (name === '@' || name === '*') return this.positional.join(' ');
    if (/^[0-9]$/.test(name)) {
      if (name === '0') return this.scriptName || 'bash';
      return this.positional[Number(name) - 1] || '';
    }
    return this.env[name] !== undefined ? this.env[name] : '';
  }

  async expandSegment(text, allowVars, io) {
    // expand $(...), ${VAR}, $VAR within a segment
    if (!allowVars) return text;
    let out = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '$' && text[i + 1] === '(') {
        const [raw, ni] = readCmdSub(text, i);
        const inner = raw.slice(2, -1);
        let captured = '';
        const subIo = { out: s => { captured += s; }, err: io ? io.err : () => {} };
        await this.exec(inner, subIo);
        out += captured.replace(/\n+$/, '').replace(/\n/g, ' ');
        i = ni; continue;
      }
      if (ch === '$' && text[i + 1] === '{') {
        const end = text.indexOf('}', i);
        if (end !== -1) { out += this.getVar(text.slice(i + 2, end)); i = end + 1; continue; }
      }
      if (ch === '$') {
        const m = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9?$#@*]/.exec(text.slice(i + 1));
        if (m) { out += this.getVar(m[0]); i += 1 + m[0].length; continue; }
      }
      out += ch; i++;
    }
    return out;
  }

  async expandWord(word, io) {
    // Returns an array of strings (globs can produce several fields).
    let text = '';
    let globbable = false;
    for (let k = 0; k < word.segs.length; k++) {
      const seg = word.segs[k];
      let t = seg.text;
      if (seg.q !== "'") t = await this.expandSegment(t, true, io);
      if (seg.q === null) {
        if (k === 0 && (t === '~' || t.startsWith('~/'))) {
          t = this.env.HOME + t.slice(1);
        }
        if (/[*?]/.test(t)) globbable = true;
      }
      text += t;
    }
    const unmask = (s) => s.replace(/\x01/g, '$').replace(/\x02/g, '`');
    if (globbable) {
      const matches = this.vfs.glob(text, this.cwd, this.user);
      return (matches.length ? matches : [text]).map(unmask);
    }
    return [unmask(text)];
  }

  rawWord(word) {
    return word.segs.map(s => s.text).join('');
  }

  async exec(line, io) {
    // io: { out(s), err(s), stdin? }
    let tokens, list;
    try {
      tokens = tokenize(line);
      list = parse(tokens);
    } catch (e) {
      io.err(`bash: ${e.message}\n`);
      this.lastStatus = 2;
      return 2;
    }
    let status = this.lastStatus;
    for (const entry of list) {
      if (entry.joiner === '&&' && status !== 0) continue;
      if (entry.joiner === '||' && status === 0) continue;
      status = await this.runPipeline(entry, io);
      this.lastStatus = status;
    }
    return status;
  }

  async runPipeline(entry, io) {
    const stages = entry.pipeline;
    let stdin = io.stdin !== undefined ? io.stdin : '';
    let status = 0;
    if (this.game) this.game.notePipeline(stages.length, entry);
    for (let s = 0; s < stages.length; s++) {
      const isLast = s === stages.length - 1;
      const stage = stages[s];
      let outBuf = '';
      let outTarget = null, outAppend = false, errTarget = null, errAppend = false;
      let stageIn = stdin;
      // resolve redirections
      let redirErr = null;
      for (const r of stage.redirs) {
        const t = (await this.expandWord(r.targetWord, io))[0];
        try {
          if (r.fd === 0) stageIn = this.vfs.readFile(t, this.cwd, this.user);
          else if (r.fd === 1) { outTarget = t; outAppend = r.op === '>>'; }
          else if (r.fd === 2) { errTarget = t; errAppend = r.op === '>>'; }
        } catch (e) {
          redirErr = `bash: ${t}: ${e.short || e.message}\n`;
        }
      }
      if (redirErr) { io.err(redirErr); status = 1; stdin = ''; continue; }
      // expand argv
      const argv = [];
      // leading VAR=value assignments
      let wordIdx = 0;
      let assignedOnly = true;
      while (wordIdx < stage.words.length) {
        const raw = this.rawWord(stage.words[wordIdx]);
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw);
        if (m && stage.words[wordIdx].segs[0].q === null && argv.length === 0) {
          const val = (await this.expandWord({ segs: stage.words[wordIdx].segs.map(sg => ({ ...sg })) }, io))[0];
          const eq = val.indexOf('=');
          this.env[val.slice(0, eq === -1 ? val.length : eq).length ? m[1] : m[1]] = val.slice(m[1].length + 1);
          wordIdx++;
          continue;
        }
        break;
      }
      for (; wordIdx < stage.words.length; wordIdx++) {
        const fields = await this.expandWord(stage.words[wordIdx], io);
        argv.push(...fields);
      }
      if (!argv.length) { stdin = ''; continue; } // pure assignment
      const name = argv[0];
      const fn = this.commands[name];
      const errSink = (msg) => {
        if (errTarget) {
          try { this.vfs.writeFile(errTarget, msg, this.cwd, this.user, errAppend); errAppend = true; }
          catch (e) { io.err(`bash: ${errTarget}: ${e.short || e.message}\n`); }
        } else io.err(msg);
      };
      if (!fn) {
        errSink(`bash: ${name}: command not found\n`);
        if (this.game) this.game.noteUnknownCommand(name);
        status = 127; stdin = ''; continue;
      }
      const ctx = {
        shell: this,
        vfs: this.vfs,
        game: this.game,
        user: this.user,
        env: this.env,
        stdin: stageIn,
        piped: s > 0,
        background: entry.bg,
        out: (txt) => { if (isLast && !outTarget) io.out(txt); else outBuf += txt; },
        err: errSink,
        rawOut: io.out // for full-screen/interactive commands (less, top)
      };
      let code = 0;
      try {
        code = await fn(ctx, argv.slice(1));
        if (typeof code !== 'number') code = 0;
      } catch (e) {
        if (e instanceof FsError) errSink(`${name}: ${e.message}\n`);
        else errSink(`${name}: ${e.message}\n`);
        code = 1;
      }
      if (outTarget) {
        try {
          this.vfs.writeFile(outTarget, outBuf + (isLast ? '' : ''), this.cwd, this.user, outAppend);
          if (this.game) this.game.noteRedirect(outTarget, outAppend);
        } catch (e) {
          io.err(`bash: ${outTarget}: ${e.short || e.message}\n`);
          code = 1;
        }
        outBuf = '';
      }
      stdin = outBuf;
      status = code;
      if (this.game) this.game.noteCommand(name, argv.slice(1), code, entry);
    }
    if (entry.bg && this.game) {
      const pid = this.game.addJob(stages.map(st => st.words.map(w => this.rawWord(w)).join(' ')).join(' | '));
      io.out(`[${this.game.jobs.length}] ${pid}\n`);
    }
    return status;
  }

  chdir(path) {
    const r = this.vfs.lookup(path, this.cwd, this.user);
    if (r.node.type !== 'dir') throw new FsError('ENOTDIR', r.abs, 'Not a directory');
    if (!this.vfs.canExec(r.node, this.user)) throw new FsError('EACCES', r.abs, 'Permission denied');
    this.env.OLDPWD = this.cwd;
    this.cwd = r.abs;
    this.env.PWD = r.abs;
  }
}

module.exports = { Shell, tokenize, parse };
