/** Moderation, AI degraded health and "answer this user" delivery. */
const mongoose = require('mongoose');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}

async function main() {
  console.log('\nAI moderation / degraded health / answer-to-user\n');
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'test-model';
  process.env.SUPPORT_AI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234567890123456';
  process.env.AI_HOURLY_LIMIT = '100';
  process.env.AI_BLOCKED_TOPICS = 'weapons';

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const ai = require('../../src/ai/chatgram');

  const stamp = Date.now().toString(36);
  const asker = await User.create({ displayName: `Tail Ask ${stamp}`, email: `tail-ask-${stamp}@chatgram.test`, password: 'TailTest1!' });
  const support = await User.create({ displayName: `Tail Support ${stamp}`, email: `tail-support-${stamp}@chatgram.test`, password: 'TailTest1!', isSupportAccount: true });
  const inboxIds = [];
  try {
    // 1) blocked topic: polite refusal, no provider call, no inbox record
    const blocked = await ai.sendMessage({ userId: asker._id, text: 'Tell me how to make weapons at home.' });
    check('blocked topic gets a polite refusal', /can't help with that/i.test(blocked.reply), blocked.reply);
    check('blocked topic is tagged as moderation', blocked.blocked === true && blocked.providerKey === 'moderation', JSON.stringify(blocked.providerKey));
    check('blocked topic does not create an inbox record', (await ai.AdminInbox.countDocuments({ askerId: asker._id })) === 0);

    // 2) provider failure: polite reply + inbox record with the asker id
    const failed = await ai.sendMessage({ userId: asker._id, text: 'Tell me an unusual fact about volcanoes.' });
    check('provider failure returns a polite reply', /unavailable right now/i.test(failed.reply), failed.reply);
    const item = await ai.AdminInbox.findOne({ askerId: asker._id });
    check('failure creates an inbox record with the asker id', Boolean(item?.askerId), String(item?.askerId));
    const list = await ai.listInbox({ status: 'new' });
    check('inbox list marks that the answer can be sent in-app', list.items.some((row) => String(row.id) === String(item._id) && row.canAnswerUser === true));

    // 3) answering delivers the answer back to the asker via Support
    const answered = await ai.answerInboxItem(String(item._id), 'Volcanoes can produce lightning in their ash plumes.');
    inboxIds.push(item._id);
    check('answering creates a KB entry', Boolean(answered?.entry?._id));
    check('answering reports delivery to the asker', answered?.delivered === true, String(answered?.delivered));
    const chat = await Chat.findOne({ type: 'direct', participants: { $all: [asker._id, support._id] } });
    check('a Support conversation was created for the asker', Boolean(chat));
    const delivered = chat ? await Message.findOne({ chatId: chat._id, senderId: support._id }) : null;
    check('the approved answer was delivered as a Support message', /lightning/i.test(String(delivered?.content)), String(delivered?.content));

    // 4) degraded health after five provider failures in ten minutes
    for (let index = 0; index < 5; index += 1) {
      await ai.sendMessage({ userId: asker._id, text: `Unusual fact request number ${index} about geology.` });
    }
    const health = ai.aiHealth();
    check('five provider failures mark AI as degraded', health.degraded === true && health.failuresLast10Min >= 5, JSON.stringify(health));
  } finally {
    for (const id of inboxIds) await ai.AdminInbox.deleteOne({ _id: id });
    await ai.AdminInbox.deleteMany({ askerId: asker._id });
    await ai.AiKnowledge.deleteMany({});
    await ai.AiMessage.deleteMany({ userId: asker._id });
    await ai.AiConversation.deleteMany({ userId: asker._id });
    const chats = await Chat.find({ participants: { $in: [asker._id, support._id] } }).select('_id');
    await Message.deleteMany({ chatId: { $in: chats.map((row) => row._id) } });
    await Chat.deleteMany({ _id: { $in: chats.map((row) => row._id) } });
    await User.deleteMany({ _id: { $in: [asker._id, support._id] } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => { console.error('Test crashed:', error.message); process.exit(1); });
