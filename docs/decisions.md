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
