# Chatgram for Windows — build notes

The desktop app is a small Electron shell around the hosted Chatgram web client
(`apps/desktop`). The web build is the single source of truth: the shell loads
`https://chatgram-xi.vercel.app/web/`, so every web deploy (Chatgram AI, the admin
dashboard, statuses, help centre, recommendations…) reaches the desktop app
without shipping a new installer. The installer only needs rebuilding when the
shell itself changes (tray, updater, version gate, icons).

## What the shell does

- Single instance lock (a second launch focuses the first window).
- Tray icon: show/hide, "Check for updates…", "Start with Windows" (persisted in
  `%APPDATA%\Chatgram\settings.json`), Quit.
- Minimise to tray on close; the app keeps running in the tray.
- Windows taskbar unread badge (overlay icon) + title count, fed by the web app
  through `window.chatgramDesktop.setUnread`.
- Native notifications through the preload bridge and `Notification`.
- Window icons: `assets/icon.ico` (normal) and `assets/icon-unread.ico` (unread).
- Offline page (`offline.html`) when the hosted app cannot be reached.
- Auto-update (chunk 7B): `electron-updater` with a **generic** feed at
  `https://chatgram-xi.vercel.app/downloads` (reads `latest.yml` there). The shell
  checks **30 s after launch, then every ~6 h with ±15 min jitter, and again on
  resume from sleep / unlock**. A manual "Check for updates" lives in
  Settings → About and in the tray menu.
- Update policy: the shell first asks `GET /api/app/version?platform=windows`
  which decides the policy (`latestVersion`, `minSupportedVersion`,
  `forceUpdate`, `withdrawn`) — see `apps/desktop/updater-logic.js`, unit tested
  by `node apps/desktop/updater-logic.test.js`. It **never downgrades**, never
  offers a withdrawn build, and below the minimum (or forced) it replaces the
  window with a blocking `update-required.html` page that downloads and installs
  by itself.
- Download: in the background, with progress, byte counts and speed shown only in
  **Settings → About** (never over the app). When it finishes the shell shows
  "Update ready: Restart to install" (banner + notification) and installs on quit
  by itself; "Restart now" installs immediately. It never restarts on its own.
- Failures: each attempt retries with backoff (5 s, 15 s, 45 s, ~2 m, ~7 m, ~20 m,
  capped at 30 min, six tries) and then returns to the 6-hour schedule; the
  installed version keeps working. A local log is written to
  `%APPDATA%\Chatgram\update.log` (rotated at 256 KB, no secrets, no chat data).
- "Download updates automatically" is a switch in Settings → About (default on),
  persisted in `%APPDATA%\Chatgram\settings.json`.
- Diagnostics for support: the About card shows the installed version, the last
  check time, the update state and the release notes.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
  external links open in the real browser.

## Updates and SmartScreen (the installer is unsigned)

Chatgram's Windows installer is **not code-signed**, so:

- **First install by hand**: a user downloading `chatgram-windows-setup.exe` may
  see "Windows protected your PC" (SmartScreen). They choose *More info* →
  *Run anyway*. This is expected, not a bug; a code-signing certificate is the
  only real fix (out of scope for this project's budget).
- **Automatic updates do not go through SmartScreen**: the NSIS updater runs
  `electron-updater`'s helper with the same unsigned installer over an existing
  install, so there is no "unknown publisher" prompt on update. The *download* is
  verified instead: electron-updater checks the **SHA-512** recorded in
  `latest.yml` before running anything, and the version endpoint always points at
  our own HTTPS domain, never a third-party host.
- **No publisher pinning**: electron-builder writes `publisherName` only for
  signed builds. Because this build is unsigned there is no publisher to pin, so
  `electron-updater` performs no Authenticode check (setting
  `updater.publisherName = null` makes that explicit) while keeping the SHA-512
  verification on. Do **not** set `win.publisherName` in `package.json` unless a
  certificate is added later — it would make every update fail signature checks.
- **Downgrades and withdrawn builds** are refused in code
  (`apps/desktop/updater-logic.js`), independent of the signing situation.
- **Troubleshooting**: `%APPDATA%\Chatgram\update.log` records each check,
  download and failure (no secrets). Deleting `%LOCALAPPDATA%\chatgram-updater`
  forces a fresh download if a cached file is corrupt.

## Build

Prerequisites: Node.js 20+, npm, network access for the Electron/NSIS downloads the
first time (electron-builder caches them under `%LOCALAPPDATA%\electron-builder\Cache`;
Electron itself came from the repo's `node_modules/electron/dist`, wired in via
`build.electronDist`, so the build does not re-download it).

```powershell
npm install                      # from the repo root (workspace deps hoist here)
npx electron-builder --win nsis --publish never --config.publish=never
```

Output: `apps/desktop/release/chatgram-windows-setup.exe` (NSIS, x64,
per-user install, choose directory, desktop + start-menu shortcuts).

`release/` is git-ignored; the file is published under `/downloads/` and recorded
in the admin → **App releases** page, which feeds the landing Downloads tab and
the in-app updater.

## This build

| | |
| --- | --- |
| Version | 1.1.0 (rebuilt 2026-10-26) |
| File | `chatgram-windows-setup.exe` |
| Size | 81,824,358 bytes |
| SHA-256 | `c98820472d69447a61d3fc0f0d51c29d79d5bbd1a4fca4365a31b77f69853ab3` |
| Signed | **No** - the installer is unsigned. Windows SmartScreen may show "Windows protected your PC". |
| Updater metadata | `latest.yml` refreshed with the new SHA-512 and size. |

### SmartScreen / install steps

1. Download `chatgram-windows-setup.exe` from the landing Downloads tab.
2. If SmartScreen appears: **More info → Run anyway** (the build is unsigned; the
   published SHA-256 above lets you verify the file with
   `Get-FileHash .\chatgram-windows-setup.exe -Algorithm SHA256`).
3. Run the installer, choose a folder if you want, finish. Chatgram opens and
   stays in the tray when closed.
4. Later versions arrive through the built-in updater once `latest.yml` and the
   installer are published under `/downloads/`.
