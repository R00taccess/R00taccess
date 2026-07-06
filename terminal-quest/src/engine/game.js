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
  'root-wizard':         { name: 'Root Wizard', desc: 'Complete Terminal Quest.' }
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
      gameMinutes: this.gameMinutes
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
    const banner =
      `\x1b[1;32m` +
      `╔══════════════════════════════════════════════════════════════╗\n` +
      `  LEVEL ${String(lvl.id).padEnd(2)} — ${lvl.name}\n` +
      `╚══════════════════════════════════════════════════════════════╝\x1b[0m\n`;
    this.print('\n' + banner);
    if (lvl.commands && lvl.commands.length) {
      this.print(`\x1b[36mNew tools: ${lvl.commands.join(', ')}   (try: man ${lvl.commands[0]})\x1b[0m\n`);
    }
    this.print('\n' + lvl.briefing.trim() + '\n\n');
    this.print('\x1b[90mCommands: mission (re-read) · tutorial (walkthrough) · hint (clue, costs XP)\x1b[0m\n\n');
    this.save();
    this.changed();
  }

  showBriefing(ctx) { ctx.out('\n\x1b[1mLEVEL ' + this.level().id + ' — ' + this.level().name + '\x1b[0m\n\n' + this.level().briefing.trim() + '\n\n'); }

  showTutorial(ctx) {
    const lvl = this.level();
    ctx.out('\n\x1b[1;36m── SANDBOX WALKTHROUGH — try these safely, nothing here can break ──\x1b[0m\n');
    ctx.out(lvl.tutorial.trim() + '\n\n');
  }

  giveHint(ctx) {
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
    const lvl = this.level();
    if (lvl && lvl.onEvent) lvl.onEvent(this, 'command', { name, args, code });
    this.changed();
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
