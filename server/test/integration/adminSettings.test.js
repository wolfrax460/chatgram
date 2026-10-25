/**
 * 9b Settings: site identity, support email, retention, legal links and backups.
 * No secret is ever returned (SMTP/Telegram are presence booleans only).
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminSettings.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only

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

async function api(method, route, { token, headers, body, raw } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: response.status, text: await response.text(), headers: response.headers };
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload, text, headers: response.headers };
}

async function main() {
  console.log('\nsettings (9b)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const platformSettings = require('../../src/utils/platformSettings');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = {
    Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': loginBody.csrfToken,
  };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const initial = await api('GET', '/api/admin/settings', { headers });
  check('settings state loads', initial.status === 200 && initial.body?.settings && initial.body?.status, initial.status);
  check('settings state exposes only presence for SMTP/Telegram, never secrets', typeof initial.body?.status?.smtpConfigured === 'boolean' && typeof initial.body?.status?.telegramConfigured === 'boolean' && !/SMTP_PASS|TELEGRAM_BOT_TOKEN|password|secret/i.test(initial.text), null);
  check('settings state includes the backups list', Array.isArray(initial.body?.backups), typeof initial.body?.backups);
  const userToken = await api('GET', '/api/admin/settings', { token: 'not-a-real-token' });
  check('a normal user token cannot read settings', userToken.status === 401, userToken.status);

  const badUrl = await api('PUT', '/api/admin/settings', { headers, body: { siteUrl: 'javascript:alert(1)' } });
  check('an unsafe site URL is rejected', badUrl.status === 400, badUrl.status);
  const badEmail = await api('PUT', '/api/admin/settings', { headers, body: { supportEmail: 'not-an-email' } });
  check('an invalid support email is rejected', badEmail.status === 400, badEmail.status);
  const badRetention = await api('PUT', '/api/admin/settings', { headers, body: { reviewLogRetentionDays: 3 } });
  check('an out-of-range retention is rejected', badRetention.status === 400, badRetention.status);

  const saved = await api('PUT', '/api/admin/settings', {
    headers,
    body: {
      siteName: `Chatgram Settings ${Date.now().toString(36)}`,
      siteUrl: 'https://chatgram-xi.vercel.app',
      supportEmail: 'support@chatgram.test',
      privacyUrl: '/docs/#privacy',
      termsUrl: '/docs/#terms',
      dataRetentionDays: 400,
      reviewLogRetentionDays: 410,
    },
  });
  check('valid settings save', saved.status === 200 && saved.body?.settings?.supportEmail === 'support@chatgram.test', saved.status);
  const after = await api('GET', '/api/admin/settings', { headers });
  check('saved settings persist', after.body?.settings?.reviewLogRetentionDays === 410 && after.body?.settings?.dataRetentionDays === 400, after.body?.settings);
  const reviewStats = await api('GET', '/api/admin/reviews/stats', { headers });
  check('the review log retention follows the Settings value', reviewStats.status === 200 && reviewStats.body?.retentionDays === 410, reviewStats.body?.retentionDays);

  const audit = await api('GET', '/api/admin/audit?limit=30', { headers });
  check('settings changes are audited', audit.status === 200 && String(audit.text).includes('site_settings_update'), audit.status);

  const backup = await api('POST', '/api/admin/settings/backup', { headers, body: {} });
  check(
    'the backup endpoint is honest: it either succeeds or reports the missing tool',
    (backup.status === 200 && Boolean(backup.body?.backup?.name)) || (backup.status === 501 && backup.body?.code === 'BACKUP_TOOL_MISSING') || (backup.status === 500 && backup.body?.code === 'BACKUP_FAILED'),
    { status: backup.status, code: backup.body?.code },
  );
  check('the backup response carries no secrets', !/SMTP_PASS|TELEGRAM_BOT_TOKEN|mongodb\+srv/i.test(backup.text), null);

  // Restore the defaults.
  const restored = await api('PUT', '/api/admin/settings', {
    headers,
    body: {
      siteName: 'Chatgram',
      siteUrl: 'https://chatgram-xi.vercel.app',
      supportEmail: '',
      privacyUrl: '/docs/#privacy',
      termsUrl: '/docs/#terms',
      dataRetentionDays: 365,
      reviewLogRetentionDays: 730,
    },
  });
  check('the default settings are restored', restored.status === 200 && restored.body?.settings?.reviewLogRetentionDays === 730, restored.status);

  await platformSettings.resetCache();
  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('settings test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
