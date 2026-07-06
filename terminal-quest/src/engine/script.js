'use strict';
/*
 * Terminal Quest — bash script interpreter (subset).
 * Supports: comments, variables, $1..$9/$#/$@, for..in..do..done,
 * if/elif/else/fi with `test`/[ ], while..do..done, case..esac,
 * exit N, and any plain command line (pipes/redirection included,
 * handled by the shell engine).
 */

const { VFS } = require('./vfs');

class ScriptExit {
  constructor(code) { this.code = code; }
}

function splitUnits(source) {
  // Split a script into logical units: newlines, top-level ';' and ';;'.
  const units = [];
  let buf = '';
  let q = null;
  const push = () => { const t = buf.trim(); if (t) units.push(t); buf = ''; };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (q) {
      buf += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; buf += ch; continue; }
    if (ch === '\\' && source[i + 1] === '\n') { i++; continue; } // line continuation
    if (ch === '\n') { push(); continue; }
    if (ch === ';' && source[i + 1] === ';') { push(); units.push(';;'); i++; continue; }
    if (ch === ';') { push(); continue; }
    buf += ch;
  }
  push();
  // Split leading block keywords glued to the next command, e.g.
  // "do echo hi" -> ["do", "echo hi"], "then cmd" -> ["then", "cmd"].
  const out = [];
  for (let u of units) {
    if (u.startsWith('#')) continue;
    let m;
    while ((m = /^(do|then|else)\s+(.+)$/.exec(u))) {
      out.push(m[1]);
      u = m[2].trim();
    }
    // trailing "; done"/"fi"/"esac" already split by ';'; also split "cmd; then"? not needed
    out.push(u);
  }
  return out;
}

function parseBlock(units, i, terminators) {
  // returns [statements, nextIndex, terminatorSeen]
  const stmts = [];
  while (i < units.length) {
    const u = units[i];
    const kw = u.split(/\s+/)[0];
    if (terminators.includes(u) || terminators.includes(kw)) return [stmts, i, u];
    if (kw === 'for') {
      const m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.*)$/.exec(u);
      if (!m) throw new Error(`syntax error near 'for'`);
      i++;
      if (units[i] !== 'do') throw new Error(`syntax error: expected 'do' after 'for'`);
      const [body, ni, term] = parseBlock(units, i + 1, ['done']);
      if (term !== 'done') throw new Error("syntax error: expected 'done'");
      stmts.push({ type: 'for', name: m[1], wordsRaw: m[2], body });
      i = ni + 1;
    } else if (kw === 'while' || kw === 'until') {
      const cond = u.slice(kw.length).trim();
      i++;
      if (units[i] !== 'do') throw new Error(`syntax error: expected 'do' after '${kw}'`);
      const [body, ni, term] = parseBlock(units, i + 1, ['done']);
      if (term !== 'done') throw new Error("syntax error: expected 'done'");
      stmts.push({ type: kw, cond, body });
      i = ni + 1;
    } else if (kw === 'if' || kw === 'elif') {
      const clauses = [];
      let elseBody = null;
      let cond = u.slice(kw.length).trim();
      i++;
      for (;;) {
        if (units[i] !== 'then') throw new Error("syntax error: expected 'then'");
        const [body, ni, term] = parseBlock(units, i + 1, ['fi', 'else', 'elif']);
        clauses.push({ cond, body });
        i = ni;
        const t = units[i];
        if (t === 'fi') { i++; break; }
        if (t === 'else') {
          const [eb, nj, term2] = parseBlock(units, i + 1, ['fi']);
          if (term2 !== 'fi') throw new Error("syntax error: expected 'fi'");
          elseBody = eb;
          i = nj + 1;
          break;
        }
        // elif
        cond = t.slice(4).trim();
        i++;
      }
      stmts.push({ type: 'if', clauses, elseBody });
    } else if (kw === 'case') {
      const m = /^case\s+(.+)\s+in$/.exec(u);
      if (!m) throw new Error("syntax error near 'case'");
      const wordRaw = m[1];
      i++;
      const cases = [];
      while (i < units.length && units[i] !== 'esac') {
        let unit = units[i];
        const pm = /^([^)]+)\)\s*(.*)$/.exec(unit);
        if (!pm) throw new Error(`case: expected pattern near '${unit}'`);
        const patterns = pm[1].split('|').map(s => s.trim());
        const body = [];
        if (pm[2] && pm[2] !== ';;') body.push({ type: 'simple', line: pm[2] });
        i++;
        while (i < units.length && units[i] !== ';;' && units[i] !== 'esac') {
          body.push({ type: 'simple', line: units[i] });
          i++;
        }
        if (units[i] === ';;') i++;
        cases.push({ patterns, body });
      }
      if (units[i] !== 'esac') throw new Error("syntax error: expected 'esac'");
      i++;
      stmts.push({ type: 'case', wordRaw, cases });
    } else {
      stmts.push({ type: 'simple', line: u });
      i++;
    }
  }
  return [stmts, i, null];
}

async function expandWords(shell, raw, io) {
  const { tokenize } = require('./shell');
  const tokens = tokenize(raw).filter(t => t.type === 'word');
  const out = [];
  for (const t of tokens) {
    const fields = await shell.expandWord(t, io);
    // unquoted expansions undergo word splitting
    for (const f of fields) {
      if (t.segs.length === 1 && t.segs[0].q === null && /\s/.test(f)) out.push(...f.split(/\s+/).filter(Boolean));
      else out.push(f);
    }
  }
  return out;
}

async function execStatements(shell, stmts, io) {
  let status = 0;
  for (const s of stmts) {
    if (s.type === 'simple') {
      const kw = s.line.split(/\s+/)[0];
      if (kw === 'exit') {
        const code = parseInt(s.line.split(/\s+/)[1], 10);
        throw new ScriptExit(isNaN(code) ? status : code);
      }
      if (kw === 'break' || kw === 'continue') throw { loopCtl: kw };
      status = await shell.exec(s.line, io);
    } else if (s.type === 'for') {
      const words = await expandWords(shell, s.wordsRaw, io);
      for (const w of words) {
        shell.env[s.name] = w;
        try { status = await execStatements(shell, s.body, io); }
        catch (e) {
          if (e.loopCtl === 'break') break;
          if (e.loopCtl === 'continue') continue;
          throw e;
        }
      }
    } else if (s.type === 'while' || s.type === 'until') {
      let guard = 0;
      for (;;) {
        if (++guard > 10000) { io.err('script: loop aborted after 10000 iterations\n'); break; }
        const c = await shell.exec(s.cond, io);
        const go = s.type === 'while' ? c === 0 : c !== 0;
        if (!go) break;
        try { status = await execStatements(shell, s.body, io); }
        catch (e) {
          if (e.loopCtl === 'break') break;
          if (e.loopCtl === 'continue') continue;
          throw e;
        }
      }
    } else if (s.type === 'if') {
      let ran = false;
      for (const cl of s.clauses) {
        const c = await shell.exec(cl.cond, io);
        if (c === 0) { status = await execStatements(shell, cl.body, io); ran = true; break; }
      }
      if (!ran && s.elseBody) status = await execStatements(shell, s.elseBody, io);
    } else if (s.type === 'case') {
      const word = (await expandWords(shell, s.wordRaw, io))[0] || '';
      for (const c of s.cases) {
        const hit = c.patterns.some(p => VFS.globToRegExp(p).test(word));
        if (hit) { status = await execStatements(shell, c.body, io); break; }
      }
    }
  }
  return status;
}

async function runScript(ctx, source, name, args) {
  const { Shell } = require('./shell');
  const child = new Shell({
    vfs: ctx.vfs,
    game: ctx.game,
    commands: ctx.shell.commands,
    user: ctx.user
  });
  child.cwd = ctx.shell.cwd;
  child.env = { ...ctx.env };
  child.positional = args;
  child.scriptName = name;
  const io = { out: ctx.out, err: ctx.err, stdin: ctx.stdin };
  let stmts;
  try {
    const units = splitUnits(source);
    [stmts] = parseBlock(units, 0, []);
  } catch (e) {
    ctx.err(`${name}: ${e.message}\n`);
    return 2;
  }
  try {
    const code = await execStatements(child, stmts, io);
    if (ctx.game) ctx.game.onScriptRun(name, source);
    return code;
  } catch (e) {
    if (e instanceof ScriptExit) {
      if (ctx.game) ctx.game.onScriptRun(name, source);
      return e.code;
    }
    if (e.loopCtl) return 0;
    ctx.err(`${name}: ${e.message}\n`);
    return 1;
  }
}

module.exports = { runScript };
