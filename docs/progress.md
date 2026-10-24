## STATUS after the 2026-10-24 evening round (deployed, production green)

### Done, tested and deployed this round
- **STEP 0** verified against production (item 4 card live, Support answers in ~3 s with a 9/9
  regression test, pinned AI row + Ask-AI row work in a real browser). See "Round 1" below.
- **Change 3** native dropdown fix (color-scheme, dark options, date/time, autofill) + guard test +
  contrast Playwright specs.
- **Change 1** Chatgram AI as a normal conversation (shared ChatHeader/Composer, menus, previews,
  unread badge, streamed safe markdown, actions, clear/new) **and group @Chatgram AI mentions**
  (off by default, rate limited, dedicated system account). Two production-only AI bugs fixed:
  `service.streamForFeature` was missing from the destructured service (every answer said
  "unavailable"), and the Vercel config never proxied `/api` (stream fetch 405 + admin cookie).
  The hidden learning marker no longer leaks, even mid-stream.
- **9e tail**: low-confidence/empty/refused answers and repeated questions create/increment Inbox
  records; a message to Chatgram Support with no reply in 60 s creates `support_timeout`;
  `GET /api/admin/ai/inbox/unread` feeds a 15 s live badge.
- **Change 2 chunk 1**: the new route-based admin dashboard (Overview, Users + detail, Inbox,
  Providers, Admin security, placeholders), dark design system, Ctrl+K palette, shared custom
  Select, new dashboard endpoints, and the previously missing `/api/admin/ai/policy` routes.
  Screenshots: `docs/screens/admin-*.png`.
- Admin panel password reset (the recorded one did not match the server hash) — the owner must
  change it on first use and delete `.secrets/admin-credentials.txt`.

### Production state
`/api/status/health` ok (DB + socket + Cloudinary), `/web/`, `/web/admin`, `/docs/` 200,
`/api` proxy verified (GET health + POST login). Last web deployment `chatgram-oazzw9gg7`, backend
PM2 restart #79, backups `20261024-173554` and `20261024-182636` with source snapshots.

### 9b pages deployed in the final rounds of this session
- Admin dashboard shell + Overview/Users/User detail/Inbox/Providers/Security (chunk 1).
- Item 4 server-driven recommendations + Announcements editor.
- System health, Audit log (read-only, verified in production).
- Chatgram AI usage + Knowledge base editor (verified in production).
Owner actions unchanged: rotate both admin passwords (panel password now set to the owner's
chosen value and stored in the credentials file), delete the credentials file after changing it,
enable TOTP once built, paste the Groq key.

### Still to build (crossed in the report)
1. **9b remaining pages**: Reports/moderation, Groups, Statuses & media, Support extras, Knowledge
   base editor, AI usage, Announcements (incl. item-4 recommendations editor), App releases,
   Feature flags & maintenance, Safety & abuse, System health, Audit log UI, Settings, Data
   requests. Each is an honest "not built yet" placeholder in the new dashboard today.
2. **9d oversight** (sensitive): security-review reason prompt, audit "who viewed what",
   read-only conversation review with a 15-minute session, global message search, rate limits,
   legal/notice text updates.
3. **9a remainder**: TOTP enrolment + recovery codes, optional IP allowlist, removing the legacy
   role-based admin guard (sign-out-all already exists).
4. **Item 4 remainder**: `GET /api/app/recommendations`, dismissal, completed-state hiding, admin
   editor (the rotating card + quick actions are live).
5. **Items 5/6/7**: rebuild the Windows NSIS installer from the current web build, build the
   Android APK, and the landing Features/Downloads tab with real screenshots + checksums + QR.
6. Owner actions: change both passwords and delete `.secrets/admin-credentials.txt`, enable TOTP
   once built, paste a working Groq key in Model providers, rotate leaked keys, install the APK on
   a real phone once built.

### Next session starts here (in this order)
1. Finish 9b pages one per deploy, starting with Reports/Support/Groups (data endpoints already
   follow the pattern in `server/src/controllers/adminOverviewController.js`).
2. 9d oversight with its guard rails before showing any user message content.
3. 9a TOTP + IP allowlist + remove the legacy guard (list removals in docs/decisions.md).
4. Item 4 API/editor; then items 5, 6, 7 (installers/APK/landing) and one final report.

## Round 1 (fresh session, 2026-10-24 evening) — starts here

### STEP 0 verification (done against code + production)

(a) **Item 4 empty-screen recommendations** — the branded card + quick-actions row ARE built and
live: production `/web/` served it to a real signed-in browser (temporary probe account, deleted
afterwards): `empty-recommendation` card ("Ask Chatgram AI anything") and `empty-quick-actions`
render, no console/page errors. NOT tested by Playwright, and the server-driven parts are still
missing (`GET /api/app/recommendations`, dismiss, completed-item hiding, admin editor).

(b) **Item 2 Support outage** — Chatgram Support answers in production: a real question sent from
a temporary account to the Support conversation got a reply in **3.1 s** ("How do I turn on
two-step verification?"), then the account/chat/ticket/messages were deleted. Regression test
`server/test/integration/supportReply.test.js` passes **9/9** (AI disabled still replies, existing
ticket does not silence, provider failure replies + classified 401/429/404/timeout).

(c) **Signed-in pinned AI row + search row** — verified in a real browser on production with a
temporary test account (deleted): pinned row visible with avatar/badge, search row appears for a
non-matching query and opens the AI view, no runtime errors. 9/9 checks passed.

### Change 3 — white native dropdowns (DONE, deployed with this round)

- `apps/web/src/index.css`: `color-scheme: dark` under `html.dark` (light stays light), dark
  `select/option/optgroup` surface + readable text + checked/disabled states, date/time pickers,
  `-webkit-autofill` guard, dark `accent-color`.
- Guard test `server/test/unit/nativeSelectGuard.test.js` (in `test:unit`): fails when a new bare
  `<select>` appears outside the five pinned legacy screens (and never in the new admin dashboard),
  and asserts the CSS rules stay.
- Playwright `tests/e2e/selects.dark.spec.js` (4 tests): auth country select, settings select,
  admin Model-providers + feature-routing selects at 1366x600 and 1920x1080 — asserts
  `color-scheme: dark`, non-white option background and >= 4.5:1 option contrast.
- `apps/web/vite.config.ts` dev server now binds `127.0.0.1` and the Playwright base URL is
  `http://127.0.0.1:5174`, so app + API are the same site and the SameSite=Strict admin cookie
  works locally (as it does through the Vercel proxy in production).

### Change 1 core — Chatgram AI is a normal conversation (DONE in this round)

- **Production bug found and fixed:** `service.js` exposed `streamForFeature` only as a named
  export, while `chatgram.js` holds `const { service } = require('./service')` captured at load
  time. `service.streamForFeature` was therefore `undefined` and **every streamed Chatgram AI
  answer fell back to "Chatgram AI is unavailable right now."** (SSE plumbing and provider were
  fine). Fixed by attaching the streamer to the `service` object; regression test
  `server/test/ai/streaming.test.js` (8 checks, in `test:ai`) fails without the fix.
- New `apps/web/src/components/AiThread.tsx` renders inside the normal two-column shell with the
  **shared ChatHeader and Composer**; header is avatar + "Chatgram AI" + subtitle "AI" + search +
  three-dot menu, **no call buttons**; three-dot menu = New conversation / Previous conversations /
  Search in chat / Mute / Pin / Clear chat; attach + mic hidden with the on-screen reason ("text
  only"); disclaimer is one system banner at the top of the thread, not under the composer; intro
  system message + 4 suggestion pills that disappear after the first message; typing indicator;
  streamed safe markdown (bold, italic, inline code, lists, code blocks with copy button); per
  answer actions Copy / Good / Bad / Share to another chat / Reply / Regenerate; reply quotes the
  chosen message; XSS rendered as text; Clear chat aborts an in-flight stream.
- Pinned chat-list row now shows last-answer preview, time and an unread badge
  (`apps/web/src/lib/aiThread.ts`, persisted preview/mute/pin); left-rail AI button moved below a
  divider at the bottom of the rail; the dedicated `pages/AiChat.tsx` page is deleted.
- The "Ask Chatgram AI" search row hands the query to the thread (prop handoff, not a CustomEvent
  that the not-yet-mounted thread would miss).
- Playwright `tests/e2e/aiThread.spec.js` (6 tests) with a deterministic mock provider
  (`tests/e2e/mockAiProvider.js`, port 5099, allowed via `AI_ALLOWED_LOCAL_HOSTS` in
  `scripts/start-staging.ps1`): pinned row + standard header no calls, typing/streaming/markdown/
  XSS-as-text, copy + good/bad + reply, clear chat, search handoff, list preview.
- Still missing from Change 1: **group "@Chatgram AI" mentions** (toggle off by default, rate
  limit, only mentioning messages sent to the provider).

### Change 1 group mentions (DONE in this round)

- Group settings gained `aiMentions` (off by default) with an admin toggle in Groups → Settings
  (`data-testid="ai-mentions-toggle"`), also exposed by `PATCH /api/chats/:id`.
- `server/src/ai/groupMentions.js`: only text messages that match `@Chatgram AI` are sent to the
  provider; answers are posted into the group thread by a dedicated **Chatgram AI system account**
  (`server/src/utils/aiAccount.js`, `isAiAccount`), which never appears in people search
  (`/api/users/search`, `/api/contacts/search`) and has no password (cannot be signed into).
  Rate limit: 3 answers / 10 minutes per group and a 20 s gap, reserved before the provider call
  so five rapid mentions produce one answer. Blocked topics apply. Failures are silent + logged.
- Hooked into both message paths (REST `messageController` and Socket.IO `socketHandler`).
- Integration test `server/test/integration/groupAiMentions.test.js` (14 checks, in
  `test:integration`): off by default, toggle works and persists, one reply per mention, plain
  messages ignored, rapid mentions rate limited to one, AI not searchable, toggle-off stops replies.

### Test isolation fix found during the gate

`policy.test.js` restored the AiSettings document with `$set` of a snapshot that had no
`aiPolicy`, which Mongoose silently strips — so its test limits (hourlyLimit 2) leaked into the
staging DB and later AI suites hit "you have reached the Chatgram AI limit". Restore now uses
`replaceOne` plus a "policy restored after the run" check; the staging policy was cleared.

### Change 2 — admin dashboard chunk 1 (in progress this round)

Built and tested: lazy route-based admin app (`pages/admin/`), dark design system, app shell
(sidebar groups, top bar, Ctrl+K palette, date range, live API/DB/AI chips, session timer,
15 s inbox badge), **Overview** (14 KPIs, sparklines, per-day bars, needs-attention panel, AI
usage per provider, quick actions), **Users** (server-side search/pagination, chips, CSV,
row → detail), **User detail** (Profile/Activity/Actions tabs, force logout, reset 2FA),
**Inbox** (master-detail, type/status filters, j/k/a/i shortcuts, answer→KB, ignore), **Model
providers** (cards, test, health/budget meters, feature routing with fallbacks + undo, AI
safety limits), **Admin security** (password change, sessions, sign out all, audit preview).
New backend: `/api/admin/overview`, `/api/admin/users`, `/api/admin/users/:id`,
`.../force-logout`, `.../reset-2fa` and the previously missing `/api/admin/ai/policy`
routes. Tests: 29 integration checks (`adminOverview.test.js`), 5 Playwright dashboard specs,
the dark-select specs rewritten for the shared custom dropdown, screenshots under
`docs/screens/`. Remaining from 9b/9d is listed in `docs/decisions.md` D34/D35 and crossed in
the report.

### Deployed (2026-10-24 ~19:05-19:25)

Backend backup `20261024-164639` (36K, statuses safe), src backup `src.bak-20261024-164639`.
Commits: `b07baf8` (Change 3), `bd939f2` (AI streaming fix), `f8e39fd` (Change 1 + group
mentions), `6c72655` (test isolation + docs), `483b30a` (marker + /api proxy), plus the
client marker-strip commit. PM2 restarts #76/#77. Web deployments: `chatgram-fh4jk7f2x` →
`chatgram-7a0bsmz1c` (adds the `/api` proxy) → `chatgram-13vnvgz1z`.
Gate before deploy: typecheck/build, 6 unit, 9 AI suites, 14 integration suites, **69/69
Playwright**. Production smoke (temporary account, deleted afterwards): login, pinned AI row,
AI header "AI", no call buttons, attach hidden, **real streamed AI answer with no marker
leak**, admin gate sign-in through the proxy + `GET /api/admin/providers` 200, no runtime
errors.

**Owner action from this round:** the admin-panel password in
`.secrets/admin-credentials.txt` did not match the server hash (the panel was unreachable), so
it was reset to a new random 28-character value written to the same file and the file ACL was
set to the current user only. Change both passwords on first use, then delete the file. Note:
one local debug command accidentally echoed the credentials file into this machine's terminal
history — rotate both passwords.

### Queue after this round

1. 9e tail: support-no-reply-60s Inbox record, low-confidence/duplicate records, live Inbox push.
2. Change 2: route-based admin dashboard shell + Overview/Users/Inbox/Providers, then 9b pages + 9d
   oversight (the main remaining work item).
3. 9a remainder: TOTP, IP allowlist, remove the legacy role-based admin guard, sign out all sessions.
4. Item 4 completion: `/api/app/recommendations`, dismissal, completed hiding, admin editor.
5. Items 5/6/7: Windows installer rebuild, Android APK, landing Features/Downloads.

---

## Next session starts here (updated 2026-10-24, end of round 16)


Read this file and docs/deploy.md first. Nothing is mid-flight: the last deploy is green and
every change is committed. Do NOT rebuild what already exists; continue the queue below.

### Order of work from here
1. **Change 2 — admin dashboard shell** (biggest win, do first in a fresh context):
   route-based lazy-loaded /web/admin app shell + Overview, Users, Inbox, Model providers.
   Keep the existing password gate, providers, inbox and AI policy panels (move, don't rewrite).
   Deploy shell+Overview+Users+Inbox, then add the remaining 9b/9d pages one at a time.
2. **Finish Change 1**: move the AI thread into the shared ChatWindow component; add
   share-to-chat, reply-to-message, group @Chatgram AI + settings toggle, unread badge/preview;
   attach stays hidden (text-only provider) and must be explained on screen. Add the Playwright
   specs named in the Change 1 spec (pinned row, pills vanish, streaming, XSS-as-text, copy/thumbs,
   clear chat, search handoff).
3. **Item 4 completion**: GET /api/app/recommendations (server-driven, hides completed items),
   dismissible card, admin editor in the Announcements area.
4. **9e tail**: type (e) support-no-reply-60s trigger; in-app admin socket / 15s polling push.
5. **Items 5/6/7**: rebuild Windows NSIS installer with the current web build; rebuild the
   Android APK (JDK 17 + Android SDK; see docs/android-build.md); landing Features + Downloads tab
   with real screenshots, checksums and QR, data from the App releases admin tab.
6. **Finish**: final report + deploy records.

### Known constraints / gotchas for the next session
- Windows CRLF files: patch scripts must normalise \r\n before string-matching or edits silently miss.
- Staging API: restart it (scripts/start-staging.ps1) before integration tests that hit new routes.
- Verified production state: /api/status/health ok; /web/ and /web/admin 200; live web bundle
  chatgram-qzvhilsac (item 4 partial); latest backend deploy 20261024-151502 (9e alerts).
- Provider list in the dashboard is empty until the owner pastes a Groq key; AI works via the env
  Groq key meanwhile. The no-provider banner shows on /web/admin.
- Chatgram Admin account (terminal123b@gmail.com) exists, queued inbox delivered once. The owner
  must change both passwords and delete C:\\Users\\mugis\\documents\\chatgram\\.secrets\\admin-credentials.txt.
- Never commit .secrets/, never print keys/passwords, no blanket find-and-replace, keep small commits.

### Where the work queue stands (audited 2026-10-24)

Legend: ✅ done + deployed · ◐ partial (missing parts listed) · ✗ not started.

1. ✅ White lines / scrollbars / help launcher — deployed.
2. ✅ Support/AI outage — root cause fixed (stale dashboard key overriding the env key;
   assistant silenced by existing tickets / disabled AI). Regression test + production smoke
   pass; admin Test-AI shows a red, classified error.
3. ◐ Chatgram AI — backend + UI + streaming + pinned conversation + silent learning loop +
   admin Inbox + KB learning + blocked topics + degraded banner + answer-to-user are deployed.
   Missing: Meta-AI-style *standard chat view* (Change 1: per-message actions, share,
   regenerate, image/pasted input, group @mentions, unread previews), 9e notification digests.
4. ◐ Empty-screen recommendations + quick actions — deployed (2026-10-24, web chatgram-qzvhilsac):
    branded card, rotating recommendation, quick-actions row. Missing: /api/app/recommendations,
    admin editor, dismissal, completed-state hiding, Playwright test.
9a. ◐ Admin password gate deployed and enabled in production (sessions, CSRF, lockout, audit,
    change-password). Missing: TOTP enrolment, IP allowlist, removal of the legacy
    support-admin guard.
9b. ✗ Admin dashboard pages — only the single-page admin gate/providers/inbox exists;
    no route-based shell, Overview/Users/… pages.
9c. ◐ Model providers + feature routing deployed (keys write-only, health, undo, tests).
    Missing: cost estimates, per-provider budget enforcement, "switch all".
9d. ✗ Read-only oversight, security-review reason flow, global message search, review audit UI.
9e. ◐ Admin Inbox + AI degraded banner + answer-to-user deployed. Missing: hourly digest /
    instant all-providers-down notification behind a toggle; real-time inbox updates.
5.  ◐ Windows app — an older installer exists; it was NOT rebuilt with this session's features.
6.  ◐ Android — the earlier build is sideload-only and was NOT rebuilt with this session's
    features; no release keystore (by design).
7.  ✗ Landing Features/Downloads tab with checksums and QR code.
•   9e alert delivery — ✅ deployed (2026-10-24): instant degraded alert (once/10 min) + hourly
    failure digest behind the admin settings toggle, via the existing Telegram/email notifier;
    silent by default. Tests 7/7. Missing: type (e) support-timeout trigger, in-app socket push.
•   AI policy (admin-editable blocked topics + limits) — ✅ deployed: settings-backed, validated,
    audited, effective immediately; tests 7/7. Alerts toggle stored but digest delivery not built.
•   Change 1 (Meta-AI-style conversation) — ◐ partial: pinned "Chatgram AI" row with avatar +
    verified badge, "Ask Chatgram AI" search row (sends the typed query), disclaimer banner, intro bubble, pills
    above the composer, verified badge, typing dots, copy/good/bad/regenerate actions and thumbs
    feedback are deployed. Still missing: standard ChatWindow component, share-to-chat,
    image/pasted input, group @Chatgram AI, unread badge/preview, "Ask Chatgram AI" search row.
•   Change 2 (route-based admin dashboard) — ✗ not implemented.
•   Admin account setup (Chatgram Admin user, queued-inbox delivery, credentials file,
    must-change-password flag, provider banner) — ✅ done 2026-10-24.
•   Presence stuck-online fix (parallel work) — ✅ deployed and verified.

### Next session starts here (in order — remaining queue)

Done and deployed: auth layout fix, docs tidy, full production deploy, AI layer switch,
group photo, message edit/forward/star/report, join-request approval, do-not-disturb,
WebRTC 1:1 voice calls.

Remaining:
1. Offline send queue (retry failed messages when the socket reconnects) and message-list
   virtualization for very long conversations; link previews if time allows.
2. Quality gate: remove `any` from the admin page, delete dead legacy files (e.g. the old
   `server/server` copy if unused), run the whole suite, then deploy with the recorded
   procedure.

### Working commands

    npm run build -w @chatgram/web      # tsc --noEmit + vite build (the real quality gate)
    npm run typecheck                   # all workspaces
    npm run start:staging               # local API on :5000 against chatgram_staging (never prod)
    npm run test:integration            # auth, status media/cleanup, profile, groups, account settings
    npm run test:e2e                    # Playwright: status, profile, groups, settings, realtime, security, mobile, help widget
    node server/test/ai/ai.test.js      # AI layer unit tests with mocked provider servers
    node server/test/integration/helpCenter.test.js  # help-centre backend

Local stack (see docs/local-staging.md): MongoDB on 127.0.0.1:27017, API on :5000
(scripts/start-staging.ps1), web on :5174 (VITE_API_URL=http://127.0.0.1:5000).

### Owner actions still pending (I cannot do these)

- Rotate the Groq/DeepSeek/NVIDIA/Ollama keys and the Telegram bot token (assume compromised).
- Add https://chatgram.duckdns.org/api/auth/google/callback to the Google Cloud Console
  authorized redirect URIs.
- Deploy the ready-to-deploy commits when satisfied (no prod deploy was done).
- Play Store release keystore (sideload APK only for now).

---

## LEDGER (session 2, copied 2026-10-21)

Legend: ✅ done and verified in the last session | ðŸŸ¡ partial | ❌ not done | â“ unknown, verify by auditing the code first

**Urgent bug list (A to F)**
- ✅ A1 to A3: status photo upload crash fixed and verified
- ✅ A4: automated upload test for image, audio and video (2026-10-21, commit: task 2)
  - `server/test/integration/statusMedia.test.js` — 45 assertions: real PNG + real WAV + real video uploads, limits, wrong types, file-on-disk checks, file deletion on status delete.
  - `tests/e2e/status.spec.js` — 9 Playwright tests with real fixtures (PNG, WebM video/audio recorded via Chromium MediaRecorder in `tests/e2e/fixtures/generate-fixtures.js`).
- ✅ B1: status media no longer cropped (composer preview and viewer use contain + letterbox, 240px preview cap)
- ✅ B2: video and audio status types (mp4/webm/mov, mp3/m4a/ogg/wav), client and server validation, limits (2026-10-21)
  - `POST /api/status/media`, `GET /api/status/limits`; image 10 MB, video 50 MB/60 s, audio 20 MB. 415/413/400 codes; client validates before upload with the limit in the message.
- ✅ B3: video thumbnail + duration limit / trim; audio player with waveform and cover placeholder (2026-10-21)
  - Poster frame captured on canvas and uploaded as `thumbnailUrl`. Over-60 s videos are **rejected** (spec allows reject or trim; no trim editor built). Audio preview/player has a real waveform (Web Audio decode) + gradient cover placeholder.
- ✅ B4: viewer auto-advance (5s + progress bar), hold to pause, arrow keys / tap for next and previous (2026-10-21)
  - Images and text statuses advance on a 5 s rAF clock with an accessible `role="progressbar"`; video/audio advance on `ended`; hold-to-pause with tap suppression; swipe left/right; arrow keys; Esc.
- ✅ B5: upload progress bar, cancel and retry (2026-10-21)
  - `api.uploadFileWithProgress` (XHR) drives a real percentage bar; AbortController cancels; the file stays selected so Post status = retry. Playwright verifies cancel + retry under throttled upload.
- ✅ B6: caption for any media type (2026-10-21)
  - `Status.text` is the caption; composer labels it "Caption (optional)" when a file is selected; rendered under every media type in the viewer.
- ✅ B7: delete stored file when a status expires or is deleted (2026-10-21)
  - 10-minute cleanup job deletes >24 h statuses + files/posters; legacy `createdAt` TTL index dropped; `expiresAt` 25 h TTL safety net; delete endpoint removes the file immediately. `statusCleanup.test.js` verifies (13 assertions).
- ✅ C: change password (Settings > Account, endpoint, session invalidation, email notice, tests) (2026-10-21)
  - `POST /api/auth/change-password` + Settings → Account → Change password UI (strength meter, confirm, show/hide). Session generation (`tokenVersion`/`tv`) signs out every other device, keeps this one signed in; email notice; per-IP + per-account throttling. 30 integration assertions pass.
- ❌ D: profile panel (tap a person anywhere, GET /api/users/:id/profile, privacy rules, actions)
- ✅ E: group members list and leave group (backend + UI)
- ❌ E (rest): add/remove members and promote/demote verified with permission tests, live member updates verified, last-admin handoff verified, empty-group handling, three-user automated tests
- ❌ F: Settings audit (every control in every section works and saves)

**Already working in production (do not break)**
Auth with 2FA + recovery codes, Google sign-in/up, support AI agent with Telegram two-way, dashboard inbox + reply, knowledge-base editor, group member roster and leave group, status photo upload and uncropped display, Settings/Contacts/Status full width, forgot-password reveal, Windows installer at `/downloads/chatgram-windows-setup.exe`, `/docs` Terms + Privacy.

**Other open items**
- ❌ Android APK: scaffolded, Gradle distribution download blocked (see Decisions)
- ❌ Playwright / integration suite: needs the local staging stack (see Rules)
- ❌ Google OAuth: add `https://chatgram.duckdns.org/api/auth/google/callback` as an authorized redirect URI in Google Cloud Console (I do this myself; without it Google sign-in fails with redirect_uri_mismatch)
- ❌ Rotate the Groq, DeepSeek, NVIDIA and Ollama keys and the Telegram bot token (I do this myself)

**Features requested but not confirmed built (audit each, then mark ✅/ðŸŸ¡/❌)** — audit result 2026-10-21:
- 🟡 Help-center widget upgrade: 3-tab Home/Messages/Help widget + help-centre backend built (2026-10-24, commit: help): 10 collections / 37 seeded articles, Article+Collection models, search, conversations with assistant replies (/api/help/*), human handoff to a ticket, live agent reply bridge, transcript email, feedback, resolve/delete, admin article editor, GET /api/status/health status card. Gaps: widget strings English-only, no voice-note recording in the widget, article icons not rendered.
- ✅ Provider-agnostic AI layer: server/src/ai/ built AND wired in (2026-10-24, commit: ai + session-4): one chat()/streamChat() interface; adapters for OpenAI-compatible (OpenAI, Azure, Groq, Together, OpenRouter, DeepSeek, xAI, Mistral, Ollama, LM Studio, llama.cpp, vLLM, custom), Anthropic, Gemini and Cohere; env-first config with encrypted admin keys; fallback chain + circuit breaker + retries/timeouts; daily token budget; redaction; SSRF checks; admin API + panel + Test connection. The support assistant/help widget now delegate to it when `SUPPORT_AI_LAYER=true` (legacy `support/aiProvider.js` remains the default/fallback). Tests: 29 mocked-server + 7 switch tests.
- ❌ Chatgram Assistant avatar: files `public/assistant-avatar.svg`, `assistant-512-circle.png` are NOT in `apps/web/public/`; create an original one.
- 🟡 Chat basics: delivery/read ticks, date separators, unread divider, typing, drafts, emoji picker, search in chat, reply, delete me/everyone, reactions, edit (with edited label), forward, star, report message, group pin all work (26 integration assertions + 4 Playwright tests for the new actions). Missing: generic per-chat pin, link previews, message search across chats (in-chat search exists).
- 🟡 Chat list: unread badges, previews, search chats, new chat/new group, sorted by recent, mute (server + profile + Settings) work. Missing: pin, archive, mark unread, delete chat.
- ❌ Calls (WebRTC voice/video with TURN) — nothing server-side or client-side.
- 🟡 Notifications: desktop notifications, tab title + favicon unread, mention notifications (group @mentions -> message:mention) work; taskbar badge via the desktop bridge is unverified; Android push and DND are not built.
- 🟡 Security review: blocking/mute/read-receipt/who-can-add privacy enforced server-side; authorization tested across chats, groups, profile and help (Playwright security spec); XSS rendered as text (tested); upload type/size checks; rate limits on auth/status/help. Remaining: systematic endpoint-by-endpoint audit, secure-header review, socket event audit.

---


## Historical notes

The phase-0 audit and its blockers are kept in git history. Everything that was blocked then (staging backend, Android applicationId, release keystore, staging suites) now has a local staging stack and fake/real test coverage; only the Play Store keystore and production secrets rotation remain owner actions. See `docs/deploy.md` for the current deploy procedure.

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
  the first message not in \
eadBy\.
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

- \Message\: \
eactions[{userId, emoji, createdAt}]\, \deletedFor[userId]\, \isDeleted\
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
\
eactToMessage\/\deleteMessage\ without importing them, so the API crash-looped
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
  Note: a Vercel 
ewrites entry for /docs did not take effect, so /docs is
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
- SUPPORT_NOTIFY_EMAIL set to an owner-controlled Gmail address (redacted) on the server and PM2
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
- Telegram: TELEGRAM_CHAT_ID=<redacted> set; channelStatus now reports telegram:true. Verified a real ticket notifies via telegram AND email.

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


---

## 2FA enrollment UI + sign-in prompt (2026-10-20)

- components/TwoFactorSettings.tsx mounted under a new Security section in Settings: shows on/off state, 'Set up two-factor' -> QR image + optional setup key + 6-digit confirm, and 'Turn off two-factor' requiring a current code.
- api-client: login() accepts an optional totp; added twoFactorStatus/setup/enable/disable.
- Auth sign-in detects ApiError.code TOTP_REQUIRED / TOTP_INVALID, shows a 6-digit Authenticator code field and re-submits with the code.
- i18n keys errTotpRequired, errTotpInvalid, totpCode, totpHint.

Verified: build green; deployed bundle contains 2fa/status, 2fa/setup, 2fa/enable, 'Set up two-factor', 'Authenticator code', 'Turn off two-factor'. /, /web/, /web/admin all 200.


---

## 2FA recovery codes + KB/inbox admin APIs (2026-10-20)

- User.recoveryCodes (hashed, select:false). Enabling 2FA now returns 10 single-use codes formatted AAAAA-BBBBB. Login accepts a recovery code when the TOTP code is wrong and consumes it, so a replay fails. POST /api/auth/2fa/recovery-codes regenerates them (requires a current TOTP code); GET /2fa/recovery-codes/count reports how many are left.
- support/kbStore.js: knowledge base now lives in SupportSettings.kb with knowledge-base.json as seed/fallback, so it can be edited without a deploy. assistantController, agentResponder and supportAgentReply all read through kbStore.
- Admin APIs: GET/PUT /admin/kb, POST /admin/kb/reset, GET /admin/tickets (filter status/q), GET /admin/tickets/:id, POST /admin/tickets/:id/reply (posts as Support, mirrors to the ticket, pushes to the guest socket, emails the user).

### Verified live
Recovery codes: 10 generated (format 4DE2Y-6BDLR); login with no code -> 401 TOTP_REQUIRED; with a recovery code -> 200; replay -> 401 TOTP_INVALID. Admin routes mounted (401 without auth). /api/config 200.

### Not done
The /web/admin UI for the KB editor and ticket inbox is NOT built - the APIs work but there are no screens yet.


---

## Dashboard inbox + KB editor + recovery codes UI (2026-10-20)

- /web/admin rebuilt with three tabs: Overview (AI/model/channels), Tickets (inbox) and Knowledge base (editor).
- Tickets: status filters (open/answered/closed/all), auto-refresh every 20s, list with ticket ID/status/reply count/summary/contact, detail pane with transcript and replies, and a reply box that posts as Chatgram Support (mirrors to the ticket, pushes to the guest socket, emails the user). Tickets without a chat show their contact instead.
- Knowledge base: list of entries, expand to edit title/keywords/answer, add, delete, Save (PUT /admin/kb) and Reset to the bundled JSON.
- Settings: email alerts now carry a note that turning them off means relying on this dashboard; escalations already create tickets so they appear in the Tickets tab.
- 2FA: after enabling, the 10 backup codes are displayed in a warning card ('Save these backup codes now') with a dismiss button.

Verified: build green; deployed bundle contains Knowledge base, admin/tickets, Send reply, Add entry, Save knowledge base, Save these backup codes, admin/kb. /, /web/, /web/admin all 200.


---

## Email off, greetings, escalation ticket fix (2026-10-20)

### The dashboard bug (root cause)
In-app escalations called SupportTicket.create with transcript roles of user, but the schema enum is guest|assistant. Validation failed, the code fell back to ticketId in-app, so the alert reached Telegram but no ticket row existed - which is why nothing appeared in the dashboard Tickets tab. Fixed by mapping user to guest when writing the transcript. Verified: an unanswerable in-app message now produces CG-W2SY7 (status open, transcript role guest) and notifies via Telegram.

### Other changes
- EMAIL_ENABLED=false now actually disables email (notifier.emailConfigured checks the flag). channelStatus reports telegram true, email false. Alerts go to Telegram plus the dashboard only.
- Greetings and small talk are answered instead of escalated: added a greeting knowledge-base entry (hi, hello, muraho, amakuru, bonjour, habari, how are you) and both agent prompts now allow one warm line without ESCALATE.
- Verified: hi how are you doing -> warm English answer; muraho amakuru -> Kinyarwanda answer; in-app muraho amakuru -> Kinyarwanda answer, no escalation.
- Ticket transcript labels: user turns now labelled User instead of Assistant.
- Default AI remains Groq openai-compatible openai/gpt-oss-20b.


---

## Forgot-password existence check + full-width layout (2026-10-20)

- forgotPassword now returns exists (boolean) so the UI can say whether the address is registered. Verified: unknown email -> exists:false; known email -> exists:true with delivery smtp. NOTE: this intentionally reveals whether an account exists (user asked for it); it weakens the previous anti-enumeration behaviour.
- Forgot-password banner shows 'That email is not registered. Check the spelling, or create an account.' when exists is false, otherwise 'A reset code is on its way.'
- Layout: the chat/settings content column widened from 860px to 1400px so pages fill the screen, and the scroll container uses .no-scrollbar so the vertical scrollbar line is gone.
- Windows installer rebuilt (78 MB) and republished to /downloads/chatgram-windows-setup.exe (79M, 200).
- Android: apps/mobile scaffolded with Capacitor 6.2.2, android platform added, web assets synced. Gradle build blocked by a network timeout downloading gradle-8.2.1-all from services.gradle.org; the local ~/.gradle cache has 8.2.1 but the wrapper still tried to fetch. Not resolved.


---

## A. Status/chat upload crash - ROOT CAUSE AND FIX (2026-10-21)

### Cause (reproduced from the production log, not guessed)
messageController.uploadMedia called require('../utils/upload').resolveSubdir(req) at line 254. utils/upload.js exports no such function, so EVERY upload threw TypeError and was caught by the generic handler, returning 500 'Server error uploading file'.

Evidence: ~/.pm2/logs/chatgram-api-error.log - 'Upload media error: TypeError: require(...).resolveSubdir is not a function at uploadMedia (src/controllers/messageController.js:254:47)'.

This affected status media AND chat media, because both use the same /api/messages/media endpoint.

### Fix
- Derive the storage subfolder from the mimetype inline (images / videos / audio / files); the broken require is gone.
- Added an upload error handler that maps multer and storage failures to specific messages (File too large (max X MB) / Unsupported file type / Storage unavailable, try again) instead of the generic one.

### Verified
POST /api/messages/media with a real PNG -> 201, URL https://res.cloudinary.com/vzz4kwby/image/upload/... (Cloudinary, durable).
Audio/video attempts failed only because the test payloads were synthetic random bytes - Cloudinary correctly replied 400 'Unsupported video format or file'. resourceTypeFor already maps audio->video as Cloudinary requires. Not yet verified with real audio/video files.


---

## E. Groups: members list + leave group (2026-10-21)

### Causes found
1. Members list: there was NO GET /api/chats/:id/participants endpoint - only add (POST) and admin-remove (DELETE /participants/:userId). The UI had nothing to call.
2. Leave group: no leave endpoint existed at all. DELETE /participants/:userId is admin-only removal of somebody else, so a member had no way out.

### Fixed
- GET /api/chats/:id/participants - member list with isAdmin, isYou, and presence that respects each member's showOnlineStatus privacy setting. Rejects non-members with 403.
- DELETE /api/chats/:id/leave - self-removal. Creates a system message ('X left', plus 'Y is now an admin' when a promotion happens), emits message:new and group:members so other members refresh live, and emits chat:removed to the leaver. If the last admin leaves, the longest-standing member is promoted. If the last member leaves, the group and its messages are deleted.

### Bugs found while testing
- The controller used chat.admins; the schema field is chat.groupAdmins. Fixed.
- The Chat schema validates that a group has at least one participant, so saving an empty group threw. The last-member path now deletes the chat instead.

### Verified
Routes mounted (401 without auth). Lifecycle: 3 members -> user3 leaves (2 left) -> admin leaves (1 left, auto-promote true) -> last member leaves (chat deleted, not in DB). Config 200, health OK.

### Not done
The web UI for the members panel / leave button is not built (API only). Admin add/remove/promote already existed server-side. Live socket refresh is emitted but untested against a real client.


---

## E. Group info panel: members list + leave (UI) (2026-10-21)

- api-client: getGroupMembers(chatId) and leaveGroup(chatId).
- GroupInfo now loads the roster from GET /:id/participants instead of reading chat.participants, which is usually just ids - that is why the member list looked empty. The admin flag now comes from the server (isAdmin), so admin controls appear correctly.
- Added a Leave group footer with a confirmation step (Yes, leave / Cancel). On success it refreshes the group and chat lists and closes the panel.
- Presence comes from the endpoint, which respects each member showOnlineStatus.

### Bugs fixed while wiring
- A blanket find/replace of the contacts-picker key also hit a User-typed list, breaking the build; reverted.
- A blanket replace of the member count also hit the group list row; restored.

### Verified
Build green. Deployed bundle contains Leave group, Yes leave, /participants, /leave. /, /web/, /web/admin all 200.


---

## B1. Status media fit (2026-10-21)

The composer preview used object-cover, which cropped whichever dimension overflowed - that is the crop visible in the reported screenshot. Both preview surfaces now preserve the uploaded aspect ratio.

- Composer preview: wrapped in a dark letterbox (bg-black, grid place-items-center, overflow-hidden) with the image at object-contain, max-h 240px and w-auto max-w-full. Portrait, landscape and square all fit, and the capped height keeps the Post status button visible without scrolling.
- Viewer: object-contain on a bg-black letterbox at max-h 68vh, w-auto max-w-full, matching the composer sizing.
- Avatars intentionally keep object-cover (correct for round thumbnails).

### Not done in B
Video and audio status types, thumbnail generation, duration limits, viewer auto-advance and hold-to-pause, upload progress/cancel/retry, caption for media, and deleting the stored file on expiry. These are still outstanding.


---

## Session 2 log (2026-10-21)

### C. Change password - DONE (commit fadbb29)
- `POST /api/auth/change-password` (authenticated, per-IP + per-account throttled).
  Wrong current password -> 400 `CURRENT_PASSWORD_INVALID`; weak -> 400
  `WEAK_PASSWORD` + `problems[]`; mismatch -> `PASSWORD_MISMATCH`; reuse ->
  `PASSWORD_UNCHANGED`; Google-only account -> `PASSWORD_NOT_SET` (use reset flow).
- Session generation: every JWT carries `tv`; `User.tokenVersion` is compared in the
  auth middleware and on refresh. Password change/reset bumps it -> all other access
  and refresh tokens get 401 `SESSION_REVOKED`; the caller receives a fresh token pair
  and stays signed in. Tokens from before the feature (no `tv`) count as version 0.
- Email notice (`notifier.notifyPasswordChanged`, no secrets in it).
- UI: Settings -> Account -> Change password: current/new/confirm, show/hide, live
  strength meter, server-rule validation, success/notice banner.
- Verified: `server/test/integration/changePassword.test.js` 30/30 assertions pass on
  the local staging stack (wrong current, weak, no-digit, mismatch, unchanged,
  unauthenticated, success, old tokens 401 SESSION_REVOKED, other device refresh 401,
  new access works, refresh rotates, old password cannot sign in, new one can,
  throttle 429 + retryAfter).
- Note: SMTP delivery of the notice was NOT tested locally (EMAIL_ENABLED=false by
  policy); the code path ran and reported `notified.email: false`.

### B (rest). Status photo / video / voice note - DONE
(see ledger above; decisions D14). Files:
- server: `utils/statusMedia.js`, `utils/statusCleanup.js`, `utils/storage.js`
  (`deleteStoredFile`), `utils/upload.js` (statusUpload), `models/Status.js` (media
  fields + expiresAt), `controllers/statusController.js`, `routes/statusRoutes.js`,
  `server.js` (start cleanup after Mongo connects).
- web: `lib/statusMedia.ts` (limits/probes/waveform/poster), `lib/api.ts` unchanged,
  `components/status/{StatusComposer,StatusViewer,AudioPlayer,Parts}.tsx`,
  `pages/Status.tsx` rewritten.
- api-client: `uploadFileWithProgress` (XHR progress/cancel), `uploadStatusMedia`,
  `statusLimits`, extended `createStatus`.

### Local staging + automated suite (start of task 6)
- `scripts/start-staging.ps1`, `docs/local-staging.md` - local-only API on :5000
  against `chatgram_staging` MongoDB with all real providers disabled.
- `tests/e2e/playwright.config.js` + `helpers.js`; `npm run test:e2e`.
- `tests/e2e/fixtures/generate-fixtures.js` records real PNG/WebM media with
  Chromium MediaRecorder (no ffmpeg encoders available here).
- Bug found+fixed while testing: the status progress bar never rendered because a
  CSS width transition restarted on every rAF update; now plain width + aria-valuenow.
- Bug found+fixed: text-only statuses never auto-advanced (treated as no media).
- Bug found+fixed: multer wrote local status files to `uploads/status/` while the URL
  said `uploads/videos/`, so local video/audio 404'd.
- Also fixed: root `npm run typecheck` was broken (packages had no tsconfig.json).


### D. Profile panel - DONE (commit be5a2c1)
- `GET /api/users/:id/profile` (privacy-aware), `POST/DELETE /api/users/:id/block`,
  `GET /api/users/me/blocked`, `POST /api/users/:id/report`,
  `GET/POST/DELETE /api/users/me/muted[/:chatId]`, extended `GET/PUT /api/users/me/privacy`
  (showPhone, showEmail, showAbout, showProfilePhoto, readReceipts, whoCanAddToGroups).
- Blocking enforced in REST sendMessage, socket `message:send` and direct-chat creation.
  A blocked person gets 404 for the profile; the blocker gets a minimal card so the block
  can be undone from the same panel.
- Read receipts: with `readReceipts:false` delivery is recorded but no `message:read` is
  published/stored (sender never sees blue ticks).
- UI: one `ProfilePanel` opened from chat header, chat list avatar, contacts, group member
  list, status viewer and group message sender names. Large photo lightbox, about, phone/
  email with copy, common groups, shared media/links, actions (message, voice/video call
  placeholders, mute/unmute, block/unblock, report with reasons).
- Verified: `server/test/integration/profile.test.js` 57/57, `tests/e2e/profile.spec.js` 8/8.


### E (rest). Groups - DONE except two items (commit 603abe7)
- Chat model: `groupDescription`, `groupCreatedBy`, `groupSettings
  {whoCanEditInfo,whoCanSendMessages,whoCanAddMembers}`, `inviteToken`/`inviteEnabled`,
  `pinnedMessageId`. Message model: `type: 'system'` + `mentionUserIds`.
- Server: permission-aware `PATCH /api/chats/:id` (name/description/settings, system
  messages), `POST/DELETE /api/chats/:id/admins` (last-admin guard), add/remove members
  with "who can add" privacy + system messages, invite link endpoints
  (`GET/POST/DELETE /:id/invite`, `GET /invite/:token`, `POST /invite/:token/join`),
  `POST/DELETE /:id/pin`, `GET /:id/media`, `GET /api/messages/:id/readers`,
  @mention detection + `message:mention` socket event, group send-permission check on
  both REST and socket paths.
- UI: rewritten group info panel (roster search, admin badges, add members, promote/
  demote, remove, edit name/description, permission toggles, invite link, mute, leave),
  media tab, pinned banner, "seen by" modal, centred system messages, invite preview
  page, live list updates.
- Verified: `server/test/integration/groups.test.js` 61/61; `tests/e2e/groups.spec.js`
  5/5 (three-user roster + live update, non-admin controls hidden, promote + leave with
  live system message, invite preview/join/land, pin banner).
- Known gaps: no group photo upload UI; no join-request approval mode (links join
  directly, which matches WhatsApp-style links).



### A4 + test suites - DONE (commit: e2e)
- Local staging stack: `scripts/start-staging.ps1` + `docs/local-staging.md` (local Mongo,
  every real provider disabled, rate limits off for tests only outside production).
- `tests/e2e/fixtures/generate-fixtures.js` produces real PNG/WebM video/audio via Chromium
  MediaRecorder (no ffmpeg encoders in this environment).
- Playwright suites (all passing, 31/31): status media 9, profile 8, groups 5, settings 4,
  realtime (two isolated contexts: typing, live message, read ticks, unread badge) 1,
  security (XSS rendered as text, cross-user authorization, login throttle) 3, mobile 1.
- Bug found+fixed while testing: incoming messages in an open conversation were never
  marked read, so senders never saw blue ticks. ChatWindow now sends read receipts for
  unread incoming messages while the window is visible.
- Integration suites (238 assertions total): changePassword 30, statusMedia 45,
  statusCleanup 13, profile 57, groups 61, accountSettings 32.
- Run with: `npm run test:integration` and `npm run test:e2e` (see docs/local-staging.md).



---

## Session 3 log (2026-10-21 to 2026-10-24)

### F. Settings audit - DONE (commit 2dee8e8)
Account (profile, password, email/phone with verification + current password, sessions/log out
others, delete account with full data cleanup, 2FA), Privacy (all switches, hide-from list,
blocked users with unblock), Notifications (permission, sounds, muted chats), Appearance (theme +
text size), Language (en/rw/fr/sw persistence), Time format. Server: new /api/auth/account/*
endpoints. Verified: 32 integration assertions + 4 Playwright tests.

### A4 + suites - DONE (commit 2151957)
Local staging stack (scripts/start-staging.ps1, docs/local-staging.md), real media fixtures
generated via Chromium MediaRecorder, 31 Playwright tests, 238 integration assertions. Found and
fixed: incoming messages in an open chat were never marked read (no blue ticks for senders).

### W. Help centre + 3-tab widget - DONE except noted gaps (commit a1eaec0)
Backend server/src/help/: models, seed (10 collections / 37 articles), public search/articles,
guest+user conversations with assistant replies grounded on articles, handoff to a real
SupportTicket, human reply bridge, transcript email, feedback, resolve/delete, admin article
editor, GET /api/status/health. Widget rewritten: launcher, Home (greeting, recent message,
status card, suggested articles), Messages (server-backed list), conversation (typing, citations,
thumbs, attachments, emoji, handoff, email transcript, resolve, delete), Help (search, collections,
article reader, was-this-helpful). Verified: 54 integration assertions + 5 Playwright tests.

### P. Provider-agnostic AI layer - DONE except switching the live assistant (commit: ai)
server/src/ai/: adapters (OpenAI-compatible family, Anthropic, Gemini, Cohere), one
chat()/streamChat() interface, env-first + encrypted DB settings, fallback chain, retries,
timeouts, abort support, circuit breaker, daily token budget, redaction, SSRF validation, admin
API (GET/PUT /api/support/admin/ai, POST /test) and an admin panel with provider/model/key/limits/
fallbacks + Test connection. 29 unit tests with mocked provider servers. Still to do: point the
support assistant/agent at this layer (see "next session starts here").

### Not done this session
Section 9 (calls, edit/forward/star, push notifications, offline queue, virtualization, Android
APK build, FCM) and the remaining quality-gate polish (bundle split, dead code, admin types).

---

## Session 4 log (2026-10-24)

### P follow-up - DONE
The support assistant/help widget now delegate to the provider-agnostic layer when
SUPPORT_AI_LAYER=true (encrypted admin settings, fallback chain, redaction, budget,
circuit breaker, SSRF). Legacy aiProvider remains the default and the fallback path.
Verified by server/test/ai/layerSwitch.test.js (7 assertions, mocked provider).

### E (rest) group photo - DONE
POST /api/chats/:id/avatar (image only, honours whoCanEditInfo, system message, live
update). UI picker in the group info panel + avatars rendered in the list and header.
Verified: groups integration test 68/68 + a Playwright photo-upload test.

### Section 9 basics - DONE (message actions)
PATCH /api/messages/:id (edit own text, "edited" label, message:edited socket event),
POST/DELETE /:id/star (per-user), POST /:id/forward (permission + block checks),
POST /:id/report (moderation Report + message snapshot). UI in the message menu.
Verified: server/test/integration/messageFeatures.test.js 26/26 + tests/e2e/messaging.spec.js 4/4.

### Quality gate - partial
vite manualChunks splits react/data/icons/socket; main JS chunk 562 KB -> 265 KB and the
size warning is gone. Build + typecheck green.

### Still not built (section 9 remainder)
WebRTC voice/video calls + TURN, push notifications (FCM/Android), chat-list pin/archive/
mark-unread/delete, link previews, offline send queue, list virtualization, @mention polish
in the chat list, Android APK build, admin `any` types, dead legacy file cleanup.

---

## Session 5 (2026-10-24): auth scrolling fix + production deploy

### Auth pages now fit short laptop viewports - FIXED
Root cause: the auth shell used a fixed vertical stack (large logo, tagline, card,
multi-row footer) inside an `overflow-y-auto` container that hid its own scrollbar,
so on a 1366x600 window the card was ~3-40px taller than the viewport and the primary
button/footer were clipped.

Fix (no scrollbar hiding, content never clipped):
- `apps/web/src/index.css`: height-aware auth layout. Tall wide screens get a
  two-column layout (brand panel + form); short windows (max-height 700/620) compress
  the logo inline with the name, hide the tagline and download links, use 40/38px
  inputs, tighter card padding and smaller field-error placeholders.
- `apps/web/src/pages/Auth.tsx`: compact inline brand header, brand side panel,
  single-line footer (links + language + version), password/confirm side by side on
  >=640px, Terms checkbox on one line. Removed `no-scrollbar` so scrolling (when a
  phone really needs it) is visible and normal.
- Playwright `tests/e2e/authLayout.spec.js`: 12 tests at 1366x600, 1366x680,
  1280x600, 1440x700, 1920x1080 (sign-in + sign-up, no vertical overflow, primary/
  Google/footer/language/version inside viewport), side-by-side password check, and a
  390x700 mobile test (no horizontal overflow, everything reachable).

### Docs tidy
- `docs/progress.md` re-saved as clean UTF-8 (mojibake repaired), stale
  "Phase 0-5 not started" block removed, personal identifiers (email, Telegram chat
  id) redacted. `AUTH_REVEAL_ACCOUNT_EXISTS` confirmed present and defaults to `true`
  in `authController.js` and `.env.example`.
- New `docs/deploy.md` (procedure + rollback + record) and decision D17
  (`deploy-after-green`).


---

## Production deploy (2026-10-24) — DONE

All work committed locally up to `180c867` was deployed under the new
`deploy-after-green` policy (owner authorised deploys).

**Backend** (api https://chatgram.duckdns.org)
- Database backup: `~/chatgram-backups/20261024-105120.tgz` (also pulled to `backups/`).
- Read-only status-cleanup check before first boot: `total=0 olderThan24h=0` (nothing
  real to delete).
- Dependencies installed before restart (`npm ci --omit=dev`), PM2 restarted with
  `--update-env`; previous API source kept at `~/chatgram/server/src.bak-20261024-105120`.
- `GET /api/status/health` → `{ok:true, database:"connected", socket:"connected", storage:"cloudinary"}`.
- nginx: `client_max_body_size` raised **25m → 60m** (status videos up to 50 MB);
  backup of the site file at `/etc/nginx/sites-available/chatgram.duckdns.org.bak-20261024`,
  `nginx -t` + reload OK.
- Error log after deploy: only expected `Socket auth error: jwt expired` lines; no crashes,
  PM2 online with no unstable restarts.

**Web** (Vercel project `chatgram` → https://chatgram-xi.vercel.app)
- Deployed prebuilt static output: landing + `/docs` + React app at `/web/`
  (deployment `chatgram-fqux4ip0s`). All of `/`, `/web/`, `/docs/`, `/web/admin` return 200
  and `/web/` serves the new bundle (`index-EFZc5UmR.js`).
- Auth layout checked **on production** at 1366x600, 1280x600, 1440x700 and 390x700:
  zero vertical overflow on laptops for sign-in and sign-up; primary/Google/footer/
  language/version all inside the viewport; the phone view scrolls normally and every
  action is reachable.

**Production smoke test** (two clearly-named TEST accounts, created and deleted):
24/24 functional checks passed — sign-in both accounts, direct chat + messages both ways,
photo + real video + real audio status uploads through Cloudinary, status feed visibility,
profile panel, group create/members/leave, help-widget conversation + assistant reply,
change password + re-login. All test statuses deleted; test accounts removed (verified 0
remaining, 0 statuses). Deletion via the API hit the per-IP change-password rate limit after
the password-change check, so the final account removal was done directly in the database
and verified with a count query (test accounts only, by their exact test identifiers).

**Sign-up note:** production requires an emailed verification code, so the UI sign-up form
was verified at the target viewports but the actual production registration was not
exercised with a real inbox (codes go to owner-controlled email). Sign-in, messages,
uploads, groups, help, password change and account deletion were all exercised through the
public API.

**Rollback:** previous Vercel deployment (promote in dashboard), API `src.bak-20261024-105120`,
DB `chatgram-backups/20261024-105120.tgz`, nginx `.bak-20261024`. Recorded in
`docs/deploy.md`.

### Session 6 — join-request approval mode (2026-10-24)
- `Chat.groupSettings.requireApproval` + `Chat.joinRequests`; invite links and the new
  join-request endpoint return a pending request when approval is on.
- Admin endpoints to list/approve/decline; approvals add the member, post a system
  message and update every member live. UI: settings switch, pending-request card in the
  members tab (admins), invite page "Request sent" state.
- Verified: `server/test/integration/joinRequests.test.js` **26/26** and a Playwright
  approval-flow test (enable switch → outside request → approve → member listed).


### Session 6 deploy (2026-10-24) — join-request approval
- Deployed commit `2fb2bde` to API (backup `20261024-112539`, src backup
  `src.bak-20261024-112539`) and web (Vercel `chatgram-p3lsvk26d`).
- Gate before deploy: typecheck, build, 351 integration assertions (incl. 26 new
  join-request checks), 36 AI tests, 54 Playwright tests — all green.
- After deploy: `/api/status/health` ok, `/`, `/web/`, `/docs/`, `/web/admin` 200,
  new join-request endpoint returns 401 unauthenticated, auth layout verified on
  production at all target sizes.
- Rollback: previous Vercel deployment, `src.bak-20261024-112539`,
  `chatgram-backups/20261024-112539.tgz`.

### Session 6 — 2FA dependency fix (already committed as 3c01773, deployed)
- The deploy included commit `3c01773` (otplib pinned to ^12.0.1, `express-rate-limit`
  and `qrcode` declared, 22-assertion `server/test/unit/twoFactor.test.js`). Verified on
  the production server: installed otplib **12.0.1**, `authenticator` helper present,
  both dependencies declared. `npm run test:unit` → 22/22.

### Session 7 — do-not-disturb notifications (2026-10-24)
- `User.notificationPrefs` (dndEnabled/dndStart/dndEnd) with `GET/PUT /api/users/me/notifications`,
  HH:mm validation, defaults 22:00 → 07:00.
- Web: Settings → Notifications "Do not disturb" switch + From/To time inputs (saved on change),
  client gate in `lib/notify.ts` (`isDoNotDisturbActive`, wrap-over-midnight aware) silences both
  desktop notifications and the message chime; loaded on sign-in.
- Verified: `notificationPrefs.test.js` 14/14 + Playwright persistence test.


### Session 7 deploy (2026-10-24) — do-not-disturb
- Deployed commit `ef8d69b` to API (backup `20261024-114214`, src backup
  `src.bak-20261024-114214`) and web (Vercel `chatgram-24mhshntt`).
- Gate before deploy: unit 22, integration 365 assertions, AI 36, Playwright 55,
  typecheck + build — all green.
- After deploy: health ok (database/socket/cloudinary), `/`, `/web/`, `/docs/`,
  `/web/admin` 200, auth layout verified on production, new notifications endpoint
  401 unauthenticated, PM2 online with no unstable restarts.
- Rollback: previous Vercel deployment, `src.bak-20261024-114214`,
  `chatgram-backups/20261024-114214.tgz`.

### Session 8 — WebRTC 1:1 calls (2026-10-24)
- Server: `GET /api/calls/ice` (STUN/TURN from env, TURN credentials never exposed to the
  client beyond the ICE payload) and authenticated socket signalling (`call:offer`,
  `call:answer`, `call:ice`, `call:reject`, `call:end`) with shared-chat + block checks,
  `call:unavailable` for offline users and `CALL_FORBIDDEN` for non-participants.
- Web: `lib/calls.ts` (RTCPeerConnection, media, mute/camera, state store) + full-screen
  `CallOverlay` (ring, accept/decline, timer, hang-up); ChatHeader phone button starts a
  voice call in direct chats. Fake-media Playwright args enabled for the test suite.
- Verified: `server/test/integration/calls.test.js` **16/16** and Playwright
  `calls.spec.js` **2/2** (decline flow + accept → live timer → hang-up).
- TURN is optional (`TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL`); P2P works without it,
  strict-NAT users need it configured on the server.


### Session 8 deploy (2026-10-24) — WebRTC calls
- Deployed commit `8e4e192` to API (backup `20261024-115853`, src backup
  `src.bak-20261024-115853`) and web (Vercel `chatgram-fwrlqb6h9`).
- Gate before deploy: unit 22, integration 381 assertions (incl. 16 call-signalling
  checks), AI 36, Playwright 57 (incl. 2 call flows with fake media), typecheck + build.
- After deploy: health ok, all pages 200, auth layout verified, `/api/calls/ice` 401
  unauthenticated, PM2 online (no unstable restarts), error log only expected lines.
- TURN is not configured in production yet: P2P calls work for normal networks; add
  `TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL` to `~/chatgram/server/.env` and restart
  for strict-NAT users.
- Rollback: previous Vercel deployment, `src.bak-20261024-115853`,
  `chatgram-backups/20261024-115853.tgz`.


---

## Session 9 (2026-10-24) — new queue, progress ledger

Legend: ✅ done + vs deployed · ✗ not started · ◐ partial.

1. ✅ White lines / scrollbars / help launcher — thin dark themed scrollbars everywhere
   (`scrollbar-width: thin`, transparent track, subtle thumb, dark color-scheme),
   dark-theme divider override (no bright 1px lines), floating help launcher hidden inside
   the signed-in app and opened from a new sidebar "Help" button (still floating on auth
   pages). Playwright `theme.spec.js` checks scrollbar tracks are not light and launchers
   do not overlap. **Deployed** (web `chatgram-4us7nqyix`).
2. ✅ Support outage root cause + AI answer test — **fixed and deployed**. Root cause:
   a stale 70-char dashboard AI key overriding the valid env Groq key (401), plus
   `answerSupportChat` returning early for chats with an existing ticket and returning
   silently when the AI was disabled. Fixes: env-key fallback with `stored_key_invalid`,
   empty-answer retry, ticket no longer silences, holding reply on every failure, error
   classification + red banner/Test-AI errors in /web/admin, stale production key cleared.
   Verified by `server/test/integration/supportReply.test.js` (9/9), all other integration
   suites, and a production smoke: **Support answered a test user in 2.8 s**, test account
   and chat deleted afterwards.
9a. ◐ Admin password gate — **server + UI deployed and enabled in production** (password set via scripts/set-admin-password.js on 2026-10-24, login/logout verified 200 through the public API and the Vercel /api proxy; credential stored by the owner locally, DPAPI-encrypted, never in the repo). One admin password (bcrypt cost 12,
   `ADMIN_PANEL_PASSWORD_HASH`, `scripts/set-admin-password.js`), server-side sessions with
   HttpOnly/SameSite=Strict/Secure cookie, per-session CSRF, sliding 30 min / absolute 8 h,
   sign-out + sign-out-all, per-IP progressive lockout (5/15 min), constant-time comparison,
   append-only audit trail, change-password screen, sessions screen, same-origin /api proxy
   for the Strict cookie. Verified: 23 integration assertions (wrong password, lockout, CSRF,
   user JWT rejected, cookie flags, no hash leakage, logout/logout-all, audit).
   **Not done:** TOTP enrolment UI, optional IP allowlist, removing the legacy
   support-account guard on /api/support/admin/*, and the 9b dashboard tabs.
9c. ✗ Model provider switching tab — not started (existing providers panel remains).
3.  ✗ Chatgram AI (sidebar entry, general assistant, streaming, silent learning loop,
    admin inbox) — not started.
4.  ✗ Empty-screen recommendations + quick actions — not started.
9e. ✗ Automatic dashboard alerts for unanswered questions — not started.
9b. ✗ Admin feature tabs (overview, users, moderation, groups, statuses, support, AI,
    announcements, releases, flags, safety, health, audit, settings, data requests) — not started.
9d. ✗ Admin read-only oversight + audit trail — not started.
5.  ✗ Windows app rebuild/installer — not started.
6.  ✗ Android app build — not started.
7.  ✗ Landing features/downloads tab — not started (landing has the earlier rewrite).
8.  ◐ Finish: item 1 deployed and docs updated; the rest of the queue above is unfinished.

Root causes/steps for the next session are the queue text above; the support outage (item 2)
was NOT diagnosed — it needs the production PM2 logs, SupportSettings document and an
authenticated AI test, then the Groq key replacement through the admin providers panel.


### Session 10 (2026-10-24) — Support/AI outage fixed
- Backend deployed (DB backup `20261024-124018`, src backup `src.bak-20261024-124018`,
  `npm ci --omit=dev`, PM2 `--update-env`); web deployed `chatgram-eus3b6wu3` (admin red
  error UI). `/api/status/health` ok, all pages 200.
- Production verification: AI test OK (323 ms, no last error); end-to-end Support message
  answered in 2.8 s; temporary test account/chat deleted.
- Remaining queue from the new plan: items 9a, 9c, 3, 4, 9e, 9b, 9d, 5, 6, 7 — all still ✗.


### Session 12 (2026-10-24) — item 9a admin gate deployed
- Backend deployed first (DB backup `20261024-130018`, src backup `src.bak-20261024-130018`,
  health ok); web deployed `chatgram-kashovb0o`. `/web/admin` now shows the "Admin access"
  password screen; a same-origin `/api/*` proxy route was added on Vercel (verified:
  `/api/status/health` through the Vercel domain returns the API JSON).
- Production currently answers `503 ADMIN_NOT_CONFIGURED` for the admin session until the
  owner runs `node scripts/set-admin-password.js` on the server — this is intentional (the
  server never ships a default admin password).


### Session 13 (2026-10-24) — item 9c deployed
- Backend first (DB backup `20261024-133230`, src backup `src.bak-20261024-133230`, health ok),
  then web `chatgram-9j152ftlv`. Production verified: admin login 200,
  `/api/admin/providers` 200 with `providers=0, features=3` (owner adds the first provider in
  the tab), logout 200; page routes 200 and the /api proxy works.
- Item 3 (Chatgram AI) **not started** — next in the queue.


### Session 14 (2026-10-24) — Chatgram AI backend MVP
- Backend deployed (DB backup `20261024-135355`, src backup `src.bak-20261024-135355`,
  health ok). `/api/ai/conversations` and `/api/admin/ai/inbox` return 401 unauthenticated
  (routes live behind their gates).
- Chatgram AI answers through the existing env-configured Groq provider when no
  "Chatgram AI" feature routing is set (owners can override in Model providers).
- UI, streaming and the Chatgram Admin account inbox delivery are still ✗.


### Session 15 (2026-10-24) — Chatgram AI streaming + UI
- Backend deployed (DB backup `20261024-140451`, src backup `src.bak-20261024-140451`, health
  ok); `CHATGRAM_ADMIN_EMAIL` set on the server only. Web deployed `chatgram-6s6iqov0n`.
- Tests before deploy: ai 29, layer 7, providers 14, chatgramAi 19 — all pass.
- Production verified: admin login + `/api/admin/ai/inbox?status=all` 200, `/web/` and
  `/web/admin` 200, stream endpoint 401 unauthenticated.


### Session 16 (2026-10-24) — AI moderation + degraded alert + answer-to-user
- Backend first (DB backup `20261024-145107`, src backup `src.bak-20261024-145107`, health ok),
  then web `chatgram-ajmsmgr3a`. Production verified: `/api/admin/ai/health` 401
  unauthenticated, 200 with the admin session; pages 200.


### Session 17 (2026-10-24) — ledger reconciliation + admin account setup
- Audited code + production; rewrote the status block above.
- Created the **Chatgram Admin** user (terminal123b@gmail.com) through the normal model path
  (bcrypt-hashed password, must-change-password flag, profile/avatar), set
  `CHATGRAM_ADMIN_EMAIL`, delivered the 2 queued unknown-question inbox records once each
  (`AdminInbox.deliveredAt` bookkeeping, idempotent), and verified admin login (200).
- Wrote both operator passwords once to
  `C:\Users\mugis\documents\chatgram\.secrets\admin-credentials.txt` (ACL: user + SYSTEM);
  `.secrets/` added to `.gitignore` + `.vercelignore` and proven ignored with
  `git check-ignore -v`. Admin panel password was already configured and was left unchanged.
- Added the dashboard banner shown while no AI provider is configured.
- Backend deployed (DB backup `20261024-150153`, src backup `src.bak-20261024-150153`), web
  `chatgram-m9obak9dg`. Tests: `server/test/ai/adminDelivery.test.js` 8/8.


### Session 18 (2026-10-24) — AI bubble polish + feedback
- Backend deployed (DB backup 20261024-150744, src backup src.bak-20261024-150744, health ok),
  web chatgram-k8n88dt5n. Tests: server/test/ai/feedback.test.js 7/7 (up accepted with no inbox
  noise, down recorded with question + counter, repeat increments, other users rejected).


### Session 19 (2026-10-24) — admin-editable AI policy
- Backend deployed (DB backup 20261024-151218, src backup src.bak-20261024-151218, health ok),
  web chatgram-d980jqxf4. Tests: server/test/ai/policy.test.js 7/7 (env defaults, stored values,
  invalid limits rejected, stored blocked topic refused, max input enforced, stored hourly cap).


### Session 20 (2026-10-24) — 9e alert delivery
- Backend deployed (DB backup 20261024-151502, src backup src.bak-20261024-151502, health ok).
  Tests: server/test/ai/alerts.test.js 7/7 (off by default, instant once, instant rate-limited,
  digest when due, counter reset, digest not repeated within the hour).


### Session 21 (2026-10-24) — Change 1: pinned row + Ask-AI search
- Web deployed chatgram-gkizpo8ia (backend unchanged). Built with tsc + Vite green; /web/ and
  /web/admin 200. Pinned row and search handoff are build-verified; a signed-in production
  smoke of the new row was not run this round (no test account created).


### Session 22 (2026-10-24) — item 4 partial
- Web deployed chatgram-qzvhilsac (build green, /web/ + /web/admin 200). Hard-coded
  recommendations + quick actions; backend endpoint and admin editor still crossed.
