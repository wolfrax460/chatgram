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
