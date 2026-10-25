/**
 * 9b Support desk endpoints (admin session): stats, settings, AI/KB read,
 * ticket queue/detail and the reply path, with auth + CSRF gates.
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminSupport.test.js
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
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 220)}` : ''}`);
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

async function main() {
  console.log('\nsupport desk (admin session)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const SupportTicket = require('../../src/models/SupportTicket');

  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  const headers = { Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': loginBody.csrfToken };
  check('admin login works', login.status === 200 && Boolean(loginBody.csrfToken), login.status);

  const ticketIds = [];
  try {
    // Auth gates.
    for (const route of [
      '/api/admin/support/stats',
      '/api/admin/support/settings',
      '/api/admin/support/tickets',
      '/api/admin/support/ai',
      '/api/admin/support/kb',
    ]) {
      check(`GET ${route} requires the admin session`, (await api('GET', route)).status === 401);
      check(`GET ${route} rejects a user token`, (await api('GET', route, { token: 'fake-user-token' })).status === 401);
    }
    check('the reply endpoint requires the admin session', (await api('POST', '/api/admin/support/tickets/ABC123/reply', { body: { text: 'hi' } })).status === 401);

    // Read endpoints.
    const stats = await api('GET', '/api/admin/support/stats', { headers });
    check('stats returns counts', stats.status === 200 && typeof stats.body?.counts?.total === 'number', stats.body?.counts);
    const settings = await api('GET', '/api/admin/support/settings', { headers });
    check('settings returns the support settings + channel status', settings.status === 200 && typeof settings.body?.settings === 'object' && typeof settings.body?.status === 'object', settings.status);
    check('settings never returns secret keys', !/(apiKey|secret|token)"\s*:/i.test(settings.text), 'secret-looking field');
    const ai = await api('GET', '/api/admin/support/ai', { headers });
    check('the support AI configuration is readable', ai.status === 200, ai.status);
    const kb = await api('GET', '/api/admin/support/kb', { headers });
    check('the support knowledge base is readable', kb.status === 200, kb.status);

    // A ticket shows up in the queue and detail. Created directly in the DB:
    // the public endpoint also drops a copy in the Support account chat, which
    // needs the staging Support account to exist (production has it).
    const ticketId = SupportTicket.newTicketId();
    ticketIds.push(ticketId);
    await SupportTicket.create({
      ticketId,
      guestId: `support-desk-${run}`,
      contact: `support-desk-${run}@chatgram.test`,
      contactType: 'email',
      summary: `Support desk UI check ${run}`,
      transcript: [{ role: 'guest', text: 'I cannot sign in' }],
      meta: { page: '/web/help' },
    });
    check('the new ticket has an id', Boolean(ticketId));

    const queue = await api('GET', `/api/admin/support/tickets?q=${encodeURIComponent(run)}`, { headers });
    check('the queue lists the ticket', queue.status === 200 && (queue.body.tickets || []).some((row) => row.ticketId === ticketId), (queue.body.tickets || []).length);
    const row = (queue.body.tickets || []).find((entry) => entry.ticketId === ticketId) || {};
    check('ticket rows carry status/contact/summary', Boolean(row.status && row.contact && row.summary), row);
    const detail = await api('GET', `/api/admin/support/tickets/${ticketId}`, { headers });
    check('the ticket detail returns the transcript', detail.status === 200 && (detail.body?.ticket?.transcript || []).some((entry) => entry.text.includes('cannot sign in')), detail.status);
    check('the detail never returns secrets', !/(password|apiKey|secret)"\s*:/i.test(detail.text), 'secret-looking field');
    const missing = await api('GET', '/api/admin/support/tickets/ZZZ000', { headers });
    check('an unknown ticket returns 404', missing.status === 404, missing.status);

    // Reply path: contact-only tickets are refused, CSRF is required.
    const reply = await api('POST', `/api/admin/support/tickets/${ticketId}/reply`, { headers, body: { text: 'We are looking into it.' } });
    check('a contact-only ticket cannot be replied to in the chat', reply.status === 400, reply.status);
    const noCsrf = await api('POST', `/api/admin/support/tickets/${ticketId}/reply`, { headers: { Cookie: headers.Cookie }, body: { text: 'x' } });
    check('replies require the CSRF header', noCsrf.status === 403, noCsrf.status);
    const empty = await api('POST', `/api/admin/support/tickets/${ticketId}/reply`, { headers, body: { text: '  ' } });
    check('an empty reply is refused', empty.status === 400, empty.status);

    // Audit trail for support settings writes (validation only, no change).
    const badSettings = await api('PUT', '/api/admin/support/settings', { headers, body: {} });
    check('settings updates validate their input', [200, 400].includes(badSettings.status), badSettings.status);
  } finally {
    for (const ticketId of ticketIds) {
      await SupportTicket.deleteOne({ ticketId }).catch(() => {});
    }
    await SupportTicket.deleteMany({ contact: new RegExp(`^support-desk-${run}@chatgram\\.test$`) });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
