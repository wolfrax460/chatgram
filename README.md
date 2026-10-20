# Chatgram

A cross-platform messaging app — Flutter client + Node/Express/Socket.IO backend
+ MongoDB. Runs on **Android**, **Windows desktop** and **Chrome (web)** from one
codebase, with a responsive layout that becomes a WhatsApp-Web style three-pane
desktop layout on wide screens.

> Reviewing this project? Read **[BUG_REPORT.md](BUG_REPORT.md)** — it lists every
> bug found, the root cause of the "backend not responding" symptom, and what is
> still missing.

---

## Stack

| Layer | Technology |
|---|---|
| Client | Flutter 3.47 (Android + Windows + Web) |
| Backend | Node.js + Express 5 (REST) + Socket.IO 4 (realtime) |
| Database | MongoDB 8 + Mongoose |
| Auth | JWT access + refresh tokens (rotated), bcrypt |
| Media | Local disk, served from `/uploads` |

---

## Every time you turn on your computer

Chatgram needs its backend running. There is **one step**:

> Double-click **“Chatgram Server”** on your desktop.

(That's a shortcut to `start-dev.ps1`. Or run `.\start-dev.ps1` from this folder.)

It will:

1. start MongoDB if it isn't already running (no admin rights needed),
2. leave your existing accounts and chats alone — demo data is only loaded
   when the database is empty,
3. start the API and serve the web app.

Leave that window open. **Ctrl+C** stops the server.

### Then, depending on what you want to do

| I want to… | Do this |
|---|---|
| **Just use it** | Open <http://localhost:5001> in your browser |
| **Use the desktop app** | Double-click **“Chatgram”** on your desktop (or `dist\chatgram-windows\chatgram.exe`) |
| **Use my phone** | Open the installed Chatgram app. If it can't connect, tap **“Server: …”** and enter your PC's address |
| **Show a friend** | Send them the **"Share this"** address printed by the server window — same Wi-Fi required |
| **Develop the app** | Open a *second* terminal: `cd client` then `flutter run -d chrome` (or `-d windows`, `-d <android-device>`) |

### If something looks wrong

```powershell
# Is the backend alive?
Invoke-RestMethod http://localhost:5001/api/health
# -> { status: ok, database: connected, ... }

# Is MongoDB listening?
Test-NetConnection 127.0.0.1 -Port 27017
```

| Symptom | Cause | Fix |
|---|---|---|
| "Cannot reach the server" | Server window closed / PC restarted | Double-click **Chatgram Server** again |
| Health says `database: disconnected` | MongoDB is not running | Start the server shortcut again — it starts MongoDB too |
| Port 5001 already in use | A server window is already open | Nothing to do, it's already running |
| Phone can't connect | Wrong server address, or different Wi-Fi | Set it via **“Server: …”** on the login screen |

> **Other commands you may want**
> `.\start-dev.ps1 -Open` (also opens the browser) ·
> `.\start-dev.ps1 -Reseed` (reload demo data) ·
> `npm test` in `server/` (98-check backend suite) ·
> `flutter test` in `client/` (42 tests)

---

## Quick start

### 1. Start the backend

```powershell
.\start-dev.ps1
```

This checks that MongoDB is running (starting `mongod` if needed — the service
was stopped, which is what previously took the whole API down), installs
dependencies, seeds demo data, and starts the API on
`http://localhost:5001`.

Prefer to do it by hand?

```powershell
cd server
npm install
npm run seed      # optional: creates demo users + chats
npm start         # or: npm run dev  (nodemon)
```

Verify:

```powershell
Invoke-RestMethod http://localhost:5001/api/health
# { status: ok, database: connected, onlineUsers: 0, ... }
```

### 2. Run the client

```powershell
cd client
flutter pub get

flutter run -d chrome        # Chrome / web
flutter run -d windows       # Windows desktop
flutter run -d <device-id>   # Android (flutter devices to list)
```

The client picks the right backend URL automatically:

| Target | Default API base URL |
|---|---|
| Web / Windows / iOS sim | `http://localhost:5001` |
| Android emulator | `http://10.0.2.2:5001` |

For a **physical Android device** (or a backend on another machine), override it:

```powershell
flutter run -d <device-id> --dart-define=API_BASE_URL=http://192.168.1.20:5001
```

### 3. Sign in

`npm run seed` creates three accounts (password `password123`):

| Email |
|---|
| `alice@chatgram.dev` |
| `bob@chatgram.dev` |
| `carol@chatgram.dev` |

Two direct chats and a 3-member group with history are created.

**To see realtime working:** open two Chrome windows, sign in as Alice in one and
Bob in the other, then type. You should see messages arrive instantly, the
"typing…" indicator, presence dots and blue read ticks.

---

## Share it with a friend (same Wi-Fi)

The backend also hosts the web app, so the whole thing lives on **one origin** —
no CORS, and nothing to install on your friend's computer.

**1. Build the web app once** (only needed again when the client code changes):

```powershell
cd client
flutter build web --release
```

**2. Start the backend.** It prints the address to share:

```powershell
.\start-dev.ps1
```

```
  This computer : http://localhost:5001
  Share this    : http://10.5.112.99:5001
```

**3. Give your friend that "Share this" URL.** They open it in Chrome (or any
browser) on the same Wi-Fi, click **Create one**, and start chatting with you.

The client figures out the backend automatically: on web it talks to whatever
origin served the page, so the same build works from `localhost`, from your LAN
IP, or from a public URL — no rebuild per machine.

### If your friend cannot connect

1. **Same network?** Both devices must be on the same Wi-Fi/router.
2. **Windows Firewall.** Inbound access for `node.exe` is usually already
   allowed (an "Allow" rule is created the first time you run a Node server and
   accept the prompt). If the page won't load, allow it explicitly — in an
   **Administrator** PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "Chatgram" -Direction Inbound `
     -Protocol TCP -LocalPort 5001 -Action Allow -Profile Private
   ```
3. **Wrong adapter.** `start-dev.ps1` uses the default route to pick the right
   IP. If you have VMware/VirtualBox/WSL installed, ignore the "Other adapters"
   line and use the "Share this" one.
4. **Network profile set to Public.** Works, but Windows is stricter. Setting
   the network to *Private* is recommended.

### Sharing outside your Wi-Fi

The same build works anywhere if you expose the backend:

```powershell
# Option A — quick public tunnel (no account needed)
cloudflared tunnel --url http://localhost:5001
# Option B — ngrok
ngrok http 5001
```

Give your friend the HTTPS URL the tunnel prints. The backend already allows
cross-origin requests in development, and Socket.IO shares the same origin, so
realtime messaging works through the tunnel as-is.

For something permanent, deploy the backend (Render/Railway/Fly + MongoDB Atlas)
and host `client/build/web` on any static host, then build the client against it:

```powershell
flutter build web --release --dart-define=API_BASE_URL=https://your-api.example.com
```

> Reminder for production: replace the JWT secrets in `server/.env`, set
> `NODE_ENV=production` and `CLIENT_URL`, serve over HTTPS, and turn off
> cleartext traffic in `client/android/app/src/main/res/xml/network_security_config.xml`.

---

## Features

- **Welcome screen** — a WhatsApp-style landing page shown the first time the
  app is opened, with copy tailored to the platform (Android / desktop / web).
- **Sign in / sign up with Google** — one button on both screens. Uses the OAuth
  2.0 authorization-code flow, so the *same* code works on web, Android and
  Windows (no native SDK, no `google-services.json`). Hidden until you add a
  Client ID — see [dist/GOOGLE-SIGN-IN-SETUP.md](dist/GOOGLE-SIGN-IN-SETUP.md).
- **Auth** — register with **email or phone**, a **confirm-password** field,
  strict email/phone validation, and **email verification codes / phone OTP**
  before the account is created. Plus JWT access + rotating refresh tokens and
  transparent refresh-and-retry on 401.
- **1:1 messaging** — realtime over Socket.IO, persisted to MongoDB, optimistic
  send with REST fallback and a Retry action, delivered/read receipts (✓/✓✓/blue ✓✓).
- **Group chat** — a dedicated **Groups tab** listing every group you belong to,
  with member counts and an "Admin" badge. Create a group, view group info, add
  or remove members, promote/demote admins, rename the group, or leave it.
  Sender names show in the thread.
- **Contacts (your own address book)** — the Contacts tab shows **only people you
  added**, not every account in the application. Tap **Add contact** to search
  the directory by name, phone or email and add them; people you already chat
  with are suggested. Remove a contact any time.
- **Media** — send photos, videos and documents. Images render inline and open
  full-screen with pinch-zoom; **videos play in-app** on Android/iOS/web (desktop
  hands them to the system player); documents open in their default app.
- **Voice notes** — hold-to-record in the composer, inline playback with a
  scrubber. (On **web**, browsers only allow microphone access over HTTPS or on
  `localhost` — use the Android or Windows app, or serve the site over HTTPS.)
- **Presence & typing** — online/offline with last-seen, per-chat typing indicator.
- **Status / Stories** — text or image, 24h TTL index, and the owner can see
  **exactly who viewed** each status by name and avatar.
- **Contacts** — search, online grouping, one-tap chat.
- **Responsive UI** — bottom-nav phone layout below 900 px; navigation rail +
  chat list + conversation above it. Light and dark themes.
- **Settings** — profile & avatar editing, theme mode, notification/sound/read-receipt
  toggles (persisted), logout.
- **App icon** — generated for Android (legacy + adaptive), web/PWA and Windows
  from one source (`scripts/make_icons.py`).

---

## Project layout

```
chatgram/
├── start-dev.ps1              # one-command local dev (MongoDB + API)
├── BUG_REPORT.md              # review findings
├── server/
│   ├── src/
│   │   ├── server.js          # express app + socket bootstrap
│   │   ├── controllers/       # auth, chat, message, status, user
│   │   ├── middleware/        # auth (JWT), errorHandler
│   │   ├── models/            # User, Chat, Message, Status
│   │   ├── routes/            # REST routes
│   │   ├── sockets/           # socketHandler.js — all realtime events
│   │   └── utils/             # db (retry/backoff), realtime registry, upload
│   ├── uploads/               # avatars/, media/, status/
│   └── test/
│       ├── e2e.smoke.js       # 79-check end-to-end API + socket suite
│       └── seed.js            # demo data
└── client/
    ├── lib/
    │   ├── main.dart          # providers + MaterialApp
    │   ├── server_config.dart # per-platform base URL + media URL resolution
    │   ├── core/              # theme, routes
    │   ├── features/
    │   │   ├── auth/          # login, register, AuthService
    │   │   ├── chat/          # list + thread, ChatService
    │   │   ├── contacts/      # ContactsService
    │   │   ├── status/        # StatusService
    │   │   ├── settings/      # SettingsService
    │   │   └── home/          # HomeShell — responsive master/detail
    │   └── shared/
    │       ├── models/        # UserModel, ChatModel, MessageModel, StatusModel
    │       ├── services/      # ApiClient, SocketService
    │       └── widgets/       # ChatTile, MessageBubble, UserAvatar, …
    └── test/
        ├── models_test.dart           # parsing & status logic
        ├── widget_test.dart           # UI behaviour
        └── api_integration_test.dart  # live HTTP against the running API
```

---

## Testing

**Backend** (needs the API running):

```powershell
cd server
npm test          # 79 checks: auth, users, chats, groups, messages,
                  # receipts, sockets, status, uploads
```

**Client:**

```powershell
cd client
flutter analyze   # expect: No issues found!
flutter test      # 27 unit/widget tests (integration auto-skips)

# Live integration tests against the running backend:
flutter test test/api_integration_test.dart --tags integration `
  --dart-define=API_BASE_URL=http://127.0.0.1:5001
```

**Builds:**

```powershell
cd client
flutter build web --release
flutter build windows --release   # needs "Desktop development with C++" in VS
flutter build apk --release       # needs the Android SDK
```

**Real-browser end-to-end check (web/Chrome):**

```powershell
flutter build web --release      # the probe serves this build
node scripts/verify-web-e2e.js
```

This boots the *compiled* app in headless Chrome against the running backend and
waits for `onlineUsers` to rise from 0 to 1 — which can only happen if the app
restored its session, completed a REST round-trip and authenticated a Socket.IO
connection. Use `--headed` to watch it.

---

## Configuration

`server/.env`:

```ini
NODE_ENV=development
PORT=5001
MONGODB_URI=mongodb://localhost:27017/chatgram
JWT_SECRET=change-me
JWT_EXPIRES_IN=1d
JWT_REFRESH_SECRET=change-me-too
JWT_REFRESH_EXPIRES_IN=30d
CLIENT_URL=http://localhost:3000   # production CORS allow-list
MAX_FILE_SIZE=10mb
```

> **Before deploying:** replace both JWT secrets, set `NODE_ENV=production` and
> `CLIENT_URL`, serve the API over HTTPS, and tighten
> `client/android/app/src/main/res/xml/network_security_config.xml`
> (`cleartextTrafficPermitted="false"`).

---

## Socket.IO event reference

**Client → server:** `authenticate`, `chat:join`, `chat:leave`, `message:send`
(`{ chatId, type, content, mediaUrl, clientId }`), `message:delivered`,
`message:read` (`{ messageId }` or `{ chatId }`), `typing:start`, `typing:stop`.

**Server → client:** `authenticated`, `auth_error`, `message:new`,
`message:error`, `message:delivered`, `message:read`, `presence:online`,
`presence:offline`, `typing:start`, `typing:stop`, `chat:new`, `chat:updated`,
`chat:removed`, `user:updated`.

---

## REST API

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/health` | liveness + DB status |
| `POST` | `/api/auth/register` | `{ displayName, identifier, password }` |
| `POST` | `/api/auth/login` | `{ identifier, password }` |
| `POST` | `/api/auth/refresh` | `{ token }` → rotated pair |
| `GET` | `/api/auth/me` | current user |
| `POST` | `/api/auth/logout` | marks offline |
| `GET` | `/api/users` | contacts (excludes self) |
| `GET` | `/api/users/search?query=` | |
| `GET` | `/api/users/:id` | |
| `PUT` | `/api/users/:id` | self only |
| `POST` | `/api/users/:id/avatar` | multipart `avatar` |
| `POST` | `/api/chats` | direct `{ participantId }` / group `{ groupName, participantIds }` |
| `GET` | `/api/chats` | includes `unreadCount`, populated `lastMessage` |
| `GET` | `/api/chats/:id` | |
| `POST` | `/api/chats/:id/participants` | admin only |
| `DELETE` | `/api/chats/:id/participants/:userId` | admin or self (leave) |
| `GET` | `/api/messages?chatId=&limit=&before=` | `{ messages, hasMore, nextCursor }` |
| `POST` | `/api/messages` | also broadcasts over Socket.IO |
| `POST` | `/api/messages/chat/:chatId/read` | mark all read |
| `POST` | `/api/messages/:id/read` · `/:id/delivered` | |
| `POST` | `/api/messages/media` | multipart `file` |
| `GET` `POST` `DELETE` | `/api/status` · `/api/status/:id` · `/api/status/:id/view` | |
