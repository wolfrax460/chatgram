# Deploying Chatgram

Production is live. This is the procedure used for every deploy and the record of
what is currently deployed. **Deploy only when green** (`deploy-after-green`).

| | |
|---|---|
| Web app + landing + `/docs` | https://chatgram-xi.vercel.app (`/web/`, `/`, `/docs/`) |
| API + WebSocket | https://chatgram.duckdns.org |
| Server | `ubuntu@84.12.64.204` (Oracle VM, Johannesburg) |
| Server code | `~/chatgram/server`, PM2 process `chatgram-api` |
| Database | MongoDB Atlas M0 (`chatgram` DB) |
| Uploads | Cloudinary in production, local disk in dev/staging |

## 0. Access

```powershell
$key = 'C:\Users\<you>\...\chatgram-ssh.key'
ssh -i $key ubuntu@84.12.64.204
```

The Vercel CLI is already logged in locally (`npx vercel whoami`).

## 1. Pre-deploy gate (never skip)

Run from the repo root; all must pass:

```powershell
npm run typecheck
npm run build -w @chatgram/web
npm run test:integration     # needs the local staging API on :5000
npm run test:ai
$env:E2E_SKIP_WEBSERVER='1'; npx playwright test --config tests/e2e/playwright.config.js
```

Commit everything (`git status` clean) and record the commit hash:

```powershell
git rev-parse --short HEAD
```

## 2. Backend deploy

### 2a. Database backup (on the VM, then pull it down)

`mongodump` runs on the VM (Atlas allows the VM IP only).

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
ssh -i $key ubuntu@84.12.64.204 "mkdir -p ~/chatgram-backups/$stamp && cd ~/chatgram/server && set -a && . ./.env && set +a && mongodump --uri=\"\$MONGODB_URI\" --out ~/chatgram-backups/$stamp && tar czf ~/chatgram-backups/$stamp.tgz -C ~/chatgram-backups $stamp"
scp -i $key -r ubuntu@84.12.64.204:"~/chatgram-backups/$stamp.tgz" backups/
```

Record the dump path. Restore command (only if rolling back data):

```bash
mongorestore --uri="$MONGODB_URI" --drop ~/chatgram-backups/<stamp>
```

### 2b. Status-cleanup safety check (first boot after the cleanup job shipped)

Read-only count of what the new 10-minute job will delete (`expiresAt` older than
now / `createdAt` older than 24 h). Run **before** restarting:

```bash
cd ~/chatgram/server && node -e "
require('dotenv').config();
const m = require('mongoose');
m.connect(process.env.MONGODB_URI).then(async () => {
  const cut = new Date(Date.now() - 24*3600*1000);
  const n = await m.connection.db.collection('statuses').countDocuments({ createdAt: { \$lt: cut } });
  console.log('statuses older than 24h that cleanup will delete:', n);
  await m.disconnect();
});"
```

Expectation: only test/old statuses. Abort the deploy if real user data would be
removed unexpectedly. The first boot also drops the legacy `createdAt` TTL index
(harmless, it only ever removed documents).

### 2c. Copy code, install dependencies, restart

```powershell
scp -i $key -r server/src server/package.json server/package-lock.json ubuntu@84.12.64.204:~/chatgram/server/
ssh -i $key ubuntu@84.12.64.204 "cd ~/chatgram/server && npm ci --omit=dev && pm2 restart chatgram-api --update-env && sleep 3 && pm2 describe chatgram-api | head -20"
```

(Ship only what changed; `ecosystem.config.js`, `.env` and `uploads/` stay untouched.)

### 2d. nginx upload limits (status videos are up to 50 MB)

```bash
sudo grep -n 'client_max_body_size' /etc/nginx/sites-available/chatgram.duckdns.org
```

It must be `60m` (or larger) with `client_body_timeout 300s` and
`proxy_read_timeout 86400s`. Edit, then `sudo nginx -t && sudo systemctl reload nginx`.

### 2e. Verify the backend before touching the web app

```powershell
Invoke-RestMethod https://chatgram.duckdns.org/api/status/health
Invoke-RestMethod https://chatgram.duckdns.org/api/health
curl.exe -sS -o NUL -w "%{http_code}`n" https://chatgram.duckdns.org/web/
```

`/api/status/health` must be `{ ok: true, database: "connected", socket: "connected" }`.

## 3. Web deploy (Vercel)

The React app is served at `/web/` and the marketing site + `/docs` at `/`.
Both are deployed together from the landing project.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-web.ps1
```

That script builds both bundles, assembles `.vercel/output` (Build Output API),
deploys with `--prebuilt`, and checks the four production URLs. Use `-SkipBuild`
to re-deploy files that are already built.

> **Do not run a bare `npx vercel --prod` from `client/landing`.**
> Vercel then runs its own `vite build` from the uploaded source, which empties
> `dist/` and silently deletes the copied `dist/web` — the landing updates while
> `/web/` starts returning **404**. This happened on 2026-10-24 and was fixed by
> switching to the prebuilt flow above.

Then verify:

```powershell
curl.exe -sS -o NUL -w "%{http_code}`n" https://chatgram-xi.vercel.app/
curl.exe -sS -o NUL -w "%{http_code}`n" https://chatgram-xi.vercel.app/web/
curl.exe -sS -o NUL -w "%{http_code}`n" https://chatgram-xi.vercel.app/docs/
curl.exe -sS -o NUL -w "%{http_code}`n" https://chatgram-xi.vercel.app/web/admin
```

The deployment URL printed by the CLI is the new production alias; if it went to a
preview URL, run `npx vercel alias <url> chatgram-xi.vercel.app`.

## 4. Production smoke test (create + delete TEST accounts)

Rules: two clearly named test accounts, never touch real users, delete everything
afterwards (statuses, conversations, accounts).

1. Sign up `deploy-test-a-<stamp>@chatgram.test` and `deploy-test-b-<stamp>@chatgram.test`
   (the email verification code is shown only in dev; on production use two existing
   owner-provided test accounts or create them through the API with
   `REQUIRE_VERIFICATION` handling — do **not** change production verification settings
   for a smoke test).
2. On a 1366x600 viewport: sign in and sign up fit without scrolling; primary button,
   Google button, footer, language selector visible.
3. A sends B a text message both ways; A posts a photo status, a real video status and
   a real audio status (through Cloudinary); B sees them.
4. Change password, open a profile, open the group members list and leave a group,
   open the help widget and send a message.
5. Delete the test statuses, messages and accounts (DB cleanup by those exact test
   identifiers only).
6. Watch logs for 10 minutes:

```bash
ssh -i $key ubuntu@84.12.64.204 "pm2 logs chatgram-api --lines 100 --err"
```

If a health check or the smoke test fails: roll back immediately (section 5) and report.

## 5. Rollback

| Scope | Command |
|---|---|
| API code | `ssh -i $key ubuntu@84.12.64.204 "cd ~/chatgram/server && pm2 restart chatgram-api"` after restoring the previous `src/` (keep a copy: `cp -r src src.bak-<stamp>` before copying) |
| Database | `mongorestore --uri="$MONGODB_URI" --drop ~/chatgram-backups/<stamp>` |
| Web | Vercel dashboard → previous deployment → **Promote to Production** (or `npx vercel rollback`), or redeploy the previous git commit with the same procedure |
| nginx | restore `/etc/nginx/sites-available/chatgram.duckdns.org` from the backup copy + reload |

Always record the current commit and the Vercel deployment URL before deploying so
rollback is unambiguous.
| 2026-10-24 (evening) | \`ef8d69b\` | Do-not-disturb notification preferences (User.notificationPrefs, GET/PUT /api/users/me/notifications, Settings UI switch + From/To times, client gate silencing desktop notifications and the chime, wrap-over-midnight aware). Gate: 365 integration assertions + 22 unit + 36 AI + 55 Playwright. | **Green.** DB backup \`20261024-114214\` (28K, statuses 0), src backup \`src.bak-20261024-114214\`, deps installed then PM2 \`--update-env\` → health ok. Web deployment \`chatgram-24mhshntt\`; /, /web/, /docs/, /web/admin 200; auth layout re-verified. New endpoint 401 unauthenticated. |
| 2026-10-24 (night) | \`8e4e192\` | WebRTC 1:1 voice calls: GET /api/calls/ice (STUN/TURN from env), authenticated socket signalling (offer/answer/ICE/reject/end, shared-chat + block checks, offline + forbidden errors), web call overlay (ring, accept/decline, mute, camera, timer, hang-up), ChatHeader call button, Playwright fake-media args. Gate: 381 integration assertions + 22 unit + 36 AI + 57 Playwright. | **Green.** DB backup \`20261024-115853\` (28K, statuses 0), src backup \`src.bak-20261024-115853\`, deps installed then PM2 \`--update-env\` → health ok. Web deployment \`chatgram-fwrlqb6h9\`; /, /web/, /docs/, /web/admin 200; auth layout verified; /api/calls/ice 401 unauth. TURN is optional via STUN_URLS/TURN_* env vars. |

| 2026-10-24 (14:20) | 618a9eb (web only; includes 8e4e192 + landing rewrite) | Composer send-button accessibility label; rebuilt landing + /web from the current workspace. | Web deployment chatgram-cufahiivk; /, /web/, /docs/, /web/admin 200; API health ok (backend unchanged since 8e4e192). Rollback: previous Vercel deployment. |

| 2026-10-24 (14:35) | 9a0c1e2-ish (web) | Item 1: thin dark themed scrollbars + dark-theme divider fixes + help launcher moved into the sidebar (hidden floating launcher inside the app). New Playwright theme test. | Web deployment `chatgram-4us7nqyix`; /, /web/, /docs/, /web/admin 200. Rollback: previous Vercel deployment. |

| 2026-10-24 (14:45) | support AI fix (see git) | Item 2: support assistant silence fixed (env-key fallback + `stored_key_invalid`, ticket no longer silences, holding reply on AI-disabled/failure, empty-answer retry, error classification), admin red AI error banner/Test-AI red result. Backend deployed first (DB backup `20261024-124018`, src backup `src.bak-20261024-124018`, health ok), then web `chatgram-eus3b6wu3`. Production smoke: Support answered in 2.8 s; test account deleted. Rollback: `src.bak-20261024-124018`, `chatgram-backups/20261024-124018.tgz`, previous Vercel deployment. |

| 2026-10-24 (15:05) | item 9a admin gate | Admin panel password gate: bcrypt hash in ADMIN_PANEL_PASSWORD_HASH, set-admin-password script, server sessions + CSRF + lockout + audit, sessions/change-password UI, /web/admin gate screen, Vercel /api proxy route. Backend first (DB backup `20261024-130018`, src backup `src.bak-20261024-130018`, health ok), then web `chatgram-kashovb0o`. | **Green.** /, /web/, /docs/, /web/admin 200; /api proxy through the Vercel domain verified; admin session 503 until the owner sets a password (by design). Rollback: previous Vercel deployment, `src.bak-20261024-130018`, DB dump `20261024-130018`. |

| 2026-10-24 (15:35) | item 9c | Model providers tab + per-feature AI routing: /api/admin/providers (admin session+CSRF), encrypted write-only keys, Test connection, feature primary/fallback routing with undo, health counters, audit; UI tab in /web/admin. Backend first (DB backup `20261024-133230`, src backup `src.bak-20261024-133230`, health ok), web `chatgram-9j152ftlv`. | **Green.** Admin login + providers endpoint verified in production; no provider configured yet (owner adds the Groq key in the tab). Rollback: previous Vercel deployment, `src.bak-20261024-133230`, DB dump `20261024-133230`. |

| 2026-10-24 (15:57) | Chatgram AI MVP | `/api/ai` (conversations, messages, delete, send with history/limits/redaction), silent `AdminInbox` records + admin answer → KB learning, provider feature routing for `chatgramAI`, polite provider-failure reply. Backend first (DB backup `20261024-135355`, src backup `src.bak-20261024-135355`, health ok). | **Green (backend).** `/api/ai/*` and `/api/admin/ai/inbox` 401 unauthenticated; tests 19/19. UI/streaming not deployed yet. Rollback: `src.bak-20261024-135355`, DB dump `20261024-135355`. |

| 2026-10-24 (16:06) | Chatgram AI streaming + UI | SSE `/api/ai/messages/stream`, web Chatgram AI page (sidebar entry, pinned chat-list row, streaming, safe markdown, suggestions, copy, history, new chat/delete), admin AI inbox tab (answer→KB, ignore), silent inbox delivery via `CHATGRAM_ADMIN_EMAIL`. Backend first (DB backup `20261024-140451`, src backup `src.bak-20261024-140451`, health ok), then web `chatgram-6s6iqov0n`. | **Green.** Admin inbox endpoint verified in production; AI stream endpoint 401 unauthenticated; pages 200. Rollback: previous Vercel deployment, `src.bak-20261024-140451`, DB dump `20261024-140451`. |

| 2026-10-24 (16:52) | AI moderation/degraded/answer-user | Blocked-topic guard (`AI_BLOCKED_TOPICS`), AI degraded flag (5 failures/10 min) + admin health endpoint and red banner, inbox answer now delivers to the asker via Support. Backend first (DB backup `20261024-145107`, src backup `src.bak-20261024-145107`, health ok), web `chatgram-ajmsmgr3a`. | **Green.** /api/admin/ai/health 401 unauth, 200 with admin session; pages 200. Rollback: previous Vercel deployment, `src.bak-20261024-145107`, DB dump `20261024-145107`. |

| 2026-10-24 (17:05) | admin account + inbox delivery | Chatgram Admin account created (must-change flag), queued AI inbox records delivered once each (idempotent bookkeeping), `.secrets/` ignore rules + dashboard no-provider banner. Backend first (DB backup `20261024-150153`, src backup `src.bak-20261024-150153`, health ok), web `chatgram-m9obak9dg`. | **Green.** Admin user login 200 via the public API; inbox queue delivered=2 remaining=0; pages 200. Rollback: previous Vercel deployment, `src.bak-20261024-150153`, DB dump `20261024-150153`. |

| 2026-10-24 (17:09) | AI bubble polish + feedback | Disclaimer banner, intro bubble, suggestion pills above composer, verified badge, typing dots, copy/good/bad/regenerate actions, POST /api/ai/messages/:id/feedback (thumbs-down -> admin Inbox negative_feedback, dedupe counter). Backend first (DB backup 20261024-150744, src backup src.bak-20261024-150744, health ok), web chatgram-k8n88dt5n. | Green. Feedback endpoint 401 unauthenticated; pages 200. Rollback: previous Vercel deployment, src.bak-20261024-150744, DB dump 20261024-150744. |

| 2026-10-24 (17:13) | AI policy (blocked topics + limits) | AiSettings.aiPolicy, GET/PUT /api/admin/ai/policy (admin session + CSRF, audited), Chatgram AI reads blocked topics/caps/max-input immediately (normal + streaming), dashboard "AI safety & limits" panel. Backend first (DB backup 20261024-151218, src backup src.bak-20261024-151218, health ok), web chatgram-d980jqxf4. | Green. /api/admin/ai/policy 401 unauthenticated; pages 200; tests 7/7. Rollback: previous Vercel deployment, src.bak-20261024-151218, DB dump 20261024-151218. |

| 2026-10-24 (17:16) | 9e alert delivery | server/src/ai/alerts.js: instant AI-degraded alert (once/10 min) + hourly failure digest behind aiPolicy.alertsEnabled (off by default), delivered via the Support notifier (Telegram/email), sanitized reasons. Wired into normal + streaming AI failure paths. Backend first (DB backup 20261024-151502, src backup src.bak-20261024-151502, health ok). | Green. Health ok; tests 7/7. Rollback: src.bak-20261024-151502, DB dump 20261024-151502. Web bundle unchanged. |

| 2026-10-24 (17:24) | Change 1: pinned AI row + Ask-AI search | Restored pinned "Chatgram AI" row with assistant avatar + verified badge at the top of the chat list; added the "Ask Chatgram AI" row in chat search that sends the typed query via the streaming endpoint. Web only: build green, deployed chatgram-gkizpo8ia; /web/ and /web/admin 200. | Green (build + page checks). UI smoke with a signed-in test account not run this round. Rollback: previous Vercel deployment. |

## 6. Deploy record

| Date | Commit | Deployed | Result / rollback |
|---|---|---|---|
| 2026-10-19 | (pre-session) | Flutter app + landing + API | live |
| 2026-10-24 | `180c867` | API: help centre (10 collections/37 articles, widget endpoints, handoff), status media (video/audio/upload/cleanup), profile panel + blocking/mute/report, group permissions/invites/pin/mentions/photo, account settings/change password/sessions/delete account, read receipts, message edit/star/forward/report, AI layer (inactive behind `SUPPORT_AI_LAYER=false`). Web: all of the above UI + compact auth screens for short viewports. nginx `client_max_body_size` 25m → 60m. | **Green.** Health ok (database/socket/cloudinary). Smoke test 24/24 functional checks (sign-in, messages both ways, photo+real video+real audio statuses via Cloudinary, profile, group members + leave, help widget, change password). Auth layout verified on production at 1366x600 / 1280x600 / 1440x700 / 390x700. Vercel deployment `chatgram-fqux4ip0s`; rollback: previous Vercel deployment + `src.bak-20261024-105120` + `chatgram-backups/20261024-105120.tgz`. |
| 2026-10-24 (later) | `2fb2bde` | Group **join-request approval mode**: requireApproval setting, join-request API (request/list/approve/decline), invite links return pending, admin UI switch + pending card + invite-page state; server test suite 351 assertions, Playwright 54. | **Green.** DB backup `20261024-112539` (28K, statuses 0), src backup `src.bak-20261024-112539`, `npm ci --omit=dev` + PM2 `--update-env` → health ok. Web deployment `chatgram-p3lsvk26d`; /, /web/, /docs/, /web/admin 200; new join-requests route 401 unauth; auth layout re-verified on production. |
| 2026-10-24 (evening) | `37fb9e5` | Landing + README refresh: rewritten README for the current stack, 12 feature cards (incl. one-to-one voice calls), 6 privacy cards, two-release changelog, corrected roadmap and 10 FAQs, real screenshots of the current web app replacing the Flutter-era ones. New `scripts/deploy-web.ps1`. Web bundle rebuilt from committed `HEAD` so no in-progress code shipped. | **Green.** Vercel deployment `chatgram-e250wephh` (prebuilt); /, /web/, /web/admin, /docs/ all 200; landing bundle carries the new content, web bundle has calls and no `outbox`. **Incident, fixed same session:** the first attempt used a bare `npx vercel --prod`, so Vercel re-ran `vite build` from source, emptied `dist/` and dropped the copied `/web/` (404 on `/web/` and `/web/admin`). Redeployed through the Build Output API with `--prebuilt`; the procedure is now codified in `scripts/deploy-web.ps1`. Rollback: previous deployment `chatgram-fwrlqb6h9`. |
| 2026-10-24 (late) | `e97104a` | **Presence fix**: online state now comes from live sockets (`utils/realtime` set of socket ids), every REST read path asks the registry (chats/groups/rosters/profiles/contacts/search), login no longer flags online, client heartbeat `presence:ping` every 25 s with a 60 s stale sweep, lastSeen + `presence:offline` on the last disconnect, boot-time `resetStuckPresence()`, one-off `scripts/reset-presence.js`, health exposes `presence{usersOnline,sockets,staleMs}`, new `lib/presence.ts` client gate. Gate: 460 integration + 50 unit + 36 AI; Playwright presence spec added. | **Green.** DB backup `~/chatgram-backups/20261024-143333.tgz` (32K), `src.bak-20261024-143333`; 11 files syntax-checked + require graph OK; PM2 restart ? health ok, boot log `reset 2/2 stuck online flag(s)`. Production smoke 7/7 with 2 throwaway accounts, deleted (0 left); `users isOnline=true: 0`; Janvier Yedid + SAMUEL FX now offline with their real lastSeen. Web `chatgram-8jiknwnkc` (prebuilt), /, /web/, /web/admin, /docs/ 200. Rollback: `src.bak-20261024-143333` + `chatgram-backups/20261024-143333.tgz`, previous Vercel deployment. |
| 2026-10-24 (night) | `758b69f` | **Group voice and video calls for up to 20 people**: new `utils/callRegistry.js` (participant cap, invitee authorisation, busy detection, pruning), multi-party signalling in `socketHandler` (start/accept/decline/offer/answer/ICE/end + disconnect cleanup), mesh client (`calls.ts`) with video, participant-grid `CallOverlay`, video-call button in `ChatHeader` and group calling. Also fixes: declined 1:1 calls are destroyed (caller no longer stuck busy); overlay background, grid layout and video attachment. Gate: 400 integration + 50 unit + 36 AI, typecheck and build clean. | **Green.** `src.bak-20261024-124235`, socketHandler + callRegistry copied, `node --check` and registry smoke test passed, PM2 restart ? health ok (`storage: cloudinary`), `/api/calls/ice` 401 unauth. Web deployment `chatgram-3jhc0izef` (prebuilt); /, /web/, /web/admin, /docs/ all 200; live bundle carries the new call events. Two-browser fake-media check: both peers reach `active`, each sees a 2-track remote stream plus local preview. **Note:** prebuilt deploys need `.vercel/output/config.json` written without a BOM � a missing/BOM config makes Vercel fail the deployment with no useful error, and the production alias keeps serving the previous build. |

> Update this table after every deploy. The rollback for a code deploy is the previous
> row's commit plus the backup archive recorded at deploy time.

## 7. Known first-boot side effects (safe, additive)

- Help centre seeds 10 collections / 37 articles (idempotent upsert).
- Status cleanup drops the legacy `createdAt` TTL index and adds the `expiresAt` TTL.
- New indexes: `starredBy`, message `editedAt`, chat invite token, help TTLs.
- No document is deleted by a schema change.
