# Chatgram — Deployment Guide

Follow these in order. Every command is copy-pasteable. Nothing here has been
run against your servers yet — this is the checked-in preparation only.

---

## What you are building

```
   Your PC                          Internet
   ────────                         ────────
   Flutter web build  ──vercel──▶  https://<project>.vercel.app   (static, HTTPS)
                                          │
                                          │  REST + Socket.IO over HTTPS/WSS
                                          ▼
                              https://chatgram.duckdns.org  ──▶  84.12.64.204
                                          │
                                    ┌─────┴─────┐
                                    │   nginx   │ :80 / :443  (TLS via certbot)
                                    └─────┬─────┘
                                          │ http://127.0.0.1:5000
                                    ┌─────┴─────┐
                                    │  Node API │  PM2, 1 process
                                    └─────┬─────┘
                                          │ mongodb+srv (TLS)
                                          ▼
                              MongoDB Atlas M0 (512 MB) — not on the VM
```

**Why the frontend is on Vercel and not nginx:** the VM has 1 GB RAM and a
fraction of a CPU. Building Flutter there would fail or take forever, and
serving static files from the same small VM wastes its bandwidth. Vercel serves
the static bundle for free over HTTPS with a global CDN. nginx on the VM only
proxies the API and WebSocket traffic.

**Why the backend needs HTTPS:** the Vercel site is HTTPS. A browser will
refuse to call `http://` or `ws://` from an HTTPS page (mixed content), and
`getUserMedia` for voice notes requires a secure context. Hence certbot.

---

## Before you start — you need

- [ ] Oracle VM created, running, with a **public IP `84.12.64.204`**
- [ ] VCN Security List allows inbound TCP **22, 80, 443** from `0.0.0.0/0`
- [ ] DuckDNS record `chatgram` → `84.12.64.204`
- [ ] MongoDB Atlas **M0** cluster `cluster0.6ik0wiw.mongodb.net`
- [ ] The SSH **private key** file on your PC
- [ ] A Vercel account
- [ ] This repository pushed to GitHub (private is fine)

> ⚠️ **Confirm the VM shape.** You pasted a review page showing
> `VM.Standard.A1.Flex 1 OCPU / 6 GB` (ARM), but the architecture notes say
> `VM.Standard.E2.1.Micro 1 OCPU / 1 GB` (x86). Both work with these files —
> `setup-server.sh` detects the architecture — but the 1 GB micro is much
> tighter. Check **Compute → Instances → Shape** before continuing.

---

## A. MongoDB Atlas

1. Open <https://cloud.mongodb.com> → your **M0** cluster.
2. **Database Access → Add New Database User**
   - Username: `wolfrax`
   - Password: pick a **simple** one (letters + digits only). If you must use
     special characters, they have to be percent-encoded in the URI:
     `@`→`%40`, `:`→`%3A`, `/`→`%2F`, `?`→`%3F`, `#`→`%23`, `[`→`%5B`, `]`→`%5D`, `%`→`%25`.
   - Role: **Read and write to any database** (or `readWrite` on `chatgram`).
3. **Network Access → Add IP Address** → `84.12.64.204/32`
   > Use the **exact /32**, not `0.0.0.0/0`. If your VM's IP changes
   > (ephemeral IP), you must update this — see TROUBLESHOOTING.
4. **Database → Create Database** → name `chatgram`, collection `messages`
   (any collection; it just creates the DB).
5. **Connect → Drivers** → copy the string and build the final URI:

```
mongodb+srv://wolfrax:YOUR_PASSWORD@cluster0.6ik0wiw.mongodb.net/chatgram?retryWrites=true&w=majority
```

Write it in a scratch note. **Do not commit it.**

---

## B. Oracle — reach the VM

### B1. Confirm the network path exists

Console → **Networking → Virtual Cloud Networks → your VCN**:

- **Internet Gateways**: at least one exists (e.g. `chatgram`).
- **Route Tables → Default Route Table**: has a rule
  `0.0.0.0/0 → Internet Gateway`. **Without this, the VM has no internet
  route at all** and SSH will time out even with ports open.
- **Security Lists / NSG**: inbound `0.0.0.0/0` on TCP 22, 80, 443.

### B2. SSH in

> ⚠️ Your pasted command was missing a space before `ubuntu@`. Also, the key
> path contains spaces, so it must stay quoted.

**PowerShell on your PC:**

```powershell
ssh -i "C:\Users\mugis\Downloads\mugisha recovery codes for github 8\chatgram recovery keys\ssh-key-2026-10-19.key" ubuntu@84.12.64.204
```

Windows OpenSSH refuses keys that other users can read. If you see
`UNPROTECTED PRIVATE KEY FILE`, fix it once:

```powershell
icacls "C:\Users\mugis\Downloads\mugisha recovery codes for github 8\chatgram recovery keys\ssh-key-2026-10-19.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Then retry the `ssh` command.

> Ubuntu images use the user **`ubuntu`**. Oracle Linux images use **`opc`**.
> If you picked Ubuntu 24.04, `ubuntu` is correct.

---

## C. DuckDNS — verify BEFORE certbot

certbot's HTTP-01 challenge fails if DNS has not propagated yet. Check first:

```powershell
nslookup chatgram.duckdns.org
```

Expected: it resolves to **84.12.64.204**.

If it is wrong, update DuckDNS (from your PC, or run
`scripts/duckdns-update.sh` on the VM after step D). **Do not run certbot
until this returns the right IP.**

---

## D. On the VM — set up and start the API

Still inside the `ssh` session:

### D1. Clone

```bash
cd ~
git clone https://github.com/<your-username>/chatgram.git
cd chatgram
```

If the repo is private, use a GitHub Personal Access Token:
`git clone https://<token>@github.com/<user>/chatgram.git`

### D2. System setup

```bash
chmod +x scripts/*.sh
./scripts/setup-server.sh
```

This installs git/nginx/certbot/Node LTS/PM2, creates a 2 GB swap file, and
opens ports 80/443 **in the OS firewall** (Oracle's Ubuntu image blocks them
even when the VCN allows them). Safe to re-run.

### D3. Create `.env`

```bash
cd ~/chatgram/server
cp .env.example .env
nano .env
```

Fill in at minimum:

```ini
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://wolfrax:YOUR_PASSWORD@cluster0.6ik0wiw.mongodb.net/chatgram?retryWrites=true&w=majority
JWT_SECRET=<paste a generated value>
JWT_REFRESH_SECRET=<paste a DIFFERENT generated value>
CLIENT_URL=https://<your-project>.vercel.app
REQUIRE_VERIFICATION=true
DEV_SHOW_CODES=false
EMAIL_PROVIDER=smtp
SMTP_USER=<your gmail>
SMTP_PASS=<app password>
MAIL_FROM=Chatgram <your gmail>
GOOGLE_REDIRECT_URI=https://chatgram.duckdns.org/api/auth/google/callback
```

Generate the two secrets (run twice, use different values):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **`CLIENT_URL` is not known yet** if you have not deployed to Vercel. Put a
> placeholder, finish steps E–F, then come back and set the real URL in step G.

Lock the file down:

```bash
chmod 600 .env
```

### D4. Install dependencies and start

```bash
cd ~/chatgram/server
npm ci --omit=dev
```

> `--omit=dev` is important: dev-only packages (`nodemon`, the test client) are
> not installed on a 1 GB box. Use `npm ci` (not `npm install`) so the
> lockfile is honoured exactly.

> If `npm ci` fails because `package-lock.json` is out of date, run
> `npm install --package-lock-only` **on your PC**, commit the lockfile, and
> pull again on the server.

```bash
pm2 start ecosystem.config.js
pm2 logs chatgram-api --lines 40
```

Look for `MongoDB Connected: ...` and `Chatgram API listening on port 5000`.
Press `Ctrl+C` to stop following logs (the process keeps running).

```bash
pm2 save
pm2 startup
```

`pm2 startup` prints **one command** starting with `sudo env PATH=...`. Copy and
run that exact command — it makes PM2 start on boot.

Smoke test locally (on the VM, bypassing nginx):

```bash
curl -s http://127.0.0.1:5000/health
# → {"status":"ok"}
```

---

## E. nginx + HTTPS

### E1. Install the site config

```bash
sudo cp ~/chatgram/deploy/nginx/chatgram.duckdns.org.conf \
        /etc/nginx/sites-available/chatgram.duckdns.org
sudo ln -sf /etc/nginx/sites-available/chatgram.duckdns.org \
            /etc/nginx/sites-enabled/chatgram.duckdns.org
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` must print `syntax is ok` / `test is successful`. If it fails, do
not proceed.

Check plain HTTP works **before** TLS:

```powershell
# from your PC
curl http://chatgram.duckdns.org/health
```

Expect `{"status":"ok"}`. If this fails, certbot will also fail — fix it first
(see TROUBLESHOOTING).

### E2. Get the certificate

```bash
sudo certbot --nginx -d chatgram.duckdns.org
```

- Enter your email when asked.
- Accept the terms.
- **Choose "Redirect"** when asked about HTTP→HTTPS redirect.

certbot edits the nginx file itself, adding the `listen 443 ssl` block and the
redirect. Do not hand-edit TLS sections.

Verify renewal works (do this now, not in 90 days):

```bash
sudo certbot renew --dry-run
```

---

## F. Verify end to end

```powershell
# 1. Health over HTTPS
curl https://chatgram.duckdns.org/health
# → {"status":"ok"}

# 2. API reachable
curl https://chatgram.duckdns.org/api/config
```

Then:

3. **WebSocket** — open <https://<your-project>.vercel.app> (after step G), sign
   in on two devices, and send a message. It should arrive without a refresh.
4. **Database** — the login working at all proves Atlas is connected.
5. **Uploads** — send a photo; it should appear and be re-downloadable.

From a browser console on the Vercel site you can confirm the socket URL:

```js
// should print wss://chatgram.duckdns.org/socket.io/...
performance.getEntriesByType('resource').filter(e => e.name.includes('socket')).map(e => e.name)
```

---

## G. Frontend on Vercel

The Flutter bundle is built **on your PC**, never on the server or on Vercel.

### G1. Build

**PowerShell, in `F:\projects\chatgram\client`:**

```powershell
flutter build web --release `
  --dart-define=API_URL=https://chatgram.duckdns.org `
  --dart-define=WS_URL=wss://chatgram.duckdns.org
```

Single-line form:

```powershell
flutter build web --release --dart-define=API_URL=https://chatgram.duckdns.org --dart-define=WS_URL=wss://chatgram.duckdns.org
```

### G2. Add the SPA rewrite (prevents 404 on refresh)

```powershell
Copy-Item .\vercel.json .\build\web\vercel.json
```

### G3. Deploy

```powershell
cd build\web
vercel --prod
```

First run asks you to log in and link a project. When it finishes it prints the
production URL, e.g. `https://chatgram-abc123.vercel.app`.

> Vercel must **not** run a build. This is a plain static upload — no
> `package.json`, no framework preset. If Vercel tries to build, set
> **Framework Preset: Other** and **Build Command: (empty)** in project
> settings.

### G4. Tell the backend the real frontend URL

Back on the VM:

```bash
cd ~/chatgram/server
nano .env        # set CLIENT_URL=https://chatgram-abc123.vercel.app
pm2 restart all
```

Then reload the Vercel site. **CORS errors here mean `CLIENT_URL` is wrong** —
it must be `https`, no trailing slash, and the *production* URL (not a preview).

### G5. Android

```powershell
flutter build apk --release `
  --dart-define=API_URL=https://chatgram.duckdns.org `
  --dart-define=WS_URL=wss://chatgram.duckdns.org
```

`INTERNET` permission is already declared in
`client/android/app/src/main/AndroidManifest.xml`. The release APK uses
https/wss, so no cleartext exception is needed — though the manifest still
permits cleartext for LAN testing (see Risks in the final report).

---

## H. Updating later

**Backend:**

```bash
cd ~/chatgram
git pull
cd server
npm ci --omit=dev
pm2 restart all
```

**Frontend:** rebuild on your PC (G1) and `vercel --prod` again. No server work.

**Before any schema change:** take a backup (step I).

---

## I. Backups

Atlas **M0 has no automated backups**. Do this from your PC.

### Install the tools once

Download MongoDB Database Tools:
<https://www.mongodb.com/try/download/database-tools> — or if you have MongoDB
installed locally, `mongodump` is often already on PATH:

```powershell
mongodump --version
```

### Dump

```powershell
$stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
mongodump --uri="mongodb+srv://wolfrax:YOUR_PASSWORD@cluster0.6ik0wiw.mongodb.net/chatgram" `
          --out="F:\backups\chatgram\$stamp"
```

### Restore

```powershell
mongorestore --uri="mongodb+srv://wolfrax:YOUR_PASSWORD@cluster0.6ik0wiw.mongodb.net/chatgram" `
             --drop "F:\backups\chatgram\2026-10-19-0930\chatgram"
```

`--drop` replaces existing collections — it is destructive, use deliberately.

**Do this weekly, and after any big change.** Also note: uploaded media files
are **not** in the database (see below), so a dump alone does not restore images.

---

## ⚠️ Media storage — DECISION NEEDED (not implemented)

This is the one part of your spec I deliberately did **not** change, because you
asked to confirm first.

**Current behaviour:** avatars, chat images/videos/voice notes and status images
are written by multer to `server/uploads/` on the VM's boot volume, and served
at `/uploads/...`.

**Where it breaks:**

| Risk | Impact |
|---|---|
| Boot volume lost / instance terminated | **All media gone.** `mongodump` does not help — it only backs up the database. |
| Rebuilt from scratch | Same — media is not in git, not in Atlas. |
| Disk fills (50 GB default) | Uploads start failing with 500s. |
| Multiple instances / resizing | Media is local to one VM, cannot scale. |

**It does NOT break on**: ordinary reboot, `pm2 restart`, `git pull`, or nginx
reload — the boot volume is persistent, so this is far safer than a Render/Railway
container. It is genuinely acceptable for a small private deployment.

**Options if you want durability:**

1. **Oracle Object Storage** (Free tier includes 20 GB) — closest to your
   infrastructure, no third-party account. Needs `@aws-sdk/client-s3` (OCI is
   S3-compatible) and a bucket + auth keys.
2. **Cloudinary free tier** (~25 GB) — least code: upload the buffer, store the
   returned URL. Simplest to implement, but requires an account and has usage
   limits/transformations.

Either way the change is confined to `server/src/controllers/messageController.js`,
`userController.js`, `statusController.js` and `utils/upload.js` — the DB stores
a URL string, so **existing rows keep working** if the URL stays absolute.

**Tell me which one and I will implement it.** Until then, take a manual copy of
`~/chatgram/server/uploads` as part of your backup routine:

```bash
# from your PC
scp -i "<key>" -r ubuntu@84.12.64.204:~/chatgram/server/uploads "F:\backups\chatgram-uploads"
```

---

## Environment variable reference

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | ✅ | `production` on the server |
| `PORT` | ✅ | `5000`; nginx proxies to it |
| `MONGODB_URI` | ✅ | Atlas URI incl. `/chatgram` |
| `JWT_SECRET` | ✅ | 48-byte hex; app warns if default |
| `JWT_REFRESH_SECRET` | ✅ | different value |
| `CLIENT_URL` | ✅ | exact Vercel origin, https, no trailing slash |
| `REQUIRE_VERIFICATION` | recommended | `true` |
| `DEV_SHOW_CODES` | ✅ | **must be `false`** in production |
| `EMAIL_PROVIDER` + `SMTP_*` | for signup | else no verification emails |
| `GOOGLE_*` | optional | redirect URI must be the HTTPS one |
| `UPLOAD_DIR` | optional | defaults to `server/uploads` |
| `MAX_FILE_SIZE` | optional | bytes; keep nginx `client_max_body_size` ≥ this |
| `APP_LATEST_VERSION` | optional | version tracking |
