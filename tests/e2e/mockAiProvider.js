/**
 * Mock OpenAI-compatible AI provider for the Playwright suite.
 *
 * Chatgram talks to the real provider layer, which is configured through the
 * admin API (a DB-backed provider pointing at this local server). No real key,
 * no internet, deterministic answers. The staging API only allows this endpoint
 * because scripts/start-staging.ps1 puts it in AI_ALLOWED_LOCAL_HOSTS.
 */
const http = require('http');

const PORT = 5099;
const KEY = 'e2e-mock-ai';
const MODEL = 'mock-chatgram-1';

/** What the mock model "answers": markdown, lists, a code block and raw HTML. */
const ANSWER = [
  '**Chatgram AI** here.',
  '',
  'Here is a short list:',
  '- First point',
  '- Second point',
  '',
  '1. Step one',
  '2. Step two',
  '',
  'Inline `code` and a block:',
  '```js',
  'console.log("hello from the mock");',
  '```',
  '',
  '<script>window.__xss = true; alert("xss")</script>',
].join('\n');

let server = null;

function start() {
  if (server) return Promise.resolve(server);
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        if (req.method === 'GET' && req.url.includes('/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: MODEL }] }));
          return;
        }
        if (!req.url.includes('/chat/completions')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        let body = {};
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          body = {};
        }
        if (body.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          // First token arrives after a short pause so the typing indicator is
          // observable; then the answer streams in small pieces.
          const words = ANSWER.split(/(\s+)/);
          let index = 0;
          const sendNext = () => {
            if (index >= words.length) {
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            const piece = words[index] ?? '';
            index += 1;
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
            setTimeout(sendNext, 12);
          };
          setTimeout(sendNext, 250);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: ANSWER }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 60 },
          }),
        );
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only (scripts/start-staging.ps1)

/** Point Chatgram AI at the mock through the real admin API. */
async function configure(request, apiUrl) {
  const login = await request.post(`${apiUrl}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
  if (!login.ok()) throw new Error(`admin login failed: ${login.status()}`);
  const { csrfToken } = await login.json();
  const headers = { 'X-Admin-CSRF': csrfToken };
  const saved = await request.put(`${apiUrl}/api/admin/providers/${KEY}`, {
    headers,
    data: {
      key: KEY,
      provider: 'custom',
      label: 'E2E mock AI',
      model: MODEL,
      baseUrl: `http://127.0.0.1:${PORT}/v1`,
      apiKey: 'e2e-not-a-real-key',
      enabled: true,
      timeoutMs: 20000,
    },
  });
  if (!saved.ok()) throw new Error(`saving provider failed: ${saved.status()} ${await saved.text()}`);
  const routed = await request.put(`${apiUrl}/api/admin/providers/features`, {
    headers,
    data: { features: { chatgramAI: { primary: KEY, fallbacks: [] } } },
  });
  if (!routed.ok()) throw new Error(`routing provider failed: ${routed.status()} ${await routed.text()}`);
  return { csrfToken, headers };
}

/** Remove the mock provider (deleting it also clears the routing). */
async function unconfigure(request, apiUrl) {
  const login = await request.post(`${apiUrl}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
  if (!login.ok()) return;
  const { csrfToken } = await login.json();
  await request.delete(`${apiUrl}/api/admin/providers/${KEY}`, { headers: { 'X-Admin-CSRF': csrfToken } });
}

module.exports = { start, stop, configure, unconfigure, ANSWER, KEY, MODEL, PORT };
