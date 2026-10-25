/**
 * 9d oversight guard rails that are enforced by code shape rather than runtime
 * state: the notices users see, the reason requirement, the absence of any
 * write route in the admin review API, and the model's expiry fields.
 *
 *   node server/test/unit/oversightNotices.test.js
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

console.log('\noversight notices and read-only guard rails (9d)\n');

const auth = read('apps/web/src/pages/Auth.tsx');
check('the sign-up page warns that chats are not end-to-end encrypted', auth.includes('signup-privacy-notice') && /not end-to-end encrypted/i.test(auth));
check('the sign-up page says administrators may review content', /administrators may review/i.test(auth));

const settings = read('apps/web/src/pages/Settings.tsx');
check('the in-app privacy settings carry the same notice', settings.includes('privacy-admin-review-notice') && /not end-to-end encrypted/i.test(settings));

const policyHtml = read('client/landing/public/docs/index.html');
check('the public privacy policy says administrators can review content', /Authorised Chatgram administrators can review conversation content/i.test(policyHtml));
const policyJsx = read('client/landing/src/Docs.jsx');
check('the landing docs page carries the review sentence', /Authorised Chatgram administrators can review conversation content/i.test(policyJsx));

const model = read('server/src/models/ReviewSession.js');
check('review sessions require a reason', /reason: \{ type: String, required: true/.test(model));
check('review sessions expire and track activity', /expiresAt/.test(model) && /lastActivityAt/.test(model));
check('review sessions are tied to the admin panel session that created them', /adminSessionId/.test(model));

const controller = read('server/src/controllers/adminReviewController.js');
check('a reason shorter than 10 characters is rejected', /MIN_REASON = 10/.test(controller));
check('inactivity expires the review after 15 minutes', /IDLE_MS = 15 \* 60 \* 1000/.test(controller));
check('every message read is audited', /review_view/.test(controller));
check('reviews are rate limited', /RATE_LIMIT_PER_HOUR/.test(controller));
check('a review burst raises an admin Inbox alert', /review_burst/.test(controller));
check('review retention defaults to 2 years', /730/.test(controller));
check('message payloads never select password/token fields', !/password|refreshToken|totpSecret/.test(controller));

const routes = read('server/src/routes/adminRoutes.js');
check('the review API exposes read-only endpoints', /router\.get\('\/reviews\/:id\/messages'/.test(routes) && /router\.get\('\/reviews\/:id\/conversations'/.test(routes));
check('no admin route can POST messages or conversations', !/router\.post\('\/reviews\/:id\/(messages|conversations)'/.test(routes));
check('every review route requires the admin session', (routes.match(/router\.(get|post)\('\/reviews[^']*', requireAdminSession/g) || []).length === 7);
check('review state changes require the CSRF token', /router\.post\('\/reviews', requireAdminSession, requireAdminCsrf/.test(routes) && /router\.post\('\/reviews\/:id\/end', requireAdminSession, requireAdminCsrf/.test(routes));

const dashboard = read('apps/web/src/pages/admin/AdminApp.tsx');
check('the dashboard exposes a Who viewed what screen', dashboard.includes('/admin/reviews') && /Who viewed what/.test(dashboard));
const userDetail = read('apps/web/src/pages/admin/UserDetailPage.tsx');
check('user detail has a conversations tab behind the review gate', /ReviewConversationsTab/.test(userDetail) && /'conversations'/.test(userDetail));
const tab = read('apps/web/src/pages/admin/ReviewConversationsTab.tsx');
check('content is hidden until a reason is entered', tab.includes('Security review required') && !/useEffect\(\(\) => \{\s*void refreshConversations/.test(tab));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failures:', failures.join(' | '));
  process.exit(1);
}
