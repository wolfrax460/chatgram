# Remaining Work — Sections

Status: React web client is the default app at `/web`. `/app` (Flutter web) now **redirects to `/web`**.
The Flutter source stays in `client/` for rollback and because Android/Windows binaries still exist.

Section order is deliberate: each section is independently shippable.

---

## Parity check: `/app` (Flutter) vs `/web` (React)

| Feature | Flutter `/app` | React `/web` |
|---|---|---|
| Login / register / Google / verification / reset | ✅ | ✅ |
| Session restore, token refresh | ✅ | ✅ |
| Chat list, unread, search | ✅ | ✅ |
| 1:1 + group messaging, live socket | ✅ | ✅ |
| Typing indicator | ✅ | ✅ |
| Presence + privacy toggle | ✅ | ✅ |
| Delivery / read ticks | ✅ | ✅ |
| Status / stories (24h) | ✅ | ✅ |
| Groups: create, info, admins, remove member | ✅ | ✅ |
| Groups: **add members UI** | ✅ | ❌ (endpoint exists) |
| Contacts + directory search | ✅ | ✅ |
| Media: image / video / file | ✅ | ✅ |
| Voice notes | ✅ | ✅ |
| Profile edit + avatar upload | ✅ | ✅ |
| Settings: theme, notifications, sounds, privacy | ✅ | ✅ |
| Reactions | ❌ | ✅ (new) |
| Delete for me / everyone | ❌ | ✅ (new) |
| Reactions/delete live over socket | ❌ | ✅ |
| Deep links | ❌ | ❌ |
| Push notifications | ❌ | ❌ (browser only) |
| Calls | ❌ | ❌ |

**Verdict: `/web` is a superset except for "add group members" and the native app packages.**
That is why `/app` was redirected to `/web` rather than deleted.

---

## Section 1 — Windows app (Electron)  ⏳ next

1. `apps/desktop/` — `main.js`, `preload.js`, `package.json`, `electron-builder.yml`
2. Security: `contextIsolation: true`, `nodeIntegration: false`, tiny preload API
3. Load the hosted URL (`https://chatgram-xi.vercel.app/web/`) with an offline fallback page
4. Native: tray icon, taskbar unread badge (`setOverlayIcon`), native notifications,
   single-instance lock, start-on-login
5. Packaging: `electron-builder` → NSIS. **Unsigned for now** (per instruction)
6. Auto-update: `electron-updater` pointed at GitHub Releases

**Blocker:** none. **Effort:** 1 session.

---

## Section 2 — Android app (Capacitor)  ⏳

1. `apps/mobile/` — `npx cap add android`, `appId` configurable
2. **Signing parked** per instruction — debug build for now, `applicationId` still to be chosen
3. Safe-area insets, Android back button (`@capacitor/app`)
4. Permissions: notifications, mic, camera — requested at point of use
5. Push (`@capacitor/push-notifications` + FCM) — needs Firebase credentials (blocker B4)
6. Reconnect after background/kill; fetch-on-resume

**Blocker:** app id + FCM credentials. **Effort:** 1–2 sessions.

---

## Section 3 — Forward messages  ⏳

Client-only. No backend change.
1. Add a Forward action to the message hover row
2. Chat-picker modal (reuse the contacts/groups list)
3. On pick: `POST /api/messages` into the target chat with the same `type`/`content`/`mediaUrl`

**Effort:** ~1 hour.

---

## Section 4 — Mute chats  ⏳

1. Backend: `Chat.mutedBy: [userId]` (additive) or a `User.mutedChats` array
2. `POST /api/chats/:id/mute` toggle
3. Client: suppress sound/notification for muted chats; list shows a muted icon

**Effort:** ~2 hours.

---

## Section 5 — Block contacts  ⏳

1. Backend: `User.blocked: [userId]` (additive)
2. `POST /api/users/:id/block` + `DELETE`
3. Filter blocked users out of `getChats`, refuse `sendMessage` to/from blocked pairs,
   hide their status updates
4. Client: menu action, confirmation, blocked list in Settings

**Effort:** ~3 hours. **Risk:** touches message sending — test carefully.

---

## Section 6 — Voice/video calls  ⏳ (large)

No WebRTC anywhere today. This is a **new subsystem**, not a fix:
signalling over the existing Socket.IO server, STUN/TURN (TURN needs a relay server),
call state machine, ring UI, permission handling, and per-platform testing.

**Effort:** multi-session. **Recommendation:** defer until the migration is finished.

---

## Section 7 — Hardening the deploy loop  ⏳ (recommended before more features)

After the brief production outage:
1. `scripts/deploy-server.sh` that uploads, runs `node --check` on **every** changed file,
   requires the module graph (`node -e "require('./src/server.js')"` style smoke test),
   restarts, polls `/health`, and **rolls back** if health does not return within N seconds.
2. Keep the previous release tarball on the VM for instant rollback.

**Effort:** ~1 hour. **Value:** prevents a repeat of the 502 incident.
