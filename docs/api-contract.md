# Chatgram API Contract

> Extracted from the live backend on 2026-10-20 for the Flutter → React migration (Phase 0).
> Source of truth: `server/src/routes/*.js`, `server/src/controllers/*.js`, `server/src/sockets/socketHandler.js`.
> **This contract is frozen.** Add fields, never rename or remove.

## Connection

| Item | Value |
|---|---|
| Production REST base | `https://chatgram.duckdns.org` |
| Production socket | `wss://chatgram.duckdns.org` (Socket.IO, path `/socket.io`) |
| Health (no auth) | `GET /health` → `{"status":"ok"}` |
| Config (no auth) | `GET /api/config` |

Local dev default: `http://localhost:5000`.

### CORS

Server reads `CLIENT_URL` (comma-separated allowed origins) and rejects requests with an unknown `Origin`.
Requests **without** an `Origin` header are allowed (native/Electron/curl).
Trailing slashes are stripped before comparison. In production a missing `CLIENT_URL` is fatal at boot.

Currently allowed: `https://chatgram-xi.vercel.app`.

**Migration action:** add staging web, `http://localhost:*`, `capacitor://localhost`, `https://localhost`, and the Electron origin.

## Authentication

JWT bearer token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

- **No cookies.** SameSite/Secure concerns in the plan do not apply.
- Access token + refresh token are returned together.
- Socket auth is `handshake.auth.token` (or an `authenticate` event — see below).

### Error shape

```json
{ "message": "Human readable message", "code": "OPTIONAL_MACHINE_CODE" }
```

Known `code` values: `INVALID_IDENTIFIER`, `SUPPORT_NOT_CONFIGURED`.

---

## REST endpoints

All `/api/*` routes except `/api/config` require a bearer token. Listed as **auth: yes** unless noted.

### `/api/auth`

| Method | Path | Auth | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/register` | no | `displayName`, `identifier`, `password`, `verificationToken?` | `identifier` = email or phone |
| POST | `/login` | no | `identifier`, `password` | → `{ accessToken, refreshToken, user }` |
| POST | `/refresh` | no | `refreshToken` | → rotated pair |
| POST | `/check-identifier` | no | `identifier` | availability check |
| POST | `/verification/send` | no | `identifier` | sends code; may return `devCode` when `DEV_SHOW_CODES` |
| POST | `/verification/check` | no | `identifier`, `code` | → `verificationToken` |
| POST | `/forgot-password` | no | `identifier` | sends 6-digit code |
| POST | `/reset-password` | no | `identifier`, `code`, `newPassword` | code is 6 digits |
| GET | `/google/url` | no | — | → `{ url, state }` for the OAuth popup |
| GET | `/google/callback` | no | query | OAuth redirect target (browser) |
| GET | `/google/poll` | no | `state` | polled by native clients until complete |
| GET | `/me` | yes | — | → current user |
| POST | `/logout` | yes | — | best-effort |

**Google flow:** the Flutter client opens `/google/url`, then polls `/google/poll?state=…`. Web can keep the same pattern or do a normal redirect. **No PKCE** — do not change.

### `/api/users`

| Method | Path | Body / Query | Notes |
|---|---|---|---|
| GET | `/` | — | all users (contact picker) |
| GET | `/search` | `query` | directory search |
| GET | `/me/privacy` | — | → `{ showOnlineStatus, hiddenFrom[] }` |
| PUT | `/me/privacy` | `showOnlineStatus`, `hiddenFrom[]` | |
| GET | `/:id` | — | public profile |
| PUT | `/:id` | `displayName`, `about`, `avatarUrl` | self only (403 otherwise) |
| POST | `/:id/avatar` | multipart, field **`avatar`** | self only → `{ user, url }` |

### `/api/contacts`

| Method | Path | Body / Query |
|---|---|---|
| GET | `/` | — |
| POST | `/` | `userId` |
| GET | `/search` | `query` |
| GET | `/suggestions` | — |
| DELETE | `/:userId` | — |

### `/api/chats`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/` | `type` (`direct`\|`group`), `participantId` *or* `groupName`+`participantIds` | |
| GET | `/` | — | my direct chats |
| GET | `/groups` | — | my groups |
| GET | `/:id` | — | single chat |
| PATCH | `/:id` | `groupName` | admins only |
| POST | `/:id/participants` | participant ids | |
| DELETE | `/:id/participants/:userId` | — | |
| POST | `/:id/admins` | — | set group admin |

### `/api/messages`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/media` | multipart, field **`file`** | → `{ file: { url, mimetype, size, originalname, provider } }` |
| POST | `/` | `chatId`, `type`, `content?`, `mediaUrl?`, `clientId?` | REST send; also broadcasts over Socket.IO |
| GET | `/` | `chatId` | → `{ messages, hasMore, nextCursor }` |
| POST | `/chat/:chatId/read` | — | mark whole chat read |
| POST | `/:id/delivered` | — | |
| POST | `/:id/read` | — | |

**Message types:** `text` \| `image` \| `video` \| `audio` \| `file`.
`text` requires `content`; every other type requires `mediaUrl`.

**Upload limits (from `server/src/utils/upload.js`):**

- Max size **10 MB** per file.
- Allowed MIME: `image/jpeg|jpg|png|gif|webp|heic|heif`, `video/mp4|quicktime|x-msvideo|webm`, `audio/*` (see file), plus common documents.
- Storage: **Cloudinary** when `CLOUDINARY_*` is set, otherwise local disk under `/uploads/<subdir>/`.
- Returned `url` is absolute (Cloudinary) or server-relative (`/uploads/...`) — clients must handle both.

### `/api/status`

| Method | Path | Body |
|---|---|---|
| GET | `/` | — (my contacts + me only) |
| POST | `/` | `text?`, `mediaUrl?` (at least one) |
| DELETE | `/:id` | — |
| POST | `/:id/view` | — |

Statuses auto-expire after 24h (Mongo TTL index). `viewedBy[]` is populated.

### `/api/support`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | → `{ enabled, displayName }` |
| POST | `/chat` | opens/creates the support conversation → full chat object |

### `/api/app`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/heartbeat` | platform + version | version telemetry |
| GET | `/version` | — | latest version info |
| GET | `/versions` | — | aggregate version usage |

---

## Socket.IO

### Client → server

| Event | Payload | Notes |
|---|---|---|
| `authenticate` | `token` (string) | explicit fallback; `handshake.auth.token` is preferred |
| `chat:join` | `{ chatId }` | join room `chat:<id>` |
| `chat:leave` | `{ chatId }` | |
| `message:send` | `{ chatId, type, content?, mediaUrl?, clientId? }` | server persists + broadcasts |
| `message:delivered` | `{ messageId }` | |
| `message:read` | `{ messageId }` **or** `{ chatId }` | `chatId` = mark whole chat |
| `typing:start` | `{ chatId }` | |
| `typing:stop` | `{ chatId }` | |

### Server → client

| Event | Payload |
|---|---|
| `authenticated` | `{ success: true, user }` |
| `auth_error` | `{ message }` |
| `message:new` | full message object (includes `clientId` echo) |
| `message:delivered` | `{ messageId, chatId, userId }` |
| `message:read` | `{ chatId, userId, all }` |
| `message:error` | `{ message, clientId? }` |
| `typing:start` / `typing:stop` | `{ chatId, userId }` |
| `presence:online` | `{ userId }` |
| `presence:offline` | `{ userId, lastSeen }` |
| `chat:new` | chat object |
| `chat:updated` | chat object |
| `chat:removed` | `{ chatId }` |
| `user:updated` | user object (global broadcast) |

### Reconnect behaviour the React client must match

The Flutter client (**`client/lib/shared/services/socket_service.dart`**):

1. Connects with `transports: [websocket, polling]` (polling fallback matters — websocket-only timeouts were a real bug).
2. **Re-emits `authenticate` on every `connect`**, because room memberships are lost on disconnect.
3. Reconnection: 20 attempts, delay 1000ms → max 5000ms.
4. On `connect_error` surfaces "Realtime connection failed (n). Retrying…".

---

## Gaps identified against the migration plan

| Plan item | Reality |
|---|---|
| `X-Client` / `X-Client-Version` headers | **Not implemented anywhere.** Needed to tell Flutter vs React traffic apart. |
| Min-version gate | **Does not exist.** `/api/app/version` and `/api/app/versions` exist, but nothing returns a *minimum supported* version. |
| Push notification tokens | **No push in the Flutter app at all** (no `firebase_messaging`). Endpoint must be built from scratch. |
| Refresh tokens | Implemented (`/api/auth/refresh`) with rotation. |
| Uploads via `FormData` | Verified working from the React client (media + avatar). |
