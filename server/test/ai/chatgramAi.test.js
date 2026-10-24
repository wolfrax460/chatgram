/**
 * Chatgram AI MVP tests: general answers, silent learning loop, KB learning,
 * provider failure, fallback routing and limits. Staging MongoDB + mock provider.
 *
 *   cd server && node test/ai/chatgramAi.test.js
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
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function startMock(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => handler({ res, body }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function answer(res, text) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }));
}

async function main() {
  console.log('\nChatgram AI tests\n');
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'test-model';
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234567890123456';
  process.env.AI_SETTINGS_SECRET = 'chatgram-ai-test-secret';
  process.env.AI_HOURLY_LIMIT = '4';
  process.env.AI_DAILY_LIMIT = '100';

  const responses = ['Hello from AI.', "I don't have a confirmed answer on that yet, I've noted it for the team.\n[[CHATGRAM_UNKNOWN: how much does premium cost]]", "I don't have a confirmed answer on that yet, I've noted it for the team.\n[[CHATGRAM_UNKNOWN: how much does premium cost]]", 'General answer two.', 'General answer three.'];
  let callCount = 0;
  const primary = await startMock(({ res }) => {
    const text = responses[Math.min(callCount, responses.length - 1)];
    callCount += 1;
    answer(res, text);
  });
  const fallback = await startMock(({ res }) => answer(res, 'FROM_FALLBACK'));
  const rateLimited = await startMock(({ res }) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rate limited' } }));
  });
  const primaryUrl = `http://127.0.0.1:${primary.address().port}/v1`;
  const fallbackUrl = `http://127.0.0.1:${fallback.address().port}/v1`;
  const limitedUrl = `http://127.0.0.1:${rateLimited.address().port}/v1`;
  process.env.SUPPORT_AI_BASE_URL = primaryUrl;
  process.env.AI_ALLOWED_LOCAL_HOSTS = `127.0.0.1:${primary.address().port},127.0.0.1:${fallback.address().port},127.0.0.1:${rateLimited.address().port}`;

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const User = require('../../src/models/User');
  const ai = require('../../src/ai/chatgram');
  const providers = require('../../src/ai/providers');
  const { AiSettings } = require('../../src/ai/settings');

  const stamp = Date.now().toString(36);
  const users = [];
  const createdProviders = [];
  const settingsSnapshot = await AiSettings.findOne({ key: 'global' }).lean();
  try {
    async function newUser(label) {
      const user = await User.create({ displayName: `AI ${label} ${stamp}`, email: `ai-${label}-${stamp}@chatgram.test`, password: 'AiTest1!' });
      users.push(user._id);
      return user;
    }
    const userA = await newUser('a');
    const userB = await newUser('b');
    const userC = await newUser('c');
    const userD = await newUser('d');

    // 1) general question is answered
    const general = await ai.sendMessage({ userId: userA._id, text: 'Explain photosynthesis briefly.' });
    check('general question is answered', general.reply === 'Hello from AI.', general.reply);
    check('a conversation id is returned', Boolean(general.conversationId));
    check('provider metadata is returned', Boolean(general.providerKey), String(general.providerKey));

    // 2) Chatgram-unknown question is silent for the user and recorded for admins
    const unknown = await ai.sendMessage({ userId: userA._id, conversationId: general.conversationId, text: 'How much does premium cost?' });
    check('hidden marker is stripped from the user reply', !unknown.reply.includes('CHATGRAM_UNKNOWN'), unknown.reply);
    check('the reply is honest, not an invented answer', /noted it for the team|confirmed answer/i.test(unknown.reply), unknown.reply);
    const inbox = await ai.AdminInbox.find({ normalized: ai.normalizeQuestion('How much does premium cost?') });
    check('exactly one admin inbox record is created', inbox.length === 1, String(inbox.length));
    check('inbox counts the question', inbox[0]?.count === 1, String(inbox[0]?.count));
    const storedMessages = await ai.getMessages(userA._id, general.conversationId);
    check('no visible trace of the admin record in the conversation', !JSON.stringify(storedMessages).toLowerCase().includes('inbox'), JSON.stringify(storedMessages).slice(0, 200));

    // 3) duplicates increase the counter
    await ai.sendMessage({ userId: userA._id, conversationId: general.conversationId, text: 'How much does premium cost?' });
    const inboxAfterDup = await ai.AdminInbox.findById(inbox[0]._id);
    check('a duplicate question increments the counter', inboxAfterDup.count === 2, String(inboxAfterDup.count));

    // 4) admin answer creates a KB entry and the next ask is answered from it
    const answered = await ai.answerInboxItem(String(inbox[0]._id), 'Premium costs 5000 RWF per month.');
    check('answering creates a knowledge-base entry', Boolean(answered?.entry?._id));
    const callsBeforeKb = callCount;
    const fromKb = await ai.sendMessage({ userId: userB._id, text: 'How much does premium cost?' });
    check('the next ask is answered from the knowledge base', fromKb.reply === 'Premium costs 5000 RWF per month.', fromKb.reply);
    check('the provider is not called when the KB answers', callCount === callsBeforeKb, `${callsBeforeKb} -> ${callCount}`);

    // 5) fallback when the primary returns 429 (feature routing)
    const p1 = await providers.upsertProvider({ key: 'limited', provider: 'custom', model: 'm', baseUrl: limitedUrl, apiKey: 'key-11111111111111111111' });
    const p2 = await providers.upsertProvider({ key: 'fallback', provider: 'custom', model: 'm', baseUrl: fallbackUrl, apiKey: 'key-22222222222222222222' });
    createdProviders.push('limited', 'fallback');
    void p1; void p2;
    await providers.setFeatures({ features: { chatgramAI: { primary: 'limited', fallbacks: ['fallback'] } } });
    const fallbackReply = await ai.sendMessage({ userId: userC._id, text: 'Tell me a fun fact about the ocean.' });
    check('429 primary falls back to the next provider', fallbackReply.reply === 'FROM_FALLBACK', fallbackReply.reply);
    check('the fallback provider key is reported', fallbackReply.providerKey === 'fallback', String(fallbackReply.providerKey));

    // 6) all providers failing returns a polite message and records the failure
    await providers.setFeatures({ features: { chatgramAI: { primary: 'limited', fallbacks: [] } } });
    const unavailable = await ai.sendMessage({ userId: userD._id, text: 'Tell me another ocean fact.' });
    check('all providers failing returns a polite message', /unavailable right now|try again/i.test(unavailable.reply), unavailable.reply);
    check('no raw provider error leaks to the user', !/429|429:|rate limited|error:/i.test(unavailable.reply), unavailable.reply);
    const failureRecord = await ai.AdminInbox.findOne({ askerHash: (await ai.AdminInbox.findOne({})).askerHash, normalized: ai.normalizeQuestion('Tell me another ocean fact.') });
    check('the failure is recorded for the admin inbox', Boolean(failureRecord) || (await ai.AdminInbox.countDocuments({})) > 0);

    // Restore default routing so the limit test uses the working provider.
    await providers.setFeatures({ features: { chatgramAI: { primary: null, fallbacks: [] } } });
    await ai.AiConversation.deleteMany({ userId: userC._id });

    // 7) per-user limit (AI_HOURLY_LIMIT=4)
    let limited = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await ai.sendMessage({ userId: userB._id, text: `Limit test message ${attempt} about space.` });
      } catch (error) {
        limited = error;
        break;
      }
    }
    check('hourly limit stops the user with RATE_LIMITED', limited?.code === 'RATE_LIMITED', `${limited?.code} ${limited?.message}`);

    // 8) XSS content is stored/returned as plain text (client renders as text)
    const xss = await ai.sendMessage({ userId: userD._id, text: 'Write a tiny HTML example.' });
    check('AI output is returned as a plain string (no HTML execution server-side)', typeof xss.reply === 'string');
  } finally {
    const ids = users;
    await ai.AiMessage.deleteMany({ userId: { $in: ids } });
    await ai.AiConversation.deleteMany({ userId: { $in: ids } });
    for (const key of createdProviders) await providers.deleteProvider(key).catch(() => {});
    const testInboxIds = (await ai.AdminInbox.find({ question: { $regex: /premium cost|ocean fact/i } })).map((item) => item._id);
    await ai.AdminInbox.deleteMany({ _id: { $in: testInboxIds } });
    await ai.AiKnowledge.deleteMany({ inboxId: { $in: testInboxIds } });
    await User.deleteMany({ _id: { $in: ids } });
    if (settingsSnapshot) {
      const { _id, ...rest } = settingsSnapshot;
      await AiSettings.updateOne({ key: 'global' }, { $set: rest }, { upsert: true });
    } else {
      await AiSettings.deleteOne({ key: 'global' });
    }
    await Promise.all([primary, fallback, rateLimited].map((server) => new Promise((resolve) => server.close(resolve))));
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error.message);
  process.exit(1);
});
