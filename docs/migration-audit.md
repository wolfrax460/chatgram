# Chatgram Flutter → React Migration: Phase 0 Audit

Date: 2026-10-20
Scope: audit only. No React code written.

Companion docs: [`api-contract.md`](./api-contract.md) · [`decisions.md`](./decisions.md) · [`progress.md`](./progress.md) · [`blockers.md`](./blockers.md)

---

## 1. Flutter screen inventory

`client/lib/features/**` — 14 screens plus the shell.

| Screen | File | Purpose |
|---|---|---|
| AuthGate | `auth/screens/auth_gate.dart` | decides login vs app; splash |
| LoginScreen | `auth/screens/login_screen.dart` | identifier + password, Google button |
| RegisterScreen | `auth/screens/register_screen.dart` | sign-up + verification code |
| ForgotPasswordScreen | `auth/screens/forgot_password_screen.dart` | reset via 6-digit code |
| AuthScaffold | `auth/screens/auth_scaffold.dart` | shared auth layout |
| LandingScreen | `onboarding/landing_screen.dart` | first-run intro |
| HomeShell | `home/home_shell.dart` | rail/bottom-nav shell, 5 tabs, wide vs narrow layout |
| ChatListScreen | `chat/screens/chat_list_screen.dart` | conversations, search, filters |
| ChatDetailScreen | `chat/screens/chat_detail_screen.dart` | messages, composer, attachments, voice |
| GroupsScreen | `chat/screens/groups_screen.dart` | group list |
| GroupInfoScreen | `chat/screens/group_info_screen.dart` | members, admins, rename |
| ContactsScreen | `contacts/screens/contacts_screen.dart` | address book, directory search |
| StatusScreen | `status/screens/status_screen.dart` | 24h statuses, viewer |
| SettingsScreen | `settings/screens/settings_screen.dart` | account, privacy, appearance, support |
| ServerSettingsDialog | `settings/screens/server_settings_dialog.dart` | override API base URL |

Shared widgets (`client/lib/shared/widgets/`): `chat_tile`, `message_bubble`, `message_ticks`,
`composer`-related pieces, `voice_note_player`, `video_player_screen`, `media_viewer`,
`user_avatar`, `custom_text_field`, `custom_button`, `empty_state`, `new_chat_sheet`,
`add_contact_sheet`, `google_sign_in_button`, `server_status_banner`, `responsive`.

Navigation: imperative `Navigator.pushNamed` with routes in `core/routes.dart`
(`/`, `/login`, `/register`, `/forgot`, `/home`, `/chat/:id`, `/profile`, …).
**No `go_router`** — the migration plan's mapping is approximate; there is no route table to port 1:1.

---

## 2. Section 7 feature parity checklist

Status = **what Flutter does today**. All of it must be re-implemented in React.

| # | Feature | Flutter today | React |
|---|---|---|---|
| 1 | Register / login / logout / token refresh | ✅ incl. Google OAuth (url + poll), verification codes | ☐ |
| 2 | Profile view + edit (name, about, avatar upload) | ✅ via `PUT /api/users/:id` + `/avatar` | ☐ |
| 3 | Chat list, unread badges, search | ✅ + All/Unread/Groups filters | ☐ |
| 4 | 1-on-1 messaging, delivery/read ticks | ✅ optimistic send + sockets | ☐ |
| 5 | Typing indicator | ✅ `typing:start` / `typing:stop` | ☐ |
| 6 | Presence + last seen + privacy toggle | ✅ `presence:*`, `/me/privacy` | ☐ |
| 7 | Groups: create, members, admins, info | ✅ | ☐ |
| 8 | Status updates (24h), view + post | ✅ text and/or image | ☐ |
| 9 | Contacts + start new chat | ✅ | ☐ |
| 10 | Media: images, files, voice notes, video, previews | ✅ `image_picker`, `record`, `video_player`, `audioplayers` | ☐ |
| 11 | Notifications: desktop, Android push, sounds toggle | ⚠️ **in-app banner + sounds only. NO push (no FCM).** | ☐ |
| 12 | Settings: appearance, notifications, privacy | ✅ Light/Dark/System | ☐ |
| 13 | Reconnect handling, offline/outbox | ✅ 20 retries, 1s→5s backoff, re-auth on reconnect | ☐ |
| 14 | Deep links / notification tap → chat | ❌ not implemented | ☐ |
| 15 | Calls | ❌ do not exist in Flutter | n/a |

**Notes**

- Item 11 is a **scope increase**, not a port: push must be built from scratch (backend endpoint
  + Capacitor FCM + Electron). The plan already anticipates this in §3, but the work is greenfield.
- Item 14 must be built for push to be useful.

---

## 3. Dependency mapping (`client/pubspec.yaml`)

| Flutter package | Version | React / Capacitor / Electron equivalent |
|---|---|---|
| `provider` | ^6.0.5 | Zustand (client) + TanStack Query (server state) |
| `http` | ^1.2.0 | `packages/api-client` (fetch wrapper, refresh, typed errors) |
| `socket_io_client` | ^2.0.3 | `socket.io-client` in `packages/realtime` |
| `shared_preferences` | ^2.2.0 | localStorage (web) / Capacitor Preferences (mobile) / `safeStorage` or electron-store (desktop) |
| `image_picker` | ^1.0.0 | `<input type="file" accept="image/*">` + `@capacitor/camera` |
| `record` | ^6.0.0 | `MediaRecorder` API + `@capacitor/microphone` permission |
| `audioplayers` | ^6.0.0 | `<audio>` element (voice-note playback) |
| `video_player` | ^2.9.0 | `<video controls>` |
| `cached_network_image` | ^3.3.0 | `<img loading="lazy">` + service worker cache |
| `url_launcher` | ^6.2.0 | `window.open` / `@capacitor/browser` / `shell.openExternal` |
| `path_provider` | ^2.1.0 | `@capacitor/filesystem` / `app.getPath('temp')` |
| `intl` | ^0.18.0 | `Intl.DateTimeFormat` (no i18n library needed yet — app is English-only) |
| `font_awesome_flutter` | ^11.0.0 | **lucide-react** (per decisions) |
| `cupertino_icons` | ^1.0.2 | not needed |

Missing from the plan's table but present in this app: none. The plan's
`flutter_secure_storage`, `sqflite`/`hive`, `firebase_messaging`,
`flutter_local_notifications`, `permission_handler`, `package_info_plus`,
`flutter_localizations`, `webrtc` entries are **not used by Chatgram** — those rows can be dropped.
That reduces work: **no offline database to rebuild**.

---

## 4. Local data & auth storage (decides §5.2 of the plan)

| Data | How Flutter stores it | Survives migration? |
|---|---|---|
| Access + refresh tokens | `SharedPreferences` (`auth_service.dart:381+`) | ❌ no |
| Theme mode | `SharedPreferences` `settings.themeMode` | ❌ no |
| Notification/sound/read-receipt prefs | `SharedPreferences` | ❌ no |
| Privacy (`showOnlineStatus`) | **server** (`/me/privacy`) | ✅ yes |
| Server override URL | `SharedPreferences` | ❌ no |
| Message history | **server only** — no local DB | ✅ yes |
| Draft/outbox | in-memory only | n/a |

**Two things worth flagging:**

1. Tokens are in **plain `SharedPreferences`**, not secure storage. Migration is a good moment to
   move to Capacitor Secure Storage / Electron `safeStorage` / httpOnly-cookie-or-memory on web.
2. There is **no local database**, so the plan's "IndexedDB via Dexie" row is optional, not required.
   Users lose nothing but preferences and must log in again.

---

## 5. Platform packaging (Section 2.5 + 5.1)

### Android — ⚠️ three blocking findings

| Item | Value |
|---|---|
| `applicationId` | **`com.example.chatgram`** (`client/android/app/build.gradle.kts`) |
| `namespace` | `com.example.chatgram` |
| Signing config | **`signingConfig = signingConfigs.getByName("debug")`** |
| Release keystore | **none** — no `*.jks`, no `*.keystore`, no `key.properties` |
| `versionCode` / `versionName` | from `flutter.versionCode` / `flutter.versionName` → `pubspec.yaml` = `1.0.0+1` |

1. **`com.example.chatgram` is a placeholder.** Google Play rejects `com.example.*`. If a build with
   this id ever ships publicly it cannot be "renamed" later without becoming a *new app* with no
   install base. **Decide the real id before the first public release.**
2. **No release key exists.** The plan's "reuse the same signing key / Play App Signing" is
   **impossible today** — there is nothing to reuse. A release keystore must be created, backed up
   in at least two places, and never lost. The current APK on `/downloads/` is debug-signed.
3. Therefore **"updates in place" cannot be guaranteed** for any user who installed the current APK.

### Windows

| Item | Value |
|---|---|
| Build | `flutter build windows --release` → `build/windows/x64/runner/Release/` |
| Installer | **none** — the folder is zipped by hand into `chatgram-windows.zip` (~12 MB) |
| Code signing | **none** (SmartScreen warning) |
| Auto-update | **none** |
| App id / registry | none registered |

So §5.1's "upgrade over the Flutter build via the same channel" has no mechanism — there is no
channel. Electron + NSIS + electron-updater would be the *first* real installer.

### Web

Statically built Flutter web at `/app/`, React landing at `/`, React client at `/web/`.
Vercel project `chatgram` → `https://chatgram-xi.vercel.app`. Backend on Oracle VM behind nginx.

---

## 6. Staging (Section 2.6)

**Does not exist.** There is a single production backend (`84.12.64.204`) pointing at the
production MongoDB Atlas cluster, with a nightly `mongodump` backup. There is no second
environment, no staging database, and no separate `CLIENT_URL` allow-list.

Phase 1's exit criterion ("a browser on the staging web origin can log in") **cannot be met**
until a staging environment exists — see `blockers.md`.

---

## 7. Backend readiness vs Phase 1

| Phase 1 requirement | Status |
|---|---|
| API freeze | Contract documented (`api-contract.md`) |
| CORS allow-list | ✅ implemented via `CLIENT_URL`; **needs new origins added** |
| Socket transports | ✅ websocket + polling fallback already |
| Auth from browser | ✅ bearer tokens, no cookies — **no SameSite work needed** |
| Refresh tokens | ✅ with rotation |
| HTTPS/WSS | ✅ (nginx + certbot, TLS 1.3) |
| `X-Client` / `X-Client-Version` | ❌ **not implemented** |
| Min-version gate | ❌ not implemented (`/api/app/version` exists but is not a gate) |
| Push token endpoint | ❌ **not implemented; no push anywhere yet** |
| FormData uploads | ✅ verified from the React client (media + avatar) |

---

## 8. Existing React code worth keeping

`client/webapp/` already implements a meaningful slice in React 18 + Vite + Tailwind
(**not** TypeScript, no router, no TanStack Query):

- auth (login / register / forgot+reset / verification codes / confirm password)
- chat list + conversation view, live Socket.IO messaging, optimistic send
- media attachments, voice notes (MediaRecorder), image/video/audio/file rendering
- contacts + directory search, status/stories, profile edit + avatar upload
- settings: theme, notifications (Web Notification API), sounds, online-status privacy
- support chat entry

This is a working reference for the target behaviour and can be lifted into `apps/web`
rather than rebuilt. Deciding whether to port it or rewrite is a decision in `decisions.md`.

---

## 9. Exit criteria assessment

| Phase 0 criterion | Status |
|---|---|
| API contract documented | ✅ `docs/api-contract.md` |
| Screen/feature inventory | ✅ this document, §1–2 |
| Dependency mapping | ✅ §3 |
| Storage/packaging recorded | ✅ §4–5 |
| Staging backend running | ❌ **blocked** — no credentials/host allocated |

**Phase 0 is 5/6 complete. The remaining item is an infrastructure decision, not code.**
