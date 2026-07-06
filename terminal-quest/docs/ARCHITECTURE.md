# Terminal Quest — architecture

A single-process Electron app. The **main process** opens one borderless,
terminal-styled window; the **renderer** runs the game. There is no server and
no network dependency at runtime — the whole simulated Linux world lives in
memory in the renderer, and saves are written to the per-user app-data folder.

```
┌─ electron/main.js ─────────────────────────────────────────────┐
│  borderless BrowserWindow · IPC: save-dir, window controls      │
└───────────────────────────┬────────────────────────────────────┘
                            │ loads
┌─ src/index.html ──────────▼────────────────────────────────────┐
│  #screen (terminal)   +   #compendium (F1 panel)   +  statusbar │
└───────────────────────────┬────────────────────────────────────┘
                            │ src/term/renderer.js
                            │   input loop · history · tab-complete
                            │   ANSI→HTML (src/term/ansi.js)
                            ▼
┌─ src/engine/game.js  (the conductor) ──────────────────────────┐
│  XP · ranks · achievements · clock · save/load · level flow     │
│  fake process table · network · cron · mailbox                  │
│    ├── src/engine/world.js    builds the base OmniCorp world     │
│    ├── src/game/levels.js     20 levels: setup/onEvent/check     │
│    ├── src/engine/shell.js    tokenize→parse→expand→pipe/redirect│
│    ├── src/engine/commands.js ~60 commands (real man behaviour)  │
│    ├── src/engine/script.js   bash script interpreter (for/if/…) │
│    ├── src/engine/vfs.js      in-memory permissioned filesystem  │
│    └── src/engine/man.js      manual pages                       │
└────────────────────────────────────────────────────────────────┘
```

## Execution flow of one command line

1. `renderer.js` captures the line, echoes it, pushes it to history, and calls
   `shell.exec(line, io)`.
2. `shell.js` **tokenizes** (handling quotes, escapes, `$(...)`), **parses**
   into pipelines joined by `&& || ;`, then for each pipeline stage **expands**
   words (`$VAR`, `~`, globs), wires up **redirections**, and invokes the
   command function from `commands.js`, threading stdout between stages.
3. Each command reads/writes the **VFS** and the fake process/network tables,
   returning an exit status.
4. After each command, `game.js` accounts XP, advances the in-game clock, and
   calls the active level's `onEvent`, which watches for the win condition and
   drops a **flag** into the world.
5. The player reads the flag and runs `echo FLAG > /dev/exit`; a VFS write-hook
   routes that to `game.trySubmit`, which calls the level's `check` and, on
   success, awards XP/achievements and starts the next level.

## Why a custom DOM terminal instead of xterm.js

The renderer implements its own terminal (`term/renderer.js` + `term/ansi.js`):
a small ANSI-colour subset, a blinking block cursor, scrollback, persistent
history, and path/command tab-completion. This keeps the app **fully
self-contained** — no external JS bundle, no web fonts, no network — which suits
the strict offline/CSP posture and keeps the installer small. The engine is
UI-agnostic, so swapping in xterm.js later would only touch the renderer.

## Persistence

- `%APPDATA%\Terminal Quest\saves\terminal-quest-save.json` — level, XP,
  achievements, completion times, in-game clock.
- `…\saves\history.json` — command history across sessions.

On load, the game replays the *setup* of every already-completed level so the
resumed world is internally consistent, then applies the current level's setup.

## Testing

`test/smoke.js` runs the entire engine headlessly (no Electron): unit checks for
individual commands and shell features, a **scripted playthrough of all 20
levels** asserting each completes, and a save/reload round-trip. `npm test`.
