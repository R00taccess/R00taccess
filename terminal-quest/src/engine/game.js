'use strict';
/*
 * Terminal Quest — game state: levels, XP, ranks, achievements, clock,
 * fake processes/network/mail, and persistence.
 */

const { VFS } = require('./vfs');
const { Shell } = require('./shell');
const { commands } = require('./commands');
const { buildBaseWorld } = require('./world');
const { LEVELS } = require('../game/levels');
const { EXAM_TASKS, buildExam } = require('../game/exam');
const { buildDrill } = require('../game/drills');

// The transferable Linux commands proficiency is measured against. Concepts
// like pipes/redirection are tracked separately; these are the real tools.
const CORE_SKILLS = new Set([
  'whoami', 'pwd', 'ls', 'cd', 'mkdir', 'touch', 'rm', 'rmdir', 'cp', 'mv',
  'cat', 'less', 'head', 'tail', 'echo', 'wc', 'sort', 'uniq', 'cut', 'tr',
  'grep', 'find', 'du', 'df', 'chmod', 'chown', 'chgrp', 'ps', 'top', 'kill',
  'jobs', 'ping', 'ip', 'ifconfig', 'netstat', 'curl', 'ssh', 'scp',
  'ssh-keygen', 'ssh-copy-id', 'who', 'last', 'crontab', 'at', 'sed', 'awk',
  'bash', 'test', 'man', 'chmod'
]);

// One transferable mental model per level — the "why" that turns memorised
// commands into real understanding. Printed with each level's banner.
const KEY_IDEAS = {
  1: 'A shell always has an identity (which user) and a location (which directory). Orient yourself before you act.',
  2: 'Paths are absolute (from /) or relative (from where you stand). cd moves what "here" means.',
  3: 'The shell has no undo and no trash can — rm is forever. Build up carefully, tear down deliberately.',
  4: 'cp duplicates, mv relocates or renames. A glob like *.jpg lets one command act on many files at once.',
  5: 'Never guess why something broke — read the logs. tail shows the most recent, usually most relevant, events.',
  6: "A command's output can go to a file instead of the screen: > overwrites, >> appends. That's how you build files.",
  7: 'Tiny tools joined by | compose into powerful queries. sort | uniq -c | sort -nr answers "what is most common?".',
  8: "grep searches INSIDE files; -r walks a whole tree. It's how you find a needle in a filesystem haystack.",
  9: 'find locates files by metadata — name, age, size, type — not content, and can act on what it finds.',
  10: 'Diagnose top-down: df says the disk is full, du says which directory, find says which file. Measure before you delete.',
  11: 'Permissions are who (user/group/other) may do what (read/write/execute). Least privilege keeps a system safe.',
  12: 'Every program running is a process with a PID. Find it (ps/top), then signal it (kill). -9 is the last resort.',
  13: 'Network faults have layers: is the link up (ip), the host reachable (ping), the service answering (curl)? Test each.',
  14: 'SSH uses key pairs: guard the private key, share the public key. Once installed, you log in without passwords.',
  15: 'Incident response is a loop: find the intruder, cut their persistence, evict them, and change the locks.',
  16: 'A script is just commands in a file. Variables and loops let one script do repetitive work reliably.',
  17: 'Scripts make decisions with if/test and case, so one program handles many situations instead of one.',
  18: 'cron runs jobs on a schedule, so the machine maintains itself while you sleep.',
  19: 'sed and awk transform text at scale — substitute patterns, extract columns — without ever opening an editor.',
  20: 'Real operations means combining every skill under pressure: restore, reclaim, restart, re-arm — then verify.'
};

const RANKS = [
  { xp: 0, name: 'Trainee' },
  { xp: 400, name: 'Operator' },
  { xp: 1100, name: 'Sysadmin' },
  { xp: Infinity, name: 'Root Wizard' } // granted only by finishing the game
];

const ACHIEVEMENTS = {
  'first-blood':         { name: 'First Blood', desc: 'Capture your first flag.' },
  'rm-rf-survivor':      { name: 'rm -rf Survivor', desc: 'Point rm -rf at / and live to tell the tale.' },
  'plumber':             { name: 'Plumber', desc: 'Build a pipeline with 4 or more commands.' },
  'pipemaster':          { name: 'Pipemaster', desc: 'Build a pipeline with 10 or more commands.' },
  'midnight-commander':  { name: 'Midnight Commander', desc: 'Fix a system between 02:00 and 04:00 in-game time.' },
  'no-man-needed':       { name: 'No man Needed', desc: 'Clear a level without opening a single man page.' },
  'speed-demon':         { name: 'Speed Demon', desc: 'Clear a level in under two minutes.' },
  'bovine-intervention': { name: 'Bovine Intervention', desc: 'Consult the cow.' },
  'fortune-teller':      { name: 'Fortune Teller', desc: 'Seek wisdom from fortune.' },
  'all-aboard':          { name: 'All Aboard', desc: 'Mistype ls badly enough to summon a train.' },
  'reported':            { name: 'This Incident Will Be Reported', desc: 'Get told off by sudo.' },
  'boss-slayer':         { name: 'Boss Slayer', desc: 'Survive the Disk Crisis.' },
  'ghostbuster':         { name: 'Ghostbuster', desc: 'Evict an intruder from the system.' },
  'journeyman':          { name: 'Journeyman', desc: 'Use 20 different Linux commands correctly.' },
  'gym-rat':             { name: 'Gym Rat', desc: 'Complete 10 practice drills.' },
  'fluent':              { name: 'Fluent in Shell', desc: 'Reach proficient (3+ correct uses) on 15 commands.' },
  'certified':           { name: 'Certified Operator', desc: 'Pass the OmniCorp certification exam.' },
  'root-wizard':         { name: 'Root Wizard', desc: 'Complete Terminal Quest.' }
};

// Beginner scaffolding: concrete command suggestions shown at level start and
// as tappable chips. Hand-holding is heavy early and thins out, so by the time
// suggestions stop (level 9+) the player is expected to reason unaided.
const LEVEL_SUGGESTIONS = {
  1: [
    { cmd: 'whoami', desc: 'who am I logged in as?' },
    { cmd: 'pwd', desc: 'which directory am I in?' },
    { cmd: 'ls', desc: 'what files are here?' },
    { cmd: 'cat welcome.txt', desc: 'read the onboarding note' }
  ],
  2: [
    { cmd: 'cd /opt/maze', desc: 'enter the maze' },
    { cmd: 'ls', desc: 'look around the room' },
    { cmd: 'cat clue.txt', desc: 'read the note for the next step' },
    { cmd: 'cd ..', desc: 'go back up one level' }
  ],
  3: [
    { cmd: 'cd ~/project-falcon', desc: 'go into the messy folder' },
    { cmd: 'ls -a', desc: 'see everything, incl. hidden junk' },
    { cmd: 'mkdir src docs', desc: 'create the required folders' },
    { cmd: 'touch README.md', desc: 'create the empty README' },
    { cmd: 'rmdir old', desc: 'remove the empty old/ dir' }
  ],
  4: [
    { cmd: 'cd ~/photos', desc: 'go to the archive' },
    { cmd: 'cp evidence.jpg evidence.jpg.bak', desc: 'back up the precious file first' },
    { cmd: 'mkdir 2026-01-03', desc: 'make a date folder (do all three)' },
    { cmd: 'mv 2026-01-03_*.jpg 2026-01-03/', desc: 'file photos by date with a glob' }
  ],
  5: [
    { cmd: 'tail -n 40 /var/log/billing.log', desc: 'outages show up near the end' },
    { cmd: 'head /var/log/billing.log', desc: 'peek at the start' },
    { cmd: 'less /var/log/billing.log', desc: 'page through it all' }
  ],
  6: [
    { cmd: 'echo "STATUS: OK" > report.txt', desc: 'create the file (overwrite)' },
    { cmd: 'echo "CHECKED-BY: player" >> report.txt', desc: 'append the 2nd line' },
    { cmd: 'cat report.txt', desc: 'verify both lines' }
  ],
  7: [
    { cmd: 'sort FILE | uniq -c', desc: 'count each unique line (sort first!)' },
    { cmd: '... | sort -nr', desc: 'rank the counts, biggest on top' },
    { cmd: '... | head -1', desc: 'keep just the champion' }
  ],
  8: [
    { cmd: 'grep PATTERN FILE', desc: 'search one file' },
    { cmd: 'grep -r PATTERN /dir', desc: 'search a whole tree' },
    { cmd: 'grep -rn PATTERN /dir', desc: 'add line numbers' }
  ],
  // Mid-game: generic command PATTERNS only — a nudge toward the right tool,
  // not the answer. (Boss levels 10, 15, 20 deliberately get no chips.)
  9: [
    { cmd: 'find /path -name "*.ext"', desc: 'match by name' },
    { cmd: 'find /path -mtime +30', desc: 'older than 30 days' },
    { cmd: 'find /path -name "*.x" -mtime +30 -delete', desc: 'list first, THEN add -delete' }
  ],
  11: [
    { cmd: 'ls -l /path', desc: 'inspect current permissions' },
    { cmd: 'chown :group /path', desc: 'set the group' },
    { cmd: 'chmod 750 /dir', desc: 'rwxr-x---' },
    { cmd: 'chmod 600 /file', desc: 'rw-------' }
  ],
  12: [
    { cmd: 'ps aux | grep NAME', desc: 'find a process + its PID' },
    { cmd: 'top', desc: 'see the CPU hog on top' },
    { cmd: 'kill -9 PID', desc: 'force-kill a stubborn process' }
  ],
  13: [
    { cmd: 'ip addr', desc: 'is the interface UP?' },
    { cmd: 'sudo ip link set eth0 up', desc: 'bring the link up' },
    { cmd: 'ping -c 3 HOST', desc: 'is the host reachable?' },
    { cmd: 'curl http://HOST/PATH', desc: 'is the service answering?' }
  ],
  14: [
    { cmd: 'ssh-keygen', desc: 'make your key pair' },
    { cmd: 'ssh-copy-id USER@HOST', desc: 'install your public key' },
    { cmd: 'ssh USER@HOST cat /path/file', desc: 'read a remote file' }
  ],
  16: [
    { cmd: "echo '#!/bin/bash' > script.sh", desc: 'start a script' },
    { cmd: 'for n in 1 2 3; do echo $n; done', desc: 'loop over a list' },
    { cmd: 'bash script.sh', desc: 'run it' }
  ],
  17: [
    { cmd: 'case "$1" in a) echo A;; *) echo ?;; esac', desc: 'branch on the argument' },
    { cmd: 'if [ "$1" = start ]; then echo go; fi', desc: 'if/test alternative' },
    { cmd: 'bash script.sh start', desc: 'run with an argument' }
  ],
  18: [
    { cmd: 'echo "M H * * * /path/cmd" > mycron', desc: 'min hour * * * command' },
    { cmd: 'crontab mycron', desc: 'install the schedule' },
    { cmd: 'crontab -l', desc: 'verify it' }
  ],
  19: [
    { cmd: "awk -F'|' '{print $3}' FILE", desc: 'print the 3rd |-field' },
    { cmd: "awk -F'|' '/^42\\|/' FILE", desc: 'the row starting with 42' },
    { cmd: "sed 's/old/new/g' FILE", desc: 'substitute text' }
  ]
};

class Game {
  constructor({ storage }) {
    this.storage = storage || { load: () => null, save: () => {} };
    this.printer = null;
    this.printQueue = [];
    this.onStateChange = null; // UI callback (compendium refresh, etc.)

    this.levels = LEVELS;
    this.levelIndex = 0;
    this.xp = 0;
    this.achievements = new Set();
    this.history = [];
    this.totalCommands = 0;
    this.completionTimes = {};
    this.finished = false;
    this.mastery = {};       // command name -> count of correct uses
    this.exam = null;        // active certification-exam state, or null
    this.certScore = null;   // best certification score achieved (%)
    this.drill = null;       // active practice drill, or null
    this.drillsCompleted = 0;
    this.lastUsed = {};      // command name -> totalCommands index of last correct use

    // per-level trackers
    this.hintsUsed = 0;
    this.hintStep = 0;
    this.manReadThisLevel = false;
    this.levelStartedAt = Date.now();
    this.levelState = {}; // scratch space for the active level

    // world state (populated by buildBaseWorld + level setups)
    this.procs = [];
    this.jobs = [];
    this.network = null;
    this.sessions = [];
    this.lastLog = [];
    this.crontabs = {};
    this.atJobs = [];
    this.tarballs = {};
    this.mailbox = [];
    this.disk = { baseUsedKB: 180000 };
    this.sudoUnlocked = false;
    this.sshAuthorized = new Set();
    this.nextPid = 4000;

    // in-game clock: Monday 09:00, advances with every command
    this.gameMinutes = 9 * 60;
    this.bootAt = Date.now();
  }

  // ---- lifecycle ----------------------------------------------------------

  init() {
    const save = this.storage.load();
    if (save) {
      this.levelIndex = Math.min(save.levelIndex || 0, this.levels.length);
      this.xp = save.xp || 0;
      this.achievements = new Set(save.achievements || []);
      this.history = save.history || [];
      this.totalCommands = save.totalCommands || 0;
      this.completionTimes = save.completionTimes || {};
      this.finished = !!save.finished;
      this.gameMinutes = save.gameMinutes || 9 * 60;
      this.mastery = save.mastery || {};
      this.certScore = save.certScore != null ? save.certScore : null;
      this.drillsCompleted = save.drillsCompleted || 0;
      this.lastUsed = save.lastUsed || {};
    }
    this.rebuildWorld();
    this.shell = new Shell({ vfs: this.vfs, game: this, commands, user: this.playerUser() });
    if (this.levelIndex >= this.levels.length) this.levelIndex = this.levels.length - 1;
    this.startLevel(this.levelIndex, { resumed: !!save });
    return this;
  }

  playerUser() { return { name: 'player', groups: ['player', 'devteam'] }; }
  rootUser() { return { name: 'root', groups: ['root'] }; }

  rebuildWorld() {
    this.vfs = new VFS();
    this.procs = [];
    this.jobs = [];
    this.crontabs = {};
    this.atJobs = [];
    this.tarballs = {};
    this.mailbox = [{
      from: 'it-onboarding@omnicorp',
      subject: 'Welcome to OmniCorp',
      body: 'Your terminal is live. Type `help` anytime. Briefings from Alex will\narrive in this mailbox — read them with `mail`.'
    }];
    this.sudoUnlocked = false;
    this.sshAuthorized = new Set();
    this.disk = { baseUsedKB: 180000 };
    buildBaseWorld(this);
    // replay completed levels so the world is cumulative and consistent
    for (let i = 0; i < this.levelIndex && i < this.levels.length; i++) {
      const lvl = this.levels[i];
      if (lvl.setup) lvl.setup(this);
      if (lvl.cleanupAfter) lvl.cleanupAfter(this);
    }
    if (this.shell) {
      this.shell.vfs = this.vfs;
      if (!this.vfs.statOrNull(this.shell.cwd, '/', this.shell.user)) {
        this.shell.cwd = this.shell.env.HOME;
        this.shell.env.PWD = this.shell.cwd;
      }
    }
  }

  save() {
    this.storage.save({
      levelIndex: this.levelIndex,
      xp: this.xp,
      achievements: [...this.achievements],
      history: this.history.slice(-500),
      totalCommands: this.totalCommands,
      completionTimes: this.completionTimes,
      finished: this.finished,
      gameMinutes: this.gameMinutes,
      mastery: this.mastery,
      certScore: this.certScore,
      drillsCompleted: this.drillsCompleted,
      lastUsed: this.lastUsed
    });
  }

  // ---- output -------------------------------------------------------------

  print(s) {
    if (this.printer) this.printer(s);
    else this.printQueue.push(s);
  }

  attachPrinter(fn) {
    this.printer = fn;
    for (const s of this.printQueue) fn(s);
    this.printQueue = [];
  }

  changed() { if (this.onStateChange) this.onStateChange(); }

  // ---- clock --------------------------------------------------------------

  tickClock(mins = 7) { this.gameMinutes = (this.gameMinutes + mins) % (7 * 24 * 60); }
  now() { return Date.now(); }
  clockString() {
    const h = Math.floor(this.gameMinutes / 60) % 24;
    const m = this.gameMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  }
  dateString() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const d = days[Math.floor(this.gameMinutes / (24 * 60)) % 7];
    return `${d} Jan  5 ${this.clockString()} UTC 2026`;
  }
  uptime() {
    const mins = Math.floor((Date.now() - this.bootAt) / 60000) + 42;
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
  }

  // ---- XP / rank / achievements --------------------------------------------

  rank() {
    if (this.finished) return 'Root Wizard';
    let r = RANKS[0].name;
    for (const { xp, name } of RANKS) if (this.xp >= xp) r = name;
    return r;
  }

  addXP(n, reason) {
    const before = this.rank();
    this.xp = Math.max(0, this.xp + n);
    if (n > 0 && reason) this.print(`\x1b[32m[+${n} XP] ${reason}\x1b[0m\n`);
    if (n < 0 && reason) this.print(`\x1b[33m[${n} XP] ${reason}\x1b[0m\n`);
    const after = this.rank();
    if (after !== before && !this.finished) {
      this.print(`\x1b[1;33m★ PROMOTION — you are now: ${after} ★\x1b[0m\n`);
    }
    this.changed();
  }

  unlock(id) {
    if (this.achievements.has(id) || !ACHIEVEMENTS[id]) return;
    this.achievements.add(id);
    const a = ACHIEVEMENTS[id];
    this.print(`\x1b[1;35m🏆 ACHIEVEMENT UNLOCKED: ${a.name} — ${a.desc}\x1b[0m\n`);
    this.addXP(25, null);
    this.save();
    this.changed();
  }

  // ---- level flow -----------------------------------------------------------

  level() { return this.levels[this.levelIndex]; }

  startLevel(idx, { resumed = false } = {}) {
    this.levelIndex = idx;
    const lvl = this.level();
    this.hintsUsed = 0;
    this.hintStep = 0;
    this.manReadThisLevel = false;
    this.levelStartedAt = Date.now();
    this.levelState = {};
    if (!resumed && lvl.setup) lvl.setup(this);
    if (resumed && lvl.setup) lvl.setup(this); // resumed sessions rebuild it too
    this.mailbox.push({
      from: lvl.mailFrom || 'alex@omnicorp',
      subject: `[Level ${lvl.id}] ${lvl.name}`,
      body: lvl.briefing
    });
    this.print('\n' + this.levelBanner(lvl));
    if (lvl.commands && lvl.commands.length) {
      this.print(`\x1b[1;36m  ▸ NEW TOOLS:\x1b[0m \x1b[36m${lvl.commands.join('  ')}\x1b[0m   \x1b[90m(try: man ${lvl.commands.filter(c => /^[a-z]/.test(c))[0] || lvl.commands[0]})\x1b[0m\n`);
    }
    const idea = KEY_IDEAS[lvl.id];
    if (idea) {
      this.print(`\x1b[1;35m  ◆ KEY IDEA:\x1b[0m \x1b[35m${idea}\x1b[0m\n`);
    }
    this.print('\n' + this.colorBriefing(lvl.briefing.trim()) + '\n');
    // Beginner levels teach with concrete, ready-to-run command suggestions.
    const sug = this.currentSuggestions();
    if (sug.length) {
      this.print('\n\x1b[1;33m  ┌─ SUGGESTED COMMANDS ' + '─'.repeat(38) + '┐\x1b[0m\n');
      this.print('\x1b[33m  │\x1b[0m \x1b[90mTap a chip below (or type these) to get going:\x1b[0m\n');
      for (const s of sug) {
        this.print(`\x1b[33m  │\x1b[0m   \x1b[1;32m${s.cmd.padEnd(34)}\x1b[0m \x1b[90m${s.desc || ''}\x1b[0m\n`);
      }
      this.print('\x1b[1;33m  └' + '─'.repeat(59) + '┘\x1b[0m\n');
    }
    this.print('\n\x1b[90m  mission\x1b[0m re-read · \x1b[90mtutorial\x1b[0m walkthrough · \x1b[90mhint\x1b[0m clue · \x1b[90mman <cmd>\x1b[0m manual · \x1b[90mF1\x1b[0m compendium\n\n');
    this.save();
    this.changed();
  }

  // A framed, coloured level banner in the spirit of classic terminal games.
  levelBanner(lvl) {
    const W = 60;
    const isBoss = /boss/i.test(lvl.name);
    const c = isBoss ? '1;31' : '1;32';   // red frame for boss levels
    const accent = isBoss ? '1;33' : '1;36';
    const title = `LEVEL ${lvl.id}`;
    const name = lvl.name.replace(/^BOSS:\s*/i, '').replace(/^FINAL BOSS:\s*/i, '');
    const tag = isBoss ? (/final/i.test(lvl.name) ? '☠  FINAL BOSS  ☠' : '⚠  BOSS FIGHT  ⚠') : '';
    const top = `╔${'═'.repeat(W)}╗`;
    const bot = `╚${'═'.repeat(W)}╝`;
    const pad = (s) => {
      // s may contain no ansi; center within W
      const len = [...s].length;
      const left = Math.max(0, Math.floor((W - len) / 2));
      const right = Math.max(0, W - len - left);
      return ' '.repeat(left) + s + ' '.repeat(right);
    };
    let out = `\x1b[${c}m${top}\x1b[0m\n`;
    if (tag) out += `\x1b[${c}m║\x1b[0m\x1b[${accent}m${pad(tag)}\x1b[0m\x1b[${c}m║\x1b[0m\n`;
    out += `\x1b[${c}m║\x1b[0m\x1b[1;37m${pad(title + ' — ' + name)}\x1b[0m\x1b[${c}m║\x1b[0m\n`;
    out += `\x1b[${c}m${bot}\x1b[0m\n`;
    return out;
  }

  // Lightly colour a briefing: highlight `code`, UPPERCASE LABELS: and bullets.
  colorBriefing(text) {
    return text.split('\n').map(line => {
      let l = line;
      l = l.replace(/`([^`]+)`/g, '\x1b[1;36m$1\x1b[0m');
      l = l.replace(/^(\s*[•\-]\s)/, '\x1b[33m$1\x1b[0m');
      l = l.replace(/^(\s*\d+\.\s)/, '\x1b[33m$1\x1b[0m');
      l = l.replace(/^([A-Z][A-Za-z ]+:)(\s)/, '\x1b[1;33m$1\x1b[0m$2');
      l = l.replace(/(echo\s+[^\n]*>\s*\/dev\/exit)/g, '\x1b[1;32m$1\x1b[0m');
      return l;
    }).join('\n');
  }

  // Suggestions shown for beginner levels; fade out as the player levels up.
  // Never shown during a drill or the certification exam — those are unaided.
  currentSuggestions() {
    if (this.exam || this.drill) return [];
    const lvl = this.level();
    if (!lvl) return [];
    return (LEVEL_SUGGESTIONS[lvl.id] || []);
  }

  showBriefing(ctx) { ctx.out('\n\x1b[1mLEVEL ' + this.level().id + ' — ' + this.level().name + '\x1b[0m\n\n' + this.level().briefing.trim() + '\n\n'); }

  showTutorial(ctx) {
    const lvl = this.level();
    ctx.out('\n\x1b[1;36m── SANDBOX WALKTHROUGH — try these safely, nothing here can break ──\x1b[0m\n');
    ctx.out(lvl.tutorial.trim() + '\n\n');
  }

  giveHint(ctx) {
    if (this.exam) {
      ctx.out('\x1b[33mThe proctor looks up slowly and shakes her head. No hints during\ncertification — that is the whole point. (exam quit to abandon.)\x1b[0m\n');
      return;
    }
    if (this.drill) {
      ctx.out('\x1b[33mDrills are unaided practice — no hints. If it is too hard right now,\n\x1b[0m\x1b[1;35mdrill quit\x1b[0m\x1b[33m costs nothing and the level hints still work.\x1b[0m\n');
      return;
    }
    const lvl = this.level();
    if (this.hintStep >= lvl.hints.length) {
      ctx.out('\x1b[33mNo more hints for this level — you have everything you need.\x1b[0m\n');
      return;
    }
    const h = lvl.hints[this.hintStep++];
    this.hintsUsed++;
    ctx.out(`\x1b[33mHINT ${this.hintStep}/${lvl.hints.length}: ${h}\x1b[0m\n`);
    this.addXP(-10, 'hint used');
  }

  resetLevel(ctx) {
    this.rebuildWorld();
    const lvl = this.level();
    if (lvl.setup) lvl.setup(this);
    ctx.out('\x1b[33mLevel rebuilt. Your files for this puzzle are back in their starting state.\x1b[0m\n');
  }

  trySubmit(text, ctx) {
    const out = (s) => (ctx ? ctx.out(s) : this.print(s));
    if (this.finished && this.levelIndex >= this.levels.length - 1) {
      out('The mainframe is at peace. There is nothing left to submit.\n');
      return;
    }
    const lvl = this.level();
    let ok = false;
    try {
      ok = lvl.check ? lvl.check(this, text) : (lvl.flag && text === lvl.flag);
    } catch (e) { ok = false; }
    if (ok) this.completeLevel(out);
    else {
      out('\x1b[1;31mACCESS DENIED — that is not the right token for this gate.\x1b[0m\n');
      if (lvl.denyText) out(lvl.denyText + '\n');
      this.addXP(-2, null);
    }
  }

  completeLevel(out) {
    const lvl = this.level();
    const secs = Math.round((Date.now() - this.levelStartedAt) / 1000);
    this.completionTimes[lvl.id] = secs;
    out('\n\x1b[1;32m✔ GATE UNLOCKED — LEVEL ' + lvl.id + ' COMPLETE\x1b[0m\n');
    if (lvl.successText) out(lvl.successText.trim() + '\n');
    const bonus = this.hintsUsed === 0 ? 25 : 0;
    this.addXP(lvl.xp + bonus, `level ${lvl.id} cleared${bonus ? ' (no hints!)' : ''} in ${secs}s`);
    this.unlock('first-blood');
    if (secs < 120) this.unlock('speed-demon');
    if (!this.manReadThisLevel) this.unlock('no-man-needed');
    const hour = Math.floor(this.gameMinutes / 60) % 24;
    if (hour >= 2 && hour < 4) this.unlock('midnight-commander');
    if (lvl.id === 10) this.unlock('boss-slayer');
    if (lvl.id === 15) this.unlock('ghostbuster');
    if (lvl.cleanupAfter) lvl.cleanupAfter(this);
    if (this.levelIndex + 1 >= this.levels.length) {
      this.endGame(out);
      return;
    }
    this.levelIndex++;
    this.save();
    this.startLevel(this.levelIndex);
  }

  endGame(out) {
    this.finished = true;
    this.save();
    out('\n\x1b[1;33m');
    out([
      '        *  .  ✦       .          *      .   ✦',
      '   ✦      ____                        *        .',
      '     .   |  _ \\ ___   ___ | |_    .      ✦',
      '         | |_) / _ \\ / _ \\| __|      W I Z A R D',
      '  *      |  _ < (_) | (_) | |_   .        *',
      '         |_| \\_\\___/ \\___/ \\__|     .  ✦     .',
      '',
      '        ┌─────────────────────────────────┐',
      '        │   RANK ACHIEVED: ROOT WIZARD    │',
      '        │   The mainframe kneels to you.  │',
      '        └─────────────────────────────────┘'
    ].join('\n') + '\x1b[0m\n\n');
    out('The Director appears behind you. "Not bad, kid," she says, and drops a\nreal Linux USB stick on your desk. "Now go do it where it counts."\n\n');
    out(`Final score: ${this.xp} XP · ${this.achievements.size} achievements · total commands: ${this.totalCommands}\n`);
    out('Every command you used here works exactly the same on real Linux. Go play.\n\n');
    this.unlock('root-wizard');
    out('\x1b[1;36m  ▸ ONE THING LEFT:\x1b[0m the certification. Prove your skills with no hints,\n');
    out('    no suggestions — type \x1b[1;33mexam\x1b[0m to take the OmniCorp Operator test.\n');
    out('    Type \x1b[1;33mskills\x1b[0m for your mastery matrix, \x1b[1;33mdrill\x1b[0m to sharpen weak spots first,\n');
    out('    and \x1b[1;33mcheatsheet\x1b[0m to export your personal field manual for the real world.\n\n');
    this.changed();
  }

  // ---- progress displays ----------------------------------------------------

  showProgress(ctx) {
    const lvl = this.level();
    const nextRank = RANKS.find(r => r.xp > this.xp);
    ctx.out('\n\x1b[1m── OMNICORP PERSONNEL FILE ──\x1b[0m\n');
    ctx.out(`  Operator : ${this.shell.user.name}\n`);
    ctx.out(`  Rank     : ${this.rank()}${nextRank && !this.finished && nextRank.xp !== Infinity ? `  (next at ${nextRank.xp} XP)` : ''}\n`);
    ctx.out(`  XP       : ${this.xp}\n`);
    ctx.out(`  Level    : ${lvl.id}/${this.levels.length} — ${lvl.name}${this.finished ? ' (GAME COMPLETE)' : ''}\n`);
    ctx.out(`  Commands : ${this.totalCommands} executed\n`);
    const distinct = Object.keys(this.mastery).length;
    const proficient = Object.values(this.mastery).filter(n => n >= 3).length;
    ctx.out(`  Skills   : ${distinct} used · ${proficient} proficient  (see: skills)\n`);
    if (this.certScore != null) ctx.out(`  Cert     : \x1b[1;33mCERTIFIED OPERATOR (${this.certScore}%)\x1b[0m\n`);
    ctx.out(`  Clock    : ${this.dateString()}\n`);
    ctx.out(`  Unlocked : ${[...this.achievements].length}/${Object.keys(ACHIEVEMENTS).length} achievements (see: achievements)\n\n`);
  }

  showAchievements(ctx) {
    ctx.out('\n\x1b[1m── ACHIEVEMENTS ──\x1b[0m\n');
    for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
      const got = this.achievements.has(id);
      ctx.out(`  ${got ? '\x1b[32m[✔]' : '\x1b[90m[ ]'} ${a.name.padEnd(34)} ${got ? a.desc : '???'}\x1b[0m\n`);
    }
    ctx.out('\n');
  }

  learnedCommands() {
    const cmds = [];
    for (let i = 0; i <= this.levelIndex && i < this.levels.length; i++) {
      for (const c of this.levels[i].commands || []) if (!cmds.includes(c)) cmds.push(c);
    }
    return cmds;
  }

  // ---- command accounting / events -------------------------------------------

  recordHistory(line) {
    if (line.trim()) this.history.push(line);
  }

  noteCommand(name, args, code, entry) {
    this.totalCommands++;
    this.tickClock();
    if (code === 0) this.xp += 1; // silent trickle for correct usage
    else if (code !== 0 && code !== 1) this.xp = Math.max(0, this.xp - 1);
    this.noteMastery(name, code);
    const lvl = this.level();
    if (lvl && lvl.onEvent) lvl.onEvent(this, 'command', { name, args, code });
    if (this.exam) this.examTick();
    if (this.drill) this.drillTick();
    this.changed();
  }

  // ---- proficiency / mastery -------------------------------------------------

  noteMastery(name, code) {
    if (code !== 0 || !CORE_SKILLS.has(name)) return;
    this.mastery[name] = (this.mastery[name] || 0) + 1;
    this.lastUsed[name] = this.totalCommands;
    const distinct = Object.keys(this.mastery).length;
    if (distinct >= 20) this.unlock('journeyman');
    const proficient = Object.values(this.mastery).filter(n => n >= 3).length;
    if (proficient >= 15) this.unlock('fluent');
  }

  // A skill is "rusty" when it was practised before but hasn't been touched
  // for a long stretch of play — spaced repetition targets exactly these.
  isRusty(name) {
    const n = this.mastery[name] || 0;
    if (n === 0) return false;
    const last = this.lastUsed[name];
    if (last === undefined) return false;
    return this.totalCommands - last >= 80;
  }

  masteryTier(count) { return count >= 3 ? 2 : count >= 1 ? 1 : 0; }

  showSkills(ctx) {
    const learned = this.learnedCommands().filter(c => CORE_SKILLS.has(c));
    const dots = ['\x1b[90m○ new\x1b[0m', '\x1b[33m◑ familiar\x1b[0m', '\x1b[1;32m● proficient\x1b[0m'];
    ctx.out('\n\x1b[1m── SKILLS MATRIX — what you have actually practised ──\x1b[0m\n');
    ctx.out('  \x1b[90m○ met it\x1b[0m   \x1b[33m◑ used it 1-2×\x1b[0m   \x1b[1;32m● proficient (3+×)\x1b[0m   \x1b[35m◌ rusty\x1b[0m\n\n');
    if (!learned.length) { ctx.out('  (no core commands learned yet)\n\n'); return; }
    let prof = 0, fam = 0, rusty = 0;
    const cols = 3;
    const cells = learned.map(c => {
      const n = this.mastery[c] || 0;
      const t = this.masteryTier(n);
      if (t === 2) prof++; else if (t === 1) fam++;
      const isRusty = this.isRusty(c);
      if (isRusty) rusty++;
      const mark = isRusty ? '\x1b[35m◌' : t === 2 ? '\x1b[1;32m●' : t === 1 ? '\x1b[33m◑' : '\x1b[90m○';
      return `${mark} ${c.padEnd(12)} ${String(n).padStart(2)}×\x1b[0m`;
    });
    for (let i = 0; i < cells.length; i += cols) {
      ctx.out('  ' + cells.slice(i, i + cols).join('  ') + '\n');
    }
    const total = learned.length;
    const pct = Math.round((prof / total) * 100);
    ctx.out(`\n  Proficient: \x1b[1;32m${prof}\x1b[0m/${total}   Familiar: \x1b[33m${fam}\x1b[0m   ` +
            `Mastery: \x1b[1;36m${pct}%\x1b[0m\n`);
    if (rusty) {
      ctx.out(`  \x1b[35m◌ ${rusty} skill${rusty > 1 ? 's are' : ' is'} getting rusty\x1b[0m \x1b[90m(not used in a while — \x1b[0m\x1b[1;35mdrill\x1b[0m\x1b[90m targets these first)\x1b[0m\n`);
    }
    if (this.finished) {
      ctx.out(`  \x1b[90mReady for the finish line — type \x1b[0m\x1b[1;33mexam\x1b[0m\x1b[90m for the certification test.\x1b[0m\n`);
    }
    ctx.out('\n');
  }

  // ---- certification exam ----------------------------------------------------

  startExam(ctx) {
    if (this.exam) { this.showExamStatus(ctx); return; }
    const { errCount } = buildExam(this);
    this.exam = { done: new Set(), startedAt: Date.now(), errCount };
    // land the player in the exam sandbox
    try { this.shell.chdir('/exam'); } catch (e) {}
    ctx.out('\n\x1b[1;36m╔══════════════════════════════════════════════════════════════╗\x1b[0m\n');
    ctx.out('\x1b[1;36m║          OMNICORP OPERATOR CERTIFICATION EXAM                 ║\x1b[0m\n');
    ctx.out('\x1b[1;36m╚══════════════════════════════════════════════════════════════╝\x1b[0m\n');
    ctx.out('No hints. No suggestions. Your sandbox is \x1b[1;36m/exam\x1b[0m (you are now in it).\n');
    ctx.out('Complete every task below — each is graded automatically the moment you\n');
    ctx.out('get it right. Type \x1b[1;32mexam status\x1b[0m to review, \x1b[1;32mexam quit\x1b[0m to abandon.\n');
    this.showExamStatus(ctx);
    this.examTick(ctx);
  }

  showExamStatus(ctx) {
    if (!this.exam) { ctx.out('No exam in progress. Type \x1b[1;32mexam\x1b[0m to begin the certification.\n'); return; }
    ctx.out('\n\x1b[1m── CERTIFICATION TASKS ──\x1b[0m\n');
    EXAM_TASKS.forEach((t, i) => {
      const done = this.exam.done.has(t.id);
      const mark = done ? '\x1b[1;32m[✔]' : '\x1b[90m[ ]';
      ctx.out(`  ${mark} ${String(i + 1).padStart(2)}. \x1b[1m${t.skill}\x1b[0m\x1b[0m\n`);
      ctx.out(`        \x1b[90m${t.prompt}\x1b[0m\n`);
    });
    ctx.out(`\n  Progress: \x1b[1;32m${this.exam.done.size}\x1b[0m/${EXAM_TASKS.length}\n\n`);
  }

  examTick(ctx) {
    if (!this.exam) return;
    const out = (s) => (ctx ? ctx.out(s) : this.print(s));
    for (const t of EXAM_TASKS) {
      if (this.exam.done.has(t.id)) continue;
      let ok = false;
      try { ok = t.check(this); } catch (e) { ok = false; }
      if (ok) {
        this.exam.done.add(t.id);
        this.print(`\x1b[1;32m  ✔ Task passed: ${t.skill}\x1b[0m  \x1b[90m(${this.exam.done.size}/${EXAM_TASKS.length})\x1b[0m\n`);
      }
    }
    if (this.exam.done.size === EXAM_TASKS.length) this.finishExam();
  }

  finishExam() {
    const secs = Math.round((Date.now() - this.exam.startedAt) / 1000);
    const score = 100;
    this.certScore = Math.max(this.certScore || 0, score);
    this.exam = null;
    this.print('\n\x1b[1;33m╔══════════════════════════════════════════════════════════════╗\x1b[0m\n');
    this.print('\x1b[1;33m║   ★  CERTIFIED OMNICORP OPERATOR  ★                           ║\x1b[0m\n');
    this.print(`\x1b[1;33m║   All ${EXAM_TASKS.length} tasks passed unaided · score ${score}% · ${String(secs).padStart(4)}s${' '.repeat(20)}║\x1b[0m\n`);
    this.print('\x1b[1;33m╚══════════════════════════════════════════════════════════════╝\x1b[0m\n');
    this.print('You solved real Linux tasks with no hints and no suggestions. That is\nexactly what proficiency looks like. Every one of these works identically\non a real machine — go run them there.\n\n');
    this.unlock('certified');
    this.addXP(300, 'certification passed');
    this.save();
    this.changed();
  }

  quitExam(ctx) {
    if (!this.exam) { ctx.out('No exam in progress.\n'); return; }
    this.exam = null;
    this.procs = this.procs.filter(p => !/exam-hog/.test(p.cmd));
    ctx.out('\x1b[33mExam abandoned. Your sandbox stays in /exam; type \x1b[0m\x1b[1;32mexam\x1b[0m\x1b[33m to start fresh anytime.\x1b[0m\n');
  }

  // ---- drill mode (targeted practice) -----------------------------------------

  startDrill(ctx) {
    if (this.exam) { ctx.out('Finish (or quit) the exam first — one test at a time.\n'); return; }
    const seed = (Date.now() ^ (this.drillsCompleted * 2654435761)) >>> 0;
    const task = buildDrill(this, seed);
    this.drill = { ...task, seed, startedAt: Date.now() };
    try { this.shell.chdir('/drill'); } catch (e) {}
    ctx.out('\n\x1b[1;35m╭─ DRILL ' + '─'.repeat(52) + '╮\x1b[0m\n');
    ctx.out(`\x1b[35m│\x1b[0m \x1b[90mtargets:\x1b[0m \x1b[36m${task.skills.join(', ')}\x1b[0m` +
            `   \x1b[90m(picked from your weakest skills — see: skills)\x1b[0m\n`);
    ctx.out(`\x1b[35m│\x1b[0m ${task.prompt}\n`);
    ctx.out('\x1b[35m│\x1b[0m \x1b[90mGraded automatically when the state is right · drill quit to bail\x1b[0m\n');
    ctx.out('\x1b[1;35m╰' + '─'.repeat(60) + '╯\x1b[0m\n');
    ctx.out('\x1b[90m(you are now in /drill — no hints, any valid approach passes)\x1b[0m\n');
  }

  drillTick() {
    if (!this.drill) return;
    let ok = false;
    try { ok = this.drill.check(this); } catch (e) { ok = false; }
    if (!ok) return;
    const secs = Math.round((Date.now() - this.drill.startedAt) / 1000);
    this.drill = null;
    this.drillsCompleted++;
    this.print(`\x1b[1;32m  ✔ DRILL PASSED\x1b[0m \x1b[90m(${secs}s · ${this.drillsCompleted} total)\x1b[0m — type \x1b[1;35mdrill\x1b[0m for another.\n`);
    this.addXP(15, 'drill completed');
    if (this.drillsCompleted >= 10) this.unlock('gym-rat');
    this.save();
  }

  quitDrill(ctx) {
    if (!this.drill) { ctx.out('No drill in progress. Type \x1b[1;35mdrill\x1b[0m to start one.\n'); return; }
    this.drill = null;
    this.procs = this.procs.filter(p => !/drill-hog/.test(p.cmd));
    ctx.out('\x1b[33mDrill abandoned. No XP lost — type \x1b[0m\x1b[1;35mdrill\x1b[0m\x1b[33m whenever you want to spar again.\x1b[0m\n');
  }

  showDrillStatus(ctx) {
    if (!this.drill) { ctx.out('No drill in progress. Type \x1b[1;35mdrill\x1b[0m to start one.\n'); return; }
    ctx.out(`\x1b[1;35mCurrent drill\x1b[0m \x1b[90m(targets: ${this.drill.skills.join(', ')})\x1b[0m\n  ${this.drill.prompt}\n`);
  }

  // ---- graduation cheat sheet --------------------------------------------------
  // A personalized reference the player takes with them to a real terminal:
  // every command they learned, their own usage counts, and the key ideas.

  buildCheatsheet() {
    const { MAN_PAGES } = require('./man');
    const lines = [];
    lines.push('# Terminal Quest — Personal Linux Field Manual');
    lines.push('');
    lines.push(`Generated for **${this.shell ? this.shell.user.name : 'player'}** · rank **${this.rank()}**` +
      ` · ${this.xp} XP · ${this.totalCommands} commands run` +
      (this.certScore != null ? ` · **Certified Operator (${this.certScore}%)**` : ''));
    lines.push('');
    lines.push('Everything below works identically on real Linux. This sheet lists only');
    lines.push('what YOU learned and practised in the game.');
    lines.push('');
    lines.push('## The big ideas');
    lines.push('');
    for (let i = 0; i < this.levels.length && i <= this.levelIndex; i++) {
      const idea = KEY_IDEAS[this.levels[i].id];
      if (idea) lines.push(`- ${idea}`);
    }
    lines.push('');
    lines.push('## Your commands');
    lines.push('');
    lines.push('| Command | Practised | One-liner |');
    lines.push('|---------|-----------|-----------|');
    for (const c of this.learnedCommands()) {
      if (!CORE_SKILLS.has(c)) continue;
      const n = this.mastery[c] || 0;
      const tier = n >= 3 ? '● proficient' : n >= 1 ? '◑ familiar' : '○ not yet practised';
      let one = '';
      const man = MAN_PAGES[c];
      if (man) {
        const m = /- (.*)/.exec(man.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[3] || '');
        one = m ? m[1] : '';
      }
      lines.push(`| \`${c}\` | ${tier} (${n}×) | ${one} |`);
    }
    lines.push('');
    lines.push('## Recipes worth memorising');
    lines.push('');
    lines.push('```bash');
    lines.push('sort file | uniq -c | sort -nr | head    # what is most common?');
    lines.push('grep -rn "needle" /haystack              # find text in a tree');
    lines.push('find /path -name "*.log" -mtime +30      # old files (add -delete carefully)');
    lines.push('df -h && du -sh /var/*                   # disk full? that -> where');
    lines.push('ps aux | grep name                       # find a process, then: kill PID');
    lines.push('chmod 750 dir ; chmod 600 secret         # lock things down');
    lines.push('tail -n 50 /var/log/syslog               # what just happened?');
    lines.push('crontab -l                               # what runs on a schedule?');
    lines.push('```');
    lines.push('');
    lines.push('Go be dangerous (responsibly). — Alex');
    lines.push('');
    return lines.join('\n');
  }

  exportCheatsheet(ctx) {
    const content = this.buildCheatsheet();
    // always place a copy inside the game world too
    this.vfs.put('/home/player/cheatsheet.md', content, { owner: 'player' });
    let where = '~/cheatsheet.md (in-game)';
    if (this.exportDir) {
      try {
        const fs = require('fs');
        const path = require('path');
        const dest = path.join(this.exportDir, 'terminal-quest-cheatsheet.md');
        fs.writeFileSync(dest, content);
        where = dest + '  (on your real computer!)';
      } catch (e) { /* keep the in-game copy only */ }
    }
    ctx.out('\x1b[1;32mYour personal field manual has been written.\x1b[0m\n');
    ctx.out(`  ${where}\n`);
    ctx.out('  \x1b[90m(also saved in-game at ~/cheatsheet.md — cat it anytime)\x1b[0m\n');
  }

  notePipeline(stages) {
    if (stages >= 4) this.unlock('plumber');
    if (stages >= 10) this.unlock('pipemaster');
  }

  noteUnknownCommand(name) {
    const known = Object.keys(this.shell ? this.shell.commands : {});
    const close = known.find(k => k.length > 2 && levenshtein(k, name) === 1);
    if (close) this.print(`\x1b[90m(did you mean: ${close}?)\x1b[0m\n`);
  }

  noteRedirect(target, append) { this.emitLevel('redirect', { target, append }); }
  note(tag) { if (tag === 'sudo-denied') this.unlock('reported'); }

  emitLevel(type, data) {
    const lvl = this.level();
    if (lvl && lvl.onEvent) {
      try { lvl.onEvent(this, type, data); } catch (e) { /* level bug — never crash the shell */ }
    }
  }

  onFileRemoved(abs) { this.emitLevel('rm', { path: abs }); }
  onRmRfRoot() { this.unlock('rm-rf-survivor'); }
  onDfChecked(pct) { this.emitLevel('df', { pct }); }
  onChmod(path) { this.emitLevel('chmod', { path }); }
  onChown(path) { this.emitLevel('chown', { path }); }
  onIfaceChange() { this.emitLevel('iface', { up: this.network.eth0.up }); }
  onPing(target, up) { this.emitLevel('ping', { target, up }); }
  onCurl(host, port, path) { this.emitLevel('curl', { host, port, path }); }
  onSsh(host, user, cmd) { this.emitLevel('ssh', { host, user, cmd }); }
  onSshKeygen() { this.emitLevel('ssh-keygen', {}); }
  onScp(host, path, dir) { this.emitLevel('scp', { host, path, dir }); }
  onCrontabList(user) { this.emitLevel('crontab-list', { user }); }
  onCrontabChange(user) { this.emitLevel('crontab', { user }); }
  onAtJob(time, cmd) { this.emitLevel('at', { time, cmd }); }
  onSed(target) { this.emitLevel('sed', { target }); }
  onAwk() { this.emitLevel('awk', {}); }
  onScriptRun(name, source) { this.emitLevel('script', { name, source }); }
  onTarExtract(path) { this.emitLevel('tar', { path }); }
  onPasswd(target, ctx) {
    ctx.out(`passwd: password for ${target} updated successfully (simulated — no typing needed here)\n`);
    this.emitLevel('passwd', { target });
  }
  onManRead(name) { this.manReadThisLevel = true; }

  // ---- processes / jobs -------------------------------------------------------

  addJob(cmd) {
    const pid = this.nextPid++;
    this.procs.push({ pid, user: 'player', cpu: 0.0, mem: 0.1, time: '00:00:00', cmd });
    this.jobs.push({ pid, cmd, state: 'Running', done: false });
    return pid;
  }

  killProc(pid, ctx) {
    const p = this.procs.find(x => x.pid === pid);
    if (!p) return;
    this.procs = this.procs.filter(x => x.pid !== pid);
    this.network.connections = this.network.connections.filter(c => c.pid !== pid);
    const job = this.jobs.find(j => j.pid === pid);
    if (job) { job.done = true; }
    this.emitLevel('kill', { pid, proc: p });
  }

  // ---- privilege ---------------------------------------------------------------

  tryBecome(ctx, target) {
    if (target === 'root') {
      ctx.out('Password: \n');
      ctx.err('su: Authentication failure\n');
      ctx.out('\x1b[90m(Root logins are disabled at OmniCorp. Earn sudo rights through the story.)\x1b[0m\n');
      return 1;
    }
    ctx.err(`su: user ${target} does not exist or the account is locked\n`);
    return 1;
  }

  async runAsRoot(ctx, argv) {
    const savedUser = this.shell.user;
    this.shell.user = this.rootUser();
    try {
      const line = argv.map(a => (/[ "'$|&;<>*?]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a)).join(' ');
      return await this.shell.exec(line, { out: ctx.out, err: ctx.err, stdin: ctx.stdin });
    } finally {
      this.shell.user = savedUser;
    }
  }

  dropRoot = null;

  // ---- networking helpers --------------------------------------------------------

  localhostHttp(path) {
    if (this.level() && this.level().httpHandler) {
      const r = this.level().httpHandler(this, path);
      if (r !== null && r !== undefined) return r;
    }
    if (path === '/health') return 'OK\n';
    return 'OmniCorp internal portal. Move along.\n';
  }

  sshKeyAuthorized(host, user) {
    if (host === 'localhost' || host === 'omnicorp') return true;
    const hasKey = this.vfs.statOrNull('/home/player/.ssh/id_ed25519', '/', this.playerUser());
    return !!hasKey && this.sshAuthorized.has(`${host}:${user}`);
  }
  authorizeKey(host, user) { this.sshAuthorized.add(`${host}:${user}`); }

  remoteExec(host, user, cmd) {
    const h = this.network.hosts[host];
    if (!h || !h.files) return { err: `bash: ${cmd.split(' ')[0]}: command not found` };
    const [prog, ...rest] = cmd.trim().split(/\s+/);
    const arg = rest[0] || '/';
    const norm = (p) => ('/' + p.split('/').filter(Boolean).join('/'));
    if (prog === 'ls') {
      const dir = norm(arg);
      const names = new Set();
      for (const f of Object.keys(h.files)) {
        if (dir === '/' ? true : f.startsWith(dir + '/')) {
          const rest2 = dir === '/' ? f.slice(1) : f.slice(dir.length + 1);
          names.add(rest2.split('/')[0]);
        }
      }
      if (!names.size && !Object.keys(h.files).some(f => f === dir)) {
        return { err: `ls: cannot access '${arg}': No such file or directory` };
      }
      return { text: [...names].sort().join('  ') };
    }
    if (prog === 'cat') {
      const f = h.files[norm(arg)];
      return f !== undefined ? { text: f } : { err: `cat: ${arg}: No such file or directory` };
    }
    if (prog === 'whoami') return { text: user };
    if (prog === 'hostname') return { text: host };
    return { err: `bash: ${prog}: command not found (this remote node only allows: ls, cat, whoami, hostname)` };
  }

  remoteRead(host, path) {
    const h = this.network.hosts[host];
    if (!h || !h.files) return null;
    const norm = '/' + path.split('/').filter(Boolean).join('/');
    return h.files[norm] !== undefined ? h.files[norm] : null;
  }

  remoteWrite(host, path, content) {
    const h = this.network.hosts[host];
    if (!h) return;
    if (!h.files) h.files = {};
    h.files['/' + path.split('/').filter(Boolean).join('/')] = content;
  }

  sendMail(from, subject, body, announce = true) {
    this.mailbox.push({ from, subject, body });
    if (announce) this.print(`\x1b[1;33m✉ You have new mail — read it with: mail\x1b[0m\n`);
  }
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

module.exports = { Game, ACHIEVEMENTS, RANKS };
