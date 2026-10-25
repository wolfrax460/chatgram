/**
 * 9b app releases: admin management (Windows/Android/Web) + the public feed the
 * apps and the landing Downloads tab read.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminReleases.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const SHA = 'a'.repeat(64);

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

const blank = (platform) => ({
  platform,
  version: '',
  fileName: '',
  fileUrl: '',
  sha256: '',
  sizeBytes: 0,
  releaseNotes: '',
  minSupportedVersion: '',
  forceUpdate: false,
  published: false,
});

async function main() {
  console.log('\napp releases\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const AppRelease = require('../../src/models/AppRelease');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': loginBody.csrfToken };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  try {
    // Auth gates.
    check('GET /api/admin/releases requires the admin session', (await api('GET', '/api/admin/releases')).status === 401);
    check('GET /api/admin/releases rejects a user token', (await api('GET', '/api/admin/releases', { token: 'fake-user-token' })).status === 401);
    check('PUT /api/admin/releases requires the CSRF header', (await api('PUT', '/api/admin/releases', { headers: { Cookie: headers.Cookie }, body: { releases: [blank('windows')] } })).status === 403);

    // The admin list always has the three platforms.
    const list = await api('GET', '/api/admin/releases', { headers });
    check('the admin list returns all three platforms', list.status === 200 && (list.body.releases || []).length === 3, list.status);
    check('new platforms start as drafts', (list.body.releases || []).every((row) => row.published === false));
    check('the admin payload has no secrets', !/(password|twoFactorSecret|accessToken)"/i.test(list.text));

    // Validation.
    const badVersion = await api('PUT', '/api/admin/releases', { headers, body: { releases: [{ ...blank('windows'), version: 'v1-beta' }] } });
    check('an invalid version is rejected', badVersion.status === 400, badVersion.status);
    const badSha = await api('PUT', '/api/admin/releases', { headers, body: { releases: [{ ...blank('windows'), sha256: 'abc' }] } });
    check('an invalid SHA-256 is rejected', badSha.status === 400, badSha.status);
    const publishedWithoutUrl = await api('PUT', '/api/admin/releases', { headers, body: { releases: [{ ...blank('windows'), version: '1.0.0', published: true }] } });
    check('a published release needs a file URL', publishedWithoutUrl.status === 400, publishedWithoutUrl.status);
    const badPlatform = await api('PUT', '/api/admin/releases', { headers, body: { releases: [{ ...blank('ios') }] } });
    check('an unknown platform is rejected', badPlatform.status === 400, badPlatform.status);
    const duplicate = await api('PUT', '/api/admin/releases', { headers, body: { releases: [blank('windows'), blank('windows')] } });
    check('duplicate platforms are rejected', duplicate.status === 400, duplicate.status);

    // Publish Windows + save a draft Android.
    const windows = {
      ...blank('windows'),
      version: '1.4.0',
      fileName: 'chatgram-windows-setup.exe',
      fileUrl: '/downloads/chatgram-windows-setup.exe',
      sha256: SHA,
      sizeBytes: 84500000,
      releaseNotes: 'Chatgram AI in the standard chat view, admin moderation fixes.',
      minSupportedVersion: '1.2.0',
      forceUpdate: true,
      published: true,
    };
    const android = { ...blank('android'), version: '1.0.0-draft' };
    // Android draft has an invalid semver-ish suffix on purpose? Keep it valid.
    android.version = '1.0.0';
    const save = await api('PUT', '/api/admin/releases', { headers, body: { releases: [windows, android] } });
    check('saving the releases works', save.status === 200, save.status);
    const savedWindows = (save.body.releases || []).find((row) => row.platform === 'windows') || {};
    check('the Windows release is stored with its checksum', savedWindows.sha256 === SHA && savedWindows.sizeBytes === 84500000, savedWindows);
    check('the Windows release is published with a release date', savedWindows.published === true && Boolean(savedWindows.releasedAt), savedWindows.releasedAt);
    check('the Android draft is not published', (save.body.releases || []).find((row) => row.platform === 'android')?.published === false);

    // Public feed.
    const publicFeed = await api('GET', '/api/app/releases');
    check('the public releases feed answers', publicFeed.status === 200 && Array.isArray(publicFeed.body.releases), publicFeed.status);
    const publicWindows = (publicFeed.body.releases || []).find((row) => row.platform === 'windows') || {};
    check('the public feed contains the published release', publicWindows.version === '1.4.0' && publicWindows.forceUpdate === true, publicWindows);
    check('drafts are not exposed publicly', !(publicFeed.body.releases || []).some((row) => row.platform === 'android'), publicFeed.body.releases?.map((row) => row.platform));
    check('the public feed never exposes admin fields', !("updatedBy" in publicWindows) && !("published" in publicWindows), Object.keys(publicWindows));

    // Unpublishing removes it from the feed.
    const unpublish = await api('PUT', '/api/admin/releases', { headers, body: { releases: [{ ...windows, published: false }, android] } });
    check('unpublishing works', unpublish.status === 200, unpublish.status);
    const afterUnpublish = await api('GET', '/api/app/releases');
    check('an unpublished release leaves the public feed', !(afterUnpublish.body.releases || []).some((row) => row.platform === 'windows'), afterUnpublish.body.releases);

    // Audit.
    const audit = await api('GET', '/api/admin/audit?search=app_releases&days=1', { headers });
    check('release changes are audited', (audit.body.entries || []).some((row) => row.action === 'app_releases_update'), (audit.body.entries || []).length);
  } finally {
    await AppRelease.deleteMany({});
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
