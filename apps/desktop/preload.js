/**
 * The only bridge between the web page and Electron.
 * Nothing from Node is exposed beyond these three functions.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatgramDesktop', {
  /** Report the unread total so the taskbar/tray badge can update. */
  setUnread: (count) => ipcRenderer.send('chatgram:unread', Number(count) || 0),

  /**
   * Show a native Windows notification. Accepts `{ title, body, chatId, silent }`
   * (and the old `(title, body)` form) so the toast can open the right chat when
   * it is clicked.
   */
  notify: (payload, maybeBody) =>
    ipcRenderer.invoke(
      'chatgram:notify',
      typeof payload === 'string'
        ? { title: payload, body: maybeBody === undefined ? '' : String(maybeBody) }
        : payload && typeof payload === 'object'
          ? payload
          : {},
    ),

  /**
   * Subscribe to "the user clicked a notification": the main process tells us
   * which chat to open. Returns an unsubscribe function.
   */
  onOpenChat: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, chatId) => {
      try {
        callback(String(chatId || ''));
      } catch {
        /* a listener must never break the bridge */
      }
    };
    ipcRenderer.on('chatgram:open-chat', handler);
    return () => ipcRenderer.removeListener('chatgram:open-chat', handler);
  },

  /** Report call state so the tray/badge can announce an incoming call. */
  callState: (payload) => ipcRenderer.send('chatgram:call', payload),

  /**
   * Notification state + the Windows notification settings page. The Settings
   * screen cannot read or open the OS setting from the page itself, so the shell
   * does it (without this the "Notifications" row had no working action).
   */
  notifications: {
    getState: () => ipcRenderer.invoke('chatgram:notification-support'),
    openSettings: () => ipcRenderer.invoke('chatgram:open-notification-settings'),
  },

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

  /**
   * Remote control of a shared screen (Windows host only).
   *
   * The page only sends validated, normalized control events for an approved
   * session; main.js re-validates them, maps them to the primary display and
   * injects them with nut-js. available() reports whether the native module
   * loaded in this build, so the UI can say "Remote control is not available in
   * this build" instead of showing a dead toggle.
   */
  control: {
    available: () => ipcRenderer.invoke('chatgram:control-available'),
    send: (event) => ipcRenderer.invoke('chatgram:control-event', event),
    setActive: (active) => ipcRenderer.send('chatgram:control-session', Boolean(active)),
  },

  isDesktop: true,
});
