/**
 * The only bridge between the web page and Electron.
 * Nothing from Node is exposed beyond these three functions.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatgramDesktop', {
  /** Report the unread total so the taskbar/tray badge can update. */
  setUnread: (count) => ipcRenderer.send('chatgram:unread', Number(count) || 0),

  /** Show a native Windows notification. */
  notify: (title, body) => ipcRenderer.invoke('chatgram:notify', { title, body }),

  /** Ask the shell for its version. */
  appVersion: () => ipcRenderer.invoke('chatgram:appVersion'),

  isDesktop: true,
});
