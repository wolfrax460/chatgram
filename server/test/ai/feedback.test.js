/** Thumbs up/down on AI answers: down feeds the admin inbox exactly once. */
const mongoose = require('mongoose');
let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}

async function main() {
  console.log('\nAI feedback tests\n');
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'm';
  process.env.SUPPORT_AI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234567890123456';
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const ai = require('../../src/ai/chatgram');
  const stamp = Date.now().toString(36);
  const user = await User.create({ displayName: `Fb ${stamp}`, email: `fb-${stamp}@chatgram.test`, password: 'FbTest1!' });
  try {
    await ai.sendMessage({ userId: user._id, text: 'What is a volcano?' });
    const answer = await ai.AiMessage.findOne({ userId: user._id, role: 'assistant' }).sort({ createdAt: -1 });
    const up = await ai.recordMessageFeedback(user._id, String(answer._id), 'up');
    check('thumbs-up is accepted without inbox noise', up?.ok === true && up.recorded === false);
    check('thumbs-up creates no inbox item', (await ai.AdminInbox.countDocuments({ type: 'negative_feedback', askerId: user._id })) === 0);
    const down = await ai.recordMessageFeedback(user._id, String(answer._id), 'down');
    check('thumbs-down is recorded', down?.ok === true && down.recorded === true);
    const item = await ai.AdminInbox.findOne({ type: 'negative_feedback', askerId: user._id });
    check('thumbs-down creates an admin inbox record', Boolean(item) && item.type === 'negative_feedback');
    check('feedback item carries the question for the admin', String(item?.question || '').length > 5, String(item?.question));
    await ai.recordMessageFeedback(user._id, String(answer._id), 'down');
    const again = await ai.AdminInbox.findOne({ type: 'negative_feedback', askerId: user._id });
    check('a repeat thumbs-down increments the counter', again.count === 2, String(again.count));
    const stranger = await User.create({ displayName: `Fb Other ${stamp}`, email: `fb-other-${stamp}@chatgram.test`, password: 'FbTest1!' });
    const foreign = await ai.recordMessageFeedback(stranger._id, String(answer._id), 'down');
    check('another user cannot vote on the message', foreign === null);
    await User.deleteOne({ _id: stranger._id });
  } finally {
    await ai.AdminInbox.deleteMany({ askerId: user._id });
    await ai.AiMessage.deleteMany({ userId: user._id });
    await ai.AiConversation.deleteMany({ userId: user._id });
    await User.deleteMany({ _id: user._id });
    await mongoose.disconnect();
  }
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}
main().catch((error) => { console.error('Test crashed:', error.message); process.exit(1); });
