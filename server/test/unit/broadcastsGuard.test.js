/**
 * 9b Announcements wiring checks: routes are session/CSRF gated, the public
 * banner endpoint needs no auth but returns no secrets, confirmation is required
 * before sending, the scheduler and official-account fallback exist, and the
 * dashboard/app banner components are present.
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

console.log('\nannouncements & broadcasts wiring (9b)\n');

const controller = read('server/src/controllers/adminBroadcastsController.js');
check('the official sender falls back from support to admin accounts', /officialSender/.test(controller) && /role: 'admin'/.test(controller) && /CHATGRAM_ADMIN_EMAIL/.test(controller));
check('sending requires an explicit confirmation flag', /CONFIRM_REQUIRED/.test(controller) && /confirm !== true/.test(controller));
check('message broadcasts are delivered as real direct messages', /Message.create/.test(controller) && /Chat.create/.test(controller));
check('delivery counts are tracked', /sentCount/.test(controller) && /failedCount/.test(controller));
check('sent announcements cannot be deleted', /cannot be deleted/.test(controller));
check('every announcement action is audited', /announcement_create/.test(controller) && /announcement_publish/.test(controller) && /announcement_send/.test(controller) && /announcement_cancel/.test(controller));
check('the public banner only shows active windows', /startsAt/.test(controller) && /endsAt/.test(controller) && /status: 'sent'/.test(controller));
check('recipient lists are capped', /MAX_RECIPIENTS = 5000/.test(controller));

const routes = read('server/src/routes/adminRoutes.js');
check('announcement admin endpoints are mounted', /router\.get\('\/broadcasts'/.test(routes) && /router\.post\('\/broadcasts'/.test(routes) && /broadcasts\/:id\/send/.test(routes));
check('announcement mutations require CSRF', /router\.post\('\/broadcasts', requireAdminSession, requireAdminCsrf/.test(routes) && /broadcasts\/:id\/send', requireAdminSession, requireAdminCsrf/.test(routes));

const appRoutes = read('server/src/routes/appRoutes.js');
check('the public banner endpoint is registered', /router\.get\('\/announcements'/.test(appRoutes));

const server = read('server/src/server.js');
check('the scheduled-broadcast timer is wired', /runDue/.test(server) && /setInterval/.test(server));

check('the dashboard has a Broadcasts page', fs.existsSync(path.join(repo, 'apps/web/src/pages/admin/BroadcastsPage.tsx')));
check('the Broadcasts page is wired into the dashboard', /BroadcastsPage/.test(read('apps/web/src/pages/admin/AdminApp.tsx')) && /\/admin\/broadcasts/.test(read('apps/web/src/pages/admin/AdminApp.tsx')));
check('the app has an announcement banner component', fs.existsSync(path.join(repo, 'apps/web/src/components/AnnouncementBanner.tsx')));
check('the app renders the announcement banner', /AnnouncementBanner/.test(read('apps/web/src/App.tsx')));

const model = read('server/src/models/Broadcast.js');
check('broadcasts model both kinds and statuses', /kind/.test(model) && /banner/.test(model) && /scheduled/.test(model));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
