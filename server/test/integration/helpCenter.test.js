/**
 * Integration test: help centre + widget conversations (section W backend).
 *
 *   cd server && node test/integration/helpCenter.test.js
 */
const mongoose = require('mongoose');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';

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

async function api(method, path, { token, body, headers: extraHeaders } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const run = Date.now().toString(36);
const guestId = `guest-${run}-0123456789abcdef`;
const otherGuest = `guest-${run}-fedcba9876543210`;

async function main() {
  console.log(`\nhelp centre integration test against ${BASE}\n`);
  // Connect early: the human-reply bridge uses the models directly.
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const health = await api('GET', '/api/status/health');
  check('GET /api/status/health -> 200', health.status === 200, `got ${health.status}`);
  check('health reports the database', health.body?.database === 'connected', JSON.stringify(health.body));
  check('health reports storage', ['local', 'cloudinary'].includes(health.body?.storage), JSON.stringify(health.body));

  // ------------------------------------------------------------ content
  const collections = await api('GET', '/api/help/collections');
  check('collections -> 200', collections.status === 200, `got ${collections.status}`);
  check('seeded at least 10 collections', (collections.body || []).length >= 10, String((collections.body || []).length));
  const totalArticles = (collections.body || []).reduce((sum, collection) => sum + collection.articleCount, 0);
  check('seeded at least 25 articles', totalArticles >= 25, String(totalArticles));

  const accountCollection = (collections.body || []).find((collection) => collection.slug === 'account');
  check('account collection has articles', accountCollection?.articleCount >= 5, JSON.stringify(accountCollection));

  const collection = await api('GET', '/api/help/collections/chats');
  check('collection detail -> 200', collection.status === 200, `got ${collection.status}`);
  check('collection lists its articles', Array.isArray(collection.body?.articles) && collection.body.articles.length > 0);
  const article = await api('GET', '/api/help/articles/change-password');
  check('article -> 200', article.status === 200, `got ${article.status}`);
  check('article has a body', (article.body?.body || '').length > 100, String(article.body?.body?.length));
  check('article has related links', Array.isArray(article.body?.related));
  const missing = await api('GET', '/api/help/articles/does-not-exist');
  check('missing article -> 404', missing.status === 404, `got ${missing.status}`);

  const search = await api('GET', '/api/help/search?q=forgot%20my%20password');
  check('search -> 200', search.status === 200, `got ${search.status}`);
  check(
    'search finds the reset article',
    (search.body?.results || []).some((result) => result.slug === 'reset-password'),
    JSON.stringify((search.body?.results || []).map((r) => r.slug)),
  );
  const shortSearch = await api('GET', '/api/help/search?q=a');
  check('one-letter search is ignored', (shortSearch.body?.results || []).length === 0);

  // -------------------------------------------------------- conversations
  const created = await api('POST', '/api/help/conversations', { body: { guestId, displayName: 'Test Guest' } });
  check('create guest conversation -> 201', created.status === 201, `got ${created.status} ${JSON.stringify(created.body)}`);
  const conversationId = created.body?.conversation?.id;
  check('conversation has a welcome message', (created.body?.conversation?.messages || []).length >= 1);
  check('welcome is from the assistant', created.body?.conversation?.messages?.[0]?.role === 'assistant');

  const noGuest = await api('POST', '/api/help/conversations', { body: {} });
  check('create without guestId -> 400', noGuest.status === 400, `got ${noGuest.status}`);

  const posted = await api('POST', `/api/help/conversations/${conversationId}/messages`, {
    body: { guestId, text: 'How do I change my password?' },
  });
  check('post message -> 201', posted.status === 201, `got ${posted.status} ${JSON.stringify(posted.body)}`);
  check('assistant replied', typeof posted.body?.reply?.text === 'string' && posted.body.reply.text.length > 20, JSON.stringify(posted.body?.reply));
  check('assistant cites an article', typeof posted.body?.reply?.articleSlug === 'string', JSON.stringify(posted.body?.reply));
  check('reply source is kb locally (AI disabled)', posted.body?.source === 'kb' || posted.body?.source === 'ai', posted.body?.source);

  const list = await api('GET', `/api/help/conversations?guestId=${guestId}`);
  check('list conversations -> 200', list.status === 200, `got ${list.status}`);
  check('conversation is in the list', (list.body || []).some((conversation) => conversation.id === conversationId));
  check('preview is present', typeof (list.body || [])[0]?.preview === 'string');

  const detail = await api('GET', `/api/help/conversations/${conversationId}?guestId=${guestId}`);
  check('get conversation -> 200', detail.status === 200, `got ${detail.status}`);
  check('conversation contains both messages', (detail.body?.messages || []).length >= 3, String((detail.body?.messages || []).length));

  const strangerRead = await api('GET', `/api/help/conversations/${conversationId}?guestId=${otherGuest}`);
  check('another guest cannot read it -> 403', strangerRead.status === 403, `got ${strangerRead.status}`);
  const strangerPost = await api('POST', `/api/help/conversations/${conversationId}/messages`, {
    body: { guestId: otherGuest, text: 'intruder' },
  });
  check('another guest cannot post -> 403', strangerPost.status === 403, `got ${strangerPost.status}`);

  const assistantMessageId = posted.body?.reply?.id;
  const feedback = await api('POST', `/api/help/messages/${assistantMessageId}/feedback`, {
    body: { guestId, value: 'up' },
  });
  check('feedback -> 200', feedback.status === 200 && feedback.body?.feedback === 'up', JSON.stringify(feedback.body));
  const strangerFeedback = await api('POST', `/api/help/messages/${assistantMessageId}/feedback`, {
    body: { guestId: otherGuest, value: 'down' },
  });
  check('stranger feedback -> 403', strangerFeedback.status === 403, `got ${strangerFeedback.status}`);

  const badEmail = await api('POST', `/api/help/conversations/${conversationId}/transcript`, {
    body: { guestId, email: 'not-an-email' },
  });
  check('transcript with a bad email -> 400', badEmail.status === 400, `got ${badEmail.status}`);
  const transcript = await api('POST', `/api/help/conversations/${conversationId}/transcript`, {
    body: { guestId, email: 'help-test@chatgram.test' },
  });
  check('transcript -> 200', transcript.status === 200, `got ${transcript.status}`);
  check('transcript reports delivery state', typeof transcript.body?.delivered === 'boolean', JSON.stringify(transcript.body));

  // ------------------------------------------------------------- handoff
  const handoff = await api('POST', `/api/help/conversations/${conversationId}/handoff`, {
    body: { guestId, contact: 'help-test@chatgram.test', page: '/settings' },
  });
  check('handoff -> 201', handoff.status === 201, `got ${handoff.status} ${JSON.stringify(handoff.body)}`);
  check('handoff returns a ticket id', /^CG-[A-Z0-9]{5}$/.test(handoff.body?.ticketId || ''), handoff.body?.ticketId);
  check('handoff posts a system message', handoff.body?.message?.role === 'system', JSON.stringify(handoff.body?.message));
  const handoffAgain = await api('POST', `/api/help/conversations/${conversationId}/handoff`, { body: { guestId } });
  check('handoff is idempotent', handoffAgain.body?.ticketId === handoff.body?.ticketId, JSON.stringify(handoffAgain.body));

  const afterHandoff = await api('GET', `/api/help/conversations/${conversationId}?guestId=${guestId}`);
  check('conversation remembers the ticket', afterHandoff.body?.ticketId === handoff.body?.ticketId, String(afterHandoff.body?.ticketId));

  // ------------------------------------------------ human reply bridge
  const delivered = await (async () => {
    const { deliverAgentReply } = require('../../src/help/replyBridge');
    return deliverAgentReply(handoff.body.ticketId, 'A person here: try Settings, Account.');
  })();
  check('agent reply bridge stores a message', Boolean(delivered && delivered.role === 'agent'));
  const afterReply = await api('GET', `/api/help/conversations/${conversationId}?guestId=${guestId}`);
  check(
    'widget conversation shows the human reply',
    (afterReply.body?.messages || []).some((message) => message.role === 'agent' && /A person here/.test(message.text)),
    JSON.stringify((afterReply.body?.messages || []).slice(-2)),
  );

  // --------------------------------------------------------- resolve/delete
  const resolved = await api('POST', `/api/help/conversations/${conversationId}/resolve`, { body: { guestId } });
  check('resolve -> 200', resolved.status === 200 && resolved.body?.status === 'resolved', JSON.stringify(resolved.body));
  const deleted = await api('DELETE', `/api/help/conversations/${conversationId}?guestId=${guestId}`);
  check('delete conversation -> 200', deleted.status === 200 && deleted.body?.deleted === true, JSON.stringify(deleted.body));
  const gone = await api('GET', `/api/help/conversations/${conversationId}?guestId=${guestId}`);
  check('deleted conversation -> 404', gone.status === 404, `got ${gone.status}`);

  // --------------------------------------------------------------- admin
  // 9a: the help editor lives under the admin session only (the old
  // support-account role guard was removed).
  const adminLogin = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'staging-admin-password-123' }),
  });
  const adminLoginBody = await adminLogin.json();
  const adminHeaders = {
    Cookie: (adminLogin.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': adminLoginBody.csrfToken,
  };
  check('admin login for the help editor', adminLogin.status === 200 && Boolean(adminLoginBody.csrfToken), `got ${adminLogin.status}`);

  const normalUser = await api('POST', '/api/auth/register', {
    body: { displayName: 'Normal User', identifier: `help-normal-${run}@chatgram.test`, password: 'NormalPass1!' },
  });
  const nonAdmin = await api('GET', '/api/admin/support/help/articles', { token: normalUser.body.accessToken });
  check('a normal user cannot use the admin help API -> 401', nonAdmin.status === 401, `got ${nonAdmin.status}`);

  const adminArticles = await api('GET', '/api/admin/support/help/articles', { headers: adminHeaders });
  check('admin lists articles', adminArticles.status === 200 && (adminArticles.body || []).length >= 25, `got ${adminArticles.status}`);
  const createdArticle = await api('PUT', '/api/admin/support/help/articles', {
    headers: adminHeaders,
    body: {
      slug: `test-article-${run}`,
      collectionSlug: 'troubleshooting',
      title: 'Test article',
      summary: 'Created by the integration test',
      body: 'This article is created by the automated test and deleted afterwards.',
      keywords: ['test'],
    },
  });
  check('admin creates an article', createdArticle.status === 200, `got ${createdArticle.status}`);
  const publicArticle = await api('GET', `/api/help/articles/test-article-${run}`);
  check('created article is public', publicArticle.status === 200, `got ${publicArticle.status}`);
  const updatedArticle = await api('PUT', '/api/admin/support/help/articles', {
    headers: adminHeaders,
    body: { slug: `test-article-${run}`, collectionSlug: 'troubleshooting', title: 'Updated title', body: 'Updated body text.' },
  });
  check('admin updates the article', updatedArticle.body?.title === 'Updated title', updatedArticle.body?.title);
  const deletedArticle = await api('DELETE', `/api/admin/support/help/articles/test-article-${run}`, { headers: adminHeaders });
  check('admin deletes the article', deletedArticle.status === 200, `got ${deletedArticle.status}`);
  const badArticle = await api('PUT', '/api/admin/support/help/articles', {
    headers: adminHeaders,
    body: { slug: 'missing-fields' },
  });
  check('admin article validation -> 400', badArticle.status === 400, `got ${badArticle.status}`);

  // --------------------------------------------------------------- cleanup
  const HelpConversation = require('../../src/help/models').HelpConversation;
  const HelpMessage = require('../../src/help/models').HelpMessage;
  const SupportTicket = require('../../src/models/SupportTicket');
  const User = require('../../src/models/User');
  await HelpMessage.deleteMany({ conversationId: { $in: [] } });
  await HelpConversation.deleteMany({ guestId: { $in: [guestId, otherGuest] } });
  await SupportTicket.deleteMany({ contact: 'help-test@chatgram.test' });
  await User.deleteMany({ email: new RegExp(`^help-(admin|normal)-${run}@chatgram\\.test$`) });
  await mongoose.disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
