// Automat1 als eigenständiges Programm (Electron). Das Spiel selbst ist index.html.
// Start: kleines Startfenster → Updates prüfen (updater.js) → Spiel öffnen.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Automat1');
app.commandLine.appendSwitch('force_high_performance_gpu'); // Laptops: dedizierte Grafikkarte
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const DIR = __dirname;
const gotLock = app.requestSingleInstanceLock();
let win = null, splash = null, upd = { state: 'aus', version: null, notes: [] };

function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }

function splashHtml() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#0b0f16;color:#e9edf6;font:14px 'Segoe UI',sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;-webkit-app-region:drag;user-select:none">
  <div style="font-size:30px;font-weight:800;letter-spacing:.2em;color:#55e8ff">AUTOMAT1</div>
  <div id="s" style="margin-top:14px;color:#c9cfda">Starte …</div>
  <div style="width:260px;height:5px;border-radius:3px;background:#ffffff1a;margin-top:12px;overflow:hidden"><div id="b" style="width:0;height:100%;background:#55e8ff;transition:width .2s"></div></div>
  <div id="v" style="margin-top:12px;font-size:11px;color:#7d8696"></div></body></html>`);
}
function splashStatus(text, frac) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.executeJavaScript(`document.getElementById('s').textContent=${JSON.stringify(text)};${frac != null ? `document.getElementById('b').style.width='${Math.round(frac * 100)}%'` : ''}`).catch(() => {});
}

async function checkUpdates() {
  const ver = readJson(path.join(DIR, 'version.json'), {});
  if (splash) splash.webContents.executeJavaScript(`document.getElementById('v').textContent=${JSON.stringify('Version ' + (ver.game || '?'))}`).catch(() => {});
  try {
    const U = require('./updater.js');
    upd = await U.run(DIR, { status: splashStatus, log: m => console.log(m) });
  } catch (e) { upd = { state: 'fehler', why: e.message, notes: [] }; }
  if (!upd.version) upd.version = ver.game;
  return upd;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 600,
    fullscreen: true, backgroundColor: '#0b0f16', title: 'Automat1',
    icon: path.join(DIR, 'icon.png'), show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  win.once('ready-to-show', () => { win.show(); if (splash && !splash.isDestroyed()) splash.close(); splash = null; });
  win.loadFile(path.join(DIR, 'index.html'));
  win.webContents.on('before-input-event', (e, inp) => {
    // Esc selbst behandeln: sonst gibt Chromium die Maus frei und man müsste erst ins Spiel klicken
    if (inp.key === 'Escape') { e.preventDefault(); if (inp.type === 'keyDown' && !inp.isAutoRepeat) win.webContents.send('a1:esc'); return; }
    if (inp.type !== 'keyDown') return;
    // F11 und Alt+Enter: Vollbild umschalten. F12: Entwicklerwerkzeuge (bei Problemen)
    if (inp.key === 'F11' || (inp.key === 'Enter' && inp.alt)) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (inp.key === 'F12') win.webContents.toggleDevTools();
  });
  // Links nie im Spiel öffnen, sondern im normalen Browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
}

async function start() {
  splash = new BrowserWindow({ width: 460, height: 240, frame: false, resizable: false, backgroundColor: '#0b0f16', show: true, icon: path.join(DIR, 'icon.png'), webPreferences: { contextIsolation: true } });
  splash.loadURL(splashHtml());
  await checkUpdates();
  if (upd.shell) { splashStatus('Programm aktualisiert – starte neu …', 1); setTimeout(() => { app.relaunch(); app.exit(0); }, 700); return; }
  splashStatus(upd.state === 'aktualisiert' ? `Version ${upd.version} installiert` : upd.state === 'offline' ? 'Offline – starte letzte Version' : 'Starte …', 1);
  createWindow();
}

ipcMain.on('a1:quit', () => app.quit());
ipcMain.on('a1:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('a1:info', () => ({ state: upd.state, version: upd.version, latest: upd.latest || null, notes: upd.notes || [], why: upd.why || null }));
// Maus wieder einfangen ohne Klick: ein echter Klick in die Fenstermitte (zählt als Nutzer-Eingabe)
ipcMain.on('a1:relock', () => { if (!win) return; const [w, h] = win.getContentSize(), x = Math.round(w / 2), y = Math.round(h / 2);
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); });
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
if (!gotLock) app.quit(); else app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
