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
const { decideUpdate, backoffDelay, nextCheckDelay, describeAttempt } = require('./updater-logic');
const fs = require('node:fs');

const APP_URL = process.env.CHATGRAM_URL || 'https://chatgram-xi.vercel.app/web/';
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
const UPDATE_REQUIRED_PAGE = path.join(__dirname, 'update-required.html');

// electron-updater and the tray need the real Electron runtime. Some CI shells set
// ELECTRON_RUN_AS_NODE, which loads this file under plain Node and leaves `app`
// undefined; say so instead of throwing a confusing TypeError.
if (!app || typeof app.getPath !== 'function') {
  console.error('Chatgram must run inside Electron (unset ELECTRON_RUN_AS_NODE).');
  process.exit(1);
}
const WEB_ORIGIN = 'https://chatgram-xi.vercel.app';
// Large binaries must come from the VM directly: the Vercel /downloads/* proxy
// mangles Range responses (a 1 MB range came back as ~19 MB), which breaks the
// 82 MB installer download. latest.yml, the .blockmap and the .exe all live here.
const DOWNLOAD_ORIGIN = 'https://chatgram.duckdns.org';
const DOWNLOAD_PAGE = WEB_ORIGIN + '/#download';

/**
 * Windows toast notifications are attributed to an Application User Model ID.
 * Without one the toast says "electron.exe", ignores our icon and — worse — the
 * click handler is not delivered, so tapping a message notification did nothing
 * in a packaged build. Must match build.appId in package.json.
 */
app.setAppUserModelId('com.chatgram.desktop');

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

/**
 * Windows update runtime.
 *
 * Policy (docs/chatgram-round3-prompt.md, 7B):
 *  - check 30 s after launch, then every 6 h with jitter, and on resume/unlock;
 *  - download in the background, surfacing progress only in Settings -> About;
 *  - never restart on its own: show "Update ready: Restart to install", install
 *    on quit or immediately on "Restart now";
 *  - below minSupportedVersion or forceUpdate -> blocking "Update required" page;
 *  - failures retry with backoff and always keep the current version running;
 *  - unsigned installer: electron-builder carries no publisherName, so no
 *    publisher check is attempted, while electron-updater still verifies the
 *    SHA-512 recorded in latest.yml before installing. See docs/desktop-build.md.
 */

const START_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const CHECK_JITTER_MS = 15 * 60_000;
const MAX_CHECK_ATTEMPTS = 6;
const UPDATE_LOG_MAX_BYTES = 256 * 1024;

/** Normal 6 h schedule with jitter (see updater-logic.nextCheckDelay). */
const normalCheckDelay = () => nextCheckDelay({ intervalMs: CHECK_INTERVAL_MS, jitterMs: CHECK_JITTER_MS });

const updateLogPath = () => path.join(app.getPath('userData'), 'update.log');

/** Append one line to a local log file (no secrets, no chat data). */
function logUpdate(level, message) {
  const line = new Date().toISOString() + ' [' + level + '] ' + String(message).slice(0, 400) + '\n';
  try {
    const target = updateLogPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      if (fs.statSync(target).size > UPDATE_LOG_MAX_BYTES) fs.renameSync(target, target + '.1');
    } catch {
      /* first write */
    }
    fs.appendFileSync(target, line, 'utf8');
  } catch {
    /* logging must never break the app */
  }
  if (level === 'error') console.warn('[update]', message);
  else console.log('[update]', message);
}

const updateState = {
  status: 'idle', // idle | checking | available | downloading | ready | error | required
  version: null,
  notes: null,
  releasedAt: null,
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  lastCheckedAt: null,
  error: null,
  required: false,
  autoDownload: loadSettings().autoDownloadUpdates !== false,
  devMode: !app.isPackaged,
};

let updater = null;
let updateTimer = null;
let checkAttempt = 0;
let updateBusy = false;
let requiredScreenShown = false;

function broadcastUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('chatgram:update-state', updateState);
  } catch {
    /* window may be closing */
  }
  if (tray) {
    tray.setToolTip(
      updateState.status === 'ready'
        ? 'Chatgram - update ' + updateState.version + ' ready to install'
        : unreadCount > 0
          ? 'Chatgram - ' + unreadCount + ' unread'
          : 'Chatgram',
    );
  }
}

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  broadcastUpdateState();
}

/** Ask the version endpoint what policy applies to this install. */
async function fetchVersionPolicy() {
  const url =
    WEB_ORIGIN +
    '/api/app/version?platform=windows&current=' +
    encodeURIComponent(app.getVersion()) +
    '&build=0';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const payload = await response.json();
    const decision = decideUpdate({
      currentVersion: app.getVersion(),
      latestVersion: payload.latestVersion,
      minSupportedVersion: payload.minSupportedVersion,
      forceUpdate: payload.forceUpdate,
      withdrawn: payload.withdrawn,
    });
    return { payload, decision };
  } catch (error) {
    logUpdate('warn', 'version check failed: ' + (error && error.message));
    return null;
  }
}

function setupUpdater() {
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch {
    logUpdate('warn', 'electron-updater not installed - auto-update disabled');
    setUpdateState({ status: 'error', error: 'Auto-update is unavailable in this build.', devMode: true });
    return;
  }

  try {
    updater.setFeedURL({ provider: 'generic', url: DOWNLOAD_ORIGIN + '/downloads' });
  } catch (error) {
    logUpdate('warn', 'could not set the update feed: ' + (error && error.message));
  }

  // Background download, but no surprise restart and no downgrades.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  // The installer is unsigned, so there is no publisher to pin. SHA-512 from
  // latest.yml is still verified by electron-updater before install.
  updater.publisherName = null;

  updater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  updater.on('update-available', (info) => {
    checkAttempt = 0;
    logUpdate('info', 'update available: ' + (info && info.version));
    setUpdateState({ status: 'available', version: (info && info.version) || updateState.version });
    if (updateState.required || updateState.autoDownload) void startDownload();
  });
  updater.on('update-not-available', () => {
    checkAttempt = 0;
    setUpdateState({ status: 'idle', version: null, lastCheckedAt: new Date().toISOString(), error: null });
  });
  updater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      percent: Math.max(0, Math.min(100, Number(progress && progress.percent) || 0)),
      transferred: Number(progress && progress.transferred) || 0,
      total: Number(progress && progress.total) || 0,
      bytesPerSecond: Number(progress && progress.bytesPerSecond) || 0,
    });
  });
  updater.on('update-downloaded', (info) => {
    logUpdate('info', 'update downloaded: ' + (info && info.version));
    setUpdateState({
      status: 'ready',
      version: (info && info.version) || updateState.version,
      notes: info && typeof info.releaseNotes === 'string' ? info.releaseNotes : updateState.notes,
      percent: 100,
      error: null,
    });
    if (Notification.isSupported()) {
      new Notification({
        title: 'Chatgram update ready',
        body: 'Version ' + ((info && info.version) || '') + ' will install when you quit, or click Restart.',
      }).show();
    }
  });
  updater.on('error', (error) => {
    logUpdate('error', 'updater error: ' + (error && error.message));
    setUpdateState({ status: 'error', error: 'The update could not be downloaded.', percent: 0 });
    scheduleRetry();
  });
}

async function startDownload() {
  if (!updater || updateBusy) return updateState;
  if (updateState.status === 'downloading' || updateState.status === 'ready') return updateState;
  updateBusy = true;
  try {
    logUpdate('info', 'starting background download');
    await updater.downloadUpdate();
  } catch (error) {
    logUpdate('error', 'download failed: ' + (error && error.message));
    setUpdateState({ status: 'error', error: 'The update could not be downloaded.' });
    scheduleRetry();
  } finally {
    updateBusy = false;
  }
  return updateState;
}

/** Show the blocking page that downloads and installs by itself. */
async function showUpdateRequired(targetVersion) {
  if (requiredScreenShown || !mainWindow || mainWindow.isDestroyed()) return;
  requiredScreenShown = true;
  setUpdateState({ status: 'required', required: true, version: targetVersion || updateState.version });
  logUpdate('warn', 'blocking update required to ' + (targetVersion || 'unknown'));
  try {
    await mainWindow.loadFile(UPDATE_REQUIRED_PAGE);
  } catch (error) {
    logUpdate('error', 'could not open the update page: ' + (error && error.message));
    requiredScreenShown = false;
  }
}

function installUpdate() {
  if (!updater || updateState.status !== 'ready') return false;
  logUpdate('info', 'installing update and restarting');
  isQuitting = true;
  setImmediate(() => {
    try {
      updater.quitAndInstall(false, true);
    } catch (error) {
      logUpdate('error', 'install failed: ' + (error && error.message));
      isQuitting = false;
    }
  });
  return true;
}

function scheduleRetry() {
  checkAttempt += 1;
  if (checkAttempt > MAX_CHECK_ATTEMPTS) {
    logUpdate('warn', 'retry limit reached; returning to the normal schedule');
    checkAttempt = 0;
    scheduleNextCheck(normalCheckDelay());
    return;
  }
  const delay = backoffDelay(checkAttempt);
  logUpdate('info', 'retry ' + describeAttempt(checkAttempt) + ' in ' + Math.round(delay / 1000) + ' s');
  scheduleNextCheck(delay);
}

function scheduleNextCheck(delayMs) {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    void checkForUpdates(false);
  }, Math.max(1_000, delayMs));
  if (updateTimer.unref) updateTimer.unref();
}

/**
 * One update check: the version endpoint decides force/minimum policy, then
 * electron-updater looks at /downloads/latest.yml for the actual package.
 */
async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    setUpdateState({ status: 'idle', devMode: true, lastCheckedAt: new Date().toISOString() });
    return updateState;
  }
  const policy = await fetchVersionPolicy();
  if (policy) {
    const payload = policy.payload;
    setUpdateState({
      version: payload.latestVersion || null,
      notes: payload.notes || null,
      releasedAt: payload.releasedAt || null,
    });
    if (policy.decision.action === 'required') {
      void startDownload();
      void showUpdateRequired(payload.latestVersion);
      return updateState;
    }
  }

  if (!updater) {
    if (manual) setUpdateState({ error: 'Auto-update is unavailable in this build.' });
    scheduleNextCheck(normalCheckDelay());
    return updateState;
  }

  try {
    setUpdateState({ status: 'checking', error: null, manual });
    await updater.checkForUpdates();
    setUpdateState({ lastCheckedAt: new Date().toISOString() });
  } catch (error) {
    logUpdate('warn', 'check failed: ' + (error && error.message));
    setUpdateState({ status: 'error', error: 'Could not check for updates.' });
    scheduleRetry();
    return updateState;
  }
  // The normal plan resumes after a successful check, unless a download is running.
  if (updateState.status !== 'downloading' && updateState.status !== 'ready') {
    scheduleNextCheck(normalCheckDelay());
  }
  return updateState;
}

/** Start the schedule: 30 s after launch, then every ~6 h, plus resume/unlock. */
function startUpdateScheduler() {
  setupUpdater();
  scheduleNextCheck(START_CHECK_DELAY_MS);
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('resume', () => {
      logUpdate('info', 'woke from sleep - checking for updates');
      scheduleNextCheck(5_000);
    });
    powerMonitor.on('unlock-screen', () => scheduleNextCheck(5_000));
  } catch (error) {
    logUpdate('warn', 'power monitor unavailable: ' + (error && error.message));
  }
  logUpdate('info', 'scheduler started (first check in ' + START_CHECK_DELAY_MS / 1000 + ' s)');
}

/* ------------------------------------------------------------------ ipc */

/**
 * Bring the window back from the tray / taskbar and, when the notification was
 * about a chat, tell the page which conversation to open.
 */
function focusMainWindow(chatId) {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  if (chatId) {
    try {
      mainWindow.webContents.send('chatgram:open-chat', String(chatId));
    } catch {
      /* the page may still be loading; the tray badge is enough */
    }
  }
}

ipcMain.on('chatgram:unread', (_event, count) => setUnread(count));

ipcMain.handle('chatgram:notify', (_event, payload = {}) => {
  const title = String(payload.title || 'Chatgram');
  const body = String(payload.body || '');
  const chatId = payload.chatId ? String(payload.chatId) : '';
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title,
    body,
    icon: windowIcon(false),
    silent: payload.silent === true,
  });
  notification.on('click', () => focusMainWindow(chatId));
  notification.show();
  return true;
});

ipcMain.handle('chatgram:appVersion', () => app.getVersion());

// --- notification state and the Windows settings screen -------------------
//
// Windows has no per-app permission prompt to query: a toast is shown unless the
// user turned Chatgram off in Settings → System → Notifications (or Focus
// assist is on). So the honest answer is "the OS will show it" plus a way to
// reach that page, which is exactly what the Settings screen needs; without this
// the row was dead because the page cannot open ms-settings itself.
ipcMain.handle('chatgram:notification-support', () => ({
  supported: Notification.isSupported(),
  platform: process.platform,
}));

ipcMain.handle('chatgram:open-notification-settings', async () => {
  try {
    // Windows 10/11 notification settings page (per-app toggles live here).
    await shell.openExternal('ms-settings:notifications');
    return true;
  } catch {
    try {
      await shell.openExternal('ms-settings:');
      return true;
    } catch {
      return false;
    }
  }
});

// --- updates (Settings -> About and the required-update screen) ---
ipcMain.handle('chatgram:update-state', () => updateState);
ipcMain.handle('chatgram:update-check', async () => {
  await checkForUpdates(true);
  return updateState;
});
ipcMain.handle('chatgram:update-download', async () => startDownload());
ipcMain.handle('chatgram:update-install', () => ({ installed: installUpdate() }));
ipcMain.handle('chatgram:update-auto-download', (_event, value) => {
  const enabled = value !== false;
  updateState.autoDownload = enabled;
  saveSettings({ ...loadSettings(), autoDownloadUpdates: enabled });
  broadcastUpdateState();
  return { autoDownload: enabled };
});
ipcMain.handle('chatgram:update-open-downloads', () => {
  shell.openExternal(DOWNLOAD_PAGE);
  return true;
});

/* ------------------------------------------- remote control (screen share) */
//
// The web app negotiates consent over a WebRTC data channel and only forwards
// input events while an approved session is active. This process is the last
// line of defence: it re-validates every payload, maps normalized coordinates
// to the primary display, rate-limits to ~120 events/s and never logs keys.
// `@nut-tree-fork/nut-js` is loaded lazily so a missing/broken native build only
// disables remote control ("Remote control is not available in this build")
// instead of crashing the shell.
let nut = null;
try {
  // eslint-disable-next-line global-require
  nut = require('@nut-tree-fork/nut-js');
} catch (error) {
  const reason = error && error.message ? String(error.message).slice(0, 200) : 'unknown error';
  console.warn('Remote control unavailable (nut-js failed to load):', reason);
}

const CONTROL_MAX_EVENTS_PER_SEC = 120;
const CONTROL_KEY_NAMES = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Backspace', 'Enter', 'Tab', 'Escape', 'Delete',
  'Home', 'End', 'PageUp', 'PageDown',
  'Shift', 'Control', 'Alt', 'Meta',
]);
const CONTROL_SPECIAL_KEYS = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Shift: 'LeftShift',
  Control: 'LeftControl',
  Alt: 'LeftAlt',
  Meta: 'LeftSuper',
};

let controlSessionActive = false;
let controlRate = { at: 0, count: 0 };

function isTrustedControlSender(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function controlRateAllowed() {
  const now = Date.now();
  if (now - controlRate.at > 1_000) controlRate = { at: now, count: 0 };
  controlRate.count += 1;
  return controlRate.count <= CONTROL_MAX_EVENTS_PER_SEC;
}

function controlKeyAllowed(key) {
  if (typeof key !== 'string' || !key) return false;
  if (key.length === 1) {
    const code = key.charCodeAt(0);
    return code >= 32 && code <= 126;
  }
  return CONTROL_KEY_NAMES.has(key);
}

/** Validate the renderer payload again (never trust the page). */
function validControlEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const unit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  if (event.t === 'm') return unit(event.x) && unit(event.y) ? { t: 'm', x: event.x, y: event.y } : null;
  if (event.t === 'w') {
    return unit(event.x) && unit(event.y) && typeof event.dy === 'number' && Number.isFinite(event.dy)
      ? { t: 'w', x: event.x, y: event.y, dy: Math.max(-10, Math.min(10, event.dy)) }
      : null;
  }
  if (event.t === 'c') {
    const button = event.button === 0 || event.button === 1 || event.button === 2 ? event.button : null;
    return button !== null && unit(event.x) && unit(event.y) && typeof event.down === 'boolean'
      ? { t: 'c', x: event.x, y: event.y, button, down: event.down }
      : null;
  }
  if (event.t === 'k') {
    return controlKeyAllowed(event.key) && typeof event.down === 'boolean'
      ? { t: 'k', key: event.key, down: event.down }
      : null;
  }
  return null;
}

/** Map 0..1 coordinates to the primary display and inject with nut-js. */
async function injectControlEvent(event) {
  if (!nut) return false;
  let width = 1;
  let height = 1;
  try {
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    width = Math.max(1, display.size.width);
    height = Math.max(1, display.size.height);
  } catch {
    return false;
  }
  const x = Math.round(event.x * (width - 1));
  const y = Math.round(event.y * (height - 1));
  try {
    if (event.t === 'm') {
      await nut.mouse.setPosition({ x, y });
      return true;
    }
    if (event.t === 'w') {
      await nut.mouse.setPosition({ x, y });
      const steps = Math.max(1, Math.round(Math.abs(event.dy) / 2));
      if (event.dy < 0) await nut.mouse.scrollUp(steps);
      else await nut.mouse.scrollDown(steps);
      return true;
    }
    if (event.t === 'c') {
      await nut.mouse.setPosition({ x, y });
      const button = event.button === 2 ? nut.Button.RIGHT : event.button === 1 ? nut.Button.MIDDLE : nut.Button.LEFT;
      if (event.down) await nut.mouse.pressButton(button);
      else await nut.mouse.releaseButton(button);
      return true;
    }
    if (event.t === 'k') {
      if (event.key.length === 1) {
        if (event.down) await nut.keyboard.type(event.key);
        return true;
      }
      const name = CONTROL_SPECIAL_KEYS[event.key];
      const code = name ? nut.Key[name] : undefined;
      if (code === undefined) return false;
      if (event.down) await nut.keyboard.pressKey(code);
      else await nut.keyboard.releaseKey(code);
      return true;
    }
    return false;
  } catch (error) {
    // Never log the key itself: only the failure kind.
    const reason = error && error.message ? String(error.message).slice(0, 160) : 'injection failed';
    console.warn('Remote control injection failed:', reason);
    return false;
  }
}

ipcMain.handle('chatgram:control-available', () => Boolean(nut));

ipcMain.on('chatgram:control-session', (event, active) => {
  if (!isTrustedControlSender(event)) return;
  controlSessionActive = active === true && Boolean(nut);
  if (!controlSessionActive && nut) {
    // Release anything the viewer may have left pressed so their session cannot
    // leave a stuck mouse button or modifier behind.
    try {
      void nut.mouse.releaseButton(nut.Button.LEFT);
      void nut.mouse.releaseButton(nut.Button.RIGHT);
      void nut.mouse.releaseButton(nut.Button.MIDDLE);
      for (const name of ['LeftShift', 'LeftControl', 'LeftAlt', 'LeftSuper']) {
        const code = nut.Key[name];
        if (code !== undefined) void nut.keyboard.releaseKey(code).catch(() => undefined);
      }
    } catch {
      /* best effort */
    }
  }
});

ipcMain.handle('chatgram:control-event', async (event, payload) => {
  // Only a consented, active session in the trusted renderer may inject input.
  if (!isTrustedControlSender(event) || !controlSessionActive || !nut) return false;
  const input = validControlEvent(payload);
  if (!input) return false;
  if (!controlRateAllowed()) return false;
  return injectControlEvent(input);
});

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

    startUpdateScheduler();
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
