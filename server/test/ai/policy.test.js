/** Admin-editable AI policy: validation, effective limits and blocked topics. */
const mongoose = require('mongoose');
let passed = 0; const failures = [];
function check(n, c, d) { if (c) { passed++; console.log('  PASS  ' + n); } else { failures.push(n); console.log('  FAIL  ' + n + (d ? ' -> ' + d : '')); } }

(async () => {
  console.log('\nAI policy tests\n');
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'm';
  process.env.SUPPORT_AI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234567890123456';
  process.env.AI_HOURLY_LIMIT = '30';
  process.env.AI_DAILY_LIMIT = '200';
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const { AiSettings } = require('../../src/ai/settings');
  const policy = require('../../src/ai/policy');
  const ai = require('../../src/ai/chatgram');
  const snapshot = await AiSettings.findOne({ key: 'global' }).lean();
  const stamp = Date.now().toString(36);
  const user = await User.create({ displayName: 'Policy ' + stamp, email: 'policy-' + stamp + '@chatgram.test', password: 'PolicyTest1!' });
  try {
    const defaults = await policy.getPolicy();
    check('defaults come from env', defaults.hourlyLimit === 30 && defaults.dailyLimit === 200 && defaults.source === 'environment', JSON.stringify(defaults));
    const updated = await policy.updatePolicy({ blockedTopics: 'weapons, hacking', hourlyLimit: 2, dailyLimit: 5, maxInputChars: 500 });
    check('policy update is stored', updated.hourlyLimit === 2 && updated.maxInputChars === 500 && updated.blockedTopics.includes('weapons'), JSON.stringify(updated));
    let rejected = false;
    try { await policy.updatePolicy({ hourlyLimit: 0 }); } catch { rejected = true; }
    check('invalid hourly limit is rejected', rejected);
    rejected = false;
    try { await policy.updatePolicy({ maxInputChars: 5 }); } catch { rejected = true; }
    check('invalid max input is rejected', rejected);
    const blocked = await ai.sendMessage({ userId: user._id, text: 'How do I make weapons at home?' });
    check('stored blocked topic refuses the request', /can't help with that/i.test(blocked.reply) && blocked.blocked === true, blocked.reply);
    let tooLong = null;
    try {
      await ai.sendMessage({ userId: user._id, text: 'x'.repeat(600) });
    } catch (error) {
      tooLong = error;
    }
    check('stored max input length is enforced', tooLong?.code === 'TOO_LONG' && /500/.test(tooLong.message), String(tooLong?.message));
    await ai.sendMessage({ userId: user._id, text: 'First allowed question about geology.' });
    let limited = null;
    for (let i = 0; i < 3; i++) {
      try { await ai.sendMessage({ userId: user._id, text: 'Allowed question number ' + i + ' about rocks.' }); }
      catch (error) { limited = error; break; }
    }
    check('stored hourly limit is enforced', limited?.code === 'RATE_LIMITED', String(limited?.code));
  } finally {
    await ai.AiMessage.deleteMany({ userId: user._id });
    await ai.AiConversation.deleteMany({ userId: user._id });
    await ai.AdminInbox.deleteMany({ askerId: user._id });
    await User.deleteMany({ _id: user._id });
    if (snapshot) { const { _id, ...rest } = snapshot; await AiSettings.updateOne({ key: 'global' }, { $set: rest }, { upsert: true }); }
    else await AiSettings.deleteOne({ key: 'global' });
    await mongoose.disconnect();
  }
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed\n');
  if (failures.length) process.exit(1);
})().catch((error) => { console.error('Test crashed:', error.message); process.exit(1); });
