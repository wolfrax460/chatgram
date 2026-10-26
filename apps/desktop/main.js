/**
 * Chatgram desktop shell.
 *
 * Loads the hosted React client. The web build is the single source of truth,
 * so a deploy updates the desktop app without shipping a new installer.
 *
 * Security: contextIsolation on, nodeIntegration off, sandbox on. The renderer
 * gets a tiny, explicit API from preload.js and nothing else.
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification, session, desktopCapturer, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_URL = process.env.CHATGRAM_URL || 'https://chatgram-xi.vercel.app/web/';
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
const WEB_ORIGIN = 'https://chatgram-xi.vercel.app';
const RELEASE_FEED = WEB_ORIGIN + '/api/app/releases';
const DOWNLOAD_PAGE = WEB_ORIGIN + '/docs#downloads';

let mainWindow = null;
let tray = null;
let unreadCount = 0;
let isQuitting = false;

// Small persisted preferences (start-on-login, future desktop options).
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function saveSettings(next) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    console.warn('Could not save desktop settings', error?.message);
  }
}

/* --------------------------------------------------------------- unread */

/** Draw a red badge with the count — avoids shipping pre-rendered icons. */
function badgeImage(count) {
  const size = 32;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="#e5484d"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
            font-family="Segoe UI, sans-serif" font-size="${count > 9 ? 13 : 17}"
            font-weight="700" fill="#ffffff">${count > 99 ? '99+' : count}</text>
    </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );
}

function setUnread(count) {
  unreadCount = Math.max(0, count | 0);
  if (!mainWindow) return;

  // Taskbar overlay (Windows) + title.
  if (unreadCount > 0) {
    mainWindow.setOverlayIcon(badgeImage(unreadCount), `${unreadCount} unread`);
    mainWindow.setTitle(`(${unreadCount}) Chatgram`);
  } else {
    mainWindow.setOverlayIcon(null, '');
    mainWindow.setTitle('Chatgram');
  }

  // Tray tooltip mirrors the count.
  if (tray) {
    tray.setToolTip(unreadCount > 0 ? `Chatgram — ${unreadCount} unread` : 'Chatgram');
    tray.setImage(unreadCount > 0 ? windowIcon(true) : windowIcon(false));
  }
}

function windowIcon(unread) {
  const candidate = path.join(__dirname, 'assets', unread ? 'icon-unread.ico' : 'icon.ico');
  if (fs.existsSync(candidate)) return nativeImage.createFromPath(candidate);
  return nativeImage.createEmpty();
}

/* --------------------------------------------------------------- window */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Chatgram',
    backgroundColor: '#0b141a',
    icon: windowIcon(false),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  // If the network drops, show the offline page instead of Chromium's error.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return; // aborted, usually a redirect
    console.warn('Failed to load', url, code, description);
    mainWindow.loadFile(OFFLINE_PAGE);
  });

  // External links open in the real browser, never inside the shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('close', (event) => {
    // Minimise to tray on close unless the user chose Quit.
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ---------------------------------------------------------------- tray */

function createTray() {
  tray = new Tray(windowIcon(false));
  tray.setToolTip('Chatgram');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Chatgram',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      {
        label: 'Check for updates…',
        click: () => checkForUpdates(true),
      },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: loadSettings().startOnLogin === true,
        click: (item) => {
          const next = { ...loadSettings(), startOnLogin: item.checked === true };
          saveSettings(next);
          app.setLoginItemSettings({ openAtLogin: next.startOnLogin });
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Chatgram',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ------------------------------------------------------- release gate */

/** Compare dotted numeric versions (1.2.3 > 1.2.0). Returns -1, 0 or 1. */
function compareVersions(a, b) {
  const left = String(a || '0').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || '0').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0) ? 1 : -1;
  }
  return 0;
}

/** Enforce the minimum supported / forced version published in App releases. */
async function checkMinimumVersion() {
  try {
    const response = await fetch(RELEASE_FEED, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const payload = await response.json();
    const windows = (payload.releases || []).find((release) => release.platform === 'windows');
    if (!windows) return;
    const current = app.getVersion();
    const minimum = windows.minSupportedVersion || '';
    const belowMinimum = minimum && compareVersions(current, minimum) < 0;
    const forced = windows.forceUpdate === true && windows.version && compareVersions(current, windows.version) < 0;
    if (!belowMinimum && !forced) return;
    const { dialog } = require('electron');
    const choice = await dialog.showMessageBox({
      type: 'warning',
      title: 'Chatgram update required',
      message: belowMinimum
        ? 'This version of Chatgram (' + current + ') is no longer supported.'
        : 'A required Chatgram update is available.',
      detail: 'Please install version ' + (windows.version || minimum) + ' from the download page to keep using Chatgram.',
      buttons: ['Open download page', 'Close'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 0) {
      shell.openExternal(windows.fileUrl ? new URL(windows.fileUrl, WEB_ORIGIN).toString() : DOWNLOAD_PAGE);
    }
    isQuitting = true;
    app.quit();
  } catch (error) {
    console.warn('Version gate check failed', error?.message);
  }
}

/* ------------------------------------------------------------- updates */

let updater = null;
function setupUpdater() {
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    console.log('electron-updater not installed — skipping auto-update');
    return;
  }
  try {
    updater.setFeedURL({ provider: 'generic', url: WEB_ORIGIN + '/downloads' });
  } catch (error) {
    console.warn('Could not set the update feed', error?.message);
  }
  updater.autoDownload = true;
  updater.on('update-available', (info) => console.log('Update available', info.version));
  updater.on('error', (error) => console.warn('Updater error', error?.message));
  updater.on('update-downloaded', (info) => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Chatgram update ready',
        body: `Version ${info.version} will install when you quit.`,
      }).show();
    }
  });
}

async function checkForUpdates(manual = false) {
  if (!updater) return;
  try {
    await updater.checkForUpdates();
  } catch (error) {
    if (manual && Notification.isSupported()) {
      new Notification({ title: 'Chatgram', body: 'Could not check for updates.' }).show();
    }
  }
}

/* ------------------------------------------------------------------ ipc */

ipcMain.on('chatgram:unread', (_event, count) => setUnread(count));

ipcMain.handle('chatgram:notify', (_event, { title, body }) => {
  if (!Notification.isSupported()) return false;
  new Notification({ title: String(title), body: String(body), icon: windowIcon(false) }).show();
  return true;
});

ipcMain.handle('chatgram:appVersion', () => app.getVersion());

/* ---------------------------------------------------------------- boot */

// Only one instance may run; a second launch focuses the first.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  /**
   * Media permissions for calls.
   *
   * Electron denies getUserMedia by default. We allow audio, video and screen
   * capture for the Chatgram origin only, and deny everything else (geolocation,
   * MIDI, notifications via the page, ...). The OS-level prompt still applies.
   */
  function configurePermissions() {
    const allowedOrigins = new Set([new URL(APP_URL).origin, 'http://localhost:5174', 'http://127.0.0.1:5174']);
    const media = new Set(['media', 'audioCapture', 'videoCapture', 'display-capture', 'speaker-selection']);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      try {
        const origin = new URL(details?.requestingUrl || webContents.getURL()).origin;
        callback(media.has(permission) && allowedOrigins.has(origin));
      } catch {
        callback(false);
      }
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      try {
        const origin = new URL(requestingOrigin || webContents.getURL()).origin;
        return media.has(permission) && allowedOrigins.has(origin);
      } catch {
        return false;
      }
    });
  }

  /**
   * Screen sharing for calls (`navigator.mediaDevices.getDisplayMedia`).
   *
   * Electron does not show Chromium's picker by default: without a handler the
   * call fails with NotAllowedError. We list screens and windows from
   * desktopCapturer in a small native dialog, then hand the chosen source back
   * to the renderer. `audio: 'loopback'` adds the system audio track on Windows
   * so the web client can share sound with the screen.
   */
  function setupDisplayMedia() {
    try {
      session.defaultSession.setDisplayMediaRequestHandler(
        async (_request, callback) => {
          try {
            const sources = await desktopCapturer.getSources({
              types: ['screen', 'window'],
              thumbnailSize: { width: 0, height: 0 },
              fetchWindowIcons: false,
            });
            const screens = sources.filter((source) => source.id.startsWith('screen'));
            const windows = sources.filter((source) => !source.id.startsWith('screen'));
            const ordered = [...screens, ...windows].slice(0, 9);
            if (ordered.length === 0) {
              callback({});
              return;
            }
            const buttons = [...ordered.map((source) => source.name || 'Source'), 'Cancel'];
            const options = {
              type: 'question',
              title: 'Share your screen',
              message: 'What do you want to share in this call?',
              detail: 'Everyone in the call sees the screen or window you pick. Sharing your whole screen shares everything on it.',
              buttons,
              defaultId: 0,
              cancelId: buttons.length - 1,
              noLink: true,
            };
            const result = mainWindow
              ? await dialog.showMessageBox(mainWindow, options)
              : await dialog.showMessageBox(options);
            const index = result.response;
            if (index < 0 || index >= ordered.length) {
              callback({});
              return;
            }
            callback({ video: ordered[index], audio: 'loopback' });
          } catch (error) {
            console.warn('Screen share picker failed', error?.message);
            callback({});
          }
        },
        { useSystemPicker: true },
      );
    } catch (error) {
      // Older Electron builds do not know the handler; getDisplayMedia then
      // reports NotAllowedError and the web client shows its honest message.
      console.warn('Screen sharing handler unavailable', error?.message);
    }
  }

  app.whenReady().then(() => {
    configurePermissions();
    setupDisplayMedia();
    createWindow();
    createTray();
    setupUpdater();

    // Start-on-login: persisted opt-in (tray menu).
    const settings = loadSettings();
    app.setLoginItemSettings({ openAtLogin: settings.startOnLogin === true });

    // Incoming-call alerts from the renderer: tray balloon, notification and
    // a flashing taskbar entry so a call is visible while the window is hidden.
    let incomingNotification = null;
    ipcMain.on('chatgram:call', (_event, payload = {}) => {
      const state = String(payload.state || '');
      const title = String(payload.title || 'Someone');
      if (state === 'incoming') {
        if (tray) {
          tray.setToolTip(`Chatgram — incoming call from ${title}`);
          tray.displayBalloon?.({ title: 'Incoming call', content: `${title} is calling`, iconType: 'info' });
        }
        mainWindow?.flashFrame(true);
        if (Notification.isSupported()) {
          incomingNotification = new Notification({ title: 'Incoming call', body: `${title} is calling` });
          incomingNotification.on('click', () => {
            mainWindow?.show();
            mainWindow?.focus();
          });
          incomingNotification.show();
        }
      } else if (state === 'calling' || state === 'active' || state === 'connecting') {
        if (tray) tray.setToolTip(`Chatgram — in a call with ${title}`);
        mainWindow?.flashFrame(false);
      } else {
        if (tray) tray.setToolTip(unreadCount > 0 ? `Chatgram — ${unreadCount} unread` : 'Chatgram');
        mainWindow?.flashFrame(false);
        if (incomingNotification) {
          incomingNotification.close();
          incomingNotification = null;
        }
      }
    });

    setTimeout(() => void checkMinimumVersion(), 2500);
    setTimeout(() => checkForUpdates(false), 6000);
  });

  app.on('window-all-closed', () => {
    // Windows: stay alive in the tray.
    if (process.platform !== 'darwin' && !tray) app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });
}
