/**
 * Maintenance gate integration test.
 *
 *   # staging API on port 5003 (scripts/start-api-5003.ps1 style env)
 *   node server/test/integration/maintenanceGate.test.js
 *
 * Proves the "put the app down for a bad build" switch end to end:
 *   - ordinary REST calls answer 503 { code: 'MAINTENANCE' }
 *   - /api/status/health, /api/config, /api/app/features and /api/auth/* still answer
 *   - admin routes are not gated (they answer 401 without a session, not 503)
 *   - /api/app/features tells the shells { maintenanceMode, maintenanceMessage }
 *   - the Socket.IO handshake is refused with code MAINTENANCE
 *   - `maintenanceUntil` auto-expires and the app recovers without a toggle
 *   - read-only mode still allows reads and refuses writes
 *
 * Settings are written straight to Mongo (the test would otherwise need the
 * admin password) and the API's 5 s settings cache is given time to expire.
 */
const mongoose = require('mongoose');
const { io } = require('socket.io-client');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5003';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_calls_test';
const MESSAGE = 'Short maintenance for a bad build (test).';

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

async function api(method, route, { body } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, text };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the API's cached settings to catch up with a Mongo write. */
async function waitFor(label, predicate, timeoutMs = 12_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await predicate();
      if (last) return true;
    } catch (error) {
      last = { error: String(error && error.message) };
    }
    await sleep(400);
  }
  console.log(`  ... timed out waiting for ${label}; last=${JSON.stringify(last).slice(0, 200)}`);
  return false;
}

async function getFeatures() {
  const response = await api('GET', '/api/app/features');
  return { status: response.status, features: response.body };
}

/** One Socket.IO connection attempt; resolves whether it connected or why not. */
function connectSocket(timeoutMs = 6000) {
  return new Promise((resolve) => {
    const socket = io(API, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: timeoutMs,
    });
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(result);
    };
    socket.on('connect', () => finish({ ok: true }));
    socket.on('connect_error', (error) => finish({
      ok: false,
      code: error && error.data ? error.data.code : null,
      message: error && error.message,
    }));
    timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT' }), timeoutMs + 1500);
  });
}

async function main() {
  console.log(`\nmaintenance gate integration test against ${API}\n`);
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const PlatformSettings = require('../../src/models/PlatformSettings');
  const platformSettings = require('../../src/utils/platformSettings');

  const writeSettings = (patch) => PlatformSettings.findOneAndUpdate(
    { singleton: 'platform' },
    { $set: patch },
    { upsert: true, returnDocument: 'after' },
  );

  try {
    // All off.
    await writeSettings({
      maintenanceMode: false,
      maintenanceUntil: null,
      maintenanceMessage: platformSettings.DEFAULTS.maintenanceMessage,
      readOnlyMode: false,
    });
    await waitFor('maintenance off', async () => (await getFeatures()).features?.maintenanceMode === false);

    check('health answers before maintenance', (await api('GET', '/api/status/health')).status === 200);
    check('an ordinary call is not 503 before maintenance', (await api('GET', '/api/users/me')).status === 401);
    const baselineSocket = await connectSocket();
    check('a socket can connect before maintenance', baselineSocket.ok === true, baselineSocket);

    /* ------------------------------------------------------- maintenance on */
    await writeSettings({ maintenanceMode: true, maintenanceUntil: null, maintenanceMessage: MESSAGE });
    await waitFor('maintenance on', async () => (await getFeatures()).features?.maintenanceMode === true);

    const blockedRead = await api('GET', '/api/users/me');
    check(
      'an ordinary API call returns 503 MAINTENANCE',
      blockedRead.status === 503 && blockedRead.body?.code === 'MAINTENANCE',
      blockedRead.body,
    );
    check('the admin message is returned', blockedRead.body?.message === MESSAGE, blockedRead.body?.message);

    const blockedWrite = await api('POST', '/api/chats', { body: { type: 'group', groupName: 'maintenance test' } });
    check(
      'a write is blocked too',
      blockedWrite.status === 503 && blockedWrite.body?.code === 'MAINTENANCE',
      blockedWrite.body?.code,
    );

    // Everything clients need to explain the downtime must stay up.
    check('health still answers during maintenance', (await api('GET', '/api/status/health')).status === 200);
    check('config still answers during maintenance', (await api('GET', '/api/config')).status === 200);
    check(
      'app/features still answers during maintenance',
      (await getFeatures()).status === 200,
    );
    const featuresDown = await getFeatures();
    check(
      'app/features tells the shells maintenance is on, with the message',
      featuresDown.features?.maintenanceMode === true && featuresDown.features?.maintenanceMessage === MESSAGE,
      featuresDown.features,
    );
    const authDown = await api('POST', '/api/auth/login', { body: {} });
    check('auth endpoints still answer (validation error, not 503)', authDown.status !== 503, authDown.status);
    const adminDown = await api('GET', '/api/admin/platform-settings');
    check('admin endpoints are not gated (401 without a session, not 503)', adminDown.status === 401, adminDown.status);

    const refusedSocket = await connectSocket();
    check('the Socket.IO handshake is refused during maintenance', refusedSocket.ok === false, refusedSocket);
    check(
      'the socket refusal carries the MAINTENANCE code',
      refusedSocket.code === 'MAINTENANCE',
      refusedSocket.code,
    );
    check(
      'the socket refusal carries the admin message',
      refusedSocket.message === MESSAGE,
      refusedSocket.message,
    );

    /* ---------------------------------------------------------- auto-expiry */
    await writeSettings({
      maintenanceMode: true,
      maintenanceUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    check(
      'features exposes the auto-expiry timestamp',
      await waitFor('maintenanceUntil visible', async () => {
        const { features } = await getFeatures();
        return features?.maintenanceMode === true && Boolean(features?.maintenanceUntil);
      }),
    );

    // The window has passed: the gate must release on its own.
    await writeSettings({ maintenanceMode: true, maintenanceUntil: new Date(Date.now() - 1000).toISOString() });
    const released = await waitFor('auto-expiry release', async () => (await api('GET', '/api/users/me')).status === 401);
    check('an expired maintenanceUntil unblocks ordinary calls', released);
    check(
      'features reports maintenance off after auto-expiry',
      (await getFeatures()).features?.maintenanceMode === false,
    );

    /* ------------------------------------------------------- read-only mode */
    await writeSettings({ maintenanceMode: false, maintenanceUntil: null, readOnlyMode: true });
    const readOnlyWrite = await waitFor(
      'read-only writes blocked',
      async () => {
        const response = await api('POST', '/api/messages', { body: { chatId: '5f0000000000000000000000', type: 'text', content: 'x' } });
        return response.status === 503 && response.body?.code === 'READ_ONLY';
      },
    );
    check('writes are refused with READ_ONLY', readOnlyWrite);
    check('reads still work in read-only mode', (await api('GET', '/api/users/me')).status === 401);
    check('config still answers in read-only mode', (await api('GET', '/api/config')).status === 200);

    /* ---------------------------------------------------------- recovery */
    await writeSettings({ readOnlyMode: false, maintenanceMode: false, maintenanceUntil: null });
    const recovered = await waitFor('API recovery', async () => (await api('GET', '/api/users/me')).status === 401);
    check('ordinary calls work again after maintenance is off', recovered);
    const recoveredSocket = await connectSocket();
    check('a socket can connect again (recovery)', recoveredSocket.ok === true, recoveredSocket);
  } finally {
    // Never leave the shared test database in maintenance.
    try {
      await writeSettings({
        maintenanceMode: false,
        maintenanceUntil: null,
        maintenanceMessage: platformSettings.DEFAULTS.maintenanceMessage,
        readOnlyMode: false,
      });
    } catch (error) {
      console.log('  ... cleanup write failed:', String(error && error.message).slice(0, 160));
    }
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
