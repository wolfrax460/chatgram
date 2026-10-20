/**
 * Chatgram desktop shell.
 *
 * Loads the hosted React client. The web build is the single source of truth,
 * so a deploy updates the desktop app without shipping a new installer.
 *
 * Security: contextIsolation on, nodeIntegration off, sandbox on. The renderer
 * gets a tiny, explicit API from preload.js and nothing else.
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_URL = process.env.CHATGRAM_URL || 'https://chatgram-xi.vercel.app/web/';
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');

let mainWindow = null;
let tray = null;
let unreadCount = 0;
let isQuitting = false;

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

/* ------------------------------------------------------------- updates */

let updater = null;
function setupUpdater() {
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    console.log('electron-updater not installed — skipping auto-update');
    return;
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

  app.whenReady().then(() => {
    createWindow();
    createTray();
    setupUpdater();

    // Start-on-login (opt-in would need a setting; default off).
    app.setLoginItemSettings({ openAtLogin: false });

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
