# Chatgram — Deployment Record

**Status: LIVE and verified end-to-end.**
Deployed 2026-10-19.

---

## Live URLs

| | URL |
|---|---|
| **Web app** | **https://chatgram-xi.vercel.app** |
| **API** | https://chatgram.duckdns.org |
| **WebSocket** | wss://chatgram.duckdns.org |
| Server IP | 84.12.64.204 (Oracle, Johannesburg) |

---

## Verification results

| Check | Result |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `GET /api/health` | `database: connected` |
| `GET /api/config` | verify=true, google=true, codesShown=**false** |
| CORS preflight (Vercel origin) | `204` + `Access-Control-Allow-Origin: https://chatgram-xi.vercel.app` |
| CORS (unknown origin) | no allow-origin header — correctly blocked |
| CORS (no Origin — native apps) | allowed |
| Frontend root | `200`, Flutter bundle |
| Frontend deep link `/chat/xyz` | `200` (SPA rewrite works) |
| Bundle URLs | `https://chatgram.duckdns.org` + `wss://` — **no localhost** |
| TLS | Let's Encrypt, **TLS 1.3**, valid to 2027-01-17, auto-renew, dry-run passed |
| **End-to-end test** | register → verify → contact → chat → **message over WSS → received** → persisted in Atlas → reconnect re-auth |
| PM2 | `chatgram-api` online, 67 MB RSS |
| Swap | 2 GB active |
| Memory | 469 MB / 954 MB used |
| Disk | 40 GB free |
| Boot persistence | pm2-ubuntu enabled, nginx enabled, iptables persisted, swap in fstab, certbot timer, duckdns + backup cron |

The E2E test proved: HTTPS registration with SMTP-verified codes, contact add,
direct chat creation, **WebSocket delivery over WSS**, message persistence in
Atlas, and socket reconnect. Test data was removed afterwards (DB is empty).

---

## Architecture

```
 Your PC                          Internet
 ────────                         ────────
 Flutter web build  ──vercel──▶  https://chatgram-xi.vercel.app
                                        │
                                        │ REST + Socket.IO (HTTPS/WSS)
                                        ▼
                            https://chatgram.duckdns.org  ──▶ 84.12.64.204
                                        │
                                  ┌─────┴─────┐
                                  │   nginx   │ :443 (Let's Encrypt) -> :80 redirect
                                  └─────┬─────┘
                                        │ http://127.0.0.1:5000
                                  ┌─────┴─────┐
                                  │  Node API │ PM2, 1 fork, max_memory_restart 500M
                                  └─────┬─────┘
                                        │ mongodb+srv (TLS)
                                        ▼
                              MongoDB Atlas M0 — cluster0.6ik0wiw.mongodb.net/chatgram
```

---

## Important constraints discovered

**Atlas Network Access is locked to `84.12.64.204/32`.**
This means `mongodump` **cannot** run from your PC (tested: refused).
Backups therefore run **on the VM** and are pulled down with `scp`.
If you want PC-side dumps, add your home IP in Atlas → Network Access.

**The VM is x86_64** (`VM.Standard.E2.1.Micro`), not ARM.

**Oracle's Ubuntu images end the iptables INPUT chain with a REJECT.**
`setup-server.sh` inserts the 80/443 ACCEPT rules *before* it. Appending would
have left them unreachable.

---

## Backups

Atlas M0 has **no automated backups**. On the VM:

```bash
~/chatgram/scripts/backup-db.sh          # manual run
crontab -l                                # nightly at 03:00 UTC
```

Dumps go to `~/chatgram-backups/<timestamp>/` and keep the newest 7.
Pull to your PC:

```powershell
scp -i "<key>" -r ubuntu@84.12.64.204:/home/ubuntu/chatgram-backups/<stamp> F:\projects\chatgram\backups\
```

Restore:

```bash
mongorestore --uri="$MONGODB_URI" --drop ~/chatgram-backups/<stamp>/chatgram
```

> **Media is NOT in the dump.** Avatars/images/voice notes live on the VM disk.
> Back them up separately:
> `scp -i "<key>" -r ubuntu@84.12.64.204:~/chatgram/server/uploads F:\projects\chatgram\backups\uploads`

---

## Redeploy commands

**Backend (after a code change):**

```bash
cd ~/chatgram && git pull          # or re-upload the bundle
cd server && npm ci --omit=dev
pm2 restart all
```

**Frontend (from this PC):**

```powershell
cd F:\projects\chatgram\client
flutter build web --release --dart-define=API_URL=https://chatgram.duckdns.org --dart-define=WS_URL=wss://chatgram.duckdns.org --dart-define=APP_VERSION=1.0.0
cd build\web
vercel --prod --token $env:VERCEL_TOKEN
```

**After deploying a new APK/EXE**, bump the server's `APP_LATEST_VERSION` in
`~/chatgram/server/.env` and `pm2 restart all` so installed apps show the
update notice.

---

## Files changed in the repo

**Modified**
- `server/src/server.js` — CORS origin function (allows no-Origin native clients,
  strips trailing slashes, fatal if `CLIENT_URL` missing in prod), `trust proxy 1`,
  `GET /health`, `PORT` default 5000, graceful SIGTERM shutdown, socket ping tuning.
- `server/src/utils/db.js` — `serverSelectionTimeoutMS: 10000`, `maxPoolSize: 10`,
  password-masked URI logging, non-zero exit in production, Atlas-specific hints.
- `server/package.json` / `package-lock.json` — removed 7 unused dependencies
  (incl. `express-status-monitor`, whose native `event-loop-stats` needed a C++
  toolchain); `nodemon` moved to devDependencies. Lock 181 KB → 70 KB.
- `client/lib/server_config.dart` — `API_URL` / `WS_URL` defines, legacy aliases kept.
- `scripts/setup-server.sh` — firewall insertion order fix; non-interactive apt.
- `scripts/duckdns-update.sh` — LF normalised.

**Created**
- `.gitignore` (root), `server/.env.example`, `server/ecosystem.config.js`
- `client/vercel.json`
- `deploy/nginx/chatgram.duckdns.org.conf`
- `deploy/TROUBLESHOOTING.md`, `DEPLOY.md`, `deploy/DEPLOYMENT-LOG.md`
- `scripts/backup-db.sh` (on server)

---

## Server layout

```
/home/ubuntu/chatgram/
├── DEPLOY.md
├── deploy/{nginx,TROUBLESHOOTING.md,DEPLOYMENT-LOG.md}
├── scripts/{setup-server.sh,duckdns-update.sh,backup-db.sh}
└── server/
    ├── .env                (600)
    ├── ecosystem.config.js
    ├── node_modules/       (25 MB)
    └── src/

/etc/chatgram/duckdns.env                    (600 ubuntu:ubuntu)
/etc/nginx/sites-available/chatgram.duckdns.org
/etc/letsencrypt/live/chatgram.duckdns.org/
/home/ubuntu/chatgram-backups/
```
