/**
 * Regression: the streaming path must really reach the provider.
 *
 * Production bug this locks down: `service.js` exposed `streamForFeature` only as
 * a named export, while `chatgram.js` holds `const { service } = require('./service')`
 * captured at load time. `service.streamForFeature` was therefore undefined and
 * every Chatgram AI answer fell back to "Chatgram AI is unavailable right now."
 * The UI, the SSE plumbing and the provider were all fine.
 *
 * Staging MongoDB + a local mock OpenAI-compatible provider (no real key).
 *
 *   cd server && node test/ai/streaming.test.js
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

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch { payload = {}; }
        if (!payload.stream) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'NON_STREAM' } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        for (const piece of ['STREAMED', ' ', '**answer**', ' from the provider']) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  console.log('\nAI streaming regression tests\n');
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'test-model';
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234567890123456';
  process.env.AI_SETTINGS_SECRET = 'chatgram-ai-test-secret';

  const mock = await startMock();
  const port = mock.address().port;
  process.env.SUPPORT_AI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.AI_ALLOWED_LOCAL_HOSTS = `127.0.0.1:${port}`;

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });

  const User = require('../../src/models/User');
  const ai = require('../../src/ai/chatgram');
  const providers = require('../../src/ai/providers');
  const serviceModule = require('../../src/ai/service');

  check('the module exports streamForFeature', typeof serviceModule.streamForFeature === 'function');
  check(
    'the destructured service object exposes streamForFeature (the production bug)',
    typeof serviceModule.service.streamForFeature === 'function',
  );

  const run = Date.now().toString(36);
  const user = await User.create({
    displayName: `STREAM TEST ${run}`,
    email: `stream-test-${run}@chatgram.test`,
    password: `Stream-${run}-Aa1!`,
  });

  try {
    await providers.upsertProvider({
      key: 'stream-test',
      provider: 'custom',
      label: 'Stream test',
      model: 'test-model',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'test-key-1234567890123456',
      enabled: true,
      timeoutMs: 10000,
    });
    await providers.setFeatures({ features: { chatgramAI: { primary: 'stream-test', fallbacks: [] } } });

    const deltas = [];
    const result = await ai.streamMessage({
      userId: user._id,
      text: 'Stream something to me',
      onDelta: async (delta) => { deltas.push(delta); },
    });

    const streamed = deltas.join('');
    check('deltas stream token by token', deltas.length >= 2, `got ${deltas.length}`);
    check('the provider answer is streamed', streamed.includes('STREAMED'), streamed.slice(0, 120));
    check('the final reply is the provider answer', String(result.reply || '').includes('**answer**'), result.reply);
    check('the provider key is recorded (no silent fallback)', result.providerKey === 'stream-test', String(result.providerKey));
    check('the answer is not the unavailable fallback', !result.unavailable && !String(result.reply).includes('unavailable'), result.reply);
    check('a conversation id is returned', Boolean(result.conversationId));
  } finally {
    await providers.deleteProvider('stream-test').catch(() => {});
    const AiMessage = require('../../src/ai/chatgram').AiMessage;
    const AiConversation = require('../../src/ai/chatgram').AiConversation;
    const conversations = await AiConversation.find({ userId: user._id }).select('_id').lean();
    await AiMessage.deleteMany({ conversationId: { $in: conversations.map((row) => row._id) } });
    await AiConversation.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
    await new Promise((resolve) => mock.close(resolve));
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 800));
  process.exit(1);
});
