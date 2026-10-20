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

---

## Support assistant: multi-provider AI proxy (2026-10-20)

- **server/src/support/aiProvider.js** — one adapter, five backends:
  nthropic (Messages API), openai, gemini (generateContent),
  openai-compatible (any OpenAI-schema endpoint: Groq, OpenRouter, Together,
  DeepSeek, Mistral, Fireworks, Ollama, LM Studio, vLLM), and 
one.
  Chosen with AI_PROVIDER; legacy ANTHROPIC_API_KEY / OPENAI_API_KEY /
  GEMINI_API_KEY alone still auto-select a provider. Model comes from
  SUPPORT_AI_MODEL (per-provider default), output capped by AI_MAX_TOKENS,
  request timeout by AI_TIMEOUT_MS.
- **POST /api/support/assistant** (public): rate limited 30/hour per guest and
  200/day per IP, max 12 messages x 1200 chars in, injects the knowledge base
  into the system prompt, and **always answers** — when AI is disabled or the
  provider fails it returns a keyword-matched KB answer with source: "kb".
- **Widget** now calls the assistant endpoint instead of answering locally;
  the local KB remains as an offline fallback.

### Verified live
ssistantInfo() → {"enabled":false,"provider":"none"} (AI off by default).
POST /api/support/assistant with "I forgot my password" returned
{"source":"kb","aiEnabled":false,"answer":"Passwords must be at least 8 characters…"}
— note it matched the password-rules entry, which is the expected keyword
behaviour until AI is enabled. Health OK, /api/config 200, /api/chats 401.

### Still to build
Guest socket namespace + signed guest tokens (live support replies),
support-reply propagation, admin ticket badges, delete-my-ticket, Turnstile,
Playwright suite, backend hardening.

---

## Multi-channel support notifications (2026-10-20)

- server/src/support/notifier.js fans a new ticket out to every configured channel in parallel: Telegram (bot sendMessage), WhatsApp (Meta Cloud API) and email/Gmail (nodemailer). Missing env vars skip a channel; a failing channel never loses the ticket.
- notifyTicket formats ticket ID, contact, page, browser, problem and last 12 transcript turns. Wired into POST /api/support/tickets.
- notifySupportReply(ticket, text) is ready for reply propagation; channelStatus() reports what is configured.
- Verified live: channels telegram=false whatsapp=false email=true; ticket CG-W6ZJE created and logged as notified via email; health OK.
- Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID | WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TO, WHATSAPP_API_VERSION | SUPPORT_NOTIFY_EMAIL + SMTP_*.


---

## Guest socket + support-reply propagation (2026-10-20)

- server/src/support/guestToken.js: HMAC-signed, 30-minute tokens granting read access to ONE ticket. Format base64url(payload).base64url(hmac), constant-time compare, tamper + expiry rejected.
- server/src/sockets/supportGuestSocket.js: separate /support-guest namespace. Auth middleware verifies the token; the socket can only join ticket:<id> for its own ticket. emitToTicket(io, ticketId, event, payload) helper.
- POST /api/support/tickets now returns guestToken + guestTokenExpiresAt alongside ticketId.
- server/src/support/replyHook.js: propagateSupportReply() detects a Support-account message in a desk conversation, appends it to the ticket replies, flips status to answered, emits ticket:reply to the guest room and pings the owner channels.
- Hooked into BOTH message paths: REST sendMessage and Socket.IO message:send.
- Registered at startup (log: 'Support guest namespace ready at /support-guest').

### Verified live
- token issue/verify ok; tampered token rejected with bad-signature
- ticket CG-8BNFA returned a valid guestToken with a 30-minute expiry
- health OK after restart; /api/config 200; /api/chats 401 (unchanged)

### Remaining
The widget does not yet connect to /support-guest, and reply propagation is not yet proven end-to-end with a real Support reply. Backend hardening still outstanding.


---

## Guest socket UI, ticket badges, delete, Turnstile (2026-10-20)

Backend:
- DELETE /api/support/tickets/:id?contact= (public, 10/hr per IP) - delete-my-ticket
- GET /api/support/tickets/by-chat/:chatId (private) - admin badge data
- POST /api/support/tickets/:ticketId/close (private) - closes + emits ticket:closed to the guest
- Turnstile verification in createTicket, only when TURNSTILE_SECRET is set; fails open so a captcha outage cannot block reports

Frontend:
- Widget connects to /support-guest with the signed token from ticket creation, shows a live indicator, appends ticket:reply messages and handles ticket:closed. Falls back gracefully when the socket cannot connect.
- Delete this ticket on the confirmation screen (ticketId + contact).
- Ticket badge in the conversation header for the Support account: ticket ID, status, contact and a Close ticket action.

Verified: build green, deployed bundle contains support-guest / ticket:reply / Delete this ticket / Close ticket. Backend endpoints previously verified (404/401 correctly).

Playwright suite NOT written - no non-production backend exists and testing production was explicitly forbidden.


---

## Support-agent responder (2026-10-20)

- server/src/support/agentResponder.js: when a ticket is created the agent asks the configured model, using the knowledge base only, and requires a CONFIDENT or ESCALATE verdict as the first line of output.
- CONFIDENT: the answer is posted into the ticket conversation AS the Chatgram Support account, which runs the existing path - ticket reply stored, guest socket push, user email.
- ESCALATE: no auto-reply; the owner is notified on Telegram/email with the transcript and the ticket stays open.
- Opt-in via SUPPORT_AGENT_ENABLED=true so the owner can read tickets himself.
- aiProvider.askAssistant now accepts a per-call maxTokens override (500 for support replies).

### Verified live
TEST A 'How do I reset my password?' -> log: 'Support agent replied to ticket CG-0LXVR'
TEST B 'group chat disappeared, I want a refund' -> no auto-reply, escalated to the owner by email
Health OK; existing endpoints unchanged.


---

## Backend hardening: rate limits + account lockout (2026-10-20)

- server/src/middleware/authLimiter.js:
  - per-IP express-rate-limit on login (15/15min), register (8/hr), verification send (20/hr), forgot/reset (8/hr). 429 with Retry-After and code RATE_LIMITED.
  - per-account lockout: 5 consecutive failures locks that identifier for 15 minutes, answering 429 with code ACCOUNT_LOCKED and retryAfter. Implemented by wrapping res.json so the auth controllers stay untouched. Successful login clears the counter; other accounts are unaffected.
- Wired into authRoutes for login, register, verification/send, forgot-password, reset-password.

### Verified live
Failed logins 1-5 -> 401 Invalid credentials; attempt 6 -> 429 ACCOUNT_LOCKED retryAfter=900.
A different account still returns 401 (not locked). Support login -> 200. /api/config 200, /health 200.

### Incident
The first deploy crashed the API because express-rate-limit was installed locally but not on the VM (MODULE_NOT_FOUND). Fixed by running npm install express-rate-limit --omit=dev on the server, then restarting with a health gate. Lesson: install dependencies on the VM before deploying code that requires them.

### Still to do
- Dedicated hashed single-use reset tokens (15 min) replacing reuse of verification codes.
- TOTP 2FA.
- Playwright suite (blocked on a non-production backend).


---

## Dedicated password-reset tokens + Telegram connected (2026-10-20)

- server/src/utils/resetTokenStore.js: password resets now use their own store, completely separate from email verification. Codes are stored HASHED (HMAC-SHA256 with RESET_TOKEN_SECRET or JWT_SECRET), live 15 minutes, allow 5 attempts, and are single-use (consumed on success, so a replay returns not_found). 1-minute resend cooldown.
- authController.forgotPassword/resetPassword switched to resetStore; the verification path is untouched.
- Telegram: TELEGRAM_CHAT_ID=8304746608 set; channelStatus now reports telegram:true. Verified a real ticket notifies via telegram AND email.

### Verified live
forgot-password -> expiresInSeconds 900, delivered via smtp.
reset with a wrong code -> 400 'That code is not correct' (reason invalid), no crash.
Store unit check: wrong code invalid, right code ok, replay not_found.
verification/send still 200 (its own store). /api/config 200, /health 200.


---

## In-app Chatgram Support is now answered by the AI (2026-10-20)

The agent previously only fired on widget tickets. Users who message the Chatgram Support account directly in the app got no answer.

- server/src/support/supportAgentReply.js: when a direct message is sent to the support account, the assistant reads the conversation, answers from the knowledge base as that account (so it appears as a normal Support message, live over the existing socket), and escalates to Telegram/email when not confident.
- Skips messages sent BY support, the ticket Support Desk conversation (owned by agentResponder), chats that already have a ticket, and anything when SUPPORT_AGENT_ENABLED is not true.
- Hooked into both REST sendMessage and Socket.IO message:send.

Verified with a simulated conversation: 'How do I reset my password?' -> log 'Support assistant answered in-app for Agent Test' with a correct KB reply. Test user, chat and messages deleted afterwards. /api/config 200, /health 200.


---

## Two-way Telegram bot + escalation holding message (2026-10-20)

- In-app escalation now (a) opens a real SupportTicket so there is a reference and /reply can reach the user, and (b) posts a holding message as the Chatgram Support account: 'I'm not sure about that one, so I'm asking the Chatgram admin (ref CG-XXXXX). They'll reply here as soon as they can.' The Telegram/email alert includes the exact /reply command.
- server/src/support/telegramBot.js: inbound webhook at POST /api/support/telegram/:secret. Commands: /start, /help, /tickets, /reply CG-XXXXX text, /close CG-XXXXX, plus a bare 'CG-XXXXX text' shorthand. A reply posts into the ticket conversation as the Support account, which then mirrors to the ticket, pushes to the guest socket and emails the user. Only the configured owner chat id may drive it; a wrong secret returns 403.

### Verified live
Webhook registered with Telegram (setWebhook ok). /help and /tickets simulated -> 200. A wrong secret -> 403. /api/config 200, /health 200.

### Env added
TELEGRAM_WEBHOOK_SECRET (generated, stored on the server only).


---

## Support control dashboard (2026-10-20)

- SupportSettings model + support/settings.js: a singleton document holding AI provider/model/base URL/key, agent toggle, Telegram/email channels and copy overrides. Values are written into process.env on save so existing modules pick them up instantly; they are loaded from Mongo at boot so they survive restarts. Env vars remain the fallback when a field is blank.
- Admin API (support account only): GET/PUT /api/support/admin/settings, GET /api/support/admin/stats, POST /api/support/admin/test-ai. Non-support users get 403.
- apps/web /web/admin: live status, provider preset picker (Groq, DeepSeek, NVIDIA, Ollama, OpenAI, Anthropic, Gemini), editable model/base URL/key, AI + agent toggles, Test AI button, Telegram chat id and notify email, save button, recent tickets.
- Support replies now carry the ticket ref in the emitted payload (ref field) and SUPPORT_SHOW_TICKET_REF controls whether the stored reply text is prefixed.

### Verified live
GET admin settings without auth -> 401. With the support token: settings return status (AI enabled, openai-compatible/gpt-oss-20b, telegram+email connected) plus presets; stats return open/answered/closed/total and recent tickets (8 open, 9 total). /api/config 200.


---

## TOTP 2FA (2026-10-20)

- models/User: twoFactorEnabled + twoFactorSecret (select:false, AES-256-GCM encrypted at rest with a key derived from TOTP_ENCRYPTION_KEY or JWT_SECRET).
- controllers/twoFactorController.js: setup (secret + otpauth URI + QR data URL), enable (verify then turn on), disable (requires a current code), status. Codes verified with a one-step window for clock drift.
- loginUser now requires a TOTP code when 2FA is enabled: 401 TOTP_REQUIRED without one, 401 TOTP_INVALID when wrong, 200 with a valid code.
- Routes: GET /api/auth/2fa/status, POST /api/auth/2fa/setup|enable|disable (all protected).
- otplib pinned to v12 on the server: v13 removed the classiconic authenticator API in favour of TOTP/generate/verifySync.

### Verified live
encrypt/decrypt roundtrip true; valid code accepted; wrong code rejected; login without code -> 401 TOTP_REQUIRED; login with code -> 200; login bad code -> 401 TOTP_INVALID. Support login still 200, /api/config 200. Test account deleted.

### Not done
The Settings UI for enrolling a device is not built - the API is complete but a user must call it directly. The login screen also does not yet prompt for the code when TOTP_REQUIRED is returned.

