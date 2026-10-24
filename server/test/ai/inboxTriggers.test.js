/**
 * 9e Inbox triggers: low-confidence answers, empty/refused answers, duplicate
 * questions incrementing one record, the support-no-reply-60 s watchdog, and the
 * live badge counters. Staging MongoDB + a local mock provider (no real key).
 *
 *   cd server && node test/ai/inboxTriggers.test.js
 */
const http = require('http');
const mongoose = require('mongoose');

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startMock(replies) {
  const state = { index: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const reply = replies[Math.min(state.index, replies.length - 1)];
      state.index += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  console.log('\n9e inbox trigger tests\n');
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'test-model';
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234567890123456';
  process.env.AI_SETTINGS_SECRET = 'chatgram-ai-test-secret';
  process.env.AI_HOURLY_LIMIT = '50';
  process.env.AI_DAILY_LIMIT = '200';
  process.env.SUPPORT_REPLY_TIMEOUT_MS = '300';
  process.env.SUPPORT_PASSWORD = process.env.SUPPORT_PASSWORD || 'StagingSupport1!';
  process.env.SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@chatgram.local';

  const replies = [
    "I don't know the answer to that.",
    "I don't know the answer to that.",
    '', // empty answer -> server substitutes the honest fallback
    'A normal confident answer.',
  ];
  const mock = await startMock(replies);
  const port = mock.address().port;
  process.env.AI_ALLOWED_LOCAL_HOSTS = `127.0.0.1:${port}`;

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const ai = require('../../src/ai/chatgram');
  const providers = require('../../src/ai/providers');
  const { AiSettings } = require('../../src/ai/settings');
  const policy = require('../../src/ai/policy');
  const support = require('../../src/utils/supportAccount');
  const watchdog = require('../../src/support/supportWatchdog');

  await AiSettings.updateOne({ key: 'global' }, { $unset: { aiPolicy: '' } });
  await providers.upsertProvider({
    key: 'inbox-test', provider: 'custom', label: 'Inbox test', model: 'test-model',
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key-1234567890123456', enabled: true, timeoutMs: 10000,
  });
  await providers.setFeatures({ features: { chatgramAI: { primary: 'inbox-test', fallbacks: [] } } });

  const stamp = Date.now().toString(36);
  const user = await User.create({ displayName: `INBOX TEST ${stamp}`, email: `inbox-test-${stamp}@chatgram.test`, password: 'InboxTest1!' });
  let supportChat = null;
  const createdInbox = [];

  try {
    // 1. A low-confidence answer creates exactly one record; repeating the same
    //    question increments the counter instead of creating a duplicate.
    const first = await ai.sendMessage({ userId: user._id, text: 'Who won the 2050 world cup?' });
    check('low-confidence answer still replies politely', String(first.reply).length > 5, first.reply);
    let records = await ai.AdminInbox.find({ type: 'low_confidence', askerId: user._id });
    check('exactly one low_confidence record', records.length === 1, records.length);
    check('the record starts with count 1', records[0]?.count === 1, records[0]?.count);
    createdInbox.push(...records.map((row) => row._id));

    await ai.sendMessage({ userId: user._id, text: 'Who won the 2050 world cup?' });
    records = await ai.AdminInbox.find({ type: 'low_confidence', askerId: user._id });
    check('the same question does not duplicate the record', records.length === 1, records.length);
    check('the repeated question increments the counter', records[0]?.count === 2, records[0]?.count);

    // 2. An empty model answer becomes the honest fallback and is recorded too.
    const empty = await ai.sendMessage({ userId: user._id, text: 'Something the model returns nothing for' });
    check('empty answer is replaced by the fallback', /don't have a confirmed answer/i.test(empty.reply), empty.reply);
    const emptyRecord = await ai.AdminInbox.findOne({ type: 'low_confidence', question: /confirmed answer|Something the model/ });
    check('empty answer is recorded', Boolean(emptyRecord), Boolean(emptyRecord));

    // 3. A confident answer is not recorded.
    const confident = await ai.sendMessage({ userId: user._id, text: 'Say something normal' });
    check('a confident answer is returned', String(confident.reply).includes('normal confident answer'), confident.reply);
    check('a confident answer creates no record', (await ai.AdminInbox.countDocuments({ askerId: user._id, type: 'low_confidence' })) === 2, 'expected 2');

    // 4. Support watchdog: no reply within the (test) timeout creates one record.
    const supportId = await support.ensureSupportUser();
    check('support account available for the watchdog', Boolean(supportId));
    supportChat = await Chat.create({ type: 'direct', participants: [user._id, supportId] });
    const question = await Message.create({
      chatId: supportChat._id, senderId: user._id, type: 'text',
      content: 'My account is broken, please help', sentAt: new Date(), deliveredTo: [user._id], readBy: [user._id],
    });
    const timer = watchdog.watchSupportMessage(supportChat, question);
    await sleep(900);
    let timeoutRecord = await ai.AdminInbox.findOne({ normalized: `support:${question._id}` });
    check('an unanswered support message creates a support_timeout record', Boolean(timeoutRecord), Boolean(timeoutRecord));
    check('the record type is support_timeout', timeoutRecord?.type === 'support_timeout', timeoutRecord?.type);
    if (timeoutRecord) createdInbox.push(timeoutRecord._id);
    watchdog.watchSupportMessage(supportChat, question);
    await sleep(900);
    check('watching the same message twice keeps one record', (await ai.AdminInbox.countDocuments({ normalized: `support:${question._id}` })) === 1, 'duplicate');
    if (timer) clearTimeout(timer);

    // 5. When Support does answer, the watchdog stays silent.
    const answeredQuestion = await Message.create({
      chatId: supportChat._id, senderId: user._id, type: 'text',
      content: 'Another question that gets answered', sentAt: new Date(), deliveredTo: [user._id], readBy: [user._id],
    });
    await Message.create({
      chatId: supportChat._id, senderId: supportId, type: 'text',
      content: 'Here is the answer from support', sentAt: new Date(Date.now() + 50), deliveredTo: [supportId], readBy: [supportId],
    });
    watchdog.watchSupportMessage(supportChat, answeredQuestion);
    await sleep(900);
    check(
      'an answered support message creates no timeout record',
      (await ai.AdminInbox.countDocuments({ normalized: `support:${answeredQuestion._id}` })) === 0,
      'unexpected record',
    );

    // 6. Badge counters include the new records and break them down by type.
    const unread = await ai.inboxUnreadCount();
    check('unread counter returns a number', typeof unread.new === 'number' && unread.new >= 3, unread.new);
    check('unread counter counts low_confidence records', unread.lowConfidence >= 1, unread.lowConfidence);
    check('unread counter counts support_timeout records', unread.supportTimeout >= 1, unread.supportTimeout);

    // Nothing leaks to the user: the AI replies never mention the inbox.
    check('the user-facing reply never mentions the inbox', !/inbox|admin|noted for the team/i.test(String(first.reply).replace("I don't have a confirmed answer on that yet, I've noted it for the team.", '')), first.reply);
  } finally {
    const supportId = support.supportUserId();
    const conversationIds = (await ai.AiConversation.find({ userId: user._id }).select('_id').lean()).map((row) => row._id);
    await ai.AiMessage.deleteMany({ conversationId: { $in: conversationIds } });
    await ai.AiConversation.deleteMany({ userId: user._id });
    await ai.AdminInbox.deleteMany({ $or: [{ askerId: user._id }, { normalized: /^support:/ }] });
    if (supportChat) {
      await Message.deleteMany({ chatId: supportChat._id });
      await Chat.deleteOne({ _id: supportChat._id });
    }
    await User.deleteOne({ _id: user._id });
    await providers.deleteProvider('inbox-test').catch(() => {});
    await AiSettings.updateOne({ key: 'global' }, { $unset: { aiPolicy: '' } });
    void supportId;
    void policy;
    await mongoose.disconnect();
    await new Promise((resolve) => mock.close(resolve));
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
