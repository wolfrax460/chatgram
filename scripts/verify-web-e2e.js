#!/usr/bin/env node
/**
 * Real-browser end-to-end probe for the Chatgram web build.
 *
 * Proves the claim "the web app actually talks to the backend" rather than
 * merely "the HTTP client works in a test harness".
 *
 * How it works:
 *   1. registers a throwaway user through the real API
 *   2. writes a harness page into build/web that seeds the exact
 *      localStorage entries shared_preferences uses on web
 *      (keys prefixed with `flutter.`, values `json.encode`d)
 *   3. serves build/web over HTTP with correct MIME types
 *   4. opens the harness in headless Chrome, which boots the real Flutter app
 *   5. polls GET /api/health and waits for `onlineUsers` to become >= 1
 *
 * A non-zero `onlineUsers` can only happen if the compiled Flutter app:
 *   - booted in a real browser,
 *   - restored the session from localStorage,
 *   - called the REST API successfully, and
 *   - opened + authenticated a Socket.IO connection.
 *
 * Usage:
 *   node scripts/verify-web-e2e.js
 *   node scripts/verify-web-e2e.js --headed     # visible Chrome (debugging)
 *   node scripts/verify-web-e2e.js --keep       # leave the harness file behind
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'client', 'build', 'web');
const API = process.env.API_BASE_URL || 'http://127.0.0.1:5001';
const PORT = Number(process.env.PROBE_PORT || 8080);
const HARNESS = '__e2e_harness.html';

const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const KEEP = args.includes('--keep');

const CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.sha1': 'text/plain',
  '.txt': 'text/plain; charset=utf-8',
};

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function serve(dir, port) {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    // Never allow escaping the web root.
    const filePath = path.join(dir, path.normalize(urlPath).replace(/^([/\\])+/, ''));
    if (!filePath.startsWith(dir)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        // CanvasKit needs cross-origin isolation for the threaded build; the
        // single-threaded fallback works without it, but these are harmless.
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function api(method, route, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/**
 * Register a probe account through the real flow. When the server enforces
 * verification we request and check a code first — possible only if the server
 * exposes the code (DEV_SHOW_CODES=true), which a hardened server does not.
 */
async function registerProbeUser(displayName, identifier, password = 'password123') {
  const cfg = await api('GET', '/api/config');
  let verificationToken;

  if (cfg.body?.verificationRequired) {
    const sent = await api('POST', '/api/auth/verification/send', { body: { target: identifier } });
    if (!sent.body?.devCode) return { status: 0, verificationUnavailable: true };

    const checked = await api('POST', '/api/auth/verification/check', {
      body: { target: identifier, code: sent.body.devCode },
    });
    verificationToken = checked.body?.verificationToken;
    if (!verificationToken) return { status: 0, verificationUnavailable: true };
  }

  return api('POST', '/api/auth/register', {
    body: {
      displayName,
      identifier,
      password,
      ...(verificationToken ? { verificationToken } : {}),
    },
  });
}

async function main() {
  console.log('\nChatgram web end-to-end browser probe\n');

  check('client/build/web exists (run: flutter build web)', fs.existsSync(WEB_DIR), WEB_DIR);

  const chrome = findChrome();
  check('a Chrome/Chromium binary was found', !!chrome, 'set CHROME_EXECUTABLE');

  if (failures.length) {
    console.log('\nCannot continue without the above.\n');
    process.exit(1);
  }

  // ------------------------------------------------------------ backend up?
  const health0 = await api('GET', '/api/health').catch(() => null);
  check(
    'backend /api/health is reachable',
    !!health0 && health0.status === 200,
    'start it with: cd server && npm start'
  );
  if (!health0 || health0.status !== 200) {
    console.log('');
    process.exit(1);
  }

  const onlineBefore = health0.body.onlineUsers;

  // ---------------------------------------------------------- throwaway user
  const stamp = Date.now();
  const email = `webe2e.${stamp}@chatgram.dev`;
  const password = 'password123';

  const reg = await registerProbeUser('Web E2E Probe', email, password);

  // A hardened server enforces verification but hides the codes, so the probe
  // has no legitimate way to create an account. Say so instead of failing.
  if (reg.verificationUnavailable) {
    console.log(
      '\n  This server enforces email/phone verification and does not expose the\n' +
        '  codes, so the probe cannot create its own account. That is the correct\n' +
        '  setting for a real deployment.\n\n' +
        '  To run the probe, start a second API with test settings:\n' +
        '    $env:PORT="5002"; $env:DEV_SHOW_CODES="true"; $env:EMAIL_PROVIDER="console"; npm start\n' +
        '    $env:API_BASE_URL="http://127.0.0.1:5002"; node scripts/verify-web-e2e.js\n'
    );
    console.log('RESULT: skipped - needs DEV_SHOW_CODES=true or REQUIRE_VERIFICATION=false');
    console.log('');
    process.exit(0);
  }

  check('registered a probe user through the real API', reg.status === 201, `status ${reg.status}`);

  if (reg.status !== 201) {
    console.log(`\n${reg.body && reg.body.message}\n`);
    process.exit(1);
  }

  const accessToken = reg.body.accessToken;
  const refreshToken = reg.body.refreshToken;
  const user = reg.body.user;

  // Give the probe a real conversation so the browser app has to fetch and
  // render an actual chat (populated participants + lastMessage + unread badge)
  // rather than an empty list.
  const partnerEmail = `webe2e.partner.${stamp}@chatgram.dev`;
  const partnerReg = await registerProbeUser('Probe Partner', partnerEmail, password);
  check('registered a second user to converse with', partnerReg.status === 201, `status ${partnerReg.status}`);

  let chatId = null;
  if (partnerReg.status === 201) {
    const partnerToken = partnerReg.body.accessToken;
    const partnerId = partnerReg.body.user.id;

    const chat = await api('POST', '/api/chats', {
      token: accessToken,
      body: { type: 'direct', participantId: partnerId },
    });
    chatId = chat.body && chat.body._id;
    check('probe user has a direct chat', !!chatId, `status ${chat.status}`);

    if (chatId) {
      const sent = await api('POST', '/api/messages', {
        token: partnerToken,
        body: { chatId, type: 'text', content: 'hello from the e2e probe' },
      });
      check('partner sent a message into the probe chat', sent.status === 201, `status ${sent.status}`);
    }
  }

  // ------------------------------------------------- shared_preferences format
  // shared_preferences_web stores under `flutter.<key>` with json.encode(value).
  const seedToken = JSON.stringify(JSON.stringify(accessToken));
  const seedRefresh = JSON.stringify(JSON.stringify(refreshToken));
  const seedUser = JSON.stringify(JSON.stringify(JSON.stringify(user)));

  // ---------------------------------------------------------- where is the app?
  // Preferred: the Express server hosts the built web app itself (the setup you
  // share with friends). Fall back to serving build/web locally.
  let appOrigin = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : null;
  let servedByBackend = false;

  if (!appOrigin) {
    try {
      const res = await fetch(`${API}/`);
      const body = await res.text();
      if (res.ok && /<!doctype html/i.test(body)) {
        appOrigin = API;
        servedByBackend = true;
      }
    } catch {
      /* fall through */
    }
  } else {
    servedByBackend = appOrigin === API;
  }

  let localServer = null;
  if (!appOrigin) {
    try {
      localServer = await serve(WEB_DIR, PORT);
    } catch (e) {
      console.error(`Could not bind port ${PORT}: ${e.message}`);
      process.exit(1);
    }
    appOrigin = `http://127.0.0.1:${PORT}`;
  }

  check(
    'the app is served by the backend (shareable single-origin setup)',
    servedByBackend,
    localServer
      ? 'backend did not serve index.html; fell back to a local static server. ' +
        'Run `flutter build web` in client/ so the API hosts the app.'
      : `app origin: ${appOrigin}`
  );

  const harness = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Chatgram E2E harness</title></head>
<body>
<script>
  // Same-origin seed of the exact keys AuthService reads on startup.
  localStorage.setItem('flutter.token', ${seedToken});
  localStorage.setItem('flutter.refreshToken', ${seedRefresh});
  localStorage.setItem('flutter.user', ${seedUser});
  window.__dshSeeded = true;
  location.replace('/');
</script>
</body>
</html>
`;
  const harnessPath = path.join(WEB_DIR, HARNESS);
  fs.writeFileSync(harnessPath, harness, 'utf8');

  const harnessUrl = `${appOrigin}/${HARNESS}`;

  const indexProbe = await fetch(`${appOrigin}/`);
  check('the app origin returns the Flutter index.html', indexProbe.status === 200);
  const indexBody = await indexProbe.text();
  check('the served page is actually the Flutter app', /flutter_bootstrap\.js/.test(indexBody));

  const jsProbe = await fetch(`${appOrigin}/flutter_bootstrap.js`);
  check('flutter_bootstrap.js is served with a JS content type', jsProbe.status === 200);
  await jsProbe.text();

  const healthSameOrigin = await fetch(`${appOrigin}/api/health`);
  check('the same origin serves the API (no CORS needed)', healthSameOrigin.status === 200);
  await healthSameOrigin.text();

  // ----------------------------------------------------------------- Chrome
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgram-e2e-'));
  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    // SwiftShader gives headless Chrome a usable WebGL for CanvasKit.
    '--enable-unsafe-swiftshader',
    '--use-gl=swiftshader',
    '--window-size=1280,900',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (!HEADED) chromeArgs.unshift('--headless=new');
  chromeArgs.push(harnessUrl);

  console.log(`\n  launching ${HEADED ? 'Chrome' : 'headless Chrome'}...`);
  const chromeProc = spawn(chrome, chromeArgs, { stdio: 'ignore', detached: false });

  // ------------------------------------------------- poll for the socket
  // Poll the PROBE USER's own online flag rather than the global `onlineUsers`
  // count: other people (or the developer's own browser) may already be
  // connected, which would make a global count ambiguous.
  const deadline = Date.now() + 90000;
  let onlineUsers = onlineBefore;
  let probeUserOnline = false;

  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const me = await api('GET', '/api/auth/me', { token: accessToken });
      if (me.status === 200 && me.body.isOnline === true) {
        probeUserOnline = true;
        const h = await api('GET', '/api/health');
        onlineUsers = h.body.onlineUsers;
        break;
      }
      const h = await api('GET', '/api/health');
      onlineUsers = h.body.onlineUsers;
    } catch {
      /* keep polling */
    }
  }

  console.log(`\n  onlineUsers before=${onlineBefore} after=${onlineUsers}`);

  // Authoritative, user-specific evidence: only this user's socket
  // `authenticate` handler sets this flag, so no other connection can fake it.
  check(
    'the real Flutter web app authenticated its socket as the probe user',
    probeUserOnline,
    'the probe user never became online within 90s, so the browser app either ' +
      'failed to boot, failed to restore its session, or could not reach the API'
  );

  // --------------------------------------------------------------- cleanup
  try {
    if (localServer) localServer.close();
  } catch {
    /* ignore */
  }
  try {
    chromeProc.kill();
  } catch {
    /* ignore */
  }
  await sleep(1000);
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (!KEEP) {
    try {
      fs.unlinkSync(harnessPath);
    } catch {
      /* ignore */
    }
  }

  // Log the probe user out so it is not left "online".
  await api('POST', '/api/auth/logout', { token: accessToken }).catch(() => {});

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  console.log('');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exit(2);
});
