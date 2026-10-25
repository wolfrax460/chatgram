/**
 * System-originated answers (Chatgram Support) must be validated, delivered only
 * in the system conversation, and delivered exactly once. Admin-written answers
 * create one KB entry; the AI placeholder is rejected and never stored.
 *
 * Staging API must be running (scripts/start-staging.ps1).
 *
 *   node server/test/integration/systemAnswers.test.js
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const FALLBACK = "I don't have a confirmed answer on that yet, I've noted it for the team.";

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

async function register(label) {
  const identifier = `sys-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', { body: { displayName: `Sys ${label} ${run}`, identifier, password: 'SysTest1!' } });
  if (result.status !== 201) throw new Error(`register ${label}: ${result.status}`);
  return { user: result.body.user, token: result.body.accessToken, identifier };
}

async function main() {
  console.log('\nsystem-originated answers\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const { AdminInbox, AiKnowledge } = require('../../src/ai/chatgram');
  const Message = require('../../src/models/Message');
  const Chat = require('../../src/models/Chat');
  const User = require('../../src/models/User');
  const AdminAudit = require('../../src/models/AdminAudit');

  const adminLogin = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const adminBody = await adminLogin.json();
  const headers = {
    Cookie: (adminLogin.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
    'X-Admin-CSRF': adminBody.csrfToken,
  };
  check('admin login works', adminLogin.status === 200 && Boolean(adminBody.csrfToken), adminLogin.status);

  const a = await register('a');
  const b = await register('b');
  const abChat = await api('POST', '/api/chats', { token: a.token, body: { type: 'direct', participantId: b.user.id } });
  const abChatId = abChat.body?._id || abChat.body?.id;
  const abMessage = await api('POST', '/api/messages', { token: a.token, body: { chatId: abChatId, type: 'text', content: `Normal private message ${run}` } });
  check('private A→B chat exists with a normal message', abChat.status === 201 && abMessage.status === 201, { chat: abChat.status, message: abMessage.status });
  const abMessagesBefore = await Message.countDocuments({ chatId: abChatId });
  const abLastMessageBefore = String((await Chat.findById(abChatId).lean())?.lastMessage || '');

  const inbox = await AdminInbox.create({
    type: 'chatgram_unknown',
    question: `How do I export my data ${run}?`,
    normalized: `how do i export my data ${run}`,
    askerId: a.user.id,
    status: 'new',
    count: 1,
  });

  const answerUrl = `/api/admin/ai/inbox/${inbox._id}/answer`;

  const empty = await api('POST', answerUrl, { headers, body: { answer: '   ' } });
  check('an empty/whitespace answer is rejected', empty.status === 422 && empty.body?.code === 'ANSWER_REQUIRED', { status: empty.status, code: empty.body?.code });
  const fallback = await api('POST', answerUrl, { headers, body: { answer: FALLBACK } });
  check('the AI placeholder is rejected as an answer', fallback.status === 422 && fallback.body?.code === 'ANSWER_IS_FALLBACK', { status: fallback.status, code: fallback.body?.code });
  const prefixedFallback = await api('POST', answerUrl, { headers, body: { answer: `Chatgram AI answer:\n\n${FALLBACK}` } });
  check('a label-prefixed placeholder is rejected too', prefixedFallback.status === 422 && prefixedFallback.body?.code === 'ANSWER_IS_FALLBACK', { status: prefixedFallback.status, code: prefixedFallback.body?.code });
  check('no message was delivered for rejected answers', (await Message.countDocuments({ chatId: abChatId })) === abMessagesBefore, null);
  const afterReject = await AdminInbox.findById(inbox._id).lean();
  check('the record is untouched after rejected answers', afterReject?.status === 'new' && !afterReject?.deliveredAnswerMessageId, { status: afterReject?.status });
  check('no KB entry was created for rejected answers', (await AiKnowledge.countDocuments({ inboxId: inbox._id })) === 0, null);

  const answerText = `You can export your data from Settings → Account ${run}.`;
  const delivered = await api('POST', answerUrl, { headers, body: { answer: `  Chatgram AI answer:  ${answerText}  ` } });
  check('a real answer is accepted', delivered.status === 200 && delivered.body?.delivered?.delivered === true, { status: delivered.status, delivered: delivered.body?.delivered });

  const support = await User.findOne({ isSupportAccount: true }).select('_id displayName').lean();
  check('a system account exists', Boolean(support), null);
  const systemChat = await Chat.findOne({ type: 'direct', participants: { $all: [support._id, new mongoose.Types.ObjectId(String(a.user.id))] } }).lean();
  check('the answer went to the system conversation only', Boolean(systemChat), null);
  const systemMessages = await Message.find({ chatId: systemChat._id }).lean();
  check('exactly one answer message was created', systemMessages.length === 1, systemMessages.length);
  const answerMessage = systemMessages[0];
  check('the sender is the system account, not a human account', String(answerMessage?.senderId) === String(support._id), { sender: String(answerMessage?.senderId), support: String(support._id) });
  check('the stored answer has no AI label and matches the written answer', answerMessage?.content === answerText, answerMessage?.content);
  check('the placeholder is not in the delivered message', !/confirmed answer on that yet/i.test(String(answerMessage?.content || '')), answerMessage?.content);

  const systemChatAfter = await Chat.findById(systemChat._id).lean();
  check('the system chat preview points at the delivered answer', String(systemChatAfter?.lastMessage) === String(answerMessage._id), { lastMessage: String(systemChatAfter?.lastMessage) });
  check('the private A→B chat was not used for delivery', (await Message.countDocuments({ chatId: abChatId })) === abMessagesBefore, null);
  check('the private A→B chat preview is unchanged', String((await Chat.findById(abChatId).lean())?.lastMessage || '') === abLastMessageBefore, null);

  const kbEntries = await AiKnowledge.find({ inboxId: inbox._id }).lean();
  check('one KB entry was created for the real answer', kbEntries.length === 1 && kbEntries[0].answer === answerText, kbEntries.length);
  check('the placeholder was never stored in the KB', !/confirmed answer on that yet/i.test(String(kbEntries[0]?.answer || '')), kbEntries[0]?.answer);

  const systemMessagesBefore = await Message.countDocuments({ chatId: systemChat._id });
  const again = await api('POST', answerUrl, { headers, body: { answer: `A second answer ${run}` } });
  check('a repeated answer is idempotent', again.status === 200 && again.body?.delivered?.alreadyDelivered === true, { status: again.status, delivered: again.body?.delivered });
  check('double delivery creates no second message', (await Message.countDocuments({ chatId: systemChat._id })) === systemMessagesBefore, null);
  check('double delivery creates no second KB entry', (await AiKnowledge.countDocuments({ inboxId: inbox._id })) === 1, null);

  const audit = await AdminAudit.findOne({ action: 'ai_inbox_answer', detail: new RegExp(String(inbox._id)) }).lean();
  check('answering is audited', Boolean(audit), null);

  // Cleanup.
  await Message.deleteMany({ chatId: { $in: [abChatId, systemChat._id] } });
  await Chat.deleteMany({ _id: { $in: [abChatId, systemChat._id] } });
  await AiKnowledge.deleteMany({ inboxId: inbox._id });
  await AdminInbox.deleteOne({ _id: inbox._id });
  await User.deleteMany({ _id: { $in: [new mongoose.Types.ObjectId(String(a.user.id)), new mongoose.Types.ObjectId(String(b.user.id))] } });
  await AdminAudit.deleteMany({ detail: new RegExp(String(inbox._id)) });

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('system answers test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
