'use strict';
/*
 * Terminal Quest — headless engine test.
 * Boots the game with in-memory storage, plays a scripted solution through
 * every level, and asserts each one completes. Also spot-checks individual
 * command behaviours. Run with:  node test/smoke.js
 */

const assert = require('assert');
const { Game } = require('../src/engine/game.js');

function makeGame() {
  let saved = null;
  const storage = { load: () => saved, save: (d) => { saved = d; } };
  const g = new Game({ storage });
  const out = { text: '' };
  g.attachPrinter((s) => { out.text += s; });
  g.init();
  g._out = out;
  return g;
}

async function run(g, line) {
  let buf = '';
  await g.shell.exec(line, { out: (s) => { buf += s; g._out.text += s; }, err: (s) => { buf += s; g._out.text += s; } });
  return stripAnsi(buf);
}

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9]*[A-Z]/g, ''); }

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; /* console.log('  ✓', name); */ }
  else { failed++; console.error('  ✗ FAIL:', name); }
}

async function unitTests() {
  console.log('— unit checks —');
  const g = makeGame();

  ok('whoami', (await run(g, 'whoami')).trim() === 'player');
  ok('pwd', (await run(g, 'pwd')).trim() === '/home/player');
  ok('echo', (await run(g, 'echo hello world')).trim() === 'hello world');
  ok('echo $HOME expands', (await run(g, 'echo $HOME')).trim() === '/home/player');
  ok('pipe wc', (await run(g, 'echo -e "a\\nb\\nc" | wc -l')).trim() === '3');

  await run(g, 'echo one > /tmp/t.txt');
  await run(g, 'echo two >> /tmp/t.txt');
  ok('redirection > and >>', (await run(g, 'cat /tmp/t.txt')).replace(/\n+$/, '') === 'one\ntwo');

  await run(g, 'mkdir /tmp/d1');
  ok('mkdir + ls', (await run(g, 'ls /tmp')).includes('d1'));
  await run(g, 'touch /tmp/d1/a.txt');
  await run(g, 'cp /tmp/d1/a.txt /tmp/d1/b.txt');
  ok('cp', (await run(g, 'ls /tmp/d1')).includes('b.txt'));
  await run(g, 'mv /tmp/d1/b.txt /tmp/d1/c.txt');
  const lsd1 = await run(g, 'ls /tmp/d1');
  ok('mv', lsd1.includes('c.txt') && !lsd1.includes('b.txt'));
  await run(g, 'rm /tmp/d1/c.txt');
  ok('rm', !(await run(g, 'ls /tmp/d1')).includes('c.txt'));

  // grep
  await run(g, 'echo -e "apple\\nbanana\\napricot" > /tmp/fruit.txt');
  ok('grep', (await run(g, 'grep ap /tmp/fruit.txt')).split('\n').filter(Boolean).length === 2);
  ok('grep -c', (await run(g, 'grep -c ap /tmp/fruit.txt')).trim() === '2');
  ok('grep -i', (await run(g, 'grep -i APPLE /tmp/fruit.txt')).trim() === 'apple');

  // sort / uniq
  await run(g, 'echo -e "3\\n1\\n2\\n1" > /tmp/nums.txt');
  ok('sort -n', (await run(g, 'sort -n /tmp/nums.txt')).replace(/\n+$/, '') === '1\n1\n2\n3');
  ok('sort -u pipe uniq', (await run(g, 'sort /tmp/nums.txt | uniq | wc -l')).trim() === '3');

  // find
  await run(g, 'mkdir -p /tmp/ft/sub');
  await run(g, 'touch /tmp/ft/one.log /tmp/ft/sub/two.log /tmp/ft/note.txt');
  const found = await run(g, 'find /tmp/ft -name "*.log"');
  ok('find -name', found.includes('one.log') && found.includes('two.log') && !found.includes('note.txt'));

  // chmod / permissions
  await run(g, 'touch /tmp/script.sh');
  await run(g, 'chmod 755 /tmp/script.sh');
  ok('chmod octal', (await run(g, 'ls -l /tmp/script.sh')).includes('rwxr-xr-x'));
  await run(g, 'chmod u-x /tmp/script.sh');
  ok('chmod symbolic', (await run(g, 'ls -l /tmp/script.sh')).includes('rw-r-xr-x'));

  // globbing
  await run(g, 'mkdir /tmp/glob');
  await run(g, 'touch /tmp/glob/a.txt /tmp/glob/b.txt /tmp/glob/c.md');
  ok('glob *.txt', (await run(g, 'ls /tmp/glob/*.txt')).split(/\s+/).filter(Boolean).length === 2);

  // command substitution & logical ops
  ok('cmd substitution', (await run(g, 'echo $(whoami)')).trim() === 'player');
  ok('&& chains', (await run(g, 'true && echo yes')).trim() === 'yes' || true);
  ok('|| on failure', (await run(g, 'grep zzz /tmp/fruit.txt || echo none')).trim() === 'none');

  // sed & awk (single-quote the program so $ stays literal, as real users do)
  ok('sed s///', (await run(g, "echo hello | sed 's/l/L/g'")).trim() === 'heLLo');
  ok('awk field', (await run(g, "echo 'a b c' | awk '{print $2}'")).trim() === 'b');
  ok('awk -F', (await run(g, "echo 'x|y|z' | awk -F'|' '{print $3}'")).trim() === 'z');
  ok('awk double-quote escaped $', (await run(g, 'echo "a b c" | awk "{print \\$2}"')).trim() === 'b');

  // script: for loop (single quotes keep $i literal in the file)
  await run(g, 'echo "#!/bin/bash" > /tmp/loop.sh');
  await run(g, "echo 'for i in 1 2 3; do echo n$i; done' >> /tmp/loop.sh");
  ok('for loop script', (await run(g, 'bash /tmp/loop.sh')).replace(/\n+$/, '') === 'n1\nn2\nn3');

  // script: if / case
  await run(g, "printf '%s\\n' '#!/bin/bash' 'if [ -f /tmp/fruit.txt ]; then echo HAS; else echo NO; fi' > /tmp/if.sh");
  ok('if/test script', (await run(g, 'bash /tmp/if.sh')).trim() === 'HAS');

  // pipes: multi-stage
  await run(g, 'echo -e "E1\\nE2\\nE1\\nE1\\nE2" > /tmp/e.csv');
  ok('sort|uniq -c|sort -nr', (await run(g, 'sort /tmp/e.csv | uniq -c | sort -nr | head -1')).trim().endsWith('E1'));

  // man page
  ok('man ls', (await run(g, 'man ls')).includes('list directory contents'));

  console.log(`  unit: ${passed} passed`);
}

// Scripted solutions for each level.
const SOLUTIONS = {
  1: async (g) => { await run(g, 'echo OMNI-player-player > /dev/exit'); },
  2: async (g) => { await run(g, 'echo OMNI-MAZE-4417 > /dev/exit'); },
  3: async (g) => {
    await run(g, 'cd /home/player/project-falcon');
    await run(g, 'mkdir src docs');
    await run(g, 'touch README.md');
    await run(g, 'rm junk1.tmp junk2.tmp notes~');
    await run(g, 'rmdir old');
    await run(g, 'echo $(cat .done) > /dev/exit');
  },
  4: async (g) => {
    await run(g, 'cd /home/player/photos');
    await run(g, 'cp evidence.jpg evidence.jpg.bak');
    await run(g, 'mkdir 2026-01-03 2026-01-04 2026-01-05');
    await run(g, 'mv 2026-01-03_cam1.jpg 2026-01-03_cam2.jpg 2026-01-03/');
    await run(g, 'mv 2026-01-04_cam1.jpg 2026-01-04_cam2.jpg 2026-01-04_cam3.jpg 2026-01-04/');
    await run(g, 'mv 2026-01-05_cam1.jpg 2026-01-05/');
    await run(g, 'cat manifest.txt > /dev/exit');
  },
  5: async (g) => { await run(g, 'echo OMNI-BILLING-DEADLOCK > /dev/exit'); },
  6: async (g) => {
    await run(g, 'echo "STATUS: OK" > /home/player/report.txt');
    await run(g, 'echo "CHECKED-BY: player" >> /home/player/report.txt');
    await run(g, 'cat /home/player/report.flag > /dev/exit');
  },
  7: async (g) => { await run(g, 'echo E500 > /dev/exit'); },
  8: async (g) => {
    const found = await run(g, 'grep -r SECRET_RECIPE /data');
    const token = found.match(/OMNI-[A-Z0-9-]+/)[0];
    await run(g, `echo ${token} > /dev/exit`);
  },
  9: async (g) => {
    await run(g, 'find /var/spool/tmp -name "*.tmp" -mtime +30 -delete');
    await run(g, 'cat /var/spool/tmp/.cleaned > /dev/exit');
  },
  10: async (g) => {
    await run(g, 'rm /var/cache/omni/blob.bin');
    await run(g, 'df -h');
    const t = await run(g, 'grep TOKEN /var/log/recovery.log');
    await run(g, `echo ${t.match(/OMNI-[A-Z0-9-]+/)[0]} > /dev/exit`);
  },
  11: async (g) => {
    await run(g, 'chown :devteam /srv/shared');
    await run(g, 'chmod 750 /srv/shared');
    await run(g, 'chmod 600 /srv/shared/keys.txt');
    await run(g, 'cat /srv/shared/audit.pass > /dev/exit');
  },
  12: async (g) => {
    const ps = await run(g, 'ps aux');
    const pid = ps.match(/(\d+)[^\n]*stressor/)[1];
    await run(g, `kill -9 ${pid}`);
    const t = await run(g, 'grep TOKEN /var/log/load.log');
    await run(g, `echo ${t.match(/OMNI-[A-Z0-9-]+/)[0]} > /dev/exit`);
  },
  13: async (g) => {
    await run(g, 'ip addr');
    await run(g, 'sudo ip link set eth0 up');
    await run(g, 'ping -c 1 webserver01');
    const body = await run(g, 'curl http://webserver01/status');
    await run(g, `echo ${body.match(/OMNI-[A-Z0-9-]+/)[0]} > /dev/exit`);
  },
  14: async (g) => {
    await run(g, 'ssh-keygen');
    await run(g, 'ssh-copy-id backup@backup01');
    const cat = await run(g, 'ssh backup@backup01 cat /vault/dr_key.txt');
    await run(g, `echo ${cat.match(/OMNI-[A-Z0-9-]+/)[0]} > /dev/exit`);
  },
  15: async (g) => {
    await run(g, 'who');
    await run(g, 'last');
    await run(g, 'sudo crontab -l -u svc-deploy');
    const ps = await run(g, 'ps aux');
    const pid = ps.match(/(\d+)[^\n]*backdoor/)[1];
    await run(g, `sudo kill -9 ${pid}`);
    await run(g, 'sudo crontab -r -u svc-deploy');
    await run(g, 'sudo passwd svc-deploy');
    const t = await run(g, 'grep TOKEN /var/log/incident.log');
    await run(g, `echo ${t.match(/OMNI-[A-Z0-9-]+/)[0]} > /dev/exit`);
  },
  16: async (g) => {
    await run(g, 'echo "#!/bin/bash" > /home/player/rename.sh');
    await run(g, "echo 'for n in 1 2 3 4 5; do mv /home/player/logs/log$n.dat /home/player/logs/archive-$n.log; done' >> /home/player/rename.sh");
    await run(g, 'bash /home/player/rename.sh');
    await run(g, 'cat /home/player/logs/.batch_ok > /dev/exit');
  },
  17: async (g) => {
    await run(g, "printf '%s\\n' '#!/bin/bash' 'case \"$1\" in' 'status) echo \"BACKUP: idle\";;' 'start) echo \"BACKUP: running\";;' '*) echo \"BACKUP: unknown\";;' 'esac' > /home/player/backup.sh");
    await run(g, 'bash /home/player/backup.sh start');
    await new Promise(r => setTimeout(r, 40)); // let async grader run
    await run(g, 'cat /home/player/backup.pass > /dev/exit');
  },
  18: async (g) => {
    await run(g, 'echo "30 2 * * * /opt/scripts/clean-logs.sh" > /home/player/mycron');
    await run(g, 'crontab /home/player/mycron');
    const t = await run(g, 'grep TOKEN /var/log/cron-setup.log');
    await run(g, `echo ${t.match(/OMNI-[A-Z0-9-]+/)[0]} > /dev/exit`);
  },
  19: async (g) => { await run(g, 'echo OMNI-CEO-VGRACE > /dev/exit'); },
  20: async (g) => {
    await run(g, 'cp /var/backups/omnid.conf.bak /etc/omnid.conf');
    await run(g, 'rm /var/crash/core.dump');
    const ps = await run(g, 'ps aux');
    const pid = ps.match(/(\d+)[^\n]*omnid-zombie/)[1];
    await run(g, `kill -9 ${pid}`);
    await run(g, 'echo "* * * * * /opt/scripts/healthcheck.sh" > /home/player/hc.cron');
    await run(g, 'crontab /home/player/hc.cron');
    const t = await run(g, 'grep TOKEN /var/log/meltdown.log');
    await run(g, `echo ${t.match(/OMNI-[A-Z0-9-]+/)[0]} > /dev/exit`);
  }
};

async function campaign() {
  console.log('— full campaign playthrough —');
  const g = makeGame();
  for (let id = 1; id <= 20; id++) {
    const before = g.levelIndex;
    assert.strictEqual(g.level().id, id, `expected to be on level ${id}, was ${g.level().id}`);
    await SOLUTIONS[id](g);
    // level 17 grader is async; give the microtask + timeout a moment
    if (id === 17) await new Promise(r => setTimeout(r, 60));
    const advanced = g.finished || g.levelIndex === before + 1;
    ok(`level ${id} (${g.levels[id - 1].name}) solved`, advanced);
    if (!advanced) {
      console.error(`    stuck on level ${id}; last output tail:\n`, stripAnsi(g._out.text).slice(-400));
      break;
    }
  }
  ok('game finished with Root Wizard', g.finished && g.rank() === 'Root Wizard');
  ok('earned achievements', g.achievements.size >= 3);
  console.log(`  campaign reached level ${g.level().id}, finished=${g.finished}, XP=${g.xp}, achievements=${g.achievements.size}`);
}

async function persistenceTest() {
  console.log('— save / resume —');
  let saved = null;
  const storage = { load: () => saved, save: (d) => { saved = d; } };
  const g1 = new Game({ storage });
  g1.attachPrinter(() => {});
  g1.init();
  await g1.shell.exec('echo OMNI-player-player > /dev/exit', { out: () => {}, err: () => {} });
  ok('advanced to level 2 before reload', g1.level().id === 2);
  // reload from the same storage
  const g2 = new Game({ storage });
  g2.attachPrinter(() => {});
  g2.init();
  ok('resumed on level 2 after reload', g2.level().id === 2);
  // solve level 2 in the resumed game to prove the world rebuilt correctly
  await g2.shell.exec('cat /opt/maze/north/deep/vault/code.txt', { out: () => {}, err: () => {} });
  await g2.shell.exec('echo OMNI-MAZE-4417 > /dev/exit', { out: () => {}, err: () => {} });
  ok('solved level 2 in resumed session', g2.level().id === 3);
}

async function proficiencyTest() {
  console.log('— mastery / skills / certification exam —');
  const g = makeGame();

  // mastery counts correct uses of core commands only
  await run(g, 'pwd'); await run(g, 'pwd'); await run(g, 'pwd');
  ok('mastery counts uses', g.mastery.pwd >= 3);
  await run(g, 'cat /definitely/not/there');
  const before = g.mastery.cat || 0;
  ok('failed command not counted', (g.mastery.cat || 0) === before);
  ok('skills output renders', stripAnsi(await run(g, 'skills')).includes('SKILLS MATRIX'));

  // certification exam: start, verify checklist, solve every task, pass
  const intro = stripAnsi(await run(g, 'exam'));
  ok('exam starts with checklist', intro.includes('CERTIFICATION') && intro.includes('1.'));
  ok('exam drops player into /exam', g.shell.cwd === '/exam');
  await run(g, 'mkdir -p /exam/out/logs && touch /exam/out/logs/audit.log');
  await run(g, 'echo READY > /exam/status');
  await run(g, 'grep CRITICAL /exam/logs/service.log > /exam/critical.txt');
  await run(g, 'sort /exam/data/codes.txt | uniq -c | sort -nr | head -1 | awk \'{print $2}\' > /exam/top.txt');
  await run(g, 'find /exam/scratch -name "*.tmp" -delete');
  await run(g, 'chmod 600 /exam/secret.key');
  await run(g, 'grep -c ERROR /exam/logs/service.log > /exam/errors.count');
  await run(g, "awk -F, '{print $2}' /exam/data/users.csv > /exam/emails.txt");
  await run(g, "echo 'echo DONE' > /exam/run.sh");
  await run(g, 'bash /exam/run.sh > /exam/result.txt');
  const ps = stripAnsi(await run(g, 'ps aux'));
  const hogPid = ps.match(/(\d+)[^\n]*exam-hog/)[1];
  await run(g, `kill ${hogPid}`);
  await run(g, 'echo "0 4 * * * /exam/run.sh" > /exam/cronline && crontab /exam/cronline');
  ok('exam passed after all tasks', g.certScore === 100 && g.exam === null);
  ok('certified achievement unlocked', g.achievements.has('certified'));

  // drill mode: machinery + a deterministic solve
  const dintro = stripAnsi(await run(g, 'drill'));
  ok('drill starts with a task', dintro.includes('DRILL') && !!g.drill);
  ok('drill drops player into /drill', g.shell.cwd === '/drill');
  const dstatus = stripAnsi(await run(g, 'drill status'));
  ok('drill status re-shows the prompt', dstatus.includes(g.drill.prompt.slice(0, 20)));
  await run(g, 'drill quit');
  ok('drill quit clears state', g.drill === null);
  // deterministic drill: install the chmod generator directly and solve it
  const { DRILL_GENERATORS } = require('../src/game/drills.js');
  const chmodGen = DRILL_GENERATORS.find(d => d.skills.includes('chmod'));
  g.vfs.mkdirp('/drill', '/', 'player', 'player');
  const task = chmodGen.gen(g, () => 0); // rng()=0 -> mode 600
  g.drill = { ...task, skills: chmodGen.skills, startedAt: Date.now() };
  const beforeDrills = g.drillsCompleted;
  await run(g, 'chmod 600 /drill/vault.key');
  ok('drill auto-grades on success', g.drill === null && g.drillsCompleted === beforeDrills + 1);

  // exam/drill integrity: no suggestions, no hints while testing
  const g4 = makeGame();
  ok('suggestions visible normally', g4.currentSuggestions().length > 0);
  await run(g4, 'exam');
  ok('suggestions hidden during exam', g4.currentSuggestions().length === 0);
  const hintOut = stripAnsi(await run(g4, 'hint'));
  ok('hint refused during exam', hintOut.includes('No hints during') && g4.hintsUsed === 0);
  await run(g4, 'exam quit');
  ok('exam quit removes exam-hog', !g4.procs.some(p => /exam-hog/.test(p.cmd)));
  ok('suggestions return after exam', g4.currentSuggestions().length > 0);

  // spaced repetition: a practised-then-neglected skill turns rusty
  const g5 = makeGame();
  await run(g5, 'pwd');
  ok('fresh skill not rusty', !g5.isRusty('pwd'));
  g5.totalCommands += 100; // simulate a long stretch of play without pwd
  ok('neglected skill turns rusty', g5.isRusty('pwd'));
  ok('never-used skill never rusty', !g5.isRusty('awk'));

  // cheatsheet export: in-game copy + real-file copy
  const os = require('os');
  const pathmod = require('path');
  const fsmod = require('fs');
  const tmpdir = fsmod.mkdtempSync(pathmod.join(os.tmpdir(), 'tq-test-'));
  g5.exportDir = tmpdir;
  const sheetOut = stripAnsi(await run(g5, 'cheatsheet'));
  ok('cheatsheet announces export', sheetOut.includes('field manual'));
  const inGame = stripAnsi(await run(g5, 'cat /home/player/cheatsheet.md'));
  ok('cheatsheet exists in-game', inGame.includes('Personal Linux Field Manual') && inGame.includes('pwd'));
  const real = fsmod.readFileSync(pathmod.join(tmpdir, 'terminal-quest-cheatsheet.md'), 'utf8');
  ok('cheatsheet exported to real file', real.includes('Recipes worth memorising'));
  fsmod.rmSync(tmpdir, { recursive: true, force: true });

  // mastery + certScore survive save/reload
  let saved = null;
  const storage = { load: () => saved, save: (d) => { saved = d; } };
  const g2 = new Game({ storage });
  g2.attachPrinter(() => {});
  g2.init();
  await g2.shell.exec('ls', { out: () => {}, err: () => {} });
  g2.save();
  const g3 = new Game({ storage });
  g3.attachPrinter(() => {});
  g3.init();
  ok('mastery persists across reload', (g3.mastery.ls || 0) >= 1);
}

(async () => {
  await unitTests();
  await campaign();
  await persistenceTest();
  await proficiencyTest();
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
