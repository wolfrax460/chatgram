# Chatgram custom-domain move plan

Status: **plan only — no DNS records, Vercel domains or server env values were
changed during this task.** Everything below is for the owner to execute when the
new domain is chosen.

Current production (2026-10-26):

| Piece | Current value |
|---|---|
| Landing + `/web/` + `/docs/` | `https://chatgram-xi.vercel.app` (Vercel project linked in `client/landing/.vercel/project.json`) |
| API + WebSocket | `https://chatgram.duckdns.org` (`ubuntu@84.12.64.204`, PM2 `chatgram-api`) |
| Web build output | Vercel Build Output API, assembled by `scripts/deploy-web.ps1` (`--prebuilt`) |
| Landing SITE_URL | build-time env var, default `https://chatgram-xi.vercel.app` (see `client/landing/scripts/build.mjs`) |

Example names used below: site `chatgram.example` (apex) + `www.chatgram.example`.
Replace them with the real domain. Keep the API on `chatgram.duckdns.org` for the
first move; moving the API to `api.<domain>` is optional step 9.

## 1. Before touching DNS

1. Confirm the domain is owned by the project owner and the registrar login is
   available.
2. Decide the canonical host: **apex `https://chatgram.example`** is recommended
   (shortest, matches printed links); `www` redirects to it.
3. Record the current Vercel deployment id/URL and `git rev-parse --short HEAD`
   for rollback (`docs/deploy.md` section 5).
4. Do not change `SITE_URL` or the API `CLIENT_URL` before the new host answers
   `200`, otherwise canonical URLs and browser origins point at a dead domain.

## 2. DNS records

Vercel shows the exact target values in **Project → Settings → Domains** when a
domain is added; confirm them there before saving anything at the registrar.

| Host | Type | Value | Purpose |
|---|---|---|---|
| `chatgram.example` (apex) | `A` | `76.76.21.21` | Vercel edge (standard anycast IP; use the value Vercel shows if it differs) |
| `www.chatgram.example` | `CNAME` | `cname.vercel-dns.com` | Vercel edge (per-project/region value must be confirmed in the dashboard) |

Notes:

- If the registrar supports `ALIAS`/`ANAME` at the apex, Vercel accepts
  `cname.vercel-dns.com` there instead of the `A` record.
- Alternatively delegate the whole zone to Vercel nameservers (`ns1.vercel-dns.com`,
  `ns2.vercel-dns.com`) — then no A/CNAME records are needed.
- Keep the existing `chatgram.duckdns.org` record untouched; the API stays there.
- Wait for Vercel to show **Valid Configuration** and issue the TLS certificate
  (usually minutes; DNS propagation can take longer).

## 3. Vercel domain settings

1. Project → **Settings → Domains** → **Add**: `chatgram.example` (production) and
   `www.chatgram.example` → **Redirect to `chatgram.example`** (308).
2. Confirm `chatgram-xi.vercel.app` is still assigned to the project. Set it to
   **Redirect to `chatgram.example`** so old links, posters, installed builds and
   the `/docs` URL keep working. If the dashboard version does not offer a domain
   redirect, add host-based rules to the Build Output `config.json` (owner edit in
   `scripts/deploy-web.ps1`) using the `has: [{ "type": "host", ... }]` condition.
3. Redeploy production **through the documented prebuilt flow** after the domain is
   verified (never a bare `npx vercel --prod` — see `docs/deploy.md`).
4. Verify: `curl.exe -sS -o NUL -w "%{http_code}`n" https://chatgram.example/` →
   `200`; the `www` host → `308` to the apex; `http://` → `https://` redirect
   (Vercel automatic).

## 4. Landing SEO switch (SITE_URL)

The static landing builds canonical, hreflang, OG/Twitter URLs, JSON-LD URLs,
`sitemap.xml` and `robots.txt` from one env var:

```powershell
$env:SITE_URL = 'https://chatgram.example'      # https, no trailing slash, no query
powershell -ExecutionPolicy Bypass -File scripts/deploy-web.ps1
Remove-Item Env:\SITE_URL                        # later shells return to the default
```

`client/landing/scripts/build.mjs` rejects a non-https or malformed `SITE_URL` and
fails the build. If the variable is omitted, the build keeps the current
`https://chatgram-xi.vercel.app` origin, which is useful for a staged deploy.

After the deploy, verify every canonical moved:

```powershell
curl.exe -sS https://chatgram.example/sitemap.xml
curl.exe -sS https://chatgram.example/robots.txt
# sitemap, robots Sitemap: line, canonical, og:url and JSON-LD url/downloadUrl must
# all say https://chatgram.example
```

Also update the `$base` URL used by the deploy script's verification block (owner
edit in `scripts/deploy-web.ps1`) and the production URL table in `docs/deploy.md`.

## 5. CORS and Socket.IO (server env)

`server/src/server.js` builds the allowed browser origins from **`CLIENT_URL`**
(comma-separated, exact origins, no trailing slash; production exits fatally when
it is unset). Add the new hosts while keeping the old one during the transition:

```dotenv
# server/.env  — values are owner-managed; never commit or paste them
CLIENT_URL=https://chatgram.example,https://www.chatgram.example,https://chatgram-xi.vercel.app
```

Then restart the API with the new environment:

```powershell
ssh -i $key ubuntu@84.12.64.204 "cd ~/chatgram/server && pm2 restart chatgram-api --update-env && sleep 3 && pm2 describe chatgram-api | head -20"
```

The same allowlist covers Socket.IO (it shares `originAllowed()`), so test both:
`OPTIONS`/GET from the new origin and a browser WebSocket handshake. Remove the
old `chatgram-xi.vercel.app` origin only after the old host redirects and installed
clients have been updated.

## 6. Cookies and auth sessions

- The admin panel session cookie is `chatgram_admin`: `HttpOnly`, `SameSite=Strict`,
  `Secure` in production, **no `Domain` attribute** (`server/src/admin/auth.js`).
  It is host-only, so it follows the new host automatically **only when the admin
  panel is reached through that host**. Existing admin sessions on the old host do
  not carry over — admins sign in once on the new domain. No server change needed.
- The web app keeps the user access/refresh tokens in browser storage, not in
  cookies, so a host change does not invalidate them; users stay signed in on the
  new host after opening it.
- Keep `/api/*` proxied by the landing deployment on the new host (the prebuilt
  route already does this), so the admin cookie stays first-party and the SSE AI
  stream keeps working. Verify an admin login through the new host after cutover.

## 7. Google sign-in (OAuth redirect URI)

The flow is Google → **API** `/api/auth/google/callback` → client poll
(`server/src/utils/googleOAuth.js`); the landing host is never the OAuth redirect
URI. So:

- **API stays on `chatgram.duckdns.org`** → no change. Keep
  `GOOGLE_REDIRECT_URI=https://chatgram.duckdns.org/api/auth/google/callback`.
- **API moves to `https://api.chatgram.example`** → in Google Cloud Console →
  *APIs & Services → Credentials → OAuth 2.0 Client* add
  `https://api.chatgram.example/api/auth/google/callback` to **Authorized redirect
  URIs**, update `GOOGLE_REDIRECT_URI` in `server/.env`, restart PM2 (step 5), and
  test the popup sign-in on the new host. Do not remove the old URI until the old
  API host is gone.

## 8. Client apps (Capacitor Android + Electron Windows)

These shells load the hosted web app from the landing host and must be updated
and **rebuilt + republished to `/downloads/`** if they should use the new host:

| Thing | File | What to change |
|---|---|---|
| Android shell URL | `apps/mobile/capacitor.config.json` | `server.url` → `https://chatgram.example/web/`, `server.allowNavigation` → add `chatgram.example` (keep the API host) |
| Windows shell URL | `apps/desktop/main.js` | `APP_URL` default → `https://chatgram.example/web/` (or build with `CHATGRAM_URL`), and `WEB_ORIGIN` → `https://chatgram.example` — it drives the release feed (`/api/app/releases`), the `/downloads` update feed, the docs download link and the permission origin checks |
| Web app API base | `apps/web/src/lib/api.ts` | Production build must keep same-origin `/api` (empty `VITE_API_URL`/`VITE_SOCKET_URL`) so the Vercel proxy, admin cookie and CORS stay simple; if it points at a host directly, update `VITE_*` and rebuild `/web/` |

After rebuilding the installers, bump the version, upload the new files to the VM
`/var/www/downloads`, update `latest.yml`, and republish the release feed rows so
the landing Downloads cards and the desktop auto-updater pick them up.

## 9. Optional: move the API to `api.chatgram.example`

Only after step 4 works:

1. DNS: `api.chatgram.example` → `CNAME cname.vercel-dns.com` (Vercel edge) **or**
   an `A` record to `84.12.64.204` with an nginx `server_name` + Let's Encrypt
   certificate on the VM (the VM currently terminates TLS itself for
   `chatgram.duckdns.org`).
2. Update `CLIENT_URL` (step 5), `GOOGLE_REDIRECT_URI` (step 7),
   `VITE_API_URL`/`VITE_SOCKET_URL` in the web build, and the landing prebuilt
   `/api/*` + `/downloads/*` proxy destinations in `scripts/deploy-web.ps1`
   (`https://chatgram.duckdns.org` → the new API host).
3. Keep `chatgram.duckdns.org` serving for installed clients until they are all on
   a build that points at the new host.

## 10. Post-move checklist

- [ ] `https://chatgram.example/` and `/rw/`, `/fr/`, `/sw/`, the four
      `/guides/*.html` pages and `/docs/` all return 200.
- [ ] `https://chatgram.example/sitemap.xml` lists 8 URLs with
      `https://chatgram.example`; `robots.txt` has the matching Sitemap line.
- [ ] Canonical, hreflang, `og:url`, `og:image`, JSON-LD URLs use the new origin.
- [ ] Old host redirects to the new host (301/308), and `/web/` still returns the
      app, `/web/admin` the admin gate.
- [ ] `/api/status/health` and a POST login forward through the new host.
- [ ] Admin login through the new host sets the cookie and the SSO/CSRF flows work.
- [ ] Google sign-in popup completes; API CORS preflight from the new origin passes.
- [ ] Android + Windows builds (downloaded from the new host) load the new host and
      update correctly; upload fresh installers + `latest.yml`.
- [ ] Add the new property in Google Search Console / Bing Webmaster, submit the
      new sitemap, keep the old property with **Change of Address** for the
      `chatgram-xi.vercel.app` property.
- [ ] Update `docs/deploy.md` and the deploy-script verification URLs; rollback is
      the previous Vercel deployment + previous domain redirects if needed.
- [ ] Still outstanding in the build config (owner edit, outside this task's write
      scope): add `X-Robots-Tag: noindex` for `/web`, `/web/(.*)` and `/api/(.*)`
      to the Build Output `config.json` in `scripts/deploy-web.ps1`, and replace
      the catch-all `{ "src": "/(.*)", "dest": "/index.html" }` with
      `{ "src": "/(.*)", "dest": "/404.html", "status": 404 }` so unknown paths
      return the new branded 404 page with a real 404 status.
