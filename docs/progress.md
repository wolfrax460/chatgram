# Migration Progress

Running log. Updated as phases complete.

Last updated: 2026-10-20

---

## Phase 0 — Audit ✅ 5/6

| Task | Status |
|---|---|
| 1. Screen + feature inventory (Section 7) | ✅ `docs/migration-audit.md` §1–2 |
| 2. API contract (REST + Socket.IO) → `docs/api-contract.md` | ✅ 41 REST endpoints, 8 client→server events, 13 server→client events |
| 3. `pubspec.yaml` → React mapping (Section 6) | ✅ `docs/migration-audit.md` §3 |
| 4. Local data / auth storage recorded | ✅ §4 |
| 5. Android applicationId, signing, Windows packaging | ✅ §5 — **three blocking findings** |
| 6. Staging backend running | ❌ **blocked** — see `blockers.md` B1 |

**Exit criteria:** "contract doc complete, feature checklist complete, staging backend running."
→ 5 of 6 done. Staging is an infrastructure decision the owner must make.

---

## Phase 1 — Backend freeze & hardening ⏸ not started

Blocked on: staging (B1) for the exit criterion, and owner decisions on Android identity (B2/B3)
for the `X-Client`/min-version work to be meaningful.

Ready to do immediately once unblocked (all additive, no breaking change):

- [ ] Accept new CORS origins: staging web, `capacitor://localhost`, `https://localhost`,
      Electron origin, `http://localhost:*` in dev
- [ ] Read + log `X-Client` / `X-Client-Version` headers
- [ ] `GET /api/app/min-version` → `{ minVersion, platforms }`
- [ ] Push token endpoints (`POST /api/push/register`, `DELETE /api/push/:token`) + `platform` field
- [ ] Confirm socket handshake CORS for wrapped-app origins

---

## Phase 2 — Web MVP ⏸ not started

Seed exists: `client/webapp/` (React 18 + Vite + Tailwind, ~70% of the feature set).

- [ ] pnpm monorepo scaffold (`apps/web`, `apps/desktop`, `apps/mobile`, `packages/*`)
- [ ] `packages/api-client` — typed REST client, refresh, error handling
- [ ] `packages/realtime` — socket wrapper, reconnect (20 tries, 1s→5s), re-auth on reconnect
- [ ] `packages/core` — models, Zod schemas, stores
- [ ] `packages/ui` — design tokens + components
- [ ] `apps/web` shell, routing, theme tokens
- [ ] Auth slice
- [ ] Socket slice
- [ ] Chat list slice
- [ ] Chat screen slice (virtualized message list)
- [ ] Profile + settings slice

---

## Phase 3 — Feature parity ⏸ not started

Section 7 checklist: **0 / 15** ticked for React. See `migration-audit.md` §2 for the table.

Priority order per plan §8: groups → presence → status → media/voice → notifications → settings/privacy.
Plus: push notifications (greenfield) and deep links.

---

## Phase 4 — Windows (Electron) ⏸ not started

## Phase 5 — Android (Capacitor) ⏸ not started — **blocked on app id + keystore**

---

## Blockers

See `blockers.md`. Three need the owner: staging environment, Android applicationId,
release keystore.

---

## Phase 2 progress (2026-10-20)

Monorepo scaffolded and **building green** (	sc --noEmit strict + vite).

- [x] Workspace root (\package.json\ workspaces, \	sconfig.base.json\)
- [x] \packages/core\ — models (\User\, \Chat\, \Message\, \StatusItem\), JSON
      normalisers (\_id\/\id\ tolerance), display helpers, Zustand stores
      (session, theme, realtime, prefs)
- [x] \packages/api-client\ — typed client: bearer auth, single-flight refresh +
      replay on 401, \ApiError\, one method per endpoint in docs/api-contract.md
- [x] \packages/realtime\ — socket wrapper matching Flutter exactly: websocket +
      polling fallback, 20 retries 1s→5s, re-emit \uthenticate\ on every connect
- [x] \pps/web\ — React 18 + TS + Vite + Tailwind + lucide-react +
      TanStack Query + Zustand; login, session restore, chat list, conversation
      view, light/dark/system theme
- [ ] React Router routes beyond the shell
- [ ] Live socket wiring into the UI
- [ ] Remaining Section 7 features

**Build output:** 278.7 KB JS (88.7 KB gzip), 13.9 KB CSS (3.4 KB gzip).

**Deviation:** npm workspaces used instead of pnpm (pnpm global install stalled;
see decisions.md D9).

---

## Phase 1 progress (2026-10-20)

- [x] **CORS origins** — extracted isAlwaysAllowedOrigin/originAllowed in
      \server/src/server.js\. Always allows \http(s)://localhost:*\,
      \http(s)://127.0.0.1:*\, \capacitor://localhost\, \https://localhost\;
      the \CLIENT_URL\ allow-list still governs real domains. Socket.IO uses the
      same predicate.
      *This fixed a real user-facing bug: the React dev server on
      \http://localhost:5174\ was rejected ("CORS: blocked origin"), so sign-in
      failed locally.*
      Verified: localhost:5174 → 204 + ACAO; capacitor://localhost → ACAO;
      vercel origin still allowed; evil.example.com still gets no ACAO header.
- [ ] \X-Client\ / \X-Client-Version\ logging
- [ ] \GET /api/app/min-version\
- [ ] Push token endpoints

---

## Web UI overhaul (2026-10-20)

### Done
- **A1** Delivery ticks: sent (single), delivered (double grey), read (double #53bdeb).
  Live: message:delivered / message:read now patch the messages cache.
- **A2** Date separators (Today / Yesterday / date).
- **A3** Grouped consecutive messages: 3px spacing, timestamp on last of the run,
  sender name on first of the run.
- **A4 (partial)** Hover actions: reply (quoted preview above the bubble, sent as a
  \> Name: text\ prefix), copy, delete-for-me (local, see gaps).
- **A5** "Scroll to latest" floating button; "New messages" divider derived from
  the first message not in \eadBy\.
- **A6** Typing indicator in the chat header and in the chat-list row.
- **B1-B5** Emoji picker (32 emoji), send/mic swap, Enter sends + Shift+Enter newline,
  textarea auto-grows to ~5 lines, per-chat drafts, attach menu (photo / document / camera).
- **C1-C3** Header: in-chat search, call button, ⋮ menu; connection state shown only
  when disconnected ("Reconnecting…"); subtitle is online / typing… / "last seen today at …".
- **D1-D4** Chat list: time, unread badge, tick or "You:" prefix, initials from first+last
  word, stable colour hash of the user id, profile photo when set, search bar, new-chat
  button, sorted by most recent.
- **E1-E4** Message column capped at 860px centred, bubbles at 65%; received bubbles get a
  1px border; rail labels 11.5px with tooltips + aria-labels; logout confirmation dialog;
  secondary text moved to ink-600/ink-300 for WCAG AA.
- **E5** 12h/24h time-format setting (Settings → Time format), persisted.
- **F1-F2** Unread total in the tab title ("(2) Chatgram") and a badge drawn onto the
  favicon via canvas when unread > 0.

### Not done (need backend additions — see decisions.md D10)
- Message reactions, forward, delete-for-everyone, mute, block, clear-chat, calls.
- "Test with two browser sessions" was not performed: no second set of live credentials
  was available in this environment. Type-check and production build pass.

---

## Backend additions for deferred chat features (2026-10-20)

All additive; existing documents and the Flutter client are unaffected.

- \Message\: \eactions[{userId, emoji, createdAt}]\, \deletedFor[userId]\, \isDeleted\
  (+ indexes on \chatId+isDeleted\ and \deletedFor\).
- \DELETE /api/messages/:id?scope=me|everyone\ — \me\ pushes to \deletedFor\;
  \everyone\ (sender only) sets \isDeleted\, clears content/media and emits
  \message:deleted\ to the chat room.
- \POST /api/messages/:id/reactions\ \{ emoji }\ — one reaction per user, same
  emoji toggles off; emits \message:reaction\.
- \DELETE /api/chats/:id/messages\ — per-user clear (pushes to \deletedFor\ for
  every current message, so the other participant keeps their history).
- \getMessages\ now filters \isDeleted: true\ and \deletedFor: <me>\.

### Incident: brief production outage
While deploying the first version, \messageRoutes.js\ referenced
\eactToMessage\/\deleteMessage\ without importing them, so the API crash-looped
and nginx returned 502. A destructuring anchor in my patch did not match and I did
not verify the deployed file before restarting. Caught within minutes, fixed by
adding the imports, redeployed and verified healthy. Lesson: run the require
graph against the *uploaded* file, not only the local one.

---

## Auth screens rebuild (2026-10-20)

- [x] Sign in: 96px logo + tagline, email-or-phone with country picker (default
      +250) and E.164 normalisation, password show/hide, Caps Lock warning,
      autofocus, Enter submits, Keep-me-signed-in, inline validation, generic
      credential errors, network/429/session-expired mapping with retry
      countdown, 4s cold-start hint, loading spinner + no double submit.
- [x] Sign up: full name, identifier with country logic, password + strength
      meter + show/hide, confirm password, Terms/Privacy checkbox, safe
      duplicate handling.
- [x] Forgot: same confirmation whether or not the account exists.
- [x] Reset: code + new password + confirm + strength, success message,
      auto-redirect to sign in.
- [x] Footer: Privacy / Terms / Help, version, VITE_WINDOWS_URL and
      VITE_ANDROID_URL download links (hidden when unset), language selector.
- [x] a11y: 44px+ inputs, visible focus rings, aria-invalid, aria-describedby,
      role=alert + aria-live, full keyboard navigation, 390px layout.
- [ ] Backend hardening (rate limit, hashed single-use reset tokens, TOTP,
      Turnstile) - deferred with the six packages.
- [ ] Playwright suite - blocked on a non-production backend.

---

## Live deployment + auth + docs (2026-10-20)

- Phone **sign-up** now shows a clear message that phone registration is still in
  development and to use email (the UI previously let the server reject it).
- /docs published: **Terms of Service** and **Privacy Policy** as a real page
  (served from docs/index.html — the same SPA shell, routed by pathname in
  main.jsx). Sign-in/sign-up Terms and Privacy links deep-link to
  /docs#terms and /docs#privacy.
  Note: a Vercel ewrites entry for /docs did not take effect, so /docs is
  served as a real directory instead of a rewrite.
- Deployed to production: landing + /docs + /web (new auth screens).
- /app still 307 -> /web.

---

## Auth polish + desktop release (2026-10-20)

- **Sign-up now verifies the email**: step 1 collects name / email / password /
  confirm / terms, calls POST /api/auth/verification/send; step 2 takes the
  6-digit code, calls /verification/check, then registers with the
  erificationToken. Resend and back actions included.
- **Auth pages no longer scroll**: the shell is h-full with
  overflow-hidden, the logo is 64/80px (was 96) and spacing is tighter so
  sign-in and sign-up fit a 720p viewport without a scrollbar.
- **Windows installer published**: Chatgram Setup 1.0.0.exe (78 MB, NSIS x64,
  unsigned) uploaded to
  https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe and the
  landing page's Windows card now points at it instead of the old zip.
- Deployed: landing + /docs + /web.

---

## Google sign-in + support KB (2026-10-20)

- **Continue with Google** added to the sign-in screen: opens the consent popup
  via \GET /api/auth/google/url\ and polls \/google/poll\ (the same flow the
  Flutter client uses), then stores the tokens and loads the profile. 3-minute
  timeout with a clear message. No backend change needed.
- **docs/support-kb.md** written: 13 entries (register, phone format, password
  rules, forgot/reset, no-code, locked account, Windows install, Android
  install, notifications, contact support, ticket status, security, encryption)
  plus rules for the assistant.
- **server/src/support/knowledge-base.json**: machine-readable mirror with
  keywords, fallback text, and the system prompt for the AI assistant.

### Not built: the support widget itself
The full spec (tickets model, 6 endpoints, guest socket namespace, AI proxy,
admin ticket badges, Playwright suite) is multi-session work. The knowledge base
above is the shared prerequisite for it, so it was done first.

---

## Support widget — step 1 backend (2026-10-20)

- **Model** SupportTicket: ticketId (CG-XXXXX), guestId, contact/contactType,
  status open|answered|closed, summary, transcript[], replies[], meta
  (userAgent/page/appVersion/ipHash), chatId. **TTL index deletes transcripts
  after 90 days.**
- **POST /api/support/tickets** (public): validates contact (email or phone),
  summary required, strips HTML, caps summary 2000 / transcript 40 entries /
  4000 chars each, rate limits 5/hour per IP and 3/hour per guestId. Creates the
  ticket, then inserts a formatted message (ticket ID, contact, page, browser,
  summary, transcript) into the Support account's inbox via a "Support Desk"
  conversation and emits the existing \message:new\ socket event, then emails
  SUPPORT_NOTIFY_EMAIL when SMTP is configured.
- **GET /api/support/tickets/:ticketId?contact=** (public, 30/hour per IP):
  returns status + replies only when the contact matches; otherwise 404.
- **Nothing existing changed** — routes are mounted before \protect\.

### Deviation (documented)
The spec asked for one conversation **per ticket** between a "Support Desk"
system user and the Support user. Chats are pairwise, so per-ticket threads would
require a synthetic user per ticket. Instead all tickets arrive in a **single
"Support Desk" conversation**, each message prefixed with its ticket ID. Simpler,
no user-table pollution, and still live via the socket.

### Still to build
Widget UI, guest socket namespace + signed guest tokens, AI proxy
(POST /api/support/assistant), support-reply propagation, admin ticket badges,
delete-my-ticket, Turnstile, Playwright suite.

---

## Auth overflow + /docs fix (2026-10-20)

- **Removed the stray horizontal scrollbar/line** on the auth pages:
  \overflow-x-hidden\ on the scroll container and the decorative blur layer is
  now clipped by \overflow-hidden\.
- **/docs is now a standalone static page** (\client/landing/public/docs/index.html\,
  7.4 KB, inline CSS, no JavaScript). The previous SPA-routed version returned
  200 but the Terms/Privacy content did not render reliably. Verified live:
  "Terms of Service", "Privacy Policy", \id="privacy"\ and
  "not end-to-end encrypted" are all present in the served HTML.
- Auth footer and register Terms/Privacy links now point at \/docs/#terms\ and
  \/docs/#privacy\ (real anchors on a real page, so the browser scrolls to the
  section itself).

---

## Support widget UI (2026-10-20)

- components/SupportWidget.tsx: floating launcher (bottom-right, 56px) on every
  screen including sign-in/register/forgot/reset; panel is full-height on mobile
  and a 380x560 card on desktop. Title + AI notice, transcript with aria-live,
  5 quick-reply chips backed by the knowledge base, free-text input that masks
  anything matching "password is ..." / "code is ..." before it is stored,
  report form (contact + optional technical details), ticket ID confirmation and
  a "Check ticket status" form.
- api-client: createSupportTicket + getSupportTicket (public, anonymous).
- Mounted in App.tsx so it is available signed in and signed out.

### Also this turn
- Google sign-up button added (same popup+poll flow as sign-in).
- The visible scrollbar on the auth pages is hidden via a .no-scrollbar utility
  (still scrollable, just no visible bar).
- SUPPORT_NOTIFY_EMAIL set to terminal123b@gmail.com on the server and PM2
  restarted with --update-env (health gated).

### Still to build
Guest socket namespace for live support replies, AI proxy
(POST /api/support/assistant), support-reply propagation, admin ticket badges,
delete-my-ticket, Turnstile, Playwright suite, backend hardening.
