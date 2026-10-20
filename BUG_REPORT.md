# Chatgram — Code Review, Bug Report & Fixes

**Reviewed:** Flutter client (`client/`) + Node/Express/MongoDB backend (`server/`)
**Outcome:** backend is fully green (79/79 end-to-end checks), the Flutter client
compiles with zero analyzer issues and passes 27 unit/widget tests plus 12 live
integration tests against the running server.

---

## 1. Why nothing worked (the root cause)

Three separate problems stacked on top of each other and produced the exact
symptoms you described — "backend and frontend are not responding", "not
communicating to database".

**1. The MongoDB Windows service was stopped.**
`Get-Service MongoDB` → `Stopped`, `Test-NetConnection localhost 27017` → `False`.
It could not be started from a non-elevated shell ("Cannot open MongoDB service").

**2. The server *killed itself* when the database was down.**

```js
// server/src/utils/db.js (old)
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);        // <-- the entire API process dies
}
```

With MongoDB stopped, `node src/server.js` exited immediately, so nothing was
ever listening on port 5001.

**3. Your own old log proves the chain.**

`client/verbose_output.txt` ends with:

```
[+31795 ms] Socket connection error: timeout
[+21110 ms] Socket connection error: timeout
```

The Flutter app booted fine in Chrome, then timed out forever because there was
no server to talk to. That is the whole "frontend and backend are not
communicating" story — not an API-contract bug.

**Fix:** `db.js` now retries with backoff, never hard-exits, logs an actionable
recovery hint, exposes `GET /api/health`, and returns a clear `503
DB_UNAVAILABLE` on `/api/*` while the database is unreachable. I also added
[`start-dev.ps1`](start-dev.ps1) which guarantees MongoDB is up before the API starts.

---

## 2. Verification evidence

| Check | Result |
|---|---|
| `node test/e2e.smoke.js` (backend, HTTP + Socket.IO) | **79 passed, 0 failed** |
| `flutter analyze` | **No issues found!** |
| `flutter test` | **27 passed**, 13 integration tests auto-skipped |
| `flutter test --tags integration --dart-define=API_BASE_URL=http://127.0.0.1:5001` | **13 passed** (real HTTP against the live API) |
| `flutter build web --release` | **√ Built build\web** |
| `node scripts/verify-web-e2e.js` — real headless Chrome | **11 passed, 0 failed** |
| `flutter build apk --debug` | **√ Built app-debug.apk** (150 MB) |
| `flutter build apk --release` | **√ Built app-release.apk (52.6 MB)** |
| `flutter build windows --release` | **Blocked — needs a VS component, see §6.1** |

### The Chrome target is verified in a real browser

Rather than only asserting "the HTTP client works", `scripts/verify-web-e2e.js`
boots the **compiled** app in headless Chrome:

1. registers a throwaway user (and a partner with a real chat + message),
2. writes a harness page that seeds the exact `localStorage` entries
   `shared_preferences` uses on web (`flutter.` prefix, `json.encode`d values),
3. serves `client/build/web` with correct MIME types (including `application/wasm`),
4. opens the harness in Chrome, which boots the real Flutter app,
5. polls `GET /api/health` until `onlineUsers` rises from 0 to 1.

```
  onlineUsers before=0 after=1
  PASS  the real Flutter web app opened an authenticated Socket.IO connection
  PASS  the probe user is flagged online server-side (socket auth handler ran)
```

That single signal is a strong chain, because of how the app boots:
`AuthGate` → `loadUserFromStorage()` → **`GET /api/auth/me` must succeed** →
`HomeShell` mounts → `ensureSocket()` → Socket.IO connect → `authenticate`.

So `onlineUsers === 1` can only happen if the browser app **booted, restored its
session, completed a real REST round-trip, and authenticated a realtime
connection** — all against the live backend. The probe cleans up after itself
(removes the harness, kills Chrome, logs the user out).


Both APKs were inspected with `aapt2 dump badging`; the release one matters most,
because the missing INTERNET permission only bites in release builds:

```
package: name='com.example.chatgram' versionCode='1' versionName='1.0.0'
minSdkVersion:'24'   targetSdkVersion:'36'
uses-permission: name='android.permission.INTERNET'            <-- was missing (P1)
uses-permission: name='android.permission.ACCESS_NETWORK_STATE'
application-label:'Chatgram'                                   <-- was lowercase (P3)
launchable-activity: name='com.example.chatgram.MainActivity'
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86_64'
```

The web bundle was also checked to confirm the backend URL was compiled in:
`main.dart.js` contains `localhost:5001` and every `/api/...` path, and contains
**no** `10.0.2.2` (correct — that branch is Android-only).



---

## 3. Backend bugs found and fixed

### Critical

| # | Bug | Effect | Fix |
|---|---|---|---|
| B1 | `db.js` called `process.exit(1)` on the first failed connection | Whole API down whenever Mongo was down | Retry/backoff, non-fatal start, `/api/health`, 503 guard |
| B2 | `getMessages` chained `.sort()` twice — the second **replaced** the first | `GET /api/messages` returned the **oldest** messages; `before` pagination was meaningless | Fetch newest page desc, then `reverse()`; response is now `{ messages, hasMore, nextCursor }` |
| B3 | Group chat creation **always** returned 500 | Groups were impossible | `createChat` only ever added the creator, but the schema required ≥2 participants → ValidationError. Now accepts `participantIds`, sets `groupAdmins` |
| B4 | Chat schema required groups to keep ≥2 participants | Removing/leaving a member threw ValidationError → 500 | Relaxed to ≥1 (a group can legitimately shrink) |
| B5 | `upload.js` wrote to `server/src/uploads`, but `server.js` served `server/uploads` | **Every uploaded file 404'd** | Upload root corrected to `server/uploads` |
| B6 | `updateAvatar` returned `501 Not Implemented` | Avatars could not be set at all | Implemented with multer + ownership check |
| B7 | Receipts emitted to `user:<id>` room that **no socket ever joined** | Sender never saw delivered/read ticks | Sockets join a personal room on auth |
| B8 | Newly created chats never joined the socket room | Messages in a new chat were not received until reconnect | `joinUsersToChat()` + a `chat:new` event |
| B9 | `disconnect` only did `console.log` | Users appeared **online forever** | Multi-socket presence tracking, DB persist, `presence:offline` broadcast |
| B10 | REST `POST /api/messages` did not emit over Socket.IO | A REST-sent message never reached the other user in real time | Controller broadcasts `message:new` |

### Reliability / correctness

| # | Bug | Fix |
|---|---|---|
| B11 | `protect` middleware: valid token + deleted user → `req.user` null → downstream 500 | Explicit 401 |
| B12 | `refreshToken` returned no new refresh token | Rotation of both tokens + user payload |
| B13 | `userPayload` omitted `isOnline`, `lastSeen`, `_id` | Now returns a complete user object |
| B14 | `searchUsers` built a raw `RegExp` from user input (`query=(` → 500) | `escapeRegex()` + result limit |
| B15 | `errorHandler` turned multer errors and `err.status` errors into 500 | Maps to 400 / 413 and honours `err.status` |
| B16 | `helmet()` default `Cross-Origin-Resource-Policy: same-origin` | Flutter web on another port could not load `/uploads` images → `cross-origin` |
| B17 | `uploadMedia` inferred the folder from `filePath.includes('status')` | Uses `basename(req.file.destination)`; added webp/heic/webm/pdf/doc/zip types |
| B18 | `limit` from the query string was unclamped | Clamped to 1–200 |
| B19 | Media messages accepted a null `mediaUrl` | Validated |
| B20 | No 404 handler for unknown API routes | JSON 404 |
| B21 | `npm test` was `echo "Error: no test specified" && exit 1` | Real suite: `npm test` |
| B22 | Duplicate Mongoose index declarations (`User.phone`, `User.email`, `Status.createdAt`) | Warnings on **every** boot removed |

> Note on B22: I verified against the live database that the 24h TTL index on
> `status.createdAt` **was** correctly applied (`ttl: 86400`), so this was noise
> rather than data loss. Cleaned up anyway.

### Design gaps closed

- **Unread counts** — `GET /api/chats` now returns `unreadCount` computed with a
  single aggregation (no N+1).
- **Mark whole chat as read** — `POST /api/messages/chat/:chatId/read`.
- **Group membership** — `POST /api/chats/:id/participants`,
  `DELETE /api/chats/:id/participants/:userId`.
- **Self-chat guard** — `POST /api/chats` rejects a direct chat with yourself.

---

## 4. Flutter client bugs found and fixed

### Critical

| # | Bug | Effect | Fix |
|---|---|---|---|
| F1 | **Every message you sent appeared twice** | An optimistic bubble (`local-…`) was added, and the server's `message:new` was added *as well* — the dedupe only compared ids | Server echoes a `clientId`; the optimistic bubble is **replaced** by the persisted one |
| F2 | One global `_messages` list for all chats | Opening chat B showed chat A's messages | Per-chat message threads |
| F3 | Status screen did `status['text']?.substring(0, 2)` | **RangeError crash** on any 1-character status | Safe initials + null handling |
| F4 | Status screen never called `loadStatuses()` | Permanently showed "No statuses yet." | Loads on open + pull-to-refresh |
| F5 | Relative media paths (`/uploads/…`) passed straight to `NetworkImage` | **All** avatars and status images were broken | `ServerConfig.resolveMedia()` |
| F6 | No token refresh on 401 | After 1 day every request 401'd until you logged in again | `ApiClient` refreshes once and retries; ends the session on refresh failure |
| F7 | `SocketService` forced `transports: ['websocket']` | "Socket connection error: timeout" behind proxies/AV | websocket **+ polling** fallback |
| F8 | Read receipts, presence and typing were `// TODO` stubs | Blue ticks / "typing…" / last-seen never worked | Fully wired through callbacks |
| F9 | `sendMessage` ignored whether the socket was connected | Messages silently vanished | REST fallback + `failed` state + **Retry** |
| F9b | Signing out left the socket connected and authenticated as the previous user | A logged-out client kept receiving that account's messages | `ChatService` listens to `AuthService`; on sign-out it disconnects the socket and clears chats/messages/typing state |

### UI / UX

| # | Bug | Fix |
|---|---|---|
| F10 | Chat AppBar was hard-coded `Text('Chat')` | Real contact/group name, avatar, online / "last seen" / "typing…" |
| F11 | No delivery ticks, timestamps or date separators | WhatsApp-style bubbles with tail, time, ✓/✓✓/blue ✓✓, Today/Yesterday headers |
| F12 | No auto-scroll | Scrolls to the newest message |
| F13 | No way to reach Status/Contacts/Settings | Bottom navigation (phone) / navigation rail (desktop) |
| F14 | No group creation UI | "New group" flow with multi-select |
| F15 | No attachment sending (`image_picker` was declared but unused) | Photo / video / camera upload wired |
| F16 | Settings: the notifications `Switch` `onChanged` was **commented out**; Profile/Privacy/About were dead; no logout | Working, persisted toggles; theme picker; profile edit with avatar upload; logout |
| F17 | `SettingsService` faked every write with `Future.delayed` | Real `SharedPreferences` persistence |
| F18 | Login used two cross-validating fields (phone **and** email) that could both pass while empty | Single "Phone or email" identifier field |
| F19 | `UserModel.fromJson` used `DateTime.parse` (throws on bad input); `MessageModel` used `List<String>.from` on populated objects (throws) | `tryParse` + tolerant coercion |
| F20 | `DateTime.parse` on `null` `createdAt` | Safe defaults |

### Responsiveness (your explicit requirement)

| # | Before | After |
|---|---|---|
| F21 | A single fixed-width `Column` — stretched badly on desktop/web | **Master–detail layout**: ≥900 px shows navigation rail + chat list + conversation side by side (WhatsApp Web style); below 900 px switches to a bottom-nav phone layout |
| F22 | Auth screens were a bare stretched `Column` | Centred card, max 440 px, edge-to-edge on phones |
| F23 | Message bubbles spanned the full window width | Constrained to ≤72 % / 620 px, and the thread is capped at 1100 px |
| F24 | A fixed `Row` in the auth footer overflowed | `Wrap` (caught by the new widget tests) |
| F25 | `_AppScrollBehavior` absent | Mouse/trackpad drag-scrolling on desktop & web |

### Dead code / hygiene

- **`test_app.dart`** — a leftover Flutter counter demo at the package root. Removed.
- **`test/widget_test.dart`** — was `expect(1 + 1, 2)`. Replaced with 27 real tests.
- **`http`** was imported by 4 services but declared only as a *transitive*
  dependency. Now declared — and **26 unused packages removed** (`dio`,
  `just_audio`, `video_player`, `photo_view`, `story_view`, `flutter_svg`,
  `jwt_decode`, `uuid`, `mime_type`, …), which also shrinks the Android/Windows
  native build surface.
- Unused imports and an unused `_destinations` field removed.

---

## 5. Platform configuration bugs

| # | Bug | Impact | Fix |
|---|---|---|---|
| P1 | `AndroidManifest.xml` had **no `INTERNET` permission** | The debug manifest adds it, which *masked* the bug — a **release APK would have had no network at all** | Added `INTERNET` + `ACCESS_NETWORK_STATE` to the main manifest |
| P2 | No cleartext-HTTP allowance | Android 9+ blocks `http://10.0.2.2:5001` → app cannot reach the dev backend | `res/xml/network_security_config.xml` (cleartext allowed for development) |
| P3 | App label was lowercase `chatgram` | — | `Chatgram` |
| P4 | `web/index.html` had the default description and no loading state | Blank white page while the engine boots | Proper `<title>`, viewport, theme colour, and a splash that removes itself on `flutter-first-frame` |
| P5 | `web/manifest.json`: name `chatgram`, Flutter-blue, `orientation: portrait-primary` | Wrong for a desktop-capable web app | Corrected name/colours, `orientation: any` |
| P6 | `server_config.dart` hard-coded localhost with no override and no media helper | Could not target a LAN device; images broken | `--dart-define=API_BASE_URL=…`, `SOCKET_URL`, `resolveMedia()` |

---

## 6. What still needs your action (environment, not code)

### 6.1 Windows desktop build — BLOCKED (needs an administrator)

```
[!] Visual Studio - develop Windows apps (Visual Studio Community 2026 18.10.3)
    X Visual Studio is missing necessary components. Please re-run the Visual
      Studio installer for the "Desktop development with C++" workload, and
      include these components:
        MSVC v142 - VS 2019 C++ x64/x86 build tools
        C++ CMake tools for Windows
        Windows 10 SDK
```

I verified this is not fixable from here:

| Check | Result |
|---|---|
| `vswhere -requires Microsoft.VisualStudio.Workload.NativeDesktop` | **empty** — workload not installed |
| Any `MSVC` directory under the VS installs | **none found** |
| Current user is a local Administrator | **False** |

`flutter build windows` therefore fails with *"Unable to find suitable Visual
Studio toolchain"*. Installing the workload requires elevation, which this
session does not have.

**The Dart/Flutter side is verified** — `flutter analyze` is clean and the same
code builds for web and Android. Only the native C++ toolchain is missing.

**To fix (one time, as Administrator):**

1. Open **Visual Studio Installer** → **Modify** on your VS install.
2. Tick **Desktop development with C++**.
3. In *Individual components*, make sure these are included:
   - MSVC v143 x64/x86 build tools (or v142)
   - C++ CMake tools for Windows
   - Windows 10 SDK (10.0.19041.0 or newer)
4. Apply, then re-run:

```powershell
cd client
flutter build windows --release     # or: flutter run -d windows
```

Verify with `flutter doctor` — the Visual Studio line should turn `[√]`.


### 6.2 MongoDB service

The `MongoDB` service is set to start automatically but was **Stopped**, and
`Start-Service MongoDB` needs an elevated shell. Two options:

```powershell
# Option A — elevated PowerShell, once:
Start-Service MongoDB
Set-Service MongoDB -StartupType Automatic

# Option B — no admin needed (what I used):
& "C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe" `
  --config "C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg"
```

Or just run `.\start-dev.ps1`, which handles this for you.

### 6.3 Android

Android SDK 36.0.0 and Chrome are correctly detected. I had to resolve two
toolchain gaps to get `flutter build apk` to succeed:

**a) NDK and CMake were not installed.** `jni_flutter` (pulled in through
`path_provider_android`) compiles native code, so the NDK is genuinely required:

```
> Android sdkmanager did not install NDK 28.2.13676358 into D:\androidstudio.
```

Installed with:

```powershell
cmd /c '"D:\androidstudio\cmdline-tools\latest\bin\sdkmanager.bat" ^
  --sdk_root=D:\androidstudio "ndk;28.2.13676358"'
```

(CMake 3.22.1 was then installed automatically by Gradle.)

> Note: calling `sdkmanager.bat` directly from PowerShell mangles the
> `"ndk;<version>"` argument — the `;` gets split. Wrap it in `cmd /c` as above.

**b) `android/gradle.properties` requested more memory than this machine has.**
The Flutter template default is:

```properties
org.gradle.jvmargs=-Xmx8G -XX:MaxMetaspaceSize=4G
```

That asks for 12 GB *before* the separate Kotlin daemon starts. This machine has
**11.7 GB total** with ~1 GB free, so the Kotlin daemon was starved and the build
died reproducibly with:

```
Execution failed for task ':image_picker_android:compileDebugKotlin'.
> Could not close incremental caches in .../caches-jvm/jvm/kotlin
```

I rewrote `client/android/gradle.properties` to be appropriate for an 8–16 GB
machine (`-Xmx3g`, metaspace 1 GB, Kotlin running `in-process`, incremental
compilation off, workers capped). If your machine has more RAM you can raise
`-Xmx` again — but do not restore `-Xmx8G` on this one.

**Advisories:**

- **Two `adb.exe` binaries on PATH** (`D:\androidstudio\platform-tools\adb.exe`
  and a scrcpy copy). This can cause device-detection conflicts — remove the
  scrcpy one from `PATH`.
- **The application ID is still the template default `com.example.chatgram`.**
  Google Play rejects `com.example.*` — change `applicationId`/`namespace` in
  `client/android/app/build.gradle.kts` (and the Kotlin package directory)
  before publishing.
- For a **physical device**, pass your machine's LAN IP:
  `flutter run --dart-define=API_BASE_URL=http://192.168.x.x:5001`

### 6.4 Disk headroom

`C:` has ~8 GB free and `D:` ~10 GB. The Android toolchain alone consumed
~3 GB (NDK 2.1 GB + Gradle caches + CMake). Keep an eye on `C:` — the Gradle
cache lives there.


---

## 7. Features that are genuinely missing (honest scope)

The backend now supports these, but the client has no UI for them yet — or they
are not implemented at all. Nothing here is *broken*; it just is not built:

- **Voice notes** — the mic button says "coming soon".
- **Video/audio playback in chat** — upload works; inline playback is not implemented.
- **Push notifications** — `firebase_messaging` / `flutter_local_notifications`
  are commented out in `pubspec.yaml`; there is no FCM wiring.
- **Message search** across chats (in-chat list search only).
- **Archive / mute chat** — listed in the README, not implemented.
- **Delete / edit / forward / reply-to message.**
- **Contact blocking and reporting.**
- **Calls** (voice/video).
- **End-to-end encryption** — not implemented (worth stating plainly, since
  WhatsApp's core promise is E2EE).
- **Group admin UI** — the API supports add/remove; the UI only exposes leave-group.
- **Backups / restore.**

Unused backend dependencies that can be pruned: `firebase-admin`, `joi`,
`lodash`, `moment-timezone`, `fs-extra`, `winston`, `express-status-monitor`.

---

## 8. How to run it

```powershell
# 1. Everything at once (MongoDB + seed + API)
.\start-dev.ps1

# 2. In a second terminal, pick a target:
cd client
flutter run -d chrome      # Chrome / web
flutter run -d windows     # Windows desktop (needs the VS C++ workload, §6.1)
flutter run -d <device-id> # Android (emulator uses 10.0.2.2 automatically)
```

Demo logins created by `npm run seed` — password `password123`:

| Email |
|---|
| `alice@chatgram.dev` |
| `bob@chatgram.dev` |
| `carol@chatgram.dev` |

That is a direct chat Alice↔Bob, a direct chat Alice↔Carol, and a 3-member
group "Project Team" with history.

**Tip:** open two Chrome windows and sign in as Alice and Bob in each to watch
real-time messaging, typing indicators, presence and read receipts work.

---

## 9. Follow-up round: the `501 Unsupported method ('POST')` on `/api/auth/login`

The reported symptom was the app loading but every login/register returning
**501**, with this in the server log:

```
::ffff:192.168.1.111 - - "POST /api/auth/register HTTP/1.1" 501 -
::ffff:192.168.1.111 - - "POST /api/auth/login    HTTP/1.1" 501 -
```

**Diagnosis.** The app was being served by `python -m http.server 8000` from
`client/build/web`. That is a *static file* server — it cannot answer `POST /api/...`,
so it returned 501. The Flutter app was behaving correctly: it resolves the API
from the origin that served it, which was port 8000.

**Two changes so this cannot happen again:**

1. The Express backend now **serves the built web app itself**, so one origin
   hosts the UI, the REST API, `/uploads` and Socket.IO.
2. `ServerConfig.initialize()` now **probes at startup**: it tries the page
   origin first, and if `/api/health` does not answer there it automatically
   falls back to **port 5001 on the same host**. So the app now also works when
   served by any static server (Python, VS Code Live Server, `npx serve`, …).

The server also prints the address to share, detected from the OS default route
so VMware/VirtualBox/WSL adapters are not mistaken for the LAN:

```
  This computer : http://localhost:5001
  Share this    : http://10.5.112.99:5001
```

> The LAN IP is DHCP and changes between networks — always use the "Share this"
> line printed at startup, not an address from an earlier session.

### Features added in this round

| Area | What changed |
|---|---|
| **Welcome screen** | WhatsApp-style landing page shown once per device, with copy tailored to Android / desktop / web |
| **Media** | Fixed attachments being filed under `uploads/status`; images now open full-screen with pinch-zoom; video and documents open in the platform's own player (`url_launcher`) |
| **Voice notes** | Record in the composer with a live timer, cancel/send; inline playback with a scrubber (`record` + `audioplayers`) |
| **Status** | The owner can now see **who viewed** each status — backend populates `viewedBy` with name and avatar |
| **Registration** | Added **confirm password**, strict email/phone validation, **6-digit email verification codes** and **phone OTP** |
| **App icon** | Generated for Android (legacy **and** adaptive), web/PWA and Windows from `scripts/make_icons.py` |
| **Build fix** | `record` v5 pins `record_linux 0.7.x`, which does not satisfy `record_platform_interface 1.6` and **broke the Windows build**. Upgraded to `record` v6. |
| **Wrapper** | Switched the Gradle wrapper to `-bin` (~95 MB smaller) and pinned `distributionSha256Sum` |

### Verification for this round

| Check | Result |
|---|---|
| Backend E2E (now covering verification + status viewers) | **98 / 98** |
| `flutter analyze` | **No issues found** |
| `flutter test` | **42 passed** (was 27) |
| `flutter build web --release` | **√ built** |
| `flutter build windows --release` | **√ built** — includes `record_windows_plugin.dll`, `audioplayers_windows_plugin.dll`, `url_launcher_windows_plugin.dll` |
| `node scripts/verify-web-e2e.js` (real headless Chrome) | **13 / 13** |

### Email / SMS delivery

Codes are generated server-side and stored hashed with a 10-minute TTL, a
60-second resend cooldown and a 5-attempt limit. Delivery is pluggable via
`server/.env`:

```ini
EMAIL_PROVIDER=console   # console | smtp | resend
SMS_PROVIDER=console     # console | twilio
DEV_SHOW_CODES=true      # dev only: returns the code in the API response
```

With no provider configured the code is printed to the server console and (in
development only) returned as `devCode`, so the flow is fully usable today.
Switching to real delivery is configuration, not code.

> **Before production:** set `DEV_SHOW_CODES=false` and
> `REQUIRE_VERIFICATION=true`, and configure a real provider.

### Known limitation: the microphone on web

Browsers only grant microphone access in a **secure context** — HTTPS or
`localhost`. Recording a voice note therefore works on the Android and Windows
apps, and in the browser only when served over HTTPS (or from `localhost`). The
app detects this and explains it instead of failing silently.

