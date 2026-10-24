/**
 * Do-not-disturb notification preferences (server persistence + validation).
 *
 *   cd server && node test/integration/notificationPrefs.test.js
 */
const mongoose = require('mongoose');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const run = Date.now().toString(36);
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

async function main() {
  console.log(`\nnotification prefs integration test against ${BASE}\n`);

  const register = await api('POST', '/api/auth/register', {
    body: { displayName: `DND ${run}`, identifier: `dnd-${run}@chatgram.test`, password: 'DndTest1!' },
  });
  check('register test user', register.status === 201, `${register.status}`);
  const token = register.body?.accessToken;
  const userId = register.body?.user?.id;

  const unauth = await api('GET', '/api/users/me/notifications');
  check('unauthenticated read -> 401', unauth.status === 401, `${unauth.status}`);

  const defaults = await api('GET', '/api/users/me/notifications', { token });
  check('defaults load', defaults.status === 200, `${defaults.status}`);
  check('DND is off by default', defaults.body?.dndEnabled === false, JSON.stringify(defaults.body));
  check('default window is 22:00 -> 07:00', defaults.body?.dndStart === '22:00' && defaults.body?.dndEnd === '07:00', JSON.stringify(defaults.body));

  const enabled = await api('PUT', '/api/users/me/notifications', {
    token,
    body: { dndEnabled: true, dndStart: '21:30', dndEnd: '06:45' },
  });
  check('enable DND with custom hours -> 200', enabled.status === 200, `${enabled.status} ${JSON.stringify(enabled.body)}`);
  check('response reflects the new window', enabled.body?.dndEnabled === true && enabled.body?.dndStart === '21:30' && enabled.body?.dndEnd === '06:45', JSON.stringify(enabled.body));

  const persisted = await api('GET', '/api/users/me/notifications', { token });
  check('preferences persist', persisted.body?.dndEnabled === true && persisted.body?.dndStart === '21:30', JSON.stringify(persisted.body));

  const badStart = await api('PUT', '/api/users/me/notifications', { token, body: { dndStart: '25:99' } });
  check('invalid start time -> 400', badStart.status === 400 && badStart.body?.code === 'INVALID_TIME', `${badStart.status}`);
  const badEnd = await api('PUT', '/api/users/me/notifications', { token, body: { dndEnd: '7pm' } });
  check('invalid end time -> 400', badEnd.status === 400 && badEnd.body?.code === 'INVALID_TIME', `${badEnd.status}`);
  const afterBad = await api('GET', '/api/users/me/notifications', { token });
  check('a rejected update does not change saved values', afterBad.body?.dndStart === '21:30' && afterBad.body?.dndEnd === '06:45', JSON.stringify(afterBad.body));

  const disabled = await api('PUT', '/api/users/me/notifications', { token, body: { dndEnabled: false } });
  check('disable DND -> 200', disabled.status === 200 && disabled.body?.dndEnabled === false, JSON.stringify(disabled.body));

  const privacy = await api('GET', '/api/users/me/privacy', { token });
  check('privacy settings endpoint is unaffected', privacy.status === 200 && privacy.body?.readReceipts === true, `${privacy.status}`);

  const other = await api('PUT', '/api/users/me/notifications', {
    token: 'invalid.jwt.token',
    body: { dndEnabled: true },
  });
  check('invalid token -> 401', other.status === 401, `${other.status}`);

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 4000 });
    const User = require('../../src/models/User');
    await User.deleteMany({ _id: new mongoose.Types.ObjectId(userId) });
    await mongoose.disconnect();
  } catch (error) {
    console.log(`  (cleanup skipped: ${error.message})`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
