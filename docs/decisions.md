# Decisions Log

Autonomous decisions made while following the migration plan (per the kickoff prompt).
Each entry: what was decided, why, and what it costs to reverse.

---

## D1 — Audit first, no code until Phase 0 is signed off

**Decision:** Stop after Phase 0 and report, rather than starting the monorepo.
**Why:** the plan itself gates code on the audit ("Do not write React code until I approve the
audit" in the original §14). Three audit findings change the shape of the build:
the Android app id is a placeholder, no release signing key exists, and there is no staging
environment. Starting `apps/web` before those are settled risks building against the wrong
assumptions — especially "same applicationId, updates in place", which is currently impossible.
**Cost to reverse:** none — no code was written.

---

## D2 — Reuse `client/webapp` instead of rewriting the web app

**Decision:** treat the existing React client (`client/webapp/`, React 18 + Vite + Tailwind) as the
seed for `apps/web` rather than starting from zero.
**Why:** it already implements ~70% of Section 7 (auth incl. reset/verification, chat list,
conversations, live messaging, media, voice notes, contacts, status, profile+avatar, settings,
support). Rewriting would burn weeks to reach the same place.
**What still changes:** add TypeScript, React Router, TanStack Query, Zustand, React Hook Form +
Zod, lucide-react, and the monorepo packages. That is a real refactor, not a copy.
**Cost to reverse:** low — it is one directory; a rewrite can start beside it.

---

## D3 — Do not migrate the Flutter app's UI structure 1:1

**Decision:** match *behaviour* (Section 7), not widget-for-widget layout.
**Why:** the plan's §13 explicitly lists "scope creep into a redesign" as a risk and says
"match Flutter behavior first; redesign after cutover". The existing React client already has a
different (richer) layout, and porting Flutter's tree exactly would regress it.
**Cost to reverse:** low.

---

## D4 — Treat push notifications as greenfield, not a port

**Decision:** schedule push as new work in Phase 3, not as part of the client port.
**Why:** the Flutter app has **no** push (no `firebase_messaging`, no token registration, no
backend endpoint). Section 7 item 11 says "Android push", but there is nothing to port.
**Cost to reverse:** none.

---

## D5 — Drop the unneeded packages from the plan's §6 table

**Decision:** the migration does not need an offline DB, secure-storage migration, i18n framework,
or WebRTC. Those rows in the plan's mapping table do not apply to Chatgram.
**Why:** verified against `pubspec.yaml` — Chatgram uses `shared_preferences` only
(tokens + settings), no local database, English-only, no calls.
**Consequence:** Phase 3 is smaller than the plan implies; no Dexie/IndexedDB layer required,
though it can be added later for offline caching.
**Cost to reverse:** none.

---

## D6 — Correct the token-storage target

**Decision:** plan says `flutter_secure_storage` → Capacitor Secure Storage. Chatgram actually uses
plain `SharedPreferences`. Treat the move to secure storage as an **improvement**, not a parity port.
**Why:** we should not reproduce an insecure pattern just for parity.
**Cost to reverse:** none.

---

## D7 — Do not delete or modify the Flutter project

**Decision:** `client/` stays exactly as-is until cutover is finished and 30 days have passed.
**Why:** explicit kickoff rule; also the only rollback artefact for Android/Windows.
**Cost to reverse:** n/a.

---

## D8 — Backend changes will be additive only

**Decision:** when Phase 1 starts, only add: `X-Client`/`X-Client-Version` logging,
new CORS origins, a min-version endpoint, and push-token endpoints. No renames, no removals.
**Why:** frozen contract; old Flutter clients must keep working.
**Cost to reverse:** none (additive).

---

## Open questions for the owner

These need a human answer and block progress — see `blockers.md`.

1. **What is the real Android `applicationId`?** `com.example.chatgram` cannot ship on Play.
   Choosing it later means the app cannot be updated in place.
2. **Create a release keystore now?** Without one, no in-place Android update is possible and the
   current APK (debug-signed) has no continuous identity.
3. **Where does staging live?** A second small VM + a second Atlas database, or a `STAGING=1` mode
   on the same VM with its own Mongo database name.
4. **Is the Flutter app currently in the Play Store / distributed to real users?** This decides
   whether §5.1's update-in-place requirement is real or theoretical.

---

## D9 — npm workspaces instead of pnpm

**Decision:** use npm workspaces (root \package.json\ → \workspaces\) rather than pnpm.
**Why:** \
pm i -g pnpm\ stalled for 10+ minutes in this environment. npm 11 is present and
its workspaces give the same hoisting/symlink behaviour for this repo. The only change needed
was replacing the \workspace:*\ protocol with \*\.
**Cost to reverse:** trivial — add \pnpm-workspace.yaml\, swap \*\ back to \workspace:*\ and
\
pm i\ → \pnpm i\. Nothing in the source depends on the package manager.

---

## D10 — UI overhaul: what was implemented client-side vs deferred

**Decision:** implement everything that the frozen API already supports, and defer features
that need new endpoints rather than faking them.

| Feature | Status | Why |
|---|---|---|
| Reply | ✅ client-side | Sent as a \> Name: text\ prefix in \content\. Persists and shows for everyone without a schema change. |
| Copy | ✅ client-side | Clipboard API. |
| Delete for me | ⚠️ local only | No \DELETE /api/messages/:id\. Removed from the cache and restored on refetch. |
| Delete for everyone | ❌ deferred | Needs the endpoint above + an "is deleted" flag on the model. |
| Reactions | ❌ deferred | Needs a \eactions\ field on Message, a socket event and a REST route. |
| Forward | ❌ deferred | Implementable as send-to-another-chat, but needs a chat picker UI; not a backend gap. |
| Mute | ❌ deferred | Would need per-user muted-chats storage; currently only a placeholder toast. |
| Block contact | ❌ deferred | Needs a \locked\ relation + server-side message filtering. |
| Clear chat | ❌ deferred | Needs \DELETE /api/chats/:id/messages\. |
| Calls | ❌ N/A | No WebRTC anywhere in the product; header button is a placeholder. |

**No backend changes were made in this pass.** All backend work above is additive and can be
done in Phase 1/3 without breaking the Flutter client.

---

## D11 - Auth screens rebuild: substitutions for deferred dependencies

The six new packages (react-i18next, libphonenumber-js, playwright,
express-rate-limit, speakeasy, qrcode) were deferred by the owner, so the auth
UI was built with in-house equivalents. All are drop-in replaceable later.

| Spec asked for | Implemented instead | Why / swap path |
|---|---|---|
| \chatgram-icon-v4.svg\ / \-animated.svg\ | \pps/web/public/chatgram-icon.svg\ (the mark already in the repo) | **The v4 SVGs were never supplied** (see blockers.md B6). Static only; no animated variant exists. |
| react-i18next | \src/lib/i18n.ts\ - same \	('key')\ ergonomics, 4 locales (en/rw/fr/sw), persisted choice, browser-locale default | Swapping to react-i18next is mechanical: dictionaries and key names carry over. |
| libphonenumber-js | \src/lib/phone.ts\ - email detection, E.164 normalisation, 12-country dial list, length validation | Replace \
ormalizePhone\/\isValidPhone\ bodies with libphonenumber later; call sites unchanged. |
| Playwright | not written | No local/staging backend exists (blocker B1), and testing against production was forbidden. |
| express-rate-limit | not added | Backend deferred with the other packages. The UI already renders a 429 as "Too many attempts, try again in Ns" with a countdown. |
| TOTP / Turnstile | not added | Deferred with the other packages. |

### Behaviour notes
- **Keep me signed in**: \ApiClient.setPersistent()\ moves tokens between
  \localStorage\ (persistent) and \sessionStorage\ (tab-only). Default checked.
- **Error mapping never enumerates accounts**: 400/401/404 all collapse to
  "Wrong email or password"; network failures map to no-internet vs
  server-unreachable; 429 parses a retry-after and counts down.
- **Phone login** is client-side normalisation only; the backend still receives a
  single \identifier\ string, so no API change was needed.
- **Cold start**: a 4s timer switches on "Waking up the server..." while the
  first request is in flight.

## D12. Upload storage + the resolveSubdir crash (2026-10-21)

**Decision:** uploads stay on Cloudinary via utils/storage.js (durable object storage, already configured, no local-disk persistence problem on the VM).

**Bug:** uploadMedia called a non-existent utils/upload.resolveSubdir, so all uploads 500'd. Fixed by deriving the subfolder from the mimetype.

**Why it went unnoticed:** the catch block returned a generic message and the TypeError was only in the server log; the client showed one opaque string for every failure.

**Follow-up:** add real audio/video fixtures to the upload test - synthetic bytes are rejected by Cloudinary (400), which looks like a code failure but is not.


---

## D13 - Change password: session generation instead of a session table (2026-10-21)

**Decision:** JWTs stay stateless. A numeric `tokenVersion` (`tv` claim) on the
User document is compared on every authenticated request and on refresh. A
password change / reset increments it, which invalidates **every** existing
access and refresh token; the change-password response returns a fresh token pair
so the device that made the change stays signed in.

**Why:** there was no session store and no refresh-token table, so "log out other
devices" was otherwise impossible without a schema migration of epic size. Tokens
minted before this feature have no `tv` and are treated as version 0, so deploying
it does not sign anybody out.

**Consequences:** every request already loaded the user (middleware did
`User.findById`), so the extra check is free. A password reset now also signs
everyone out - intentional for a compromised account. Reversal: delete the claim
check; old tokens keep working.

**Password policy:** new passwords (change + reset) need 8-128 chars, at least one
letter and one digit, and must not be a known-common password
(`server/src/utils/passwordPolicy.js`). Sign-in is not re-validated, so accounts
with older weaker passwords keep working until they rotate.

**Email notice:** `notifier.notifyPasswordChanged` sends one (no password, no
tokens). If email is disabled/unconfigured the password change still succeeds and
the response says `notified.email: false`.

## D14 - Status media: dedicated upload endpoint, client-reported duration, file-aware cleanup (2026-10-21)

**Decision:** statuses have their own upload endpoint (`POST /api/status/media`)
with a 50 MB hard cap, then per-type validation:

| type | limit | duration |
|---|---|---|
| image | 10 MB | - |
| video | 50 MB | required, <= 60 s |
| audio | 20 MB | optional, <= 10 min |

**Why a separate endpoint:** the shared chat upload is capped at 10 MB by multer,
which would have made 50 MB videos impossible; raising it for chat would let a
10 MB image become a 50 MB message attachment.

**Duration is client-reported.** No encoder/ffprobe is available on the server, so
`durationSeconds` comes from `video.duration` in the browser and is validated as a
number in range. The file itself is not re-timed. Trim UI was not built: over-long
videos are rejected with a message that states the 60 s limit (the spec allows
"reject or trim").

**Thumbnails:** the composer captures a poster frame on a `<canvas>` and uploads it
as a normal image upload; `Status.thumbnailUrl` stores it. If the poster upload
fails the video status still posts.

**File deletion on expiry:** the old design put a Mongo TTL index on
`Status.createdAt`, which deleted the document at 24 h and **orphaned the uploaded
file forever**. Now:
- `server/src/utils/statusCleanup.js` runs every 10 min (after Mongo connects) and
  deletes statuses older than 24 h together with their files/poster,
- the legacy `createdAt` TTL index is dropped once on boot,
- `expiresAt` carries a 25 h TTL index as a safety net (later than the job, so the
  job always gets to the file first),
- `DELETE /api/status/:id` deletes the file immediately.

**Local-disk URL bug fixed:** multer wrote status files to `uploads/status/` while
`persistUpload` derived the URL folder from the media type (`videos/`), so every
locally stored video/audio 404'd. `persistUpload` now derives the URL from where
multer actually wrote the file.

**Verified:** 45 server assertions (`test/integration/statusMedia.test.js`), 13 for
expiry cleanup (`statusCleanup.test.js`), and 9 Playwright tests
(`tests/e2e/status.spec.js`) with real PNG/WebM fixtures recorded through Chromium
MediaRecorder (`tests/e2e/fixtures/generate-fixtures.js`).

---

## D15 - Help centre: articles in Mongo, guest conversations keyed by a random guestId (2026-10-24)

**Decision:** the help centre has its own `Collection` and `Article` models seeded from
`server/src/help/articles.seed.json` (idempotent upsert at boot), and widget
conversations are `HelpConversation` + `HelpMessage` documents with 90-day TTL indexes.
Guest conversations are authorised by the random `guestId` the widget generates and keeps
in `sessionStorage` (>=16 chars) — the same trust model as a signed-out support session.
Logged-in conversations are authorised by the session user.

**Why not reuse SupportSettings.kb:** the KB is a single prompt blob for the AI. The help
centre needs collections, article ordering, search snippets and an admin editor; keeping
them separate means editing an article cannot break the AI prompt, and the existing KB
editor keeps working.

**AI:** answers use the best-matching articles as grounding; when AI is disabled/failing the
server answers with the article text and states it does not know when nothing matches.

**Human handoff:** creates a normal `SupportTicket` (same ID format, same Telegram/email
notification) and links it to the conversation. Support replies in the desk conversation are
mirrored into the widget by `help/replyBridge` (live via socket for logged-in users; guests
get it on the widget's poll).

**Status card:** `GET /api/status/health` is new; `GET /api/status` is the existing statuses
(stories) feed and must not change, so the health check lives below it.

## D16 - Provider-agnostic AI layer (2026-10-24)

**Decision:** new `server/src/ai/` module with one `chat({messages, system, stream, signal})`
interface over adapters (OpenAI-compatible covers most vendors, plus native Anthropic,
Gemini and Cohere). Settings are env-first with database overrides; admin-saved keys are
AES-256-GCM encrypted (`AI_SETTINGS_SECRET`), never returned (last 4 chars only). Includes
retries/backoff, per-request timeouts, per-provider circuit breaker, ordered fallback chain
ending in a KB-only answer, daily token budget, redaction before sending, and SSRF
validation for admin-entered endpoints (https-only except allow-listed local model servers).

**Not switched over yet:** the existing support assistant/agent still use the older
`server/src/support/aiProvider.js` (5 backends). The new layer is wired to `/api/support/admin/ai`,
`/test` and the admin panel; migrating the widget's AI calls to it is a follow-up (see
docs/progress.md "next session starts here"). This was deliberate: switching live AI paths in
the same session as the help-centre rebuild would have made rollback harder.

---

## D17 - Deploy policy: deploy-after-green (2026-10-24)

**Decision (owner):** finished, tested work is deployed to production after the full
gate passes (typecheck, build, integration, Playwright, AI tests). Procedure and
rollback commands live in `docs/deploy.md`.

**Rules that stay:** run tsc + build after every edit; no blanket find-and-replace;
timeout every command; never print or commit secrets; never run `server.js` just to
"test" something; small commits; never delete user data; migrations must be
additive/re-runnable; security must not be weakened.

**Order:** backend first (backup → read-only status-cleanup count → deps install →
PM2 restart `--update-env` → health check), then web (Vercel), then smoke test with
throwaway test accounts which are deleted afterwards.
