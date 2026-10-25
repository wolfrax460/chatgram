/**
 * 9b Settings wiring checks: routes are session/CSRF gated, secrets are never
 * returned (presence booleans only), backups are honest about a missing tool,
 * and the review-log retention now follows the Settings value.
 */
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..', '..', '..');
let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}
function read(relative) {
  return fs.readFileSync(path.join(repo, relative), 'utf8');
}

console.log('\nsettings wiring (9b)\n');

const controller = read('server/src/controllers/adminSettingsController.js');
check('settings state never returns the SMTP password or bot token values', !/SMTP_PASS\s*[:=]\s*[^c]/.test(controller) && !/TELEGRAM_BOT_TOKEN\s*[:=]\s*[^c]/.test(controller));
check('SMTP and Telegram are reported as presence booleans', /smtpConfigured/.test(controller) && /telegramConfigured/.test(controller));
check('settings changes are audited', /site_settings_update/.test(controller));
check('the backup endpoint is honest when mongodump is missing', /BACKUP_TOOL_MISSING/.test(controller) && /ENOENT/.test(controller));
check('backups are recorded and audited', /lastBackupAt/.test(controller) && /backup_run/.test(controller));

const routes = read('server/src/routes/adminRoutes.js');
check('settings endpoints are mounted', /router\.get\('\/settings'/.test(routes) && /router\.put\('\/settings'/.test(routes) && /router\.post\('\/settings\/backup'/.test(routes));
check('settings mutations require the CSRF token', /router\.put\('\/settings', requireAdminSession, requireAdminCsrf/.test(routes) && /router\.post\('\/settings\/backup', requireAdminSession, requireAdminCsrf/.test(routes));

const util = read('server/src/utils/platformSettings.js');
check('settings values are validated in one place', /SETTINGS_TEXTS/.test(util) && /SETTINGS_NUMBERS/.test(util) && /validLink/.test(util));

const review = read('server/src/controllers/adminReviewController.js');
check('review-log retention now follows the Settings value', /reviewLogRetentionDays/.test(review) && /async function retentionDays/.test(review));

const page = path.join(repo, 'apps/web/src/pages/admin/SettingsPage.tsx');
check('the dashboard has a Settings page', fs.existsSync(page));
check('the Settings page is wired into the dashboard', /SettingsPage/.test(read('apps/web/src/pages/admin/AdminApp.tsx')) && /\/admin\/settings/.test(read('apps/web/src/pages/admin/AdminApp.tsx')));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
