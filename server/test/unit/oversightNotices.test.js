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
check('the public privacy policy says Chatgram AI reports are visible to the team', /Chatgram AI reports/.test(policyHtml) && /visible only to authorised Chatgram team members/.test(policyHtml));
check('the public privacy policy says the server sends the report, not the AI model', /not the AI model/.test(policyHtml) && /server<\/strong>/.test(policyHtml));
check('the public privacy policy explains what a report contains', /A report you ask for/.test(policyHtml) && /A question the AI cannot answer/.test(policyHtml));
check('the public privacy policy is honest about how a report is linked to the asker', /Every report is linked to your account so the team can follow up/.test(policyHtml) && /In a group, your display name is included/.test(policyHtml));
check('the public privacy policy says chats are protected in transit but not end-to-end encrypted', /conversations are protected in transit with TLS/.test(policyHtml) && /not end-to-end encrypted/.test(policyHtml));
check('the public privacy policy says reported or flagged content can be reviewed', /including content you report to us or that our safety checks flag/.test(policyHtml));
// The /docs page is now static HTML copied verbatim by the landing build
// (client/landing/scripts/build.mjs copies public/ into dist/); the old
// client/landing/src/Docs.jsx source no longer exists.
const landingBuild = read('client/landing/scripts/build.mjs');
check('the landing build copies the /docs page into dist', /cp\(path\.join\(LANDING, 'public'\), DIST/.test(landingBuild));

const i18n = read('apps/web/src/lib/i18n.ts');
check('all four locales carry the Chatgram AI notice', (i18n.match(/\n  aiNotice:/g) || []).length === 4);
check('the English notice says reports are sent to the Chatgram team and visible to them', /sends a report to the Chatgram team, who can see it/.test(i18n));
check('the English notice says reports are linked to the asker account for follow-up', /Reports are linked to your account so the team can reply/.test(i18n) && /in a group your name is included/.test(i18n));
check('the English notice says chats are protected in transit but not end-to-end encrypted', /protected in transit but not end-to-end encrypted/.test(i18n));
check('the Kinyarwanda notice says reports reach the Chatgram team', /ikipe ya Chatgram/.test(i18n));
check('the French notice says reports reach the Chatgram team', /l’équipe Chatgram/.test(i18n));
check('the Swahili notice says reports reach the Chatgram team', /timu ya Chatgram/.test(i18n));
check('every notice mentions end-to-end encryption', (i18n.match(/end-to-end/g) || []).length >= 4);
const aiThread = read('apps/web/src/components/AiThread.tsx');
check('the AI thread renders the translated notice', aiThread.includes("t('aiNotice')"));
check('the AI notice is no longer hardcoded in the component', !/const DISCLAIMER/.test(aiThread));

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
check('the global message search route is read-only', /router\.get\('\/reviews\/:id\/search'/.test(routes) && !/router\.post\('\/reviews\/:id\/search'/.test(routes));
check('message search requires a search-scope review session', /scope !== 'search'/.test(controller));
check('message search results are capped and paginated', /MAX_SEARCH_ROWS = 500/.test(controller) && /clampLimit/.test(controller));
check('the dashboard has a Message search page', fs.existsSync(require('path').join(repo, 'apps/web/src/pages/admin/SearchPage.tsx')));
check('every review route requires the admin session', (routes.match(/router\.(get|post)\('\/reviews[^']*', requireAdminSession/g) || []).length === 8);
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

