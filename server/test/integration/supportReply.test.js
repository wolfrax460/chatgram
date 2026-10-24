/**
 * Regression: a message to the Chatgram Support account must ALWAYS get a reply.
 *
 * Background production bug: `answerSupportChat` returned early when a ticket
 * existed for the conversation, and returned silently when the AI was disabled,
 * so users wrote to Support and never heard back. It also silently swallowed
 * provider failures. This test drives the responder directly against the local
 * staging database (never production, never server.js).
 *
 *   cd server && node test/integration/supportReply.test.js
 */
const mongoose = require('mongoose');

const BASE_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const run = Date.now().toString(36);
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

async function main() {
  console.log('\nsupport reply regression test\n');

  // Force a predictable, network-free environment (no real credentials needed).
  process.env.SUPPORT_AGENT_ENABLED = 'true';
  process.env.SUPPORT_AI_ENABLED = 'false';
  process.env.AI_PROVIDER = 'none';
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_ENABLED;
  process.env.EMAIL_ENABLED = 'false';

  await mongoose.connect(BASE_URI, { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const SupportTicket = require('../../src/models/SupportTicket');
  const ai = require('../../src/support/aiProvider');
  const { answerSupportChat } = require('../../src/support/supportAgentReply');

  const support = await User.create({
    displayName: `Support Test ${run}`,
    email: `support-test-${run}@chatgram.test`,
    password: 'SupportTest1!',
    isSupportAccount: true,
  });
  const user = await User.create({
    displayName: `Support Ask ${run}`,
    email: `support-ask-${run}@chatgram.test`,
    password: 'SupportTest1!',
  });
  const chat = await Chat.create({ type: 'direct', participants: [support._id, user._id] });

  async function send(text) {
    const message = await Message.create({
      chatId: chat._id,
      senderId: user._id,
      type: 'text',
      content: text,
      sentAt: new Date(),
      deliveredTo: [],
      readBy: [],
    });
    const before = await Message.countDocuments({ chatId: chat._id });
    await answerSupportChat(message, null);
    const replies = await Message.find({ chatId: chat._id, senderId: support._id }).sort({ sentAt: -1 });
    const after = await Message.countDocuments({ chatId: chat._id });
    return { reply: replies[0], added: after - before, content: String(replies[0]?.content || '') };
  }

  // 1) AI disabled: the user must still get the holding answer (never silence).
  const disabled = await send('Hello, can you help me with my account?');
  check('AI disabled still produces a support reply', disabled.added >= 1 && Boolean(disabled.reply), `added ${disabled.added}`);
  check('holding reply explains a human is being asked', /asking the Chatgram admin|admin|team/i.test(disabled.content), disabled.content.slice(0, 120));

  // 2) A ticket already linked to the chat must not silence later messages.
  await SupportTicket.create({
    ticketId: `CG-T${run.toUpperCase().slice(-5)}`,
    guestId: `user:${user._id}`,
    userId: user._id,
    contact: 'in-app chat',
    contactType: 'email',
    status: 'open',
    summary: 'earlier escalation',
    transcript: [{ role: 'guest', text: 'earlier question' }],
    chatId: chat._id,
  });
  const afterTicket = await send('Any update on this?');
  check('an existing ticket does not silence the assistant', afterTicket.added >= 1 && Boolean(afterTicket.reply), `added ${afterTicket.added}`);

  // 3) Provider unreachable: answer is still delivered and the error is recorded
  //    for the admin dashboard (classification, never the key).
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.AI_PROVIDER = 'openai-compatible';
  process.env.AI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.AI_API_KEY = 'test-key-12345678901234567890';
  process.env.SUPPORT_AI_MODEL = 'test-model';
  const brokenProvider = await send('Can you hear me now?');
  check('provider failure still produces a reply', brokenProvider.added >= 1 && Boolean(brokenProvider.reply), `added ${brokenProvider.added}`);
  const lastError = ai.getLastError();
  check('provider failure is recorded for the dashboard', Boolean(lastError?.code), JSON.stringify(lastError));

  // 4) Error classification used by the admin red banner.
  check('401 classified as invalid_key', ai.classifyError('401: Invalid API Key') === 'invalid_key');
  check('429 classified as quota', ai.classifyError('429: rate limit exceeded') === 'quota');
  check('404 model classified as model_not_found', ai.classifyError('404: model not found') === 'model_not_found');
  check('timeout classified', ai.classifyError('The operation was aborted due to timeout') === 'timeout');

  // Cleanup (test data only).
  await Message.deleteMany({ chatId: chat._id });
  await SupportTicket.deleteMany({ chatId: chat._id });
  await Chat.deleteMany({ _id: chat._id });
  await User.deleteMany({ _id: { $in: [support._id, user._id] } });
  await mongoose.disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error('Test crashed:', error.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
