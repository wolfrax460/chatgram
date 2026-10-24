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
npm run build -w @chatgram/web
npm run build --prefix client/landing
Remove-Item -Recurse -Force client/landing/dist/web -ErrorAction SilentlyContinue
Copy-Item -Recurse apps/web/dist client/landing/dist/web
cd client/landing
npx vercel --prod --yes
```

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

## 6. Deploy record

| Date | Commit | Deployed | Result / rollback |
|---|---|---|---|
| 2026-10-19 | (pre-session) | Flutter app + landing + API | live |
| 2026-10-24 | `180c867` | API: help centre (10 collections/37 articles, widget endpoints, handoff), status media (video/audio/upload/cleanup), profile panel + blocking/mute/report, group permissions/invites/pin/mentions/photo, account settings/change password/sessions/delete account, read receipts, message edit/star/forward/report, AI layer (inactive behind `SUPPORT_AI_LAYER=false`). Web: all of the above UI + compact auth screens for short viewports. nginx `client_max_body_size` 25m → 60m. | **Green.** Health ok (database/socket/cloudinary). Smoke test 24/24 functional checks (sign-in, messages both ways, photo+real video+real audio statuses via Cloudinary, profile, group members + leave, help widget, change password). Auth layout verified on production at 1366x600 / 1280x600 / 1440x700 / 390x700. Vercel deployment `chatgram-fqux4ip0s`; rollback: previous Vercel deployment + `src.bak-20261024-105120` + `chatgram-backups/20261024-105120.tgz`. |

> Update this table after every deploy. The rollback for a code deploy is the previous
> row's commit plus the backup archive recorded at deploy time.

## 7. Known first-boot side effects (safe, additive)

- Help centre seeds 10 collections / 37 articles (idempotent upsert).
- Status cleanup drops the legacy `createdAt` TTL index and adds the `expiresAt` TTL.
- New indexes: `starredBy`, message `editedAt`, chat invite token, help TTLs.
- No document is deleted by a schema change.
