// Kleine Brücke zum Spiel: Beenden, Vollbild, Maus einfangen, Update-Info. Sonst kein Zugriff auf den PC.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('a1app', {
  isApp: true,
  quit: () => ipcRenderer.send('a1:quit'),
  toggleFullscreen: () => ipcRenderer.send('a1:fullscreen'),
  relock: () => ipcRenderer.send('a1:relock'),
  info: () => ipcRenderer.invoke('a1:info'),
});

// Esc kommt vom Hauptprozess (dort abgefangen) → als normaler Tastendruck an das Spiel
ipcRenderer.on('a1:esc', () => { const a = document.activeElement, t = a && a !== document.body ? a : document; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); });
