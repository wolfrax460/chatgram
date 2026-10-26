# Next session: deploy everything (Oracle backend + Vercel frontend)

This is the checklist to run after the next chunk is green. Nothing here is a
secret: replace the SSH key path with your own local path, and never print or
commit `.secrets/`, `.env` values or API keys.

## Current production state (verified 2026-10-26 16:15, after Chunk 1 completion)

| Item | Value |
| --- | --- |
| Web / landing / docs | Vercel `chatgram-8dhgpgvgf` (https://chatgram-xi.vercel.app) |
| API / WebSocket | Oracle VM, PM2 `chatgram-api` **#117**, https://chatgram.duckdns.org |
| Health | `POST /api/status/health` → `{ok:true}` |
| Last backend backup | `20261026-153330` (92K) + `src.bak-20261026-153330` |
| Last backend change | Chunk 2 calls (commit `e2377f4`) |
| Last web change | Chunk 2 calls (`chatgram-8dhgpgvgf`) |
| SSH key (local path only; never print/copy the key itself) | `C:\Users\mugis\Downloads\mugisha recovery codes for github 8\chatgram recovery keys\ssh-key-2026-10-19.key` |
| Test-account helpers on VM | `/tmp/prod-backup.sh`, `/tmp/prod-smoke-account.js` (both present) |
| Docs shipped for production fix prompts | `~/chatgram/docs/progress.md` + `decisions.md` (refresh with each backend deploy) |
| Admin/support credentials | only in your local `.secrets/admin-credentials.txt` (never in the repo) |

## What must be finished before the next deploy

Chunk 1 is partly deployed; the remaining work is listed at the top of
`docs/progress.md` (`NEXT SESSION STARTS HERE`): Admin Inbox fix-prompt UI
(copy/combine/transcript), Telegram setting/test + two-way reply, Privacy Policy
and AI notice text, 1C private AI replies (`visibleTo`). Then Chunks 2–7 in the
order given there.

Rule for the chunk: `npm run typecheck`, `npm run build`, landing build +
`node client/landing/scripts/check-dist.mjs`, and only the test files for the
changed code. Run the full gate only if auth/messages/calls are touched.

## Prerequisites (do these first)

```powershell
# 0. From F:\projects\chatgram, clean state (only known foreign files may show)
git status --short
git log --oneline -1

# 1. SSH key for the Oracle VM (your local path)
# Chatgram key (Oct-19). The ssh-key-2026-10-17* keys in Downloads are stale and rejected.
$key = Join-Path $env:USERPROFILE 'Downloads\mugisha recovery codes for github 8\chatgram recovery keys\ssh-key-2026-10-19.key'
ssh -i $key -o ConnectTimeout=15 ubuntu@84.12.64.204 "echo ssh-ok"

# 2. Vercel CLI must be logged in
npx vercel whoami

# 3. Never leave the dev env in the production build
Test-Path apps\web\.env.local   # must be False (dev values live in .env.development.local)

# 4. Confirm the helper scripts still exist on the VM; recreate if /tmp was cleared
ssh -i $key ubuntu@84.12.64.204 "ls -l /tmp/prod-backup.sh /tmp/prod-smoke-account.js"
```

## Deploy order: backend first, then web

### A. Backend (Oracle VM)

Run this only when the backend chunk is green. If the changed code added/changed
dependencies, install them **before** restarting or PM2 will crash-loop
(`MODULE_NOT_FOUND` happened once).

```powershell
$key = Join-Path $env:USERPROFILE 'Downloads\mugisha recovery codes for github 8\chatgram recovery keys\ssh-key-2026-10-19.key'

# A1. Verified DB + source backup (the script prints BACKUP_OK / SRC_BACKUP_OK)
ssh -i $key ubuntu@84.12.64.204 "bash /tmp/prod-backup.sh"
# Expected:
#   BACKUP_OK <timestamp> <size>
#   SRC_BACKUP_OK src.bak-<timestamp>

# A2. Upload the API source (and package files if dependencies changed)
scp -i $key -r server/src ubuntu@84.12.64.204:/home/ubuntu/chatgram/server/
# Only if server/package.json or package-lock.json changed:
scp -i $key server/package.json server/package-lock.json ubuntu@84.12.64.204:/home/ubuntu/chatgram/server/

# A3. Install deps on the VM only when package files changed
ssh -i $key ubuntu@84.12.64.204 "cd ~/chatgram/server && npm ci --omit=dev"

# A4. Restart with the environment and wait for the health gate
ssh -i $key ubuntu@84.12.64.204 "cd ~/chatgram/server && pm2 restart chatgram-api --update-env; sleep 5; curl -s -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1:5000/api/status/health; pm2 describe chatgram-api | grep -E 'status|restarts' | head -2"
# health must be 200 and status online; if it crash-loops, restore src.bak-<stamp> and restart.

# A5. Check the logs briefly (expected lines only)
ssh -i $key ubuntu@84.12.64.204 "pm2 logs chatgram-api --lines 60 --nostream | tail -n 60"
```

### B. Backend smoke test with temporary accounts (then delete them)

```powershell
# Create verified test accounts (no email inbox needed)
ssh -i $key ubuntu@84.12.64.204 "timeout 25 node /tmp/prod-smoke-account.js create smoke1 2>&1 | tail -1; timeout 25 node /tmp/prod-smoke-account.js create smoke2 2>&1 | tail -1"
```

Use the returned `email`/`password`/`id` in a temporary smoke script (run from the
repo, then delete it). Cover the endpoints changed by the chunk (for example the
AI report endpoint/Telegram path, or the group-call signalling). Then clean up
**on the VM** — Atlas is only reachable there:

```sql
// run through a scp'd Node script using ~/chatgram/server/node_modules/mongoose
// delete exact probe emails/users, their chats/messages, and any test reports.
```

Verify `0` probe users remain. For AI reports also delete the smoke
AdminInbox row (find it by the reference printed in the reply) unless the owner
asked to keep it.

### C. Frontend / landing / docs (Vercel)

```powershell
# C1. Ensure the deploy guard passes (fails if apps/web/.env.local exists)
powershell -ExecutionPolicy Bypass -File scripts/deploy-web.ps1
```

The script builds the static landing, the web app and `/docs`, assembles the
Build Output API, deploys `--prebuilt`, then verifies `/`, `/web/`, `/web/admin`,
`/docs/`, `GET /api/status/health`, `/downloads/latest.yml` and POST login.

Record the deployment URL printed at the start (for rollback), e.g.
`https://chatgram-<hash>-mugishaishaq8-2444s-projects.vercel.app`.

### D. Verify production (both)

```powershell
$base = 'https://chatgram-xi.vercel.app'
foreach ($p in '/','/web/','/web/admin','/docs/','/sitemap.xml','/robots.txt') {
  (Invoke-WebRequest "$base$p" -UseBasicParsing).StatusCode
}
Invoke-RestMethod 'https://chatgram.duckdns.org/api/status/health'

# If the chunk changed UI: one signed-in production smoke of the changed flow
# (temporary accounts, deleted afterwards), plus a hard refresh/cache check.
# If the chunk changed AI reports: check the new Inbox record and the Telegram alert.
```

## Rollback (record this in docs/deploy.md before/after every deploy)

| Layer | Rollback |
| --- | --- |
| Backend | `src.bak-<timestamp>` on the VM → `scp`/`cp` back → `pm2 restart chatgram-api --update-env` → health gate; restore the DB archive `20261026-111532` only if data changed |
| Web | Previous Vercel deployment (dashboard → Deployments → promote, or `npx vercel rollback <previous-url>`) — currently `chatgram-dj8wmg0bv` |
| Data | DB backup from `/tmp/prod-backup.sh` (`BACKUP_OK <stamp>`) |

## Post-deploy (must do every time)

1. Add a row to `docs/deploy.md` with: chunk name, backend restart number, web
   deployment URL, backup stamp, health/smoke results, rollback.
2. Append the chunk report to `docs/progress.md` (and update
   `docs/decisions.md`, `docs/android-build.md`, `docs/ai-providers.md` when
   relevant). Keep the `NEXT SESSION STARTS HERE` block at the top current.
3. Delete all temporary accounts/chats/messages/reports on the VM and verify `0`
   leftovers; never print secrets.
4. Commit the chunk (`git add` only the files you changed; leave the known
   foreign files `package-lock.json`, `ads/`, `client/assets/*v4*`, `vercel.json`,
   `docs/chatgram-round3-prompt.md` alone).

## Known gotchas from the last sessions

- `apps/web/.env.local` must never exist when deploying (Vite bakes it into the
  production bundle; it broke Google sign-in once). The deploy script now refuses
  to run if it exists.
- Do not run a plain `npx vercel --prod` from `client/landing`; always use
  `scripts/deploy-web.ps1` (prebuilt API proxy + SEO routes + 404).
- AI report Telegram alerts use `server/src/support/notifier.js` (`notifyAlert`).
  `AI_REPORT_TELEGRAM=false` disables them; default is on. Test the bot before
  relying on it.
- The production AI provider fallback still points at the same `ollama-cloud`
  provider; configure a real secondary provider before relying on fallback.
- `reports.js` loads `AdminInbox` lazily from `./chatgram` to avoid a circular
  require; keep it that way.
- Release feed and landing Downloads data must be updated whenever an installer
  is rebuilt (size + SHA-256) or the landing/spec checks will be stale.
