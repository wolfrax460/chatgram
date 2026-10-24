/**
 * The support/help AI switch: with SUPPORT_AI_LAYER=true the legacy
 * `support/aiProvider` delegates to the new provider-agnostic layer.
 *
 *   cd server && node test/ai/layerSwitch.test.js
 */
const http = require('http');

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
    let lastBody = {};
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          lastBody = JSON.parse(body || '{}');
        } catch {
          lastBody = {};
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'Answer via the new AI layer' } }],
            usage: { prompt_tokens: 3, completion_tokens: 4 },
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, getLastBody: () => lastBody }));
  });
}

async function main() {
  console.log('\nsupport AI layer switch tests\n');
  const mock = await startMock();
  const port = mock.server.address().port;

  process.env.SUPPORT_AI_LAYER = 'true';
  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'mock-model';
  process.env.SUPPORT_AI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.SUPPORT_AI_API_KEY = 'switch-key';
  process.env.AI_ALLOWED_LOCAL_HOSTS = `127.0.0.1:${port}`;
  process.env.SUPPORT_AI_FALLBACKS = '';

  const legacy = require('../../src/support/aiProvider');
  check('the new layer is active', legacy.useNewLayer() === true);

  const answer = await legacy.askAssistant({
    system: 'Use the knowledge base only.',
    messages: [{ role: 'guest', text: 'my password is secret-password, how do I change it?' }],
  });
  check('legacy interface returns the new layer answer', answer === 'Answer via the new AI layer', String(answer));
  check(
    'redaction still applies through the bridge',
    !JSON.stringify(mock.getLastBody()).includes('secret-password'),
    JSON.stringify(mock.getLastBody()).slice(0, 160),
  );

  const info = legacy.assistantInfo();
  check('assistantInfo reports the provider', info.enabled === true && info.provider === 'custom', JSON.stringify(info));

  // Back to the legacy path: without any legacy config it must return null.
  delete process.env.SUPPORT_AI_LAYER;
  delete process.env.SUPPORT_AI_ENABLED;
  delete process.env.SUPPORT_AI_PROVIDER;
  delete process.env.SUPPORT_AI_BASE_URL;
  delete process.env.SUPPORT_AI_MODEL;
  delete process.env.SUPPORT_AI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.SUPPORT_AI_LAYER;

  check('the switch is off again', legacy.useNewLayer() === false);
  const legacyAnswer = await legacy.askAssistant({
    system: 'x',
    messages: [{ role: 'guest', text: 'hello' }],
  });
  check('legacy path with no configuration returns null (KB fallback)', legacyAnswer === null, String(legacyAnswer));
  check('assistantInfo says disabled', legacy.assistantInfo().enabled === false, JSON.stringify(legacy.assistantInfo()));

  await new Promise((resolve) => mock.server.close(resolve));

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
