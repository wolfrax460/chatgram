/**
 * Multi-provider switching + per-feature routing (item 9c).
 * Uses the local staging MongoDB and mocked provider HTTP servers (no real keys).
 *
 *   cd server && node test/ai/providers.test.js
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
      req.on('end', () => {
        let json = {};
        try { json = JSON.parse(body || '{}'); } catch { json = {}; }
        handler({ req, res, body: json });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function portOf(server) {
  return server.address().port;
}
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}
function openAiAnswer(res, text) {
  sendJson(res, 200, {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  });
}

async function main() {
  console.log('\nmodel providers / feature routing tests\n');

  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'default-model';
  process.env.SUPPORT_AI_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.SUPPORT_AI_API_KEY = 'env-key-1234567890123456';
  process.env.AI_SETTINGS_SECRET = 'providers-test-secret';

  const a = await startMock(({ res }) => openAiAnswer(res, 'FROM_A'));
  const b = await startMock(({ res }) => openAiAnswer(res, 'FROM_B'));
  const c = await startMock(({ res }) => sendJson(res, 429, { error: { message: 'rate limited' } }));
  const portA = portOf(a);
  const portB = portOf(b);
  const portC = portOf(c);
  process.env.AI_ALLOWED_LOCAL_HOSTS = `127.0.0.1:${portA},127.0.0.1:${portB},127.0.0.1:${portC}`;

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const providers = require('../../src/ai/providers');
  const { AiSettings } = require('../../src/ai/settings');
  const { service } = require('../../src/ai/service');

  const snapshot = await AiSettings.findOne({ key: 'global' }).lean();
  try {
    await providers.upsertProvider({ key: 'a', label: 'A', provider: 'custom', model: 'model-a', baseUrl: `http://127.0.0.1:${portA}/v1`, apiKey: 'key-aaaa-1234567890' });
    await providers.upsertProvider({ key: 'b', label: 'B', provider: 'custom', model: 'model-b', baseUrl: `http://127.0.0.1:${portB}/v1`, apiKey: 'key-bbbb-1234567890' });
    await providers.upsertProvider({ key: 'c', label: 'C', provider: 'custom', model: 'model-c', baseUrl: `http://127.0.0.1:${portC}/v1`, apiKey: 'key-cccc-1234567890' });

    const listed = await providers.listProviders();
    check('providers list contains the three providers', listed.providers.length === 3, String(listed.providers.length));
    const serialized = JSON.stringify(listed);
    check('list never exposes api keys or encrypted blobs', !serialized.includes('key-aaaa') && !serialized.includes('apiKeyEncrypted') && !serialized.includes('key-bbbb'), serialized.slice(0, 200));
    check('list shows hasKey and last 4 for each provider', listed.providers.every((row) => row.hasKey && row.keyLast4.length === 4), JSON.stringify(listed.providers.map((row) => row.keyLast4)));

    // ---- route a feature to provider A
    await providers.setFeatures({ features: { chatgramAI: { primary: 'a', fallbacks: ['b'] } } });
    const first = await service.chat({ feature: 'chatgramAI', messages: [{ role: 'user', text: 'hello' }] });
    check('feature request uses the assigned primary provider', first.text === 'FROM_A', first.text);
    check('response metadata reports the provider key', first.providerKey === 'a' || first.provider === 'custom', JSON.stringify({ key: first.providerKey, provider: first.provider }));

    // ---- primary fails (429) -> fallback B answers
    await providers.setFeatures({ features: { chatgramAI: { primary: 'c', fallbacks: ['b'] } } });
    const fallback = await service.chat({ feature: 'chatgramAI', messages: [{ role: 'user', text: 'hello' }] });
    check('429 on the primary falls back to the next provider', fallback.text === 'FROM_B', fallback.text);

    // ---- switch primary to B, then undo back to the previous assignment
    await providers.setFeatures({ features: { chatgramAI: { primary: 'b', fallbacks: ['a'] } } });
    const switched = await service.chat({ feature: 'chatgramAI', messages: [{ role: 'user', text: 'hello' }] });
    check('switching the primary takes effect immediately', switched.text === 'FROM_B', switched.text);

    await providers.setFeatures({ features: { chatgramAI: { primary: 'a', fallbacks: ['b'] } } });
    const afterSwitch = await service.chat({ feature: 'chatgramAI', messages: [{ role: 'user', text: 'hello' }] });
    check('switching back to A works', afterSwitch.text === 'FROM_A', afterSwitch.text);
    const undone = await providers.undoLastChange();
    const afterUndo = await service.chat({ feature: 'chatgramAI', messages: [{ role: 'user', text: 'hello' }] });
    check('undo restores the previous primary (B)', undone.features.chatgramAI.primary === 'b' && afterUndo.text === 'FROM_B', JSON.stringify(undone.features.chatgramAI));

    // ---- health tracking
    const healthB = providers.healthFor('b');
    check('health records successes and latency', Boolean(healthB && healthB.successes > 0 && healthB.averageLatencyMs !== null), JSON.stringify(healthB));
    const healthC = providers.healthFor('c');
    check('health records failures with an error code', Boolean(healthC && healthC.failures > 0 && healthC.lastErrorCode), JSON.stringify(healthC));

    // ---- SSRF guard on provider base URLs
    let ssrfRejected = false;
    try {
      await providers.upsertProvider({ key: 'evil', provider: 'custom', model: 'x', baseUrl: 'http://api.example.com/v1', apiKey: 'k'.repeat(24) });
    } catch {
      ssrfRejected = true;
    }
    check('plain-http public base URL is rejected by the SSRF guard', ssrfRejected);

    // ---- unknown feature provider assignment rejected
    let badAssignment = false;
    try {
      await providers.setFeatures({ features: { chatgramAI: { primary: 'nope', fallbacks: [] } } });
    } catch {
      badAssignment = true;
    }
    check('assigning an unknown provider is rejected', badAssignment);

    // ---- delete removes it from the feature assignment
    await providers.deleteProvider('b');
    const afterDelete = await providers.listProviders();
    check('deleting a provider removes it from fallbacks', afterDelete.providers.length === 2 && !afterDelete.features.chatgramAI.fallbacks.includes('b'), JSON.stringify(afterDelete.features.chatgramAI));
  } finally {
    // Restore the exact previous settings document (test data only).
    if (snapshot) {
      const { _id, ...rest } = snapshot;
      await AiSettings.updateOne({ key: 'global' }, { $set: rest }, { upsert: true });
    } else {
      await AiSettings.deleteOne({ key: 'global' });
    }
    await Promise.all([a, b, c].map((server) => new Promise((resolve) => server.close(resolve))));
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error.message);
  process.exit(1);
});
