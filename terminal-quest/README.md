# Terminal Quest

**Learn real Linux command-line skills through an immersive, terminal-based
adventure.** You play a newly hired junior sysadmin at the mysterious OmniCorp.
Everything happens inside a simulated bash shell — green-on-black, blinking
cursor, tab completion, command history, man pages — but **nothing touches your
real machine**. The entire world (filesystem, processes, users, cron, network)
is simulated in memory.

Twenty story-driven levels take you from `pwd`/`ls` to `grep`, `find`,
permissions, process control, networking, SSH, shell scripting, `cron`, and
`sed`/`awk` — each command introduced exactly when a puzzle needs it, and every
later level reuses everything you've learned. Two boss fights (a disk crisis and
a live intrusion) and a final-boss meltdown test the whole toolkit. Finish, and
you earn the rank **Root Wizard**.

Ships as a single self-contained Windows `.exe` installer. Plays fully offline.

---

## Play it

```bash
npm install      # fetches Electron (needs internet the first time)
npm start        # launches the game window
```

> If `npm start` fails to download Electron behind a corporate proxy, that's the
> Electron **binary** download (from GitHub releases), not this code. Set
> `ELECTRON_MIRROR` or install on an unrestricted network.

Run the engine test suite (headless, no Electron needed — plays through all 20
levels and asserts each one completes):

```bash
npm test
```

## Build the Windows installer

See [`scripts/build-windows.md`](scripts/build-windows.md). Short version:

```bat
npm install
npm run dist      :: -> release\TerminalQuest-Setup-1.0.0.exe  (electron-builder NSIS)
```

Or via Inno Setup: `npm run dist:unpacked` then compile
[`installer/terminal-quest.iss`](installer/terminal-quest.iss).

---

## How to play

| Command        | What it does                                              |
|----------------|-----------------------------------------------------------|
| `help`         | survival basics                                           |
| `mission`      | re-read the current level briefing                        |
| `tutorial`     | replay this level's guided sandbox walkthrough            |
| `man <cmd>`    | full manual page for any command you've met               |
| `hint`         | a progressively clearer clue (costs a little XP)          |
| `mail`         | read story messages from Alex, the Director, and…others   |
| `progress`     | XP, rank, level and achievements                          |
| `resetlevel`   | rebuild the level if you broke something irreversibly     |
| `F1`           | toggle the **Command Compendium** side panel              |

**Beginner scaffolding.** Levels show a **suggestion bar** of command chips —
tap one to auto-type it into the prompt (it doesn't run until you press Enter, so
you always see what you're about to do). The hand-holding tiers down as you
climb: levels 1–8 give **concrete, ready-to-run** commands; mid-game levels
(9, 11–14, 16–19) give **generic patterns only** (`grep -r PATTERN /dir`) — a
nudge toward the right tool, not the answer; and the **boss levels (10, 15, 20)
get no chips at all** — those are your "prove it" moments. New commands are
announced as they're introduced, and boss levels get their own red-framed
warning banner.

## Designed for proficiency, not just exposure

The goal is that a player who finishes can sit at a *real* Linux terminal and
work. Four systems target that directly:

- **Key ideas, not just keystrokes.** Every level opens with a one-line
  transferable mental model (`◆ KEY IDEA`) — *why* the tool exists and how to
  think about it (e.g. "df says the disk is full, du says which directory,
  find says which file"), so knowledge survives outside the game's puzzles.
- **Spaced reuse.** Levels are cumulative by design — later puzzles silently
  require earlier commands (bosses require chains of them), which is how
  recall actually forms.
- **Mastery tracking.** Every correct use of a core command is counted. The
  `skills` command (and the F1 compendium's ○/◑/● dots) shows your personal
  matrix: *met it* → *familiar (1–2×)* → *proficient (3+×)*. You can see
  exactly which tools you've only read about versus genuinely practised.
- **The certification exam.** After the campaign (or anytime, with `exam`),
  you get a fresh `/exam` sandbox and a checklist of applied tasks covering
  every core skill — **no hints, no suggestion chips**, graded purely by
  inspecting the resulting system state, so any valid approach passes. Clearing
  it earns the *Certified Operator* achievement. That's the game's actual
  definition of "proficient": you did it unaided.

Each level ends by capturing a **flag** — a secret token you find by using the
level's commands correctly. Submit it with:

```bash
echo THE_FLAG > /dev/exit      # or:  submit THE_FLAG
```

Ranks climb with XP: **Trainee → Operator → Sysadmin → Root Wizard**. Wrong or
dangerous commands cost XP; clearing a level with no hints and no man pages earns
bonuses and achievements (`No man Needed`, `Speed Demon`, `Pipemaster`, and more).
There are easter eggs — try `cowsay`, `fortune`, or fat-fingering `sl`.

Progress saves automatically to `%APPDATA%\Terminal Quest\saves\` after every
level, and command history persists across sessions.

---

## What's simulated (and how faithfully)

The engine implements a documented subset of real Linux, following the actual
man-page behaviour:

- **Filesystem** — an in-memory ext4-like tree with paths, permissions
  (user/group/other, octal + symbolic), ownership, timestamps and sizes.
- **Shell** — quoting (`'`/`"`/`\`), `$VAR`/`${VAR}`/`$(...)`/backtick
  expansion, `~`, globbing (`*` `?`), pipes `|`, redirection `>` `>>` `<` `2>`
  `2>>`, logical operators `&&` `||` `;`, background `&`, and `VAR=value`
  assignments.
- **~60 commands** — navigation, file ops, `cat/less/head/tail`, `grep`
  (`-i -v -n -c -l -r`), `find` (`-name -iname -type -size -mtime -empty
  -delete`), `sort/uniq/wc/cut/tr`, `du/df`, `chmod/chown/chgrp`, `ps/top/kill/
  jobs/fg/bg`, `ping/ip/ifconfig/netstat/curl`, `ssh/scp/ssh-keygen/ssh-copy-id`,
  `crontab/at`, `sed`/`awk` (workhorse subsets), and a real **bash script
  interpreter** (variables, `for`, `while`, `if/elif/else`, `case`, `test`/`[ ]`,
  positional args, `exit`).
- **Man pages** — every command has a full in-game `man` entry with synopsis,
  options and game-flavoured examples.
- **Processes / network / cron / mail** — fake but internally consistent, and
  wired into the story (kill the right PID and a door opens; bring `eth0` up and
  a service starts answering).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map.

---

## Extending: write your own levels

Levels are plain data + hooks in [`src/game/levels.js`](src/game/levels.js).
Adding one is self-contained — see
[`docs/CUSTOM_LEVELS.md`](docs/CUSTOM_LEVELS.md) for a full annotated template.
The gist:

```js
{
  id: 21,
  name: 'Docker Basics',
  commands: ['docker'],
  briefing: `Story + objective the player reads.`,
  tutorial: `Safe sandbox walkthrough.`,
  hints: ['clue 1', 'clue 2 (clearer)', 'clue 3 (almost the answer)'],
  setup(game)  { /* build this level's files/procs/network */ },
  onEvent(game, type, data) { /* react to player actions; drop a flag when solved */ },
  check(game, submitted) { return submitted.trim() === 'THE_FLAG' && /* world is correct */; },
  successText: `Alex congratulates you.`,
  xp: 150
}
```

Everything is data-driven, so DLC packs (Docker, Git, systemd, package
management) slot in without touching the engine.

---

## Project layout

```
terminal-quest/
├── electron/main.js         Electron main process (borderless window, IPC)
├── src/
│   ├── index.html           terminal shell + compendium panel
│   ├── term/                renderer: DOM terminal, ANSI→HTML, input loop
│   ├── engine/              vfs, shell, commands, script interpreter, man, game
│   └── game/levels.js       all 20 levels (data + hooks)
├── test/smoke.js            headless engine tests (full campaign playthrough)
├── scripts/make-icon.js     generates assets/icon.{png,ico}
├── installer/terminal-quest.iss   Inno Setup script
└── assets/                  app icons
```

## License

MIT.
