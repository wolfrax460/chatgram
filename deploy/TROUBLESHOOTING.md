# Chatgram — Troubleshooting

Work top-down: most "it doesn't work" reports are one of the first four.

---

## Quick triage

Run these three, in order, and note exactly which one fails first.

```bash
# 1. Is the Node process alive? (on the VM)
pm2 status
pm2 logs chatgram-api --lines 50 --nostream

# 2. Is the API answering locally, bypassing nginx? (on the VM)
curl -s http://127.0.0.1:5000/health

# 3. Is it answering through nginx/TLS? (from your PC)
curl -s https://chatgram.duckdns.org/health
```

| #1 | #2 | #3 | Problem is |
|---|---|---|---|
| ❌ | ❌ | ❌ | The app isn't running → PM2 / .env / Atlas |
| ✅ | ❌ | ❌ | App running but not on :5000 → PORT mismatch |
| ✅ | ✅ | ❌ | nginx, TLS, or firewall → sections 2 and 3 |
| ✅ | ✅ | ✅ | Backend fine → the issue is CORS or the frontend |

---

## 1. SSH times out or is refused

**Connection times out (no prompt at all)** — the packet never reached the VM:

1. **Route table** — VCN → Route Tables → Default → must contain
   `0.0.0.0/0 → Internet Gateway`. Without it the VM has no outbound/inbound
   internet path and *everything* fails.
2. **Internet Gateway exists** — VCN → Internet Gateways. If missing, create one
   and attach it to the route table.
3. **Security List** — must allow inbound TCP **22** from `0.0.0.0/0`.
   Check both the Security List *and* any Network Security Group attached to
   the VNIC.
4. **Public IP present** — Instance details → Attached VNICs. If "Public IP
   address" is empty, assign an ephemeral or reserved public IP.
5. **Subnet is public** — a subnet is "public" only when its route table points
   at an Internet Gateway.

**`Permission denied (publickey)`** — you reached the machine but auth failed:

- Wrong **user**. Ubuntu images → `ubuntu`. Oracle Linux → `opc`.
- Wrong **key**. It must match the public key added at instance creation.
  Check the fingerprint in the console vs `ssh-keygen -lf <key>`.
- **Windows key permissions** (very common):
  ```powershell
  icacls "<path-to-key>" /inheritance:r /grant:r "$($env:USERNAME):(R)"
  ```
- Key path has **spaces** → keep it quoted:
  ```powershell
  ssh -i "C:\Users\mugis\Downloads\...\ssh-key-2026-10-19.key" ubuntu@84.12.64.204
  ```
  (Note the space between the key and `ubuntu@`. Omitting it gives
  `no such file or directory`.)

**Host key changed** after recreating the instance:
```powershell
ssh-keygen -R 84.12.64.204
```

---

## 2. Ports 80 / 443 unreachable

There are **two independent firewalls** on Oracle Cloud. Both must allow it.

**Layer 1 — VCN Security List (cloud)**
Networking → VCN → Security Lists → Default:
- `0.0.0.0/0` → TCP **80**
- `0.0.0.0/0` → TCP **443**

Confirm from your PC:
```powershell
Test-NetConnection chatgram.duckdns.org -Port 80
Test-NetConnection chatgram.duckdns.org -Port 443
```

**Layer 2 — the VM's own iptables (OS)**
Oracle's Ubuntu images ship with rules that allow only SSH. `setup-server.sh`
fixes this, but verify:

```bash
sudo iptables -L INPUT -n --line-numbers
```

You need `ACCEPT tcp dpt:80` and `dpt:443` **above** any `REJECT`/`DROP` line.

If they are missing:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

> `netfilter-persistent save` is what makes it survive a reboot. Without it the
> ports close again after every restart.

**nginx not listening**:
```bash
sudo systemctl status nginx
sudo ss -tlnp | grep -E ':80|:443'
sudo nginx -t
```

---

## 3. certbot fails

**`Timeout during connect (likely firewall problem)`**
Port 80 is not reachable from the internet. Fix section 2 first. certbot needs
plain HTTP.

**`DNS problem: NXDOMAIN` / wrong IP**
DNS has not propagated, or DuckDNS is stale:
```powershell
nslookup chatgram.duckdns.org
```
Must return `84.12.64.204`. If not, run `scripts/duckdns-update.sh` on the VM
(or update at duckdns.org) and **wait a few minutes**. Do not hammer certbot —
Let's Encrypt has strict rate limits (5 failures per hostname per hour).

**`too many failed authorizations` / rate limit**
Stop trying and wait an hour. Repeated identical failures do not fix themselves.

**DuckDNS rate limiting**
DuckDNS throttles abusive update frequency. If you have a cron running every
minute, reduce it to every **5 minutes** (the supplied script does this).

**Fallback — DNS-01 challenge** (works even when port 80 is blocked):
```bash
sudo certbot certonly --manual --preferred-challenges dns -d chatgram.duckdns.org
```
It prints a `_acme-challenge.chatgram.duckdns.org` TXT value. Add it as a TXT
record in DuckDNS (DuckDNS supports `txt=` in its update URL), wait, then
press Enter. Manual DNS-01 needs repeating every 90 days — prefer fixing HTTP-01.

**Fallback — Caddy** (automatic HTTPS, simpler than nginx+certbot):
```bash
# replace nginx entirely
sudo apt install -y caddy
# /etc/caddy/Caddyfile
# chatgram.duckdns.org {
#     reverse_proxy 127.0.0.1:5000
# }
sudo systemctl reload caddy
```
Caddy obtains and renews certificates automatically and handles WebSocket
upgrades with no extra configuration.

---

## 4. Atlas: `connection timed out` / `Server selection timed out after 10000 ms`

Almost always **Network Access**.

1. Atlas → **Network Access** → is `84.12.64.204/32` listed?
2. Has your VM's public IP changed? Ephemeral IPs change when an instance is
   **stopped and started** (not on reboot). Check:
   ```bash
   curl -s https://ifconfig.me
   ```
   If it differs from what is in Atlas, add the new `/32`.
3. Is the M0 cluster **paused**? Free clusters pause after long inactivity.
   Open the Atlas UI and resume it.
4. Test connectivity from the VM — this distinguishes DNS, routing and auth:
   ```bash
   # DNS resolving?
   getent hosts cluster0.6ik0wiw.mongodb.net
   # TCP reachable?
   nc -zv cluster0.6ik0wiw.mongodb.net 27017
   ```
   `nc` failing = network/IP allow-list. `nc` succeeding but Node failing = auth.

> To verify the VM side independently, run a throwaway check:
> ```bash
> cd ~/chatgram/server && node -e "
> require('dotenv').config();
> const m=require('mongoose');
> m.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000})
>  .then(()=>{console.log('OK');return m.disconnect();})
>  .catch(e=>{console.error('FAIL',e.message);process.exit(1);});"
> ```

---

## 5. Atlas: `bad auth : Authentication failed`

1. **Wrong password** — reset it in Atlas → Database Access → Edit user.
2. **Unencoded special characters.** The URI is not plain text; these must be
   percent-encoded:

   | Character | Encode as |
   |---|---|
   | `@` | `%40` |
   | `:` | `%3A` |
   | `/` | `%2F` |
   | `?` | `%3F` |
   | `#` | `%23` |
   | `[` `]` | `%5B` `%5D` |
   | `%` | `%25` |

   Example: password `p@ss:w0rd` → `p%40ss%3Aw0rd`.
   **Simplest fix:** set a password using only letters and digits.
3. **User is in the wrong project/cluster** — confirm the user exists on *this*
   cluster (M0 clusters are per-project).
4. **Database name missing** — the URI must end with `/chatgram` before the `?`.
5. **`.env` not loaded** — confirm `MONGODB_URI` has no surrounding quotes and
   no trailing spaces:
   ```bash
   grep MONGODB_URI .env | sed 's/:[^:@]*@/:****@/'
   ```

---

## 6. CORS errors in the browser

Symptom: `Access to fetch ... has been blocked by CORS policy` or
`No 'Access-Control-Allow-Origin' header`.

Server log shows `CORS: blocked origin https://...`. The cause is always a
`CLIENT_URL` mismatch. Compare **character by character**:

| Wrong | Why |
|---|---|
| `https://x.vercel.app/` | **trailing slash** |
| `http://x.vercel.app` | must be `https` |
| `https://x-git-main-user.vercel.app` | that's a **preview** URL, not production |
| `x.vercel.app` | missing scheme |
| several URLs separated by spaces | separator must be a comma |

Fix on the VM:
```bash
cd ~/chatgram/server
nano .env            # CLIENT_URL=https://exactly-this.vercel.app
pm2 restart all
```

Verify what the server thinks it allows:
```bash
pm2 logs chatgram-api --lines 20 --nostream | grep -i origin
```

> Native **Android/Windows** apps send no `Origin` header and are always
> allowed — if only the browser fails, this is a `CLIENT_URL` problem, not a
> firewall one.

Also confirm the exact origin from the browser console on the Vercel site:
```js
location.origin
```

---

## 7. Mixed content / `ws://` blocked

Symptoms:
- `Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an insecure resource 'http://...'`
- `SecurityError: Failed to construct 'WebSocket': ... wss`

The frontend is HTTPS, so **both** API and socket URLs must be
`https://` / `wss://`.

**Most likely cause: the build used the wrong `--dart-define`.**

```powershell
flutter build web --release --dart-define=API_URL=https://chatgram.duckdns.org --dart-define=WS_URL=wss://chatgram.duckdns.org
```

Note `wss://` for `WS_URL` — not `https://`, and not `ws://`.

Verify in the deployed bundle (DevTools → Network): every `socket.io` request
must be `wss://chatgram.duckdns.org`.

Also make sure `GOOGLE_REDIRECT_URI` uses `https://`, or Google sign-in will
bounce to an insecure redirect.

---

## 8. Socket disconnects after ~60 seconds

nginx's default `proxy_read_timeout` is **60s**. An idle WebSocket is killed and
the client reconnects in a loop.

Required in the nginx `location /` block:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;   # "upgrade" on upgrade requests
proxy_read_timeout 86400s;
proxy_send_timeout 86400s;
```

(`$connection_upgrade` comes from the `map` at the top of the supplied config.
Hardcoding `Connection "upgrade"` also works but breaks plain keep-alive
requests.)

Apply:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Confirm the upgrade actually happened (DevTools → Network → the `socket.io`
request should be **101 Switching Protocols**, not 200).

A **200** means nginx stripped the upgrade headers, or you are connecting
through something else that does (Cloudflare must be in DNS-only/grey-cloud
mode, or have WebSockets enabled).

---

## 9. Vercel: 404 or blank page on refresh

`https://x.vercel.app` works, but refreshing `/chat/abc` gives 404.

The SPA rewrite is missing. `vercel.json` must be **inside `build/web`** before
you deploy:

```powershell
cd F:\projects\chatgram\client
Copy-Item .\vercel.json .\build\web\vercel.json
cd build\web
vercel --prod
```

Contents:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

**Blank page (no 404).** Usually the app loaded but crashed, or it cannot reach
the API. Open DevTools → Console. Common causes:
- wrong `API_URL` baked in at build time
- CORS (section 6)
- `flutter_bootstrap.js` 404 → the upload was incomplete; re-run `vercel --prod`

---

## 10. Node gets killed on the VM (out of memory)

The VM is small. Check:

```bash
free -h
pm2 logs chatgram-api --lines 50 --nostream | grep -i -E "heap|memory|killed"
dmesg -T | grep -i "out of memory" | tail -5
```

**Confirm swap exists:**
```bash
swapon --show
free -h
```
If no swap, re-run `scripts/setup-server.sh` (it creates a 2 GB swapfile).

**Watch for accidental memory hogs:**

| Cause | Fix |
|---|---|
| `npm install` instead of `npm ci --omit=dev` | dev deps + build tooling not installed |
| Flutter build attempted on the VM | never — build on your PC |
| MongoDB installed on the VM | must not be — use Atlas |
| PM2 cluster mode | must be `instances: 1`, `exec_mode: 'fork'` |
| `max_memory_restart` too high | keep `500M` in `ecosystem.config.js` |

After any pm2 config change:
```bash
pm2 delete chatgram-api
pm2 start ecosystem.config.js
pm2 save
```

---

## 11. Flutter still calls localhost

If the deployed site talks to `http://localhost:5000` (or `10.0.2.2`), the
`--dart-define` flags were omitted — `String.fromEnvironment` is resolved at
**compile time**, so editing code or restarting does nothing.

Rebuild:

```powershell
flutter build web --release --dart-define=API_URL=https://chatgram.duckdns.org --dart-define=WS_URL=wss://chatgram.duckdns.org
```

Then **clean** to be certain (Flutter caches aggressively):

```powershell
flutter clean
flutter pub get
flutter build web --release --dart-define=...
```

Verify before uploading:
```powershell
Select-String -Path .\build\web\main.dart.js -Pattern "chatgram.duckdns.org" -Quiet
```
Must return `True`. If it returns `False`, the defines did not apply.

> Note: the client also supports the older names `API_BASE_URL` / `SOCKET_URL`
> for backwards compatibility. If both are supplied, `API_URL` / `WS_URL` win.

---

## 12. Miscellaneous

**`npm ci` fails: lockfile out of sync**
```bash
# on your PC, then commit and push
cd server && npm install --package-lock-only
```

**PM2 does not restart after reboot** — the `pm2 startup` command must be run:
```bash
pm2 startup            # prints a sudo command
# copy and run exactly what it prints
pm2 save
```

**`git pull` asks for a password** — use a Personal Access Token, or add a
deploy key. GitHub disabled password auth for git.

**Changes to `.env` have no effect** — PM2 keeps the old environment:
```bash
pm2 restart all --update-env
```

**Disk full**
```bash
df -h
du -sh ~/chatgram/server/uploads
```
Uploads are the usual culprit (see DEPLOY.md § Media).

**Check the server is using the right Node**
```bash
which node && node -v
pm2 describe chatgram-api | grep -E "script path|exec cwd|node"
```
