/**
 * AI layer tests with mocked provider HTTP servers (no network, no keys).
 *
 *   cd server && node test/ai/ai.test.js
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

function startMock(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(body || '{}');
        } catch {
          json = {};
        }
        handler({ req, res, body: json, raw: body });
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

async function main() {
  console.log('\nAI layer tests (mocked HTTP servers)\n');

  /* ------------------------------------------------------------ redaction */
  const { redact } = require('../../src/ai/redact');
  const redacted = redact('my password is hunter2 and email bob@example.com phone +250780000001');
  check('redaction hides the password', !redacted.includes('hunter2'), redacted);
  check('redaction hides the email', !redacted.includes('bob@example.com'), redacted);
  check('redaction hides the phone', !redacted.includes('+250780000001'), redacted);
  check('redaction keeps ordinary text', redact('how do groups work?').includes('groups'));

  /* ------------------------------------------------------------ SSRF guard */
  const { validateBaseUrl } = require('../../src/ai/ssrf');
  const httpsPublic = await validateBaseUrl('https://api.openai.com/v1');
  check('public https endpoint is allowed', httpsPublic.ok === true, JSON.stringify(httpsPublic));
  const plainHttp = await validateBaseUrl('http://api.openai.com/v1');
  check('plain http public endpoint is rejected', plainHttp.ok === false, JSON.stringify(plainHttp));
  const metadata = await validateBaseUrl('https://169.254.169.254/latest');
  check('metadata address is rejected', metadata.ok === false, JSON.stringify(metadata));
  const creds = await validateBaseUrl('https://user:pass@api.openai.com/v1');
  check('credentials in the URL are rejected', creds.ok === false, JSON.stringify(creds));

  /* --------------------------------------------------------- mock backends */
  let openAiRequests = 0;
  let lastOpenAiAuth = '';
  let lastOpenAiBody = {};
  const openAiServer = await startMock(({ req, res, body }) => {
    openAiRequests += 1;
    lastOpenAiAuth = String(req.headers.authorization || '');
    lastOpenAiBody = body;
    if (lastOpenAiAuth.includes('bad-key')) {
      sendJson(res, 401, { error: { message: 'invalid api key' } });
      return;
    }
    if (body.messages?.[0]?.content === 'rate-limit-me') {
      sendJson(res, 429, { error: { message: 'slow down' } });
      return;
    }
    sendJson(res, 200, {
      choices: [{ message: { content: 'Hello from the mock provider' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });
  });
  const openAiPort = portOf(openAiServer);
  const openAiBase = `http://127.0.0.1:${openAiPort}/v1`;

  const anthropicServer = await startMock(({ res }) => {
    sendJson(res, 200, {
      content: [{ type: 'text', text: 'Answer from Anthropic' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });
  });
  const geminiServer = await startMock(({ res }) => {
    sendJson(res, 200, {
      candidates: [{ content: { parts: [{ text: 'Answer from Gemini' }] } }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    });
  });
  const cohereServer = await startMock(({ res }) => {
    sendJson(res, 200, { text: 'Answer from Cohere', meta: { billed_units: { input_tokens: 3, output_tokens: 2 } } });
  });

  process.env.SUPPORT_AI_ENABLED = 'true';
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_MODEL = 'mock-model-1';
  process.env.SUPPORT_AI_BASE_URL = openAiBase;
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234';
  process.env.SUPPORT_AI_TIMEOUT_MS = '5000';
  process.env.SUPPORT_AI_DAILY_TOKEN_BUDGET = '1000000';
  process.env.SUPPORT_AI_FALLBACKS = '';
  process.env.AI_ALLOWED_LOCAL_HOSTS = `127.0.0.1:${openAiPort},127.0.0.1:${portOf(anthropicServer)},127.0.0.1:${portOf(geminiServer)},127.0.0.1:${portOf(cohereServer)}`;
  delete process.env.AI_SETTINGS_SECRET;

  const { chat, streamChat, testConnection, diagnostics, AiError } = require('../../src/ai/service');

  const localAllowed = await validateBaseUrl(openAiBase);
  check('allow-listed local endpoint passes the SSRF check', localAllowed.ok === true, JSON.stringify(localAllowed));

  /* ------------------------------------------------- OpenAI-compatible call */
  const first = await chat({ messages: [{ role: 'user', text: 'my password is secret123, how do I change it?' }] });
  check('openai-compatible returns text', first.text === 'Hello from the mock provider', first.text);
  check('usage is reported', first.usage.inputTokens === 11 && first.usage.outputTokens === 7, JSON.stringify(first.usage));
  check('authorization header is sent', lastOpenAiAuth === 'Bearer test-key-1234', lastOpenAiAuth);
  check('the model from config is used', lastOpenAiBody.model === 'mock-model-1', lastOpenAiBody.model);
  check(
    'secrets are redacted before they reach the provider',
    !JSON.stringify(lastOpenAiBody).includes('secret123'),
    JSON.stringify(lastOpenAiBody).slice(0, 200),
  );

  /* ----------------------------------------------------------- streaming */
  const chunks = [];
  for await (const chunk of streamChat({ messages: [{ role: 'user', text: 'stream please' }] })) chunks.push(chunk);
  check('streaming yields the answer', chunks.some((chunk) => chunk.text === 'Hello from the mock provider'));
  check('streaming ends with a done chunk', chunks[chunks.length - 1]?.done === true, JSON.stringify(chunks[chunks.length - 1]));

  /* -------------------------------------------------------- other adapters */
  process.env.SUPPORT_AI_PROVIDER = 'anthropic';
  process.env.SUPPORT_AI_BASE_URL = `http://127.0.0.1:${portOf(anthropicServer)}/v1`;
  process.env.SUPPORT_AI_API_KEY = 'anthropic-key';
  const anthropicResult = await chat({ messages: [{ role: 'user', text: 'hi' }] });
  check('anthropic adapter returns text', anthropicResult.text === 'Answer from Anthropic', anthropicResult.text);

  process.env.SUPPORT_AI_PROVIDER = 'gemini';
  process.env.SUPPORT_AI_BASE_URL = `http://127.0.0.1:${portOf(geminiServer)}/v1beta`;
  process.env.SUPPORT_AI_API_KEY = 'gemini-key';
  const geminiResult = await chat({ messages: [{ role: 'user', text: 'hi' }] });
  check('gemini adapter returns text', geminiResult.text === 'Answer from Gemini', geminiResult.text);

  process.env.SUPPORT_AI_PROVIDER = 'cohere';
  process.env.SUPPORT_AI_BASE_URL = `http://127.0.0.1:${portOf(cohereServer)}/v2`;
  process.env.SUPPORT_AI_API_KEY = 'cohere-key';
  const cohereResult = await chat({ messages: [{ role: 'user', text: 'hi' }] });
  check('cohere adapter returns text', cohereResult.text === 'Answer from Cohere', cohereResult.text);

  /* -------------------------------------------------------- error mapping */
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_BASE_URL = openAiBase;
  process.env.SUPPORT_AI_API_KEY = 'bad-key';
  let authError = null;
  try {
    await chat({ messages: [{ role: 'user', text: 'hi' }] });
  } catch (error) {
    authError = error;
  }
  check('401 maps to auth_failed', authError instanceof AiError && authError.code === 'auth_failed', authError?.code);

  process.env.SUPPORT_AI_API_KEY = 'test-key-1234';
  let rateError = null;
  try {
    await chat({ messages: [{ role: 'user', text: 'rate-limit-me' }], allowContact: true });
  } catch (error) {
    rateError = error;
  }
  check('429 maps to rate_limited', rateError instanceof AiError && rateError.code === 'rate_limited', rateError?.code);

  /* ------------------------------------------------------- fallback chain */
  process.env.SUPPORT_AI_PROVIDER = 'custom';
  process.env.SUPPORT_AI_BASE_URL = 'http://127.0.0.1:1/v1'; // closed port
  process.env.SUPPORT_AI_FALLBACKS = 'anthropic:fallback-model';
  process.env.SUPPORT_AI_BASE_URL_ANTHROPIC = `http://127.0.0.1:${portOf(anthropicServer)}/v1`;
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234';
  const fallbackResult = await chat({ messages: [{ role: 'user', text: 'fallback please' }] });
  check('fallback chain answers when the primary is down', fallbackResult.text === 'Answer from Anthropic', fallbackResult.text);
  check('fallback reports which provider answered', fallbackResult.provider === 'anthropic', fallbackResult.provider);

  /* --------------------------------------------------- KB-only last resort */
  process.env.SUPPORT_AI_FALLBACKS = '';
  const kbResult = await chat({
    messages: [{ role: 'user', text: 'no provider' }],
    kbFallback: () => 'Knowledge-base answer',
  });
  check('failed chain ends with a knowledge-base answer', kbResult.kbOnly === true && kbResult.text === 'Knowledge-base answer', JSON.stringify(kbResult));

  /* ----------------------------------------------------- circuit breaker */
  process.env.SUPPORT_AI_BASE_URL = openAiBase;
  process.env.SUPPORT_AI_API_KEY = 'bad-key';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await chat({ messages: [{ role: 'user', text: 'breaker' }] });
    } catch {
      /* expected */
    }
  }
  const breakerState = diagnostics().breakers.find((entry) => entry.provider === 'custom');
  check('circuit breaker opens after repeated failures', Boolean(breakerState?.open), JSON.stringify(breakerState));

  /* ------------------------------------------------------------- budget */
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234';
  process.env.SUPPORT_AI_DAILY_TOKEN_BUDGET = '1';
  const budgetResult = await chat({
    messages: [{ role: 'user', text: 'budget test' }],
    kbFallback: () => 'Budget fallback answer',
  });
  check('exhausted budget falls back instead of calling the provider', budgetResult.kbOnly === true, JSON.stringify(budgetResult));
  process.env.SUPPORT_AI_DAILY_TOKEN_BUDGET = '1000000';

  /* ------------------------------------------------------ test connection */
  process.env.SUPPORT_AI_API_KEY = 'test-key-1234';
  const connection = await testConnection();
  check('test connection reports ok', connection.ok === true, JSON.stringify(connection));
  check('test connection reports latency', typeof connection.latencyMs === 'number' && connection.latencyMs >= 0);

  process.env.SUPPORT_AI_BASE_URL = 'http://127.0.0.1:1/v1';
  const badConnection = await testConnection({ provider: 'custom', model: 'mock-model-1' });
  check('test connection reports failures with a code', badConnection.ok === false && typeof badConnection.code === 'string', JSON.stringify(badConnection));

  /* ------------------------------------------------------------ cleanup */
  await Promise.all([
    new Promise((resolve) => openAiServer.close(resolve)),
    new Promise((resolve) => anthropicServer.close(resolve)),
    new Promise((resolve) => geminiServer.close(resolve)),
    new Promise((resolve) => cohereServer.close(resolve)),
  ]);

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});

