# Cloudinary setup — store media outside the VM

**Why:** right now avatars, chat photos, videos and voice notes are written to
`/home/ubuntu/chatgram/server/uploads` on the Oracle VM. That survives reboots,
but it is **not** in your database backups and it is **gone** if the instance is
lost or rebuilt. Cloudinary moves that media to a CDN, so it outlives the server.

**Good news:** the code already supports this. You do **not** need to change any
code — you add three environment variables and restart. Until you do, the app
keeps using local disk exactly as it does now.

---

## Part 1 — Create the Cloudinary account (5 minutes)

1. Go to **<https://cloudinary.com/users/register_free>**
2. Sign up (Google sign-in works).
3. Verify your email if prompted.
4. You land on the **Dashboard**. Note the **Product Environment Credentials**
   panel. You need three values:

   | Field in dashboard | Goes into |
   |---|---|
   | **Cloud name** | `CLOUDINARY_CLOUD_NAME` |
   | **API Key** | `CLOUDINARY_API_KEY` |
   | **API Secret** | `CLOUDINARY_API_SECRET` |

   > The API secret is hidden behind a copy button — this is a real secret.
   > Never commit it, never paste it into a chat.

5. Free plan limits: **25 GB storage / 25 GB monthly bandwidth / 25k
   transformations**. For a small chat app that is a lot of headroom.

### Recommended: create an upload folder

Cloudinary will auto-create it, but to keep things tidy:

1. Left sidebar → **Media Library**
2. **New folder** → `chatgram`
3. That's the value for `CLOUDINARY_FOLDER` (default is already `chatgram`).

---

## Part 2 — Put the credentials on the server

SSH in:

```powershell
ssh -i "C:\Users\mugis\Downloads\mugisha recovery codes for github 8\chatgram recovery keys\ssh-key-2026-10-19.key" ubuntu@84.12.64.204
```

Edit the env file:

```bash
nano ~/chatgram/server/.env
```

Find the uploads section and fill in the three values:

```ini
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your-api-secret
CLOUDINARY_FOLDER=chatgram
```

Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

The file is already `chmod 600`, so it stays private.

---

## Part 3 — Install the SDK and restart

```bash
cd ~/chatgram/server
npm ci --omit=dev
pm2 restart all --update-env
```

> `--update-env` matters: PM2 caches the environment from when the process
> started. Without it the new variables are ignored.

Check it started cleanly:

```bash
pm2 logs chatgram-api --lines 20 --nostream
curl -s http://127.0.0.1:5000/health; echo
```

You want `{"status":"ok"}` and no `Cloudinary` errors.

---

## Part 4 — Verify it actually works

1. Open **<https://chatgram-xi.vercel.app/app/>** and sign in.
2. Change your profile picture (Settings → tap your avatar).
3. Send a photo in a chat.
4. Go back to the Cloudinary **Media Library** — you should see:

```
chatgram/
  avatars/     <- your new avatar
  media/       <- the photo you sent
```

5. In the app, the image should load. If you open the image URL it will be an
   absolute `https://res.cloudinary.com/<cloud>/...` link.

**Confirm nothing is hitting disk any more:**

```bash
ls -la ~/chatgram/server/uploads/media | tail -5
```

New uploads should **not** appear there after the change (old files will still
be present — see Part 5).

---

## Part 5 — Migrating old media (optional)

Anything uploaded **before** you switched stays on the VM's disk and keeps
working: the database still holds old-style `/uploads/...` paths, and the server
still serves that directory. Nothing breaks.

If you want to move them to Cloudinary too:

```bash
cd ~/chatgram/server
# 1. copy the folder down to your PC as a backup first
#    (from your PC)
scp -i "<key>" -r ubuntu@84.12.64.204:~/chatgram/server/uploads F:\projects\chatgram\backups\uploads
```

Then either:

- **Leave them.** Simplest and perfectly fine — old media stays served from the
  VM, new media goes to Cloudinary.
- **Migrate** with Cloudinary's CLI:
  ```bash
  npm install -g cloudinary-cli
  cld sync -c <cloud-name> -k <api-key> -s <api-secret> ~/chatgram/server/uploads
  ```
  This needs the database URLs rewritten afterwards, which is fiddly. **Only do
  this if the old files matter.** For a fresh deployment there is nothing to
  migrate.

---

## Part 6 — Rollback

Delete (or empty) the three `CLOUDINARY_*` values and restart:

```bash
pm2 restart all --update-env
```

Uploads go back to local disk immediately. Media already on Cloudinary keeps
working, because the database stores full URLs for those rows.

---

## How it works internally (for reference)

| File | Role |
|---|---|
| `server/src/utils/storage.js` | Chooses Cloudinary vs disk; uploads the buffer; returns the URL to store |
| `server/src/utils/upload.js` | Uses `multer.memoryStorage()` when Cloudinary is configured, `diskStorage` otherwise |
| `server/src/controllers/messageController.js` | Calls `persistUpload()` and returns the resulting URL |
| `server/src/controllers/userController.js` | Same, for avatars |

Resource types are mapped so Cloudinary handles each file correctly:

| MIME | Cloudinary `resource_type` |
|---|---|
| `image/*` | `image` |
| `video/*` | `video` |
| `audio/*` (voice notes) | `video` |
| anything else (PDF, DOCX…) | `raw` |

The database stores an **absolute URL** for Cloudinary files and a
**server-relative** `/uploads/...` path for local files. The Flutter client
already handles both (`ServerConfig.resolveMedia` passes absolute URLs through
unchanged), so no client rebuild is needed.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cloudinary is configured in .env but the "cloudinary" package is not installed` | Run `npm ci --omit=dev` on the server |
| Uploads still land in `server/uploads` | You restarted with `pm2 restart all` but forgot `--update-env` |
| `Invalid cloud_name` / 401 from Cloudinary | Wrong cloud name or API secret |
| Uploads fail with `413` | File bigger than nginx `client_max_body_size` (25 MB) or `MAX_FILE_SIZE` |
| Images upload but don't display | Check the URL starts with `https://res.cloudinary.com/`. If it starts with `/uploads/`, Cloudinary is not enabled |
| `Request entity too large` for video | Raise `client_max_body_size` in nginx **and** `MAX_FILE_SIZE` in `.env`, then reload both |

Check the active mode at any time:

```bash
cd ~/chatgram/server
node -e "console.log('cloudinary enabled:', require('./src/utils/storage').isEnabled())"
```
