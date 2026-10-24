/** Admin-account inbox delivery (unknown AI questions) + queue delivery idempotency. */
const mongoose = require('mongoose');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}

async function main() {
  console.log('\nadmin inbox delivery tests\n');
  const stamp = Date.now().toString(36);
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'test-model';
  process.env.SUPPORT_AI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234567890123456';
  process.env.AI_HOURLY_LIMIT = '50';
  process.env.CHATGRAM_ADMIN_EMAIL = `delivery-admin-${stamp}@chatgram.test`;

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const Chat = require('../../src/models/Chat');
  const Message = require('../../src/models/Message');
  const ai = require('../../src/ai/chatgram');

  const adminUser = await User.create({ displayName: 'Delivery Admin', email: process.env.CHATGRAM_ADMIN_EMAIL, password: 'DeliveryAdmin1!' });
  const support = await User.create({ displayName: 'Delivery Support', email: `delivery-support-${stamp}@chatgram.test`, password: 'DeliveryAdmin1!', isSupportAccount: true });
  const asker = await User.create({ displayName: 'Delivery Asker', email: `delivery-asker-${stamp}@chatgram.test`, password: 'DeliveryAdmin1!' });
  const asker2 = await User.create({ displayName: 'Delivery Asker2', email: `delivery-asker2-${stamp}@chatgram.test`, password: 'DeliveryAdmin1!' });

  try {
    const result = await ai.sendMessage({ userId: asker._id, text: 'Is there a Chatgram desktop app for Linux?' });
    check('unknown question still answers the user politely', /unavailable right now/i.test(result.reply), result.reply);
    const item = await ai.AdminInbox.findOne({ askerId: asker._id });
    check('inbox record created', Boolean(item));
    check('inbox record marked as delivered to the admin account', Boolean(item?.deliveredAt), String(item?.deliveredAt));
    const chat = await Chat.findOne({ type: 'direct', participants: { $all: [adminUser._id, support._id] } });
    check('admin conversation with Support exists', Boolean(chat));
    const deliveredMessage = chat ? await Message.findOne({ chatId: chat._id, senderId: support._id }) : null;
    check('question delivered as a message from Chatgram Support', /Chatgram AI inbox/i.test(String(deliveredMessage?.content)) && /Linux/i.test(String(deliveredMessage?.content)), String(deliveredMessage?.content));

    // A second unknown question while the admin is offline-in-DB is still queued safely.
    await User.updateOne({ _id: adminUser._id }, { $set: { email: `moved-${stamp}@chatgram.test` } });
    await ai.sendMessage({ userId: asker2._id, text: 'Can statuses be scheduled ahead of time?' });
    const queued = await ai.AdminInbox.findOne({ askerId: asker2._id });
    check('a later question is recorded even when the admin account is missing', Boolean(queued) && !queued.deliveredAt, JSON.stringify({ deliveredAt: queued?.deliveredAt }));

    // Restore the admin email and deliver the queued item exactly once.
    await User.updateOne({ _id: adminUser._id }, { $set: { email: process.env.CHATGRAM_ADMIN_EMAIL } });
    const first = await ai.deliverQueuedInboxToAdmin();
    check('queue delivery posts the pending question', first.delivered >= 1 && first.remaining === 0, JSON.stringify(first));
    const second = await ai.deliverQueuedInboxToAdmin();
    check('queue delivery is idempotent (nothing sent twice)', second.delivered === 0 && second.remaining === 0, JSON.stringify(second));
  } finally {
    await ai.AdminInbox.deleteMany({ askerId: { $in: [asker._id, asker2._id] } });
    await ai.AiMessage.deleteMany({ userId: { $in: [asker._id, asker2._id] } });
    await ai.AiConversation.deleteMany({ userId: { $in: [asker._id, asker2._id] } });
    const chats = await Chat.find({ participants: { $in: [adminUser._id, support._id, asker._id, asker2._id] } }).select('_id');
    await Message.deleteMany({ chatId: { $in: chats.map((row) => row._id) } });
    await Chat.deleteMany({ _id: { $in: chats.map((row) => row._id) } });
    await User.deleteMany({ _id: { $in: [adminUser._id, support._id, asker._id, asker2._id] } });
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => { console.error('Test crashed:', error.message); process.exit(1); });
