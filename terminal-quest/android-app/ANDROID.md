# Terminal Quest — Android build

The Android version is a plain, dependency-free WebView app. The whole game
(shell engine, levels, saves) is pre-bundled into
`app/src/main/assets/www/bundle.js`, **which is committed to the repo** — so
building the APK needs **no Node.js and no npm**, only the Android SDK.

## Build it (Antigravity / Android Studio)

1. Open the **`terminal-quest/android-app`** folder as the project
   (it's a standard Gradle project: `settings.gradle` at its root).
2. Let the IDE sync Gradle. The only download is the Android Gradle Plugin —
   there are zero library dependencies.
3. Build:
   - IDE: **Build → Build APK(s)**, or
   - command line: `gradle assembleDebug`
     (or `./gradlew assembleDebug` after the IDE generates the wrapper)
4. The APK lands at
   `app/build/outputs/apk/debug/app-debug.apk` — install it on any
   Android 7.0+ (API 24) device.

For a Play-Store-ready build use `assembleRelease` and sign it
(Build → Generate Signed App Bundle/APK in the IDE).

## What's in here

- `app/src/main/java/.../MainActivity.java` — fullscreen WebView host.
  JavaScript + DOM storage enabled; saves persist via localStorage.
  Back button backgrounds the app instead of killing your run.
- `app/src/main/assets/www/` — the game itself (generated, committed):
  - `bundle.js` — every engine/game/renderer module wrapped in a tiny
    CommonJS loader, with browser shims for `fs` (localStorage-backed),
    `path` and `electron`.
  - `index.html`, `mobile.js`, `mobile.css` — the phone UI: a hidden input
    bridges the Android soft keyboard, and a key toolbar provides
    Ctrl / Tab / arrows / `|` / `>` / Esc / Enter.
- `app/src/main/res/mipmap-*/ic_launcher.png` — launcher icons (generated).

## Changing the game

The game sources live in `../src/`. After editing them, regenerate the
web assets and commit the result:

```bash
node scripts/build-web.js          # rebuilds assets/www (needs only Node)
node test/webbundle.js             # boots the exact bundle the APK ships
```

Then rebuild the APK. (`webdist/` gets the same output for quick testing in a
desktop browser — just open `webdist/index.html`.)

## Troubleshooting

- **Blank screen in the APK** — open `chrome://inspect` on a connected
  desktop Chrome with the device plugged in; the WebView console shows the
  error. The web bundle is boot-tested in CI (`node test/webbundle.js`), so
  a blank screen almost always means `assets/www/` is stale — rerun
  `node scripts/build-web.js`.
- **Gradle sync fails** — you need Android SDK 34 and JDK 17 (both bundled
  with current Android Studio / Antigravity).
