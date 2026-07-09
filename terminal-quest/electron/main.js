'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 400,
    frame: false,               // borderless, styled like a raw terminal
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      nodeIntegration: true,    // offline single-player game; no remote content is ever loaded
      contextIsolation: false,
      sandbox: false,           // REQUIRED (Electron >=20): without this the renderer is
                                // sandboxed and `require` is undefined, so renderer.js dies
                                // on load and the terminal stays blank.
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

// Save files live in the per-user app data directory.
ipcMain.on('tq:get-save-dir', (ev) => {
  const dir = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(dir, { recursive: true });
  ev.returnValue = dir;
});

ipcMain.on('tq:window', (ev, action) => {
  if (!win) return;
  if (action === 'close') win.close();
  else if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
