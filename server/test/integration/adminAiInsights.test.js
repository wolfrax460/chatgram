/**
 * Chatgram AI insight pages: usage analytics + knowledge base editor.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminAiInsights.test.js
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
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''}`);
  }
}

async function api(method, route, { body, headers, token } = {}) {
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
  console.log('\nAI usage + knowledge base (admin)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const admin = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': admin.csrfToken };
  check('admin login works', login.status === 200 && Boolean(admin.csrfToken), login.status);

  let createdId = null;
  try {
    // Auth gates.
    for (const [method, route] of [
      ['GET', '/api/admin/ai/usage'],
      ['GET', '/api/admin/ai/knowledge'],
      ['POST', '/api/admin/ai/knowledge'],
    ]) {
      check(`${method} ${route} requires the admin session`, (await api(method, route)).status === 401);
      check(`${method} ${route} rejects a normal user token`, (await api(method, route, { token: 'fake-user-token' })).status === 401);
    }

    // Usage analytics.
    const usage = await api('GET', '/api/admin/ai/usage?days=7', { headers });
    check('usage returns 200', usage.status === 200, usage.status);
    check('usage has totals', ['answers', 'questions', 'unknown', 'conversations', 'knowledgeEntries', 'knowledgeUses'].every((key) => typeof usage.body?.totals?.[key] === 'number'), usage.body?.totals);
    check('usage has a per-day series of the requested length', Array.isArray(usage.body?.series) && usage.body.series.length === 7, usage.body?.series?.length);
    check('usage lists answers per provider', Array.isArray(usage.body?.byProvider));
    check('usage lists top questions', Array.isArray(usage.body?.topQuestions));
    check('usage lists inbox items by type', Array.isArray(usage.body?.inboxByType));
    check('usage never returns prompts from other users', !usage.text.includes('"userId"') && !usage.text.includes('askerHash'), 'leaked identifiers');

    // Knowledge base CRUD.
    const list = await api('GET', '/api/admin/ai/knowledge?limit=5', { headers });
    check('knowledge list returns 200', list.status === 200, list.status);
    check('knowledge list is paginated', typeof list.body?.total === 'number' && typeof list.body?.pageCount === 'number');
    check('knowledge entries never expose Mongo internals', !list.text.includes('__v') && !list.text.includes('_id'), 'internal fields');

    const question = `What is the smoke test question ${run}?`;
    const create = await api('POST', '/api/admin/ai/knowledge', {
      headers,
      body: { question, answer: 'This is the stored answer for the smoke test.', keywords: 'smoke,test' },
    });
    check('creating a knowledge entry works', create.status === 200, create.status);
    createdId = create.body?.entry?.id;
    check('the new entry has an id', Boolean(createdId));

    const found = await api('GET', `/api/admin/ai/knowledge?search=${encodeURIComponent(`smoke test question ${run}`)}`, { headers });
    check('search finds the new entry', (found.body.entries || []).some((row) => row.id === createdId), found.body.total);

    const update = await api('PUT', `/api/admin/ai/knowledge/${createdId}`, {
      headers,
      body: { question, answer: 'Updated answer from the admin editor.', keywords: ['smoke', 'edited'] },
    });
    check('updating the entry works', update.status === 200, update.status);
    const afterUpdate = await api('GET', `/api/admin/ai/knowledge?search=${encodeURIComponent(`smoke test question ${run}`)}`, { headers });
    const stored = (afterUpdate.body.entries || []).find((row) => row.id === createdId);
    check('the updated answer is stored', stored?.answer === 'Updated answer from the admin editor.', stored?.answer);
    check('the updated keywords are stored', (stored?.keywords || []).includes('edited'), stored?.keywords);

    // Validation + CSRF.
    check('a missing answer is rejected', (await api('POST', '/api/admin/ai/knowledge', { headers, body: { question: 'q' } })).status === 400);
    const noCsrf = await api('POST', '/api/admin/ai/knowledge', { headers: { Cookie: headers.Cookie }, body: { question: 'q', answer: 'a' } });
    check('knowledge writes require the CSRF header', noCsrf.status === 403, noCsrf.status);

    const remove = await api('DELETE', `/api/admin/ai/knowledge/${createdId}`, { headers });
    check('deleting the entry works', remove.status === 200, remove.status);
    const afterDelete = await api('GET', `/api/admin/ai/knowledge?search=${encodeURIComponent(`smoke test question ${run}`)}`, { headers });
    check('the entry is gone', !(afterDelete.body.entries || []).some((row) => row.id === createdId));
    check('deleting a missing entry returns 404', (await api('DELETE', `/api/admin/ai/knowledge/${createdId}`, { headers })).status === 404);

    // Every knowledge action is audited.
    const audit = await api('GET', '/api/admin/audit?search=ai_knowledge&days=1', { headers });
    const actions = (audit.body.entries || []).map((row) => row.action);
    check('knowledge create/update/delete are audited', ['ai_knowledge_create', 'ai_knowledge_update', 'ai_knowledge_delete'].every((action) => actions.includes(action)), actions.slice(0, 6));
  } finally {
    if (createdId) await api('DELETE', `/api/admin/ai/knowledge/${createdId}`, { headers }).catch(() => {});
    const { AiKnowledge } = require('../../src/ai/chatgram');
    await AiKnowledge.deleteMany({ question: new RegExp(`smoke test question ${run}`) });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
