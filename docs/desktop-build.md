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
- Auto-update: `electron-updater` with a **generic** feed at
  `https://chatgram-xi.vercel.app/downloads` (reads `latest.yml` there). The shell
  checks once 6 seconds after launch and from the tray menu.
- Minimum supported / forced update: on launch the shell reads
  `GET /api/app/releases` and compares its version with the Windows release's
  `minSupportedVersion` and `forceUpdate`. Below the minimum (or forced), it shows
  a dialog with a link to the download page and quits.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
  external links open in the real browser.

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
| Version | 1.1.0 |
| File | `chatgram-windows-setup.exe` |
| Size | 81,823,613 bytes (≈ 78.0 MB) |
| SHA-256 | `1943d51ae5c7ec7d48a10da38c1694dae9622f4ad0d9d90caa5b430456fdbae5` |
| Signed | **No** — the installer is unsigned. Windows SmartScreen may show "Windows protected your PC". |
| Updater metadata | `latest.yml` (version 1.1.0, SHA-512 of the installer) next to the file |

### SmartScreen / install steps

1. Download `chatgram-windows-setup.exe` from the landing Downloads tab.
2. If SmartScreen appears: **More info → Run anyway** (the build is unsigned; the
   published SHA-256 above lets you verify the file with
   `Get-FileHash .\chatgram-windows-setup.exe -Algorithm SHA256`).
3. Run the installer, choose a folder if you want, finish. Chatgram opens and
   stays in the tray when closed.
4. Later versions arrive through the built-in updater once `latest.yml` and the
   installer are published under `/downloads/`.
