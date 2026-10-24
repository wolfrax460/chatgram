# Chatgram

A fast, private messaging app for the web, Windows and Android — real-time chat,
voice notes, media, groups, 24-hour status updates and two-step verification,
backed by a Node.js + Socket.IO + MongoDB API.

**[Open the web app](https://chatgram-xi.vercel.app/web/)** ·
[Landing page](https://chatgram-xi.vercel.app/) ·
[Terms & Privacy](https://chatgram-xi.vercel.app/docs/) ·
[Download](#download)

> **Honest note:** messages are encrypted in transit (HTTPS/WSS) and stored on the
> server, but **not end-to-end encrypted** yet. That is the top roadmap item.

---

## What is in the app today

### Messaging
- **Real-time delivery** over Socket.IO, with optimistic sending and automatic retry
- **Delivered and read receipts** — single tick, double tick, blue double tick
- **Reply, edit, delete** (for me or for everyone), **forward, star, react** and **report**
- **Pin** important messages and **@mention** people in groups
- **Voice notes**, photos, video and documents — uploads stream straight to
  Cloudinary with progress, cancel and retry
- **Typing indicators**, presence and last-seen
- **Voice and video calls** over WebRTC — one-to-one, or **group calls with up to 20 people**
  (ring, mute, camera toggle, participant grid, call timer)
- **Search** for people, start a chat instantly, **mute** or **clear** conversations
- Works offline-ish: a cold or flaky connection recovers and re-syncs without losing the draft

### Groups
- Create a group with a **photo**, description and members
- **Admin roles** — promote, demote, add and remove members; the last admin leaving
  auto-promotes the next member so a group is never orphaned
- **Permissions**: who can edit group info, send messages and add members
- **Join-request approval mode** — outsiders request, an admin approves or declines
- **Invite links** that can be revoked, with a preview before joining
- **System messages** for joins, leaves, renames and permission changes
- **Shared media** browser and group **member list** with live updates
- **Group calls** — voice or video, up to **20 participants** in one call, rung from the chat header

### Status (24-hour stories)
- Post a **photo, video or audio** status with a caption
- Media is **never cropped or stretched** — letterboxed to fit any aspect ratio
- Viewer with **auto-advance**, a progress bar, **hold to pause**, and arrow-key navigation
- See exactly **who viewed** your status; everything expires after 24 hours and the
  stored files are deleted by a background cleanup job

### Privacy and safety
- Control who sees your **online status, last seen, profile photo, about, phone and email**
- **Read-receipt privacy** — turn receipts off and still receive messages
- **Block** and **unblock** people, **mute** chats, **report** users and messages
- **Profile panel** — tap any person to see their photo, about, presence, common
  groups and shared media, respecting their privacy settings
- Per-contact view of what you share, not a global broadcast

### Account and security
- **Two-step verification (TOTP)** — QR enrolment, 10 single-use recovery codes,
  regenerate codes, disable with a code
- **Password change** with current-password check and **invalidation of every other session**
- **Active sessions** list with sign-out of other devices
- **Identifier change** (email/phone) with a verification code
- **Delete account** permanently, with confirmation
- **Google sign-in** on web and desktop (OAuth 2.0 authorization-code flow)
- **Email verification** with 6-digit codes, **password reset**, **login rate limiting**
  and **account lockout** after repeated failures

### Notifications and appearance
- In-app notifications, desktop notifications and a message chime
- **Do-not-disturb schedule** (server-persisted, wrap-over-midnight aware)
- **Light / dark / system** themes, adjustable **text size**
- **Four languages**: English, Ikinyarwanda, Français, Kiswahili

### Help and support
- **Help centre** with 10 collections and 37 articles, searchable in-app
- **AI assistant** that answers from the knowledge base, with **human handoff** —
  escalations become tickets that appear in an admin dashboard and alert Telegram/email
- Support widget works for **signed-in users and guests**

### Platforms
| Platform | Status |
|---|---|
| **Web** (React + Vite) | Live — https://chatgram-xi.vercel.app/web/ |
| **Windows** (Electron, NSIS installer) | Live, **unsigned** — SmartScreen will warn on first run |
| **Android** (Capacitor APK) | Buildable, **debug-signed**, not on the Play Store yet |

---

## Download

| Platform | File | Notes |
|---|---|---|
| Windows 10+ (64-bit) | [`chatgram-windows-setup.exe`](https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe) | Unsigned; choose *More info → Run anyway* |
| Android 6.0+ | [`chatgram.apk`](https://chatgram.duckdns.org/downloads/chatgram.apk) | Allow "Install unknown apps" when prompted |
| Any modern browser | [Open the web app](https://chatgram-xi.vercel.app/web/) | Nothing to install |

---

## Tech stack

| Layer | Technology |
|---|---|
| Web client | React 18, TypeScript (strict), Vite, Tailwind CSS, TanStack Query, Zustand, lucide-react |
| Realtime | Socket.IO 4 (client + server) with JWT-authenticated sockets |
| API | Node.js, Express 5, Mongoose 9, MongoDB Atlas |
| Auth | JWT access + rotating refresh tokens, bcrypt, TOTP 2FA, Google OAuth |
| Media | Cloudinary in production, local disk in development |
| Desktop | Electron 33, electron-builder (NSIS) |
| Mobile | Capacitor 6 (Android) |
| Hosting | Vercel (web + landing), Oracle Cloud VM with nginx + PM2 (API) |
| Tests | Node assertion suites + Playwright end-to-end |

---

## Repository layout

```
chatgram/
├── apps/
│   ├── web/          React single-page app (served at /web/)
│   ├── desktop/      Electron wrapper for the Windows build
│   └── mobile/       Capacitor Android wrapper
├── packages/
│   ├── core/         Shared models and types
│   ├── api-client/   Typed API + socket client
│   └── realtime/     Socket helpers
├── server/           Express API, Socket.IO, MongoDB models, tests
├── client/landing/   Marketing site + static /docs page (deployed at /)
└── docs/             API contract, deploy procedure, decisions, progress
```

---

## Getting started

**Prerequisites:** Node.js 20+, npm 10+, MongoDB running on `127.0.0.1:27017`.

```powershell
npm install
npm install --prefix client/landing
npm install --prefix server
```

### Run the stack locally

Two terminals, from the repo root:

```powershell
# 1. API on :5000 against a throwaway chatgram_staging database.
#    Real providers (Atlas, Cloudinary, Telegram, SMTP) are overridden and disabled.
npm run start:staging

# 2. Web client on :5174 (proxies /api and /uploads to the API)
npm run dev
```

Open <http://localhost:5174>.

### Build

```powershell
npm run typecheck                 # TypeScript across all workspaces
npm run build                     # web app -> apps/web/dist
npm run build --prefix client/landing
```

### Desktop and Android

```powershell
npm run dist -w @chatgram/desktop      # Windows NSIS installer
npm run sync -w @chatgram/mobile       # copy the web build into the Android shell
npm run build:apk -w @chatgram/mobile  # requires JDK 17+ and the Android SDK
```

---

## Testing

```powershell
npm run test:unit         # 2FA crypto, TOTP and recovery codes  (no DB needed)
npm run test:integration  # API suites against the local staging API
npm run test:ai           # AI layer, provider adapters and fallback
npm run test:e2e          # Playwright: layout, realtime, groups, settings, security
npm run test:all          # everything
```

The integration suites expect the staging API from `npm run start:staging` on port 5000.
Current gate: **50 unit · 400 integration assertions · 36 AI · 57 Playwright**.

---

## Deployment

Production is deployed **only when the gate is green**. The full procedure —
backups, health gates, rollback steps and the deploy record — lives in
[docs/deploy.md](docs/deploy.md).

| Surface | URL | Hosting |
|---|---|---|
| Landing + web app + `/docs` | https://chatgram-xi.vercel.app | Vercel |
| API + WebSocket | https://chatgram.duckdns.org | Oracle VM, nginx, PM2 |
| Database | — | MongoDB Atlas M0 |
| Media | — | Cloudinary |

---

## Not built yet

These are real gaps, not fine print:

- **End-to-end encryption** — messages are encrypted in transit and at rest, but the
  server can read them. E2EE is the next major item.
- **Push notifications** when the app is closed (FCM/APNs)
- **Calls larger than 20 people** — the current WebRTC mesh is capped at 20;
  bigger rooms need a media server (SFU)
- **Message search** across conversations, and conversation export/backup
- **Android release build** — currently debug-signed with a placeholder application id
- **Windows code signing** — the installer is unsigned, so SmartScreen warns

---

## Security

- TLS everywhere (HTTPS and WSS) with automatically renewed certificates
- Short-lived access tokens with rotating refresh tokens; sign-out revokes server-side
- Passwords hashed with bcrypt; 2FA secrets encrypted at rest with AES-256-GCM
- Login, sign-up, password-reset and verification endpoints are rate limited;
  repeated failures trigger a temporary account lockout
- Uploads are size- and type-checked, and expired status media is deleted from storage
- Server-side authorisation is enforced per chat, per role and per privacy setting —
  never trusted from the client

To report a vulnerability, please open a private security advisory instead of a public issue.

---

## License

[MIT](LICENSE) © 2026 is'haq
