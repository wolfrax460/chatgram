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

  /** Report call state so the tray/badge can announce an incoming call. */
  callState: (payload) => ipcRenderer.send('chatgram:call', payload),

  /** Ask the shell for its version. */
  appVersion: () => ipcRenderer.invoke('chatgram:appVersion'),

  /**
   * Windows update controls (Settings -> About and the blocking update page).
   * The shell owns the schedule, the download and the install; the page only
   * reads state and asks for actions.
   */
  updates: {
    getState: () => ipcRenderer.invoke('chatgram:update-state'),
    check: () => ipcRenderer.invoke('chatgram:update-check'),
    download: () => ipcRenderer.invoke('chatgram:update-download'),
    install: () => ipcRenderer.invoke('chatgram:update-install'),
    setAutoDownload: (value) => ipcRenderer.invoke('chatgram:update-auto-download', Boolean(value)),
    openDownloads: () => ipcRenderer.invoke('chatgram:update-open-downloads'),
    onState: (callback) => {
      const handler = (_event, state) => {
        try {
          callback(state);
        } catch {
          /* a listener must never break the bridge */
        }
      };
      ipcRenderer.on('chatgram:update-state', handler);
      return () => ipcRenderer.removeListener('chatgram:update-state', handler);
    },
  },

  isDesktop: true,
});
