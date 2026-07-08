'use strict';
/*
 * Terminal Quest — drill mode (targeted practice).
 * Short, randomized tasks generated in a /drill sandbox. The picker favours
 * the skills with the LOWEST mastery, so practice goes exactly where the
 * player is weakest. Like the exam, drills are graded by world state, so any
 * valid approach passes. No hints, small XP, infinitely repeatable.
 */

const P = 'player';

function fileText(g, path) {
  const n = g.vfs.statOrNull(path, '/', g.playerUser());
  return n && n.type === 'file' ? n.content : null;
}
function exists(g, path) { return !!g.vfs.statOrNull(path, '/', g.playerUser()); }
function answer(g) { return (fileText(g, '/drill/answer.txt') || '').replace(/\n+$/, '').trim(); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// tiny deterministic PRNG so a drill can rebuild identically on resetlevel
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['falcon', 'nebula', 'quartz', 'lantern', 'cobalt', 'ember', 'signal', 'harbor', 'onyx', 'pixel'];

/*
 * Each generator: { skills: [core commands it exercises], gen(g, rng) ->
 *   { prompt, check(g) } }. Generators must build everything they need under
 * /drill (already wiped clean by startDrill).
 */
const DRILL_GENERATORS = [
  {
    skills: ['grep'],
    gen(g, rng) {
      const token = 'TOKEN-' + Math.floor(rng() * 9000 + 1000);
      const hideIn = Math.floor(rng() * 6);
      for (let i = 0; i < 6; i++) {
        const lines = [`file ${i} — routine noise`, `nothing to see on line 2`];
        if (i === hideIn) lines.splice(1, 0, `access code ${token} issued`);
        g.vfs.put(`/drill/files/log_${i}.txt`, lines.join('\n') + '\n', { owner: P });
      }
      return {
        prompt: `One file under /drill/files contains the text ${token}. Put the full matching LINE into /drill/answer.txt.`,
        check: (gg) => answer(gg).includes(token) && answer(gg).split('\n').length === 1
      };
    }
  },
  {
    skills: ['find', 'rm'],
    gen(g, rng) {
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) g.vfs.put(`/drill/tree/${i < 2 ? 'deep/' : ''}junk_${i}.tmp`, 'x\n', { owner: P });
      g.vfs.put('/drill/tree/keep.conf', 'precious\n', { owner: P });
      return {
        prompt: `Delete every *.tmp file anywhere under /drill/tree (there are ${n}, some nested). Leave keep.conf alone.`,
        check: (gg) => {
          let tmp = 0;
          try { gg.vfs.walk('/drill/tree', '/', gg.playerUser(), (a, nm) => { if (nm.endsWith('.tmp')) tmp++; }); }
          catch (e) { return false; }
          return tmp === 0 && exists(gg, '/drill/tree/keep.conf');
        }
      };
    }
  },
  {
    skills: ['chmod'],
    gen(g, rng) {
      const mode = pick(rng, [0o600, 0o640, 0o755, 0o700]);
      const oct = (mode & 0o777).toString(8);
      g.vfs.put('/drill/vault.key', 'secret\n', { owner: P, mode: 0o666 });
      return {
        prompt: `Set the permissions of /drill/vault.key to exactly ${oct}.`,
        check: (gg) => {
          const nd = gg.vfs.statOrNull('/drill/vault.key', '/', gg.playerUser());
          return nd && (nd.mode & 0o777) === mode;
        }
      };
    }
  },
  {
    skills: ['sort', 'uniq', 'wc'],
    gen(g, rng) {
      const winner = pick(rng, WORDS);
      const others = WORDS.filter(w => w !== winner);
      const rows = [];
      for (let i = 0; i < 14; i++) rows.push(winner);
      for (const o of others.slice(0, 4)) for (let i = 0; i < 3 + Math.floor(rng() * 5); i++) rows.push(o);
      for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
      g.vfs.put('/drill/words.txt', rows.join('\n') + '\n', { owner: P });
      return {
        prompt: `Find the single most frequent word in /drill/words.txt and write JUST that word to /drill/answer.txt.`,
        check: (gg) => answer(gg) === winner
      };
    }
  },
  {
    skills: ['echo'],
    gen(g, rng) {
      const a = pick(rng, WORDS), b = pick(rng, WORDS.filter(w => w !== a));
      return {
        prompt: `Create /drill/pair.txt containing exactly two lines: first "${a}", then "${b}" (in that order).`,
        check: (gg) => (fileText(gg, '/drill/pair.txt') || '').replace(/\n+$/, '') === `${a}\n${b}`
      };
    }
  },
  {
    skills: ['mv', 'mkdir'],
    gen(g, rng) {
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) g.vfs.put(`/drill/inbox/report_${i}.log`, `r${i}\n`, { owner: P });
      g.vfs.put('/drill/inbox/notes.txt', 'keep here\n', { owner: P });
      return {
        prompt: `Create /drill/archive and MOVE every .log file from /drill/inbox into it (leave notes.txt where it is).`,
        check: (gg) => {
          if (!exists(gg, '/drill/inbox/notes.txt')) return false;
          for (let i = 0; i < n; i++) {
            if (!exists(gg, `/drill/archive/report_${i}.log`)) return false;
            if (exists(gg, `/drill/inbox/report_${i}.log`)) return false;
          }
          return true;
        }
      };
    }
  },
  {
    skills: ['tail', 'head'],
    gen(g, rng) {
      const lines = [];
      for (let i = 1; i <= 30; i++) lines.push(`entry ${i}: ${pick(rng, WORDS)}`);
      const last = lines[lines.length - 1];
      g.vfs.put('/drill/events.log', lines.join('\n') + '\n', { owner: P });
      return {
        prompt: `Write the LAST line of /drill/events.log (and only it) into /drill/answer.txt.`,
        check: (gg) => answer(gg) === last
      };
    }
  },
  {
    skills: ['wc', 'grep'],
    gen(g, rng) {
      const target = 4 + Math.floor(rng() * 6);
      const rows = [];
      let placed = 0;
      for (let i = 0; i < 25; i++) {
        if (placed < target && rng() < 0.4) { rows.push(`svc: ERROR code ${i}`); placed++; }
        else rows.push(`svc: OK tick ${i}`);
      }
      while (placed < target) { rows.push(`svc: ERROR code x${placed}`); placed++; }
      g.vfs.put('/drill/service.log', rows.join('\n') + '\n', { owner: P });
      return {
        prompt: `Count how many lines in /drill/service.log contain ERROR; write just the number to /drill/answer.txt.`,
        check: (gg) => answer(gg) === String(target)
      };
    }
  },
  {
    skills: ['kill', 'ps'],
    gen(g, rng) {
      const pid = 7000 + Math.floor(rng() * 999);
      g.procs.push({ pid, user: P, cpu: 91.0, mem: 5.0, time: '00:04:20', cmd: '/usr/local/bin/drill-hog --spin' });
      return {
        prompt: `A process called drill-hog is burning CPU. Find its PID and kill it.`,
        check: (gg) => !gg.procs.some(p => p.pid === pid)
      };
    }
  },
  {
    skills: ['awk', 'cut'],
    gen(g, rng) {
      const names = ['ana', 'ben', 'cleo', 'dev', 'edna'].slice(0, 3 + Math.floor(rng() * 2));
      const rows = names.map((n, i) => `${i + 1},${n},${n}@omni.co,${pick(rng, ['ops', 'dev'])}`);
      g.vfs.put('/drill/team.csv', rows.join('\n') + '\n', { owner: P });
      return {
        prompt: `/drill/team.csv is id,name,email,role. Write every NAME (2nd column only) to /drill/answer.txt.`,
        check: (gg) => {
          const got = answer(gg).split('\n').map(s => s.trim()).filter(Boolean).sort();
          const want = [...names].sort();
          return got.length === want.length && got.every((x, i) => x === want[i]);
        }
      };
    }
  },
  {
    skills: ['sed'],
    gen(g, rng) {
      const from = pick(rng, WORDS), to = pick(rng, WORDS.filter(w => w !== from));
      const body = `alpha ${from} beta\n${from} gamma ${from}\ndelta\n`;
      g.vfs.put('/drill/doc.txt', body, { owner: P });
      return {
        prompt: `Replace every occurrence of "${from}" with "${to}" in /drill/doc.txt and save the result to /drill/answer.txt.`,
        check: (gg) => {
          const c = fileText(gg, '/drill/answer.txt') || '';
          return c.includes(to) && !c.includes(from) && c.includes('delta');
        }
      };
    }
  },
  {
    skills: ['bash'],
    gen(g, rng) {
      const n = 3 + Math.floor(rng() * 3);
      return {
        prompt: `Write and run a script /drill/loop.sh that prints the numbers 1 to ${n}, one per line, into /drill/answer.txt.`,
        check: (gg) => {
          if (!exists(gg, '/drill/loop.sh')) return false;
          const want = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
          return answer(gg) === want;
        }
      };
    }
  },
  {
    skills: ['crontab'],
    gen(g, rng) {
      const min = pick(rng, [0, 15, 30, 45]);
      const hour = 1 + Math.floor(rng() * 5);
      return {
        prompt: `Install a crontab that runs /opt/scripts/heartbeat.sh every day at ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}.`,
        check: (gg) => {
          const tab = gg.crontabs['player'] || [];
          return tab.some(l => {
            const f = l.trim().split(/\s+/);
            return f[0] === String(min) && f[1] === String(hour) && f[2] === '*' && f[3] === '*' && f[4] === '*' &&
              f.slice(5).join(' ').includes('/opt/scripts/heartbeat.sh');
          });
        }
      };
    }
  }
];

// Pick a generator, biased hard toward the player's weakest relevant skills.
function pickDrill(game, rng) {
  const learned = new Set(game.learnedCommands());
  const eligible = DRILL_GENERATORS.filter(d => d.skills.some(s => learned.has(s)));
  const pool = eligible.length ? eligible : DRILL_GENERATORS.slice(0, 6);
  const weight = (d) => {
    const m = Math.min(...d.skills.map(s => game.mastery[s] || 0));
    return m >= 3 ? 1 : m >= 1 ? 3 : 6; // unpractised skills 6× more likely
  };
  const total = pool.reduce((s, d) => s + weight(d), 0);
  let roll = rng() * total;
  for (const d of pool) { roll -= weight(d); if (roll <= 0) return d; }
  return pool[pool.length - 1];
}

function buildDrill(game, seed) {
  const rng = mulberry32(seed);
  const v = game.vfs;
  try { v.unlink('/drill', '/', game.rootUser(), true); } catch (e) {}
  game.procs = game.procs.filter(p => !/drill-hog/.test(p.cmd));
  v.mkdirp('/drill', '/', P, P);
  v.mkdirp('/drill/files', '/', P, P);
  v.mkdirp('/drill/tree/deep', '/', P, P);
  v.mkdirp('/drill/inbox', '/', P, P);
  const gen = pickDrill(game, rng);
  const task = gen.gen(game, rng);
  return { skills: gen.skills, prompt: task.prompt, check: task.check };
}

module.exports = { buildDrill, DRILL_GENERATORS };
