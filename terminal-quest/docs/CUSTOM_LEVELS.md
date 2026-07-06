# Writing custom levels for Terminal Quest

Levels live in [`../src/game/levels.js`](../src/game/levels.js) as an array of
plain objects. The engine ([`src/engine/game.js`](../src/engine/game.js)) drives
them: it calls `setup` when the level starts, forwards player actions to
`onEvent`, and asks `check` whether a submitted flag wins. No engine changes are
needed to add a level — append an object to the `LEVELS` array (keep `id`
sequential) and you're done.

## The level object

```js
{
  id: 21,                       // sequential, unique
  name: 'Container Wrangling',
  commands: ['docker'],         // shown in the compendium as "new tools"
  mailFrom: 'alex@omnicorp',    // optional; sender of the briefing mail

  briefing: `In-character story + the objective. This is what the player reads
and re-reads with 'mission'. Tell them WHAT to achieve and hint at WHICH tools,
but make them do the thinking. End by telling them to submit the flag.`,

  tutorial: `A safe walkthrough shown by 'tutorial'. List the new commands with
tiny examples. Nothing here should be destructive.`,

  hints: [                      // revealed one at a time by 'hint' (−10 XP each)
    'Gentle nudge toward the right command.',
    'More specific — name the command and flags.',
    'Almost the full answer, including the exact path or value.'
  ],

  setup(game) {
    // Build THIS level's slice of the world. Called every time the level
    // starts AND on resetlevel/reload, so it must be idempotent.
    const v = game.vfs;
    v.mkdirp('/opt/app', '/', 'player', 'player');
    v.put('/opt/app/config.yml', 'replicas: 1\n', { owner: 'player' });
    // add a fake process, cron, mail, or network host if the puzzle needs it
  },

  onEvent(game, type, data) {
    // React to player actions. Fires after every command and for specific
    // events. Use it to detect the win condition and DROP A FLAG into the world
    // (a file the player must then read), so the token can't just be guessed.
    if (someWorldConditionIsMet(game)) {
      if (!fileExists(game, '/opt/app/.deployed')) {
        game.vfs.put('/opt/app/.deployed', 'OMNI-DEPLOY-OK-21\n', { owner: 'player' });
        game.print('\x1b[32m[validator] Deploy succeeded — .deployed written.\x1b[0m\n');
      }
    }
  },

  check(game, submitted) {
    // Return true to complete the level. Verify BOTH the flag text AND that the
    // world was actually manipulated correctly — never accept a bare guess.
    return submitted.trim() === 'OMNI-DEPLOY-OK-21'
        && !!game.vfs.statOrNull('/opt/app/.deployed', '/', game.playerUser());
  },

  successText: `Alex: "Nice work."`,   // printed on completion
  xp: 150,                             // base XP awarded

  // optional:
  cleanupAfter(game) { /* permanent world change once cleared */ },
  denyText: 'Not quite — check the config again.',   // shown on a wrong flag
  httpHandler(game, path) { /* return a body for curl http://localhost<path> */ }
}
```

## `onEvent` types

`onEvent(game, type, data)` is called with these `type` values (all optional to
handle — you'll usually only care about one or two):

| type            | data                              | fired when                          |
|-----------------|-----------------------------------|-------------------------------------|
| `command`       | `{name, args, code}`              | after any command runs              |
| `rm`            | `{path}`                          | a file/dir was removed              |
| `redirect`      | `{target, append}`                | output was redirected to a file     |
| `chmod`,`chown` | `{path}`                          | permissions/ownership changed       |
| `kill`          | `{pid, proc}`                     | a process was killed                |
| `iface`         | `{up}`                            | `eth0` brought up/down              |
| `ping`,`curl`,`ssh`,`scp` | connection details      | network commands ran                |
| `crontab`,`crontab-list`,`at` | `{user}` / `{time,cmd}` | scheduling commands ran           |
| `sed`,`awk`,`script`,`tar`,`passwd` | varies          | text/script/archive/auth actions    |

The safest win-detection pattern is **not** to trust a single event but to
re-derive the world state each call (does the file exist? is the mode 750? is
the process gone?) — that way the player can reach the goal by any valid route.

## Helpers available on `game`

- `game.vfs` — the filesystem. Handy methods: `mkdirp`, `put(path, content,
  {owner, group, mode, mtime, sizeKB})`, `statOrNull`, `walk`, `usedKB`.
  Use `sizeKB` to fake large files (for disk-pressure puzzles) without storing
  megabytes of text.
- `game.procs` — array of fake processes `{pid, user, cpu, mem, time, cmd,
  critical}`. Push to add; `critical: true` makes a process ignore SIGTERM so it
  needs `kill -9`.
- `game.network` — `{eth0, hosts, connections}`. Add a host with `ports` and an
  optional `files` map (for `ssh`/`scp` remote reads).
- `game.crontabs`, `game.atJobs` — scheduling state.
- `game.sendMail(from, subject, body)` — deliver an in-story email.
- `game.sudoUnlocked = true` — grant the player `sudo` for this level.
- `game.print(text)` — write to the terminal (supports ANSI colour codes).
- `game.playerUser()` / `game.rootUser()` — user objects for VFS calls.

## Adding a new command

If your level introduces a genuinely new command, add it in
[`src/engine/commands.js`](../src/engine/commands.js):

```js
C.docker = (ctx, args) => {
  // ctx.out(text), ctx.err(text), ctx.vfs, ctx.shell, ctx.user, ctx.stdin, ctx.game
  ctx.out('CONTAINER ID   IMAGE   STATUS\n');
  return 0; // exit status
};
```

and a man page in [`src/engine/man.js`](../src/engine/man.js) via the `page(...)`
helper so `man docker` works and it appears correctly in the compendium.

## Testing your level

Add a scripted solution to [`../test/smoke.js`](../test/smoke.js) (`SOLUTIONS[21]
= async (g) => { ... }`) and run `npm test`. The harness plays every level's
solution and asserts completion, so a passing run proves your level is solvable
end-to-end.
```
