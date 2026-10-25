/**
 * 9b Announcements: in-app banner publishing + official-account broadcasts with
 * preview, confirmation, scheduling and delivery. Admin session only.
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/adminBroadcasts.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const BANNER_TEXT = `Maintenance notice ${run}: we ship at midnight.`;

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

async function register(label) {
  const identifier = `cast-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', { body: { displayName: `Cast ${label} ${run}`, identifier, password: 'CastTest1!' } });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status} ${result.text}`);
  return result.body;
}

async function main() {
  console.log('\nannouncements & broadcasts (9b)\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const Broadcast = require('../../src/models/Broadcast');
  const AdminAudit = require('../../src/models/AdminAudit');

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

  const publicBefore = await api('GET', '/api/app/announcements');
  check('the public announcement endpoint works without auth', publicBefore.status === 200 && 'banner' in (publicBefore.body || {}), publicBefore.status);
  check('a draft banner is not visible publicly', publicBefore.body?.banner?.body !== BANNER_TEXT, publicBefore.body?.banner?.body);

  const userTokenAsk = await api('GET', '/api/admin/broadcasts', { token: 'not-a-real-token' });
  check('a normal user token cannot read the announcements admin API', userTokenAsk.status === 401, userTokenAsk.status);

  // --- banner lifecycle ----------------------------------------------------
  const draft = await api('POST', '/api/admin/broadcasts', {
    headers,
    body: { kind: 'banner', title: `Notice ${run}`, body: BANNER_TEXT, link: '/web/#chatgram-ai' },
  });
  const bannerId = draft.body?.broadcast?.id;
  check('a banner draft is created', draft.status === 201 && draft.body?.broadcast?.status === 'draft', draft.status);
  const draftVisible = await api('GET', '/api/app/announcements');
  check('the draft banner is still hidden', draftVisible.body?.banner?.body !== BANNER_TEXT, draftVisible.body?.banner?.body);

  const noConfirm = await api('POST', `/api/admin/broadcasts/${bannerId}/send`, { headers, body: {} });
  check('publishing without confirmation is refused', noConfirm.status === 400 && noConfirm.body?.code === 'CONFIRM_REQUIRED', noConfirm.status);
  const published = await api('POST', `/api/admin/broadcasts/${bannerId}/send`, { headers, body: { confirm: true } });
  check('the banner publishes with confirmation', published.status === 200 && published.body?.broadcast?.status === 'sent', published.status);
  const visible = await api('GET', '/api/app/announcements');
  check('the published banner is public', visible.status === 200 && visible.body?.banner?.body === BANNER_TEXT, visible.body?.banner?.body);
  check('the public banner carries the link and no secrets', visible.body?.banner?.link === '/web/#chatgram-ai' && !/password|token/i.test(JSON.stringify(visible.body)), visible.body?.banner?.link);
  const deleteSent = await api('DELETE', `/api/admin/broadcasts/${bannerId}`, { headers });
  check('sent announcements cannot be deleted (they are the record)', deleteSent.status === 409, deleteSent.status);

  // --- message broadcast to selected test accounts -------------------------
  const a = await register('a');
  const b = await register('b');
  const messageDraft = await api('POST', '/api/admin/broadcasts', {
    headers,
    body: {
      kind: 'message',
      body: `Welcome to Chatgram ${run}! Chatgram AI is in your chat list.`,
      segment: 'selected',
      recipientIds: [a.user.id, b.user.id],
    },
  });
  const messageId = messageDraft.body?.broadcast?.id;
  check('a message broadcast draft is created', messageDraft.status === 201 && messageDraft.body?.broadcast?.kind === 'message', messageDraft.status);
  const preview = await api('GET', `/api/admin/broadcasts/${messageId}/preview`, { headers });
  check('the preview counts the selected recipients', preview.status === 200 && preview.body?.recipientCount === 2 && preview.body?.sample?.length === 2, { count: preview.body?.recipientCount, sample: preview.body?.sample?.length });
  const sent = await api('POST', `/api/admin/broadcasts/${messageId}/send`, { headers, body: { confirm: true } });
  check('the message broadcast sends', sent.status === 200 && sent.body?.broadcast?.sentCount === 2 && sent.body?.broadcast?.status === 'sent', { status: sent.status, sentCount: sent.body?.broadcast?.sentCount });

  const broadcastMessages = await Message.find({ content: new RegExp('Welcome to Chatgram ' + run) }).lean();
  check('the broadcast message is delivered once per recipient', broadcastMessages.length === 2, broadcastMessages.length);
  const deliveredChats = await Chat.find({ _id: { $in: broadcastMessages.map((row) => row.chatId) } }).populate('participants', 'displayName isSupportAccount email').lean();
  const officialNames = deliveredChats.flatMap((chat) => (chat.participants || []).filter((participant) => participant.isSupportAccount || String(participant.email || '').toLowerCase() === String(process.env.CHATGRAM_ADMIN_EMAIL || '').toLowerCase()).map((participant) => participant.displayName));
  check('the broadcast message comes from an official account', deliveredChats.length === 2 && officialNames.length === 2, officialNames);
  check('each broadcast message is in a direct chat with its recipient', deliveredChats.every((chat) => chat.type === 'direct' && chat.participants.length === 2), deliveredChats.map((chat) => chat.participants.length));


  // --- scheduled delivery --------------------------------------------------
  const scheduled = await api('POST', '/api/admin/broadcasts', {
    headers,
    body: { kind: 'message', body: `Scheduled notice ${run}`, segment: 'selected', recipientIds: [a.user.id], scheduledAt: new Date(Date.now() + 1500).toISOString() },
  });
  const scheduledId = scheduled.body?.broadcast?.id;
  check('a future announcement is scheduled', scheduled.status === 201 && scheduled.body?.broadcast?.status === 'scheduled', scheduled.status);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const due = await api('POST', '/api/admin/broadcasts/run-due', { headers, body: {} });
  check('the scheduler delivers due announcements', due.status === 200 && due.body?.delivered >= 1, due.status);
  const scheduledAfter = await api('GET', `/api/admin/broadcasts?limit=50`, { headers });
  const scheduledRow = (scheduledAfter.body?.broadcasts || []).find((row) => row.id === scheduledId);
  check('the scheduled announcement is marked sent', scheduledRow?.status === 'sent' && scheduledRow?.sentCount === 1, scheduledRow?.status);

  // --- audit ---------------------------------------------------------------
  const audit = await AdminAudit.findOne({ action: 'announcement_send', detail: new RegExp(`message ${messageId}`) }).lean();
  check('broadcast sends are audited', Boolean(audit), null);
  const auditCreate = await AdminAudit.findOne({ action: 'announcement_create', detail: new RegExp(String(bannerId)) }).lean();
  check('announcement creation is audited', Boolean(auditCreate), null);

  // --- cleanup -------------------------------------------------------------
  const ids = [a.user.id, b.user.id].map((id) => new mongoose.Types.ObjectId(String(id)));
  const chats = await Chat.find({ participants: { $in: ids } }).select('_id').lean();
  const chatIds = chats.map((row) => row._id);
  await Message.deleteMany({ chatId: { $in: chatIds } });
  await Chat.deleteMany({ _id: { $in: chatIds } });
  await Broadcast.deleteMany({ $or: [{ body: new RegExp(run) }, { _id: { $in: [bannerId, messageId, scheduledId].filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id))) } }] });
  await User.deleteMany({ _id: { $in: ids } });
  await AdminAudit.deleteMany({ detail: new RegExp(`${run}|${bannerId}|${messageId}`) });

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('broadcasts test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
