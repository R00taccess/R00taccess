'use strict';
/*
 * Terminal Quest — OmniCorp Certification Exam.
 * An unaided, applied proficiency test. The player is given a sandbox and a
 * checklist of tasks spanning every core skill; there are NO command
 * suggestions and NO hints. Each task is graded by inspecting the resulting
 * world state, so tasks can be solved by any valid route — which is what real
 * proficiency looks like.
 */

const P = 'player';

function fileText(g, path) {
  const n = g.vfs.statOrNull(path, '/', g.playerUser());
  return n && n.type === 'file' ? n.content : null;
}
function exists(g, path) { return !!g.vfs.statOrNull(path, '/', g.playerUser()); }

// Each task: { id, skill, prompt, check(game) -> bool }
const EXAM_TASKS = [
  {
    id: 'navigate', skill: 'mkdir · touch',
    prompt: 'Create the directory /exam/out/logs (and any parents), then an empty file /exam/out/logs/audit.log inside it.',
    check: (g) => {
      const d = g.vfs.statOrNull('/exam/out/logs', '/', g.playerUser());
      return d && d.type === 'dir' && exists(g, '/exam/out/logs/audit.log');
    }
  },
  {
    id: 'redirect', skill: 'echo · >',
    prompt: 'Create /exam/status containing exactly one line: READY',
    check: (g) => (fileText(g, '/exam/status') || '').replace(/\n+$/, '') === 'READY'
  },
  {
    id: 'grep', skill: 'grep',
    prompt: '/exam/logs/service.log has exactly one line containing CRITICAL. Put just that line into /exam/critical.txt.',
    check: (g) => {
      const c = (fileText(g, '/exam/critical.txt') || '').replace(/\n+$/, '');
      return /CRITICAL/.test(c) && c.split('\n').length === 1;
    }
  },
  {
    id: 'pipeline', skill: 'sort · uniq · pipe',
    prompt: 'Find the single most frequent code in /exam/data/codes.txt and write JUST that code to /exam/top.txt.',
    check: (g) => (fileText(g, '/exam/top.txt') || '').replace(/\n+$/, '').trim() === 'X42'
  },
  {
    id: 'find', skill: 'find',
    prompt: 'Delete every *.tmp file anywhere under /exam/scratch. Leave all other files intact.',
    check: (g) => {
      let tmp = 0;
      try { g.vfs.walk('/exam/scratch', '/', g.playerUser(), (a, n) => { if (n.endsWith('.tmp')) tmp++; }); }
      catch (e) { return false; }
      return tmp === 0 && exists(g, '/exam/scratch/keep.txt');
    }
  },
  {
    id: 'permissions', skill: 'chmod',
    prompt: 'Lock /exam/secret.key so only its owner can read and write it (mode 600).',
    check: (g) => {
      const n = g.vfs.statOrNull('/exam/secret.key', '/', g.playerUser());
      return n && (n.mode & 0o777) === 0o600;
    }
  },
  {
    id: 'count', skill: 'grep -c / wc -l',
    prompt: 'Count how many lines in /exam/logs/service.log contain ERROR, and write just that number to /exam/errors.count.',
    check: (g) => (fileText(g, '/exam/errors.count') || '').replace(/\n+$/, '').trim() === String(g.exam.errCount)
  },
  {
    id: 'extract', skill: 'awk / cut',
    prompt: '/exam/data/users.csv is name,email,role. Write every email (2nd column only) to /exam/emails.txt.',
    check: (g) => {
      const c = (fileText(g, '/exam/emails.txt') || '').replace(/\n+$/, '');
      const got = c.split('\n').map(s => s.trim()).filter(Boolean).sort();
      const want = ['ana@omni.co', 'ben@omni.co', 'cleo@omni.co'].sort();
      return got.length === want.length && got.every((x, i) => x === want[i]);
    }
  },
  {
    id: 'script', skill: 'bash scripting',
    prompt: 'Write a script /exam/run.sh that prints DONE, then run it so the word DONE is saved in /exam/result.txt.',
    check: (g) => exists(g, '/exam/run.sh') && (fileText(g, '/exam/result.txt') || '').replace(/\n+$/, '') === 'DONE'
  }
];

function buildExam(game) {
  const v = game.vfs;
  try { v.unlink('/exam', '/', game.rootUser(), true); } catch (e) {}
  v.mkdirp('/exam', '/', P, P);

  // service.log — 40 rotating lines (ERROR on every 4th) + one CRITICAL
  v.mkdirp('/exam/logs', '/', P, P);
  const rows = [];
  let errCount = 0;
  for (let i = 0; i < 40; i++) {
    const lv = ['INFO', 'INFO', 'WARN', 'ERROR'][i % 4];
    if (lv === 'ERROR') errCount++;
    rows.push(`svc[${100 + i}]: ${lv} event ${i}`);
  }
  rows.splice(20, 0, 'svc[777]: CRITICAL database unreachable');
  v.put('/exam/logs/service.log', rows.join('\n') + '\n', { owner: P });

  // codes.txt — X42 is the clear winner (15)
  v.mkdirp('/exam/data', '/', P, P);
  const codes = [];
  for (const [c, n] of Object.entries({ X42: 15, X13: 7, X99: 4, X01: 9 })) {
    for (let i = 0; i < n; i++) codes.push(c);
  }
  for (let i = codes.length - 1; i > 0; i--) { const j = (i * 5 + 2) % (i + 1); [codes[i], codes[j]] = [codes[j], codes[i]]; }
  v.put('/exam/data/codes.txt', codes.join('\n') + '\n', { owner: P });
  v.put('/exam/data/users.csv', 'Ana,ana@omni.co,admin\nBen,ben@omni.co,ops\nCleo,cleo@omni.co,dev\n', { owner: P });

  // scratch — .tmp files to clean, one keeper
  v.mkdirp('/exam/scratch/cache', '/', P, P);
  for (let i = 0; i < 4; i++) v.put(`/exam/scratch/f${i}.tmp`, 'tmp\n', { owner: P });
  v.put('/exam/scratch/cache/old.tmp', 'tmp\n', { owner: P });
  v.put('/exam/scratch/keep.txt', 'keep me\n', { owner: P });

  v.put('/exam/secret.key', 'topsecret\n', { owner: P, mode: 0o644 });
  return { errCount };
}

module.exports = { EXAM_TASKS, buildExam };
