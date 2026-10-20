# Blockers

Things that genuinely cannot be resolved from inside the codebase. Each lists what is blocked,
why it needs a human, and what unblocks it.

Per the kickoff rule: skipped, recorded here, continue with everything else.

---

## B1 — No staging environment (blocks Phase 0 exit + Phase 2 testing)

**Blocked:** Phase 0 exit criterion; Phase 1 exit criterion; all interop testing (React ↔ Flutter).

**Why:** there is exactly one backend — production on `84.12.64.204`, pointed at the production
MongoDB Atlas cluster, with a nightly `mongodump` backup. There is no second host, no staging
database, and `CLIENT_URL` currently allows only `https://chatgram-xi.vercel.app`.

**What is needed (pick one):**

- **A (recommended, cost ~$0):** run staging on the same VM as a second PM2 process on port 5001
  with its own database name in the same Atlas cluster (`chatgram_staging`) and its own
  `CLIENT_URL`. Needs: Atlas user permission to create a DB, ~150 MB RAM (VM has 954 MB total —
  verify headroom), and an nginx server block e.g. `staging.chatgram.duckdns.org` + certbot.
- **B:** a second small VM + separate Atlas cluster. Cleanest isolation, costs money.
- **C:** local-only staging on a dev machine talking to a local MongoDB. Fastest, but does not test
  CORS/nginx/TLS behaviour that the wrapped apps depend on.

**Unblocks:** everything in Phases 1–5 that needs a safe target.

---

## B2 — Android `applicationId` is a placeholder (blocks Phase 5, must be decided before any public Android release)

**Blocked:** Phase 5 (Capacitor), and the plan's §5.1 "updates in place" requirement.

**Why:** `client/android/app/build.gradle.kts` sets
```
namespace = "com.example.chatgram"
applicationId = "com.example.chatgram"
```
Google Play **rejects** `com.example.*`. More importantly, an application id is the app's permanent
identity: if a build with this id reaches users, it can never be changed without shipping a
different app with no install base and no upgrade path.

**What is needed:** a real id such as `com.chatgram.app` (owned domain recommended), chosen **before**
the first build that reaches a tester or the store.

**Unblocks:** Phase 5, and makes Phase 1's `X-Client` work meaningful.

---

## B3 — No release signing keystore exists (blocks in-place Android updates)

**Blocked:** Phase 5 release signing; the plan's assumption of reusing the existing key.

**Why:** the Android build is signed with the **debug** keystore —
`signingConfig = signingConfigs.getByName("debug")`. There is no `*.jks`, no `*.keystore`, no
`key.properties` anywhere in the repo. The APK currently served at `/downloads/chatgram.apk` is
debug-signed.

So there is nothing to "reuse". A release keystore must be **created**, stored offline in at least
two places, and never lost — losing it permanently breaks app updates.

**What is needed:** the owner runs `keytool -genkeypair` (or Android Studio → Generate Signed Bundle),
stores the `.jks` + passwords securely outside the repo, and adds a `key.properties` reference that
is git-ignored.

**Unblocks:** Phase 5, and any in-place update story.

---

## B4 — Push notifications are greenfield (schedule as new work, not a port)

**Blocked:** Section 7 item 11 ("Android push").

**Why:** the Flutter app contains **no push at all** — no `firebase_messaging`, no device-token
registration, no server endpoint. Nothing to migrate.

**What is needed:** a Firebase project + `google-services.json` (Android) and FCM server credentials
in the backend `.env`. Without those credentials the client side can be written but not tested.

**Unblocks:** the push part of Phase 3/5. Everything else proceeds.

---

## B5 — No code-signing certificate for Windows

**Blocked:** clean Windows distribution (SmartScreen warnings), though not the build itself.

**Why:** the current Windows build is an unsigned zip of `build/windows/x64/runner/Release/`.
An EV/OV code-signing certificate is a purchase, not a code change.

**What is needed:** a certificate (or accept SmartScreen warnings and document them for users).

**Unblocks:** only the polish of Phase 4 packaging.

---

## B6 — Design assets referenced in instructions but never received

**Blocked:** pixel-accurate logo work.

**Why:** earlier instructions referred to `chatgram-icon-v4.svg`,
`chatgram-icon-v4-animated.svg`, `chatgram-v4.ico`, `chatgram-v5-unread.ico`. None were attached to
the conversation and none exist in the repo. The repo has `client/assets/icons/chatgram-icon.svg`
and PNG masters only.

**Unblocks:** nothing structural — `packages/ui` can use placeholders and swap later.

---

## Not blockers (recorded so they are not re-litigated)

- Bearer-token auth: **no cookies**, so no SameSite/Secure work is required (plan §3 concern N/A).
- Refresh tokens: already implemented with rotation.
- HTTPS/WSS: already in place (nginx + certbot, TLS 1.3).
- FormData uploads: already verified working from the React client.
- No local Flutter database: so no offline-cache migration is required.
