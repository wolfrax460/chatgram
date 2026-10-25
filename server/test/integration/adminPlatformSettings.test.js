/**
 * 9b feature flags & maintenance: admin settings + enforcement of registration,
 * status, groups, uploads, AI, support widget, maintenance and read-only mode.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminPlatformSettings.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

async function api(method, route, { token, headers, body } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, text };
}

async function main() {
  console.log('\nfeature flags & maintenance\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const PlatformSettings = require('../../src/models/PlatformSettings');
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const platformSettings = require('../../src/utils/platformSettings');

  // Clean defaults.
  await PlatformSettings.deleteMany({});
  platformSettings.resetCache();

  // A user is created before the registration flag is flipped.
  const identifier = `flags-${run}@chatgram.test`;
  const registered = await api('POST', '/api/auth/register', {
    body: { displayName: `FLAGS ${run}`, identifier, password: 'FlagsTest1!' },
  });
  check('a test user can register while registration is on', registered.status === 201, registered.status);
  const token = registered.body.accessToken;
  const userId = registered.body.user?.id;

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': loginBody.csrfToken };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const save = async (settings) => api('PUT', '/api/admin/platform-settings', { headers, body: { settings } });
  const defaults = platformSettings.DEFAULTS;

  try {
    // Auth + CSRF gates.
    check('GET /api/admin/platform-settings requires the admin session', (await api('GET', '/api/admin/platform-settings')).status === 401);
    check('GET /api/admin/platform-settings rejects a user token', (await api('GET', '/api/admin/platform-settings', { token })).status === 401);
    check('saving platform settings requires the CSRF header', (await api('PUT', '/api/admin/platform-settings', { headers: { Cookie: headers.Cookie }, body: { settings: defaults } })).status === 403);

    const read = await api('GET', '/api/admin/platform-settings', { headers });
    check('the settings read works', read.status === 200, read.status);
    check('everything is on by default', read.body.settings.registrationEnabled === true && read.body.settings.statusEnabled === true && read.body.settings.aiEnabled === true && read.body.settings.maintenanceMode === false, read.body.settings);
    check('the settings payload has no secrets', !/(password|apiKey|secret)"/i.test(read.text));
    const badLimit = await save({ maxUploadMb: 0 });
    check('an invalid upload limit is rejected', badLimit.status === 400, badLimit.status);

    // Registration.
    check('registration can be disabled', (await save({ registrationEnabled: false })).status === 200);
    const blockedRegister = await api('POST', '/api/auth/register', { body: { displayName: 'Blocked', identifier: `blocked-${run}@chatgram.test`, password: 'Blocked1!' } });
    check('registration is blocked with REGISTRATION_DISABLED', blockedRegister.status === 403 && blockedRegister.body.code === 'REGISTRATION_DISABLED', blockedRegister.body?.code);
    check('registration can be re-enabled', (await save({ registrationEnabled: true })).status === 200);

    // Status.
    check('status can be disabled', (await save({ statusEnabled: false })).status === 200);
    const blockedStatus = await api('GET', '/api/status', { token });
    check('status is blocked with STATUS_DISABLED', blockedStatus.status === 403 && blockedStatus.body.code === 'STATUS_DISABLED', blockedStatus.body?.code);
    check('status can be re-enabled', (await save({ statusEnabled: true })).status === 200);
    check('status works again', (await api('GET', '/api/status', { token })).status === 200);

    // Groups.
    check('groups can be disabled', (await save({ groupsEnabled: false })).status === 200);
    const blockedGroup = await api('POST', '/api/chats', { token, body: { type: 'group', groupName: `Flags group ${run}` } });
    check('group creation is blocked with GROUPS_DISABLED', blockedGroup.status === 403 && blockedGroup.body.code === 'GROUPS_DISABLED', blockedGroup.body?.code);
    check('groups can be re-enabled', (await save({ groupsEnabled: true })).status === 200);

    // Uploads.
    check('uploads can be disabled', (await save({ fileUploadsEnabled: false })).status === 200);
    const blockedUpload = await api('POST', '/api/messages/media', { token, body: {} });
    check('uploads are blocked with UPLOADS_DISABLED', blockedUpload.status === 403 && blockedUpload.body.code === 'UPLOADS_DISABLED', blockedUpload.body?.code);
    check('uploads can be re-enabled', (await save({ fileUploadsEnabled: true })).status === 200);

    // AI.
    check('AI can be disabled', (await save({ aiEnabled: false })).status === 200);
    const blockedAi = await api('GET', '/api/ai/thread', { token });
    check('AI is blocked with AI_DISABLED', blockedAi.status === 403 && blockedAi.body.code === 'AI_DISABLED', blockedAi.body?.code);
    check('AI can be re-enabled', (await save({ aiEnabled: true })).status === 200);

    // Support widget.
    check('the support widget can be disabled', (await save({ supportWidgetEnabled: false })).status === 200);
    const blockedSupport = await api('POST', '/api/support/assistant', { body: { message: 'hello' } });
    check('the support widget is blocked with SUPPORT_DISABLED', blockedSupport.status === 403 && blockedSupport.body.code === 'SUPPORT_DISABLED', blockedSupport.body?.code);
    check('the support widget can be re-enabled', (await save({ supportWidgetEnabled: true })).status === 200);

    // Maintenance mode.
    check('maintenance mode can be turned on', (await save({ maintenanceMode: true, maintenanceMessage: 'Back in a minute (test).' })).status === 200);
    const maintenanceApi = await api('GET', '/api/users/me', { token });
    check('users see 503 MAINTENANCE during maintenance', maintenanceApi.status === 503 && maintenanceApi.body.code === 'MAINTENANCE', maintenanceApi.body?.code);
    check('the maintenance message is returned', /Back in a minute/.test(String(maintenanceApi.body.message)), maintenanceApi.body.message);
    check('the health check still answers during maintenance', (await api('GET', '/api/status/health')).status === 200);
    check('admins still reach the panel during maintenance', (await api('GET', '/api/admin/overview?days=7', { headers })).status === 200);
    check('maintenance mode can be turned off', (await save({ maintenanceMode: false })).status === 200);
    const apiAgain = await api('GET', `/api/users/${userId}`, { token });
    check('users can use the API again', apiAgain.status === 200, apiAgain.status + ' ' + JSON.stringify(apiAgain.body).slice(0, 160));

    // Read-only mode.
    check('read-only mode can be turned on', (await save({ readOnlyMode: true })).status === 200);
    const readOnlyWrite = await api('POST', '/api/messages', { token, body: { chatId: '5f0000000000000000000000', type: 'text', content: 'x' } });
    check('writes are blocked with READ_ONLY', readOnlyWrite.status === 503 && readOnlyWrite.body.code === 'READ_ONLY', readOnlyWrite.body?.code);
    const readOnlyRead = await api('GET', `/api/users/${userId}`, { token });
    check('reads still work in read-only mode', readOnlyRead.status === 200, readOnlyRead.status + ' ' + JSON.stringify(readOnlyRead.body).slice(0, 160));
    check('read-only mode can be turned off', (await save({ readOnlyMode: false })).status === 200);

    // Audit.
    const audit = await api('GET', '/api/admin/audit?search=platform_settings_update&days=1', { headers });
    check('platform setting changes are audited', (audit.body.entries || []).length >= 5, (audit.body.entries || []).length);
  } finally {
    await save({ ...defaults });
    platformSettings.resetCache();
    const users = await User.find({ email: new RegExp(`^(flags|blocked)-${run}@chatgram\\.test$`) }).select('_id').lean();
    const ids = users.map((row) => row._id);
    if (ids.length) {
      await Chat.deleteMany({ participants: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
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
