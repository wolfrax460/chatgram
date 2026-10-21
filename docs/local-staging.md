# Local staging stack

Everything in this document runs **locally only**. It never touches the production
database, Cloudinary, Telegram or SMTP. Use it for every integration/Playwright
test (production data must never be used for tests).

## What runs

| Piece | URL | Notes |
|---|---|---|
| MongoDB | `127.0.0.1:27017` | Windows service (already running). Database name: `chatgram_staging`. |
| API | `http://127.0.0.1:5000` | started by `scripts/start-staging.ps1`. |
| Web | `http://localhost:5174` | Vite dev server (`npm run dev -w @chatgram/web`) with `VITE_API_URL=http://127.0.0.1:5000`. |

The staging script overrides the real `.env` values (dotenv does not overwrite
variables that already exist in the environment), so:

- `MONGODB_URI` points at the local `chatgram_staging` database,
- `CLOUDINARY_*` is empty → uploads are written to `server/uploads/` (which lets
  the tests assert that files are really deleted),
- `EMAIL_ENABLED=false`, `TELEGRAM_*`/`WHATSAPP_*` empty → no real notifications,
- `REQUIRE_VERIFICATION=false`, `DEV_SHOW_CODES=true` → accounts can be created
  by the test suite,
- `AUTH_RATE_LIMIT_DISABLED=true` (ignored unless `NODE_ENV !== production`) →
  the suite creates a fresh account per test,
- `SUPPORT_AI_ENABLED=false` → no external AI calls.

## Start it

```powershell
# terminal 1 — API
powershell -ExecutionPolicy Bypass -File scripts/start-staging.ps1

# terminal 2 — web
cd apps/web
$env:VITE_API_URL = 'http://127.0.0.1:5000'
$env:VITE_SOCKET_URL = 'http://127.0.0.1:5000'
npm run dev
```

## Test accounts

`docs/test-accounts.md` lists the seeded accounts (test-only passwords).

## Suites

```powershell
# backend integration tests (needs the API on :5000)
cd server
node test/integration/changePassword.test.js
node test/integration/statusMedia.test.js
node test/integration/statusCleanup.test.js

# browser E2E (needs the API; the web server is auto-started by the config)
npm run test:e2e
```

## Reset the staging data

The staging database can be dropped at any time — it holds no real data:

```powershell
node -e "const m=require('mongoose');m.connect('mongodb://127.0.0.1:27017/chatgram_staging').then(async()=>{await m.connection.dropDatabase();console.log('dropped');process.exit(0)})"
```

(Also delete `server/uploads/` if you want the uploaded fixtures gone.)
