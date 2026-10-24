/**
 * Integration test: message edit / star / forward / report (section 9 basics).
 *
 *   cd server && node test/integration/messageFeatures.test.js
 */
const mongoose = require('mongoose');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
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

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
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

async function createUser(label) {
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Msg ${label}`, identifier: `msg-${label}-${run}@chatgram.test`, password: 'MessagePass1!' },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id, displayName: `Msg ${label}` };
}

async function main() {
  console.log(`\nmessage features integration test against ${BASE}\n`);
  const a = await createUser('alice');
  const b = await createUser('bob');
  const c = await createUser('carol');

  const direct = await api('POST', '/api/chats', { token: a.token, body: { type: 'direct', participantId: b.id } });
  const chatId = direct.body._id;
  const group = await api('POST', '/api/chats', {
    token: a.token,
    body: { type: 'group', groupName: `Forward target ${run}`, participantIds: [c.id] },
  });
  const groupId = group.body._id;
  check('setup: direct chat + group', Boolean(chatId && groupId));

  const sent = await api('POST', '/api/messages', { token: a.token, body: { chatId, type: 'text', content: 'Original text' } });
  check('send message -> 201', sent.status === 201, `got ${sent.status}`);
  const messageId = sent.body._id;

  // ------------------------------------------------------------------ edit
  const edit = await api('PATCH', `/api/messages/${messageId}`, { token: a.token, body: { content: 'Edited text' } });
  check('sender edits own message -> 200', edit.status === 200, `got ${edit.status} ${JSON.stringify(edit.body)}`);
  check('edit returns the new content', edit.body?.content === 'Edited text', JSON.stringify(edit.body));
  check('edit sets editedAt', Boolean(edit.body?.editedAt), JSON.stringify(edit.body?.editedAt));

  const seenByB = await api('GET', `/api/messages?chatId=${chatId}`, { token: b.token });
  const editedRow = (seenByB.body?.messages || []).find((row) => row._id === messageId);
  check('the other participant sees the edited content', editedRow?.content === 'Edited text', editedRow?.content);
  check('the editedAt flag reaches the other participant', Boolean(editedRow?.editedAt));

  const editByB = await api('PATCH', `/api/messages/${messageId}`, { token: b.token, body: { content: 'hijack' } });
  check('somebody else cannot edit -> 403', editByB.status === 403, `got ${editByB.status}`);
  check('edit denial code is NOT_SENDER', editByB.body?.code === 'NOT_SENDER', JSON.stringify(editByB.body));
  const editEmpty = await api('PATCH', `/api/messages/${messageId}`, { token: a.token, body: { content: '   ' } });
  check('editing to empty text -> 400', editEmpty.status === 400, `got ${editEmpty.status}`);
  const outsiderEdit = await api('PATCH', `/api/messages/${messageId}`, { token: c.token, body: { content: 'nope' } });
  check('non-participant cannot edit -> 403', outsiderEdit.status === 403, `got ${outsiderEdit.status}`);

  // ------------------------------------------------------------------ star
  const star = await api('POST', `/api/messages/${messageId}/star`, { token: b.token });
  check('star a message -> 200', star.status === 200 && star.body?.starred === true, JSON.stringify(star.body));
  const listForB = await api('GET', `/api/messages?chatId=${chatId}`, { token: b.token });
  const starRowB = (listForB.body?.messages || []).find((row) => row._id === messageId);
  check('star convenience flag is true for Bob', starRowB?.starred === true, String(starRowB?.starred));
  const listForA = await api('GET', `/api/messages?chatId=${chatId}`, { token: a.token });
  const starRowA = (listForA.body?.messages || []).find((row) => row._id === messageId);
  check('the star is per-user (Alice not starred)', starRowA?.starred === false, String(starRowA?.starred));
  const unstar = await api('DELETE', `/api/messages/${messageId}/star`, { token: b.token });
  check('unstar -> 200', unstar.status === 200 && unstar.body?.starred === false, JSON.stringify(unstar.body));
  const outsiderStar = await api('POST', `/api/messages/${messageId}/star`, { token: c.token });
  check('non-participant cannot star -> 403', outsiderStar.status === 403, `got ${outsiderStar.status}`);

  // --------------------------------------------------------------- forward
  const forward = await api('POST', `/api/messages/${messageId}/forward`, { token: a.token, body: { chatId: groupId } });
  check('forward to my group -> 201', forward.status === 201, `got ${forward.status} ${JSON.stringify(forward.body)}`);
  check('forwarded copy has the text', forward.body?.content === 'Edited text', forward.body?.content);
  check('forwarded copy is a new message', forward.body?._id !== messageId);
  const groupHistory = await api('GET', `/api/messages?chatId=${groupId}`, { token: c.token });
  check('group members see the forwarded message', (groupHistory.body?.messages || []).some((row) => row.content === 'Edited text'));
  const forwardOut = await api('POST', `/api/messages/${messageId}/forward`, {
    token: a.token,
    body: { chatId: new mongoose.Types.ObjectId().toString() },
  });
  check('forwarding to a chat I am not in -> 403/404', [403, 404].includes(forwardOut.status), `got ${forwardOut.status}`);

  // ---------------------------------------------------------------- report
  const report = await api('POST', `/api/messages/${messageId}/report`, { token: b.token, body: { reason: 'spam', details: 'test report' } });
  check('report a message -> 201', report.status === 201, `got ${report.status} ${JSON.stringify(report.body)}`);
  check('report returns an id', typeof report.body?.reportId === 'string');
  const badReasonReport = await api('POST', `/api/messages/${messageId}/report`, { token: b.token, body: { reason: 'nope' } });
  check('unknown reason coerced to other', badReasonReport.body?.reason === 'other', JSON.stringify(badReasonReport.body));
  const selfReport = await api('POST', `/api/messages/${messageId}/report`, { token: a.token, body: { reason: 'spam' } });
  check('cannot report my own message -> 400', selfReport.status === 400, `got ${selfReport.status}`);
  const outsiderReport = await api('POST', `/api/messages/${messageId}/report`, { token: c.token, body: { reason: 'spam' } });
  check('non-participant cannot report -> 403', outsiderReport.status === 403, `got ${outsiderReport.status}`);

  // ---------------------------------------------------------------- cleanup
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 4000 });
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const Report = require('../../src/models/Report');
    const ids = [a.id, b.id, c.id].map((id) => new mongoose.Types.ObjectId(id));
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    const chatIds = chats.map((chat) => chat._id);
    await Message.deleteMany({ chatId: { $in: chatIds } });
    await Chat.deleteMany({ _id: { $in: chatIds } });
    await Report.deleteMany({ reporterId: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  } catch (error) {
    console.log(`  (cleanup skipped: ${error.message})`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
