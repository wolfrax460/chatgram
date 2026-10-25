/**
 * 9b Safety & abuse wiring checks: enforcement points exist where they must and
 * the admin API is session-gated. Behavioural coverage is in
 * server/test/integration/adminSafety.test.js.
 *
 *   node server/test/unit/safetyGuard.test.js
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

console.log('\nsafety & abuse wiring (9b)\n');

const middleware = read('server/src/middleware/safety.js');
check('an IP-ban middleware exists', middleware.includes('blockBannedIp'));
check('the signup throttle is enforced server-side', middleware.includes('checkSignup') && middleware.includes('SIGNUP_THROTTLED'));
check('blocked words are enforced server-side', middleware.includes('BLOCKED_WORD'));
check('blocked link domains are enforced server-side', middleware.includes('BLOCKED_LINK'));
check('the message rate limit is enforced server-side', middleware.includes('MESSAGE_RATE_LIMITED'));
check('counters are in-memory sliding windows (no durable PII)', /new Map\(\)/.test(middleware));

const server = read('server/src/server.js');
check('the IP-ban middleware is mounted on /api', /middleware\/safety'\)\.blockBannedIp/.test(server));
check('the admin panel and health stay reachable from a banned IP', /path\.startsWith\('\/admin'\)/.test(middleware) && /status\/health/.test(middleware));

const auth = read('server/src/controllers/authController.js');
check('registration runs the signup throttle', /checkSignup\(req\)/.test(auth));
check('successful registrations are counted', /recordSignup\(req\)/.test(auth));
check('blocked email domains refuse sign-up', /EMAIL_DOMAIN_BLOCKED/.test(auth));

const messages = read('server/src/controllers/messageController.js');
check('message sending runs the safety check', /safety'\)\.checkMessage/.test(messages));

const routes = read('server/src/routes/adminRoutes.js');
check('safety endpoints are mounted under /api/admin', /router\.get\('\/safety'/.test(routes) && /router\.put\('\/safety'/.test(routes));
check('IP-ban add/remove endpoints exist', /router\.post\('\/safety\/ip-bans'/.test(routes) && /router\.delete\('\/safety\/ip-bans\/:ip'/.test(routes));
check('every safety route requires the admin session', (routes.match(/router\.(get|put|post|delete)\('\/safety[^']*', requireAdminSession/g) || []).length === 5);
check('safety mutations require the CSRF token', /router\.put\('\/safety', requireAdminSession, requireAdminCsrf/.test(routes) && /router\.post\('\/safety\/ip-bans', requireAdminSession, requireAdminCsrf/.test(routes) && /router\.delete\('\/safety\/ip-bans\/:ip', requireAdminSession, requireAdminCsrf/.test(routes));

const controller = read('server/src/controllers/adminSafetyController.js');
check('a change of safety settings is audited', /safety_settings_update/.test(controller));
check('IP bans are audited', /ip_ban_add/.test(controller) && /ip_ban_remove/.test(controller));
check('IP bans validate the address and require a reason', /validIp/.test(controller) && /A reason is required/.test(controller));
check('spam signals cover mass messaging and signup bursts', /massMessaging/.test(controller) && /signupBursts/.test(controller));

const page = path.join(repo, 'apps/web/src/pages/admin/SafetyPage.tsx');
check('the dashboard has a Safety & abuse page', fs.existsSync(page));
check('the safety page is wired into the dashboard', /SafetyPage/.test(read('apps/web/src/pages/admin/AdminApp.tsx')) && /\/admin\/safety/.test(read('apps/web/src/pages/admin/AdminApp.tsx')));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
