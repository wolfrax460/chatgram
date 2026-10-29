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

---

## Session 2 additions (2026-10-21) — all additive

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/change-password` | yes | `{ currentPassword, newPassword, confirmPassword? }`. 400 `CURRENT_PASSWORD_INVALID`, `WEAK_PASSWORD` (+`problems[]`), `PASSWORD_MISMATCH`, `PASSWORD_UNCHANGED`, `PASSWORD_NOT_SET` (Google-only account). 429 `RATE_LIMITED` after repeated wrong current passwords. Success returns a fresh `accessToken` + `refreshToken` (this device stays signed in) and 401 `SESSION_REVOKED` for every other token: every JWT now carries a `tv` claim compared with `User.tokenVersion`. A password reset bumps the same counter. |
| POST | `/api/status/media` | yes | Multipart `file`, optional `durationSeconds`. Types: jpg/png/webp/gif, mp4/webm/mov, mp3/m4a/ogg/wav(/webm/aac). Limits: image 10 MB, video 50 MB + 60 s, audio 20 MB. 415 `UNSUPPORTED_MEDIA_TYPE`, 413 `MEDIA_TOO_LARGE`, 400 `MEDIA_TOO_LONG`, `DURATION_REQUIRED`. Returns `{ file: { url, mediaType, mimetype, size, provider, publicId } }`. Stored copy is removed when validation fails. |
| GET | `/api/status/limits` | yes | `{ limits: { image, video, audio } }` with `maxBytes`, `maxDurationSeconds` and allowed `mimetypes`. |
| POST | `/api/status` | yes | Extended body: `{ text, mediaUrl, mediaType, mimetype, mediaSize, mediaPublicId, mediaProvider, thumbnailUrl, durationSeconds }`. `text` is the caption for every media type. Old clients that only send `mediaUrl` are still accepted (treated as an image). |
| DELETE | `/api/status/:id` | yes | Now also deletes the stored file (Cloudinary public id or local `/uploads` path) and a video poster. |

`GET /api/status` additionally returns `mediaType`, `thumbnailUrl` and `durationSeconds`. Rows created before this change get `mediaType: "image"` in the response when they have a `mediaUrl`.

### Status expiry

`Status.createdAt` no longer carries a TTL index. A scheduled job (`server/src/utils/statusCleanup.js`, started after MongoDB connects, every 10 minutes) deletes statuses older than 24 h **and their stored files**; `expiresAt` carries a 25 h TTL index as a safety net only. The legacy `createdAt` TTL index is dropped once on boot (safe to re-run). `DELETE /api/status/:id` deletes the file immediately.

---

## Session 3 additions (2026-10-24) — help centre + AI layer

### Help centre (public)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/status/health` | `{ ok, database, socket, storage, time }`. **`/api/status` remains the statuses feed.** |
| GET | `/api/help/collections` | collections + `articleCount` |
| GET | `/api/help/collections/:slug` | collection + its articles |
| GET | `/api/help/articles/:slug` | article + `collectionTitle` + related articles |
| GET | `/api/help/search?q=` | title/summary/body/keyword search with snippets |
| POST | `/api/help/uploads` | multipart attachment for a widget message (10 MB, rate limited) |

### Help widget conversations (user or guest)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/help/conversations` | create/reuse an open conversation; guests send `guestId` (>=16 chars) |
| GET | `/api/help/conversations?guestId=` | list mine (user via bearer, guest via guestId) |
| GET | `/api/help/conversations/:id` | messages (owner only, 403 otherwise) |
| POST | `/api/help/conversations/:id/messages` | `{ text?, attachments? }` → stores the message + assistant reply (`{ reply, source, matched, ticketId }`) |
| POST | `/api/help/conversations/:id/read` | clear unread |
| POST | `/api/help/conversations/:id/resolve` | status → resolved + system message |
| DELETE | `/api/help/conversations/:id` | delete-my-data path |
| POST | `/api/help/conversations/:id/handoff` | creates a `SupportTicket` (`CG-XXXXX`), links it, notifies the owner |
| POST | `/api/help/conversations/:id/transcript` | email a copy (valid email required) |
| POST | `/api/help/messages/:id/feedback` | `{ value: 'up'|'down' }` |

Messages carry `role: user|assistant|agent|system`, optional `articleSlug` citation,
attachments and feedback. Human replies are mirrored into the conversation by the support
reply hook (`help/replyBridge`); guests poll while the widget is open.

### Admin editor + AI settings (support account only)

| Method | Path | Notes |
|---|---|---|
| GET/PUT/DELETE | `/api/help/admin/collections[/:slug]` | article collections |
| GET/PUT/DELETE | `/api/help/admin/articles[/:slug]` | articles (slug, collection, title, summary, body, keywords, published) |
| GET | `/api/support/admin/ai` | effective AI settings, masked key (`hasKey`, `keyLast4`), providers, env names, diagnostics |
| PUT | `/api/support/admin/ai` | save provider/model/baseUrl/key/limits/fallbacks (key encrypted at rest) |
| POST | `/api/support/admin/ai/test` | tiny prompt; `{ ok, latencyMs, provider, model }` or `{ ok:false, code, message }` |

## Session 4 additions (2026-10-24) — message actions + group photo

| Method | Path | Notes |
|---|---|---|
| PATCH | `/api/messages/:id` | edit my own text message; `{ content }` → `{ messageId, chatId, content, editedAt }`; 403 `NOT_SENDER`; broadcasts `message:edited` |
| POST/DELETE | `/api/messages/:id/star` | star / unstar for me (per-user `starredBy`); `GET /api/messages` adds a `starred` convenience flag |
| POST | `/api/messages/:id/forward` | `{ chatId }` → copies text/media into another chat I belong to (participant + group-send-permission + block checks) |
| POST | `/api/messages/:id/report` | `{ reason, details? }` → moderation `Report` with a message snapshot; cannot report your own message |
| POST | `/api/chats/:id/avatar` | multipart `avatar` (image only) — group photo, respects `whoCanEditInfo`, posts a system message and updates every member live |

Socket: new server→client event `message:edited` `{ messageId, chatId, content, editedAt }`.

## Session 6 additions (2026-10-24) — group join approval

| Method | Path | Notes |
|---|---|---|
| POST | `/api/chats/:id/join-request` | ask to join; in approval mode → `202 { pending:true }` (idempotent), otherwise joins directly and returns `{ joined:true, chat }` |
| GET | `/api/chats/:id/join-requests` | admin only; `{ requests: [{ user, requestedAt }] }` |
| POST | `/api/chats/:id/join-requests/:userId/approve` | admin only; adds the member, posts a system message and updates everyone live |
| POST | `/api/chats/:id/join-requests/:userId/reject` | admin only; removes the request without adding the member |
| PATCH | `/api/chats/:id` | `groupSettings.requireApproval` boolean; invite links then return `202 { pending:true }` instead of joining |

Socket: `group:join-request` is emitted to the group room so admins see new requests.

## Session 7 additions (2026-10-24) — notification preferences (do-not-disturb)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/users/me/notifications` | `{ dndEnabled, dndStart: "22:00", dndEnd: "07:00" }` |
| PUT | `/api/users/me/notifications` | partial update; times must be 24-hour `HH:mm` (400 `INVALID_TIME` otherwise) |

The web client loads these on sign-in and silences desktop notifications and the message
chime while the window is active (start > end means the window wraps over midnight).
Mentions still highlight in-app; nothing is dropped.

## Session 8 additions (2026-10-24) — WebRTC 1:1 calls

| Method | Path | Notes |
|---|---|---|
| GET | `/api/calls/ice` | auth required; `{ iceServers, hasTurn, ttlSeconds }` built from `STUN_URLS` / `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` |

Socket signalling (all authenticated; the server forwards, never sees media):

| Client → server | Server → client | Payload |
|---|---|---|
| `call:offer` | `call:incoming` (callee) / `call:ringing` (caller) / `call:unavailable` (offline) / `call:error` (forbidden) | `{ toUserId, chatId, callId, video, sdp }` |
| `call:answer` | `call:answer` | `{ callId, sdp }` |
| `call:ice` | `call:ice` | `{ callId, candidate }` |
| `call:reject` | `call:end` with `reason: "declined"` | `{ callId }` |
| `call:end` | `call:end` | `{ callId, reason }` |

Both users must share the chat (`call:offer` etc. are rejected with `CALL_FORBIDDEN` otherwise)
and blocked users cannot call each other. The web app shows a full-screen call overlay
(ring/accept/decline, mute, camera, hang-up) and works in a one-to-one chat.


## Session 11 additions (2026-10-24) — admin panel access (item 9a)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/auth/login` | `{ password }`; sets the `chatgram_admin` cookie, returns `{ csrfToken, session }`; 401 generic on failure, 429 with `retryAfter` when locked out, 503 when no admin hash is configured |
| GET | `/api/admin/auth/session` | current session + `csrfToken`, `activeSessions`, `totpEnabled`; 401 without a valid session |
| GET | `/api/admin/auth/sessions` | active sessions (no tokens) |
| GET | `/api/admin/auth/audit` | recent audit entries |
| POST | `/api/admin/auth/logout` | CSRF required; revokes this session |
| POST | `/api/admin/auth/logout-all` | CSRF required; revokes every admin session |
| POST | `/api/admin/auth/change-password` | CSRF required; `{ currentPassword, newPassword }`; persists the new bcrypt hash to `.env` |

Gateway rule: no admin route works from a normal user JWT — only the admin cookie
(and CSRF header for state changes). The web app reaches these through the
same-origin `/api/*` proxy so SameSite=Strict cookies are sent.

## Maintenance & one-time codes (2026-10-27, additive)

Nothing above is renamed or removed; this section only documents new fields and
code values.

### One-time verification codes

`POST /api/auth/verification/send` reports `expiresInSeconds` (the configured
lifetime) and `POST /api/auth/verification/check` can answer with distinct
failure codes so the client can offer "send a new code":

| HTTP | `code` | `reason` | Meaning |
|---|---|---|---|
| 400 | `CODE_MISSING` | `missing` | no pending code (never sent, already used, or purged) |
| 400 | `CODE_EXPIRED` | `expired` | the code existed but its lifetime is over |
| 400 | `CODE_INVALID` | `invalid` | wrong code; the pending code is still usable |
| 429 | `CODE_TOO_MANY_ATTEMPTS` | `too_many_attempts` | 5 wrong guesses burned the code |

Every failure body also has `canResend` (true except for `CODE_INVALID`).
`POST /api/auth/account/identifier/confirm` returns the same `code`/`reason`/
`canResend` values for a failed code (it used to answer only `INVALID_CODE`).

Codes are stored in MongoDB (hashed with a server pepper), so they survive a
restart and are shared by every API instance.

- **Lifetime:** `VERIFICATION_CODE_TTL_MINUTES` (5–120, default **15**; production
  runs 20). The email/SMS copy is generated from the same value. An expired row
  is retained briefly so the API can answer `CODE_EXPIRED` rather than `missing`.
- **Resend never invalidates an emailed code:** every code still inside its own
  lifetime is kept (up to 5 previous codes) and verifies, so someone who pressed
  "Resend" while mail was slow can type whichever email arrived. The 60 s resend
  cooldown and the 5-attempt cap are unchanged; a successful check consumes the
  whole pending record (single use).
- **Input normalization:** submitted codes are stripped of whitespace and
  zero-padded to six digits, so `"012345"`, `12345` (a JSON number dropping the
  leading zero) and `" 012 345 "` are the same code. Non-digits/oversized input
  is rejected as a wrong code.
- **Observability:** every failed check logs a content-free line
  (`[otp] check failed reason=<reason> channel=<channel>`) — no target, no code.

### Protected account deletion (14-day grace)

All three routes require a signed-in user (`Authorization: Bearer <accessToken>`).
There is no environment flag: the feature is always available to authenticated users.

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/account/delete/request-code` | — | `200 { sent: true, channel: 'email', expiresInSeconds: 600 }` |
| POST | `/api/account/delete/confirm` | `{ password?, code, confirmWord, reason? }` | `200 { scheduled: true, deleteAt }` |
| POST | `/api/account/delete/cancel` | — | `200 { cancelled: true }` (idempotent) |

- **Code:** emailed to the registered address only; 6 digits, 10 minutes, single use,
  max 5 verify attempts, max 3 sends per user per hour (and the normal 60 s resend
  cooldown). A phone-only account answers `409 { code: 'EMAIL_REQUIRED' }`.
- **Confirm:** `password` is required for local password accounts (`PASSWORD_REQUIRED`
  / `PASSWORD_INVALID`); Google-only accounts prove ownership with the code only.
  `confirmWord` must be exactly `DELETE` (`CONFIRM_WORD_REQUIRED`). Code failures use
  `CODE_MISSING` / `CODE_EXPIRED` / `CODE_INVALID` and `429 CODE_TOO_MANY_ATTEMPTS`.
  `reason` is optional, trimmed and capped at 200 characters.
- **Grace:** `deleteAt = now + 14 days`, stored on the user with `pendingDeletionAt`
  and `deletionReason`. During grace the account is hidden from user search, the
  contact directory and the contacts list, and cannot be added to a new direct/group
  chat; existing chats keep their messages. Signing in before `deleteAt` cancels the
  deletion automatically; the cancel endpoint always works.
- **Profile field:** `GET /api/users/me` and `GET /api/auth/me` add
  `pendingDeletion: { deleteAt, reason? } | null` (also present in the login/register/
  refresh `user` payload). Older clients can ignore it.
- **Admin:** `GET /api/admin/account-deletions` (admin session) returns
  `{ now, counts, scheduled[], pending[], completed[] }` with ids/timestamps and a
  `hasReason` flag only — no email, code or reason text.
- **Purger:** hourly from the existing maintenance interval. It deletes the account,
  sessions/login history, device tokens, verification codes and statuses; marks the
  user's own messages deleted-author while keeping the chat and every other
  participant's messages; queues media URLs in `PendingMediaDeletion` instead of
  calling an external provider.

### Maintenance / read-only gate

While `GET /api/app/features` reports `maintenanceMode: true`, every `/api/*`
route answers **503** with `{ "code": "MAINTENANCE", "message": <admin message>,
"maintenanceUntil?": <ISO date> }`, except:

- `/api/status/health`, `/api/health`, `/api/config`, `/api/app/features`
- every `/api/auth/*` route
- every `/api/admin/*` route

Read-only mode (`readOnlyMode: true`) answers **503** `{ "code": "READ_ONLY" }`
for non-`GET/HEAD/OPTIONS` requests, with the same exemptions.

`GET /api/app/features` adds the effective values:

| Field | Notes |
|---|---|
| `maintenanceMode` | effective boolean; `false` again once `maintenanceUntil` has passed |
| `maintenanceMessage` | the admin message (already present) |
| `maintenanceUntil` | ISO timestamp of an auto-expiry window, or `null` |

Socket.IO: a new connection while maintenance is on fails the namespace
handshake, and the client receives it as `connect_error` with
`err.data = { code: "MAINTENANCE", message }`. Sockets that were already
connected stay connected but their events are dropped and the server emits
`maintenance` with the same payload; they resume automatically when maintenance
is turned off (a server disconnect is not auto-reconnected by the client).

### Admin

`PUT /api/admin/platform-settings` (CSRF required) accepts the optional
`maintenanceUntil` field in `settings`: an ISO date (within the next 7 days) or
`null`. It is a one-shot window — once the date passes the gate releases on its
own, no second save is needed. Turning `maintenanceMode` off clears it. Every
change is audited as `platform_settings_update`, as before.

## Call-quality diagnostics (2026-10-27, additive)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/calls/quality` | auth required. Body is an exact allowlist of 14 fields: `callId` (string ≤64), `video` (boolean), `status`, `iceConnectionState`, `connectionState` (strings ≤32), `candidatePair` (string ≤40 or `null`), `audioIn`, `videoIn`, `audioOut`, `videoOut` (finite numbers ≥0), `remoteTracks`, `remoteMuted` (integers 0–16), `stalledSeconds` (number 0–3600), `platform` (string ≤20). Every string must match `[A-Za-z0-9 ._:+→-]`. `204` on success; `400 { code: "INVALID_CALL_QUALITY" }` for a missing/extra/mistyped field or a URL/token-shaped string; `429 { code: "CALL_QUALITY_RATE_LIMITED", retryAfterSeconds }` above 5 reports/user/minute. |

The endpoint stores/merges one **AdminInbox** row per call (`type: call_quality`,
`normalized: call_quality:<callId>`), visible through `GET /api/admin/ai/inbox`.
Its text is content-free by construction — fixed labels, validated numbers and
short platform labels only; no user id, message text, names, tokens or URLs are
stored. Repeat reports for the same call increment the row's `count`.

## Push notifications — device registration (2026-10-27, additive)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/notifications/devices` | auth required. Body `{ token, platform: "android"\|"web", deviceLabel? }`; upserts by token (re-registering refreshes it, a token moving to another account is reassigned), keeps the 10 most recently seen devices per user. `204`, or `400 { code: "INVALID_DEVICE" }`. |
| DELETE | `/api/notifications/devices` | auth required. Body `{ token }`; `204` even when the token was already gone. |
| POST | `/api/notifications/devices/test` | auth required. Sends one test notification to the caller's own tokens: `200 { sent, failed }`; `503 { code: "PUSH_DISABLED" }` when the server has no Firebase service account. |

Delivery rules used by the server (FCM, Android channel `messages`):
message pushes carry `notification {title: senderName, body: preview}` and
`data { chatId, type: "message", hidePreview }` with high priority, collapse key
`chat-<chatId>` and tag `<chatId>`; call pushes are **data-only**
`{ type: "call", callId, chatId, callerName, kind, groupName? }` with high
priority and a 45 s TTL. Recipients online with a live socket are skipped unless
the call path forces it; DND windows and muted chats are respected; message
pushes coalesce to one per recipient+chat every 3 s. Tokens FCM reports as
unregistered are marked `invalid` and never retried. Each delivery failure
becomes one content-free AdminInbox row (`type: push_failure`,
`normalized: push:<tokenId>`, `count++`) containing only the sanitized Firebase
error code and platform.

## Group AI membership (2026-10-28, fix)

Adding the built-in Chatgram AI account to a group is the opt-in for group AI
replies: `POST /api/chats` with the AI user id in `participantIds`, or
`POST /api/chats/:id/participants` with that id, sets
`groupSettings.aiMentions = true`, so members can write `@Chatgram AI ...`
without enabling the separate toggle. Removing the AI account from the group sets
`aiMentions = false` again, so a later mention cannot silently re-add it through
the reply path. `aiReplyVisibility` is unchanged (`asker` by default, `everyone`
optional). Admins can still turn the flag off/on explicitly from group settings.




