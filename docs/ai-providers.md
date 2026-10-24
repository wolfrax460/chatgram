# AI providers (provider-agnostic layer)

Chatgram's AI layer lives in `server/src/ai/`. It exposes one interface for every
provider so the app has no vendor lock-in:

```js
const { service } = require('./src/ai');

const result = await service.chat({
  system: 'You are the Chatgram Assistant…',
  messages: [{ role: 'user', text: 'How do I reset my password?' }],
  signal,            // AbortSignal (aborted when the client disconnects)
  allowContact,      // true only when the user is submitting ticket contact details
});

// → { text, provider, model, kbOnly, usage: { inputTokens, outputTokens } }

for await (const chunk of service.streamChat({ ... })) {
  // { text, done, provider }
}

await service.testConnection();   // { ok, latencyMs, code?, message? }
```

## What is sent

- The system prompt (never includes keys), the recent conversation (max 20 turns),
  and nothing else from the user's account.
- Before sending, `redact()` removes passwords, OTP/2FA codes, bearer tokens, API
  keys, JWTs, long random secrets, card numbers, email addresses and phone
  numbers. `allowContact: true` keeps the email/phone only for the ticket-contact
  flow (the user is deliberately handing them over).
- Provider responses are treated as text. No HTML is ever injected into the UI.

## Configuration: env first, database second

The admin dashboard (`GET/PUT /api/support/admin/ai`, support account only) can
override every value. A saved API key is encrypted with AES-256-GCM using
`AI_SETTINGS_SECRET` (falls back to `JWT_SECRET`) and is **never returned** — the
API returns `hasKey` and `keyLast4` only. Environment variables remain the
default when no database value is set.

| Env variable | Meaning | Default |
|---|---|---|
| `SUPPORT_AI_ENABLED` | master switch | `false` |
| `SUPPORT_AI_PROVIDER` | provider id (table below) | – |
| `SUPPORT_AI_MODEL` | model name — **never hardcoded** | – |
| `SUPPORT_AI_API_KEY` | API key (prefer the admin page / provider-specific keys) | – |
| `SUPPORT_AI_BASE_URL` | endpoint override (Azure, gateway, local server) | provider default |
| `SUPPORT_AI_TEMPERATURE` | 0–2 | `0.2` |
| `SUPPORT_AI_MAX_OUTPUT_TOKENS` | output cap | `400` |
| `SUPPORT_AI_TIMEOUT_MS` | per-request timeout | `20000` |
| `SUPPORT_AI_DAILY_TOKEN_BUDGET` | tokens/day before falling back to KB-only | `200000` |
| `SUPPORT_AI_FALLBACKS` | ordered `provider:model[:KEY_ENV]` list, comma separated | empty |
| `SUPPORT_AI_BASE_URL_<PROVIDER>` | per-provider base URL for fallbacks (e.g. `SUPPORT_AI_BASE_URL_ANTHROPIC`) | provider default |
| `AI_SETTINGS_SECRET` | key for encrypting stored keys | `JWT_SECRET` |
| `AI_ALLOWED_LOCAL_HOSTS` | comma list of local hosts `host:port` allowed for plain-http/private endpoints | empty |

Provider-specific key env vars are also read when `SUPPORT_AI_API_KEY` is empty:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`,
`GROQ_API_KEY`, `TOGETHER_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`,
`XAI_API_KEY`, `COHERE_API_KEY`, `AZURE_OPENAI_API_KEY`, `CUSTOM_AI_API_KEY`.

## Providers and adapters

| Provider id | Adapter | Default base URL | Notes |
|---|---|---|---|
| `openai` | openai-compatible | `https://api.openai.com/v1` | |
| `azure-openai` | openai-compatible | – | set the full deployment URL as base URL |
| `anthropic` | anthropic | `https://api.anthropic.com/v1` | `x-api-key` + `anthropic-version` |
| `gemini` | gemini | `https://generativelanguage.googleapis.com/v1beta` | key in query string |
| `mistral` | openai-compatible | `https://api.mistral.ai/v1` | |
| `groq` | openai-compatible | `https://api.groq.com/openai/v1` | |
| `together` | openai-compatible | `https://api.together.xyz/v1` | |
| `openrouter` | openai-compatible | `https://openrouter.ai/api/v1` | |
| `deepseek` | openai-compatible | `https://api.deepseek.com/v1` | |
| `xai` | openai-compatible | `https://api.x.ai/v1` | |
| `cohere` | cohere | `https://api.cohere.com/v2` | |
| `ollama` | openai-compatible | `http://127.0.0.1:11434/v1` | local, no key |
| `lmstudio` | openai-compatible | `http://127.0.0.1:1234/v1` | local, no key |
| `llamacpp` | openai-compatible | `http://127.0.0.1:8080/v1` | local, no key |
| `vllm` | openai-compatible | `http://127.0.0.1:8000/v1` | local, no key |
| `custom` | openai-compatible | – | any OpenAI-schema endpoint |

### Example configs

```ini
# Groq (fast, cheap)
SUPPORT_AI_ENABLED=true
SUPPORT_AI_PROVIDER=groq
SUPPORT_AI_MODEL=<model available in your Groq account>
GROQ_API_KEY=<key>

# OpenRouter with an Anthropic fallback
SUPPORT_AI_PROVIDER=openrouter
SUPPORT_AI_MODEL=<model>
OPENROUTER_API_KEY=<key>
SUPPORT_AI_FALLBACKS=anthropic:<anthropic-model>:ANTHROPIC_API_KEY

# Local Ollama (no key, allow the local host for plain http)
SUPPORT_AI_PROVIDER=ollama
SUPPORT_AI_MODEL=<model pulled in Ollama>
SUPPORT_AI_BASE_URL=http://127.0.0.1:11434/v1
AI_ALLOWED_LOCAL_HOSTS=127.0.0.1:11434

# OpenAI-compatible gateway / vLLM / LM Studio
SUPPORT_AI_PROVIDER=custom
SUPPORT_AI_BASE_URL=https://gateway.example.com/v1
SUPPORT_AI_MODEL=<model>
CUSTOM_AI_API_KEY=<key>
```

## Behaviour shared by every provider

- **Same error types**: `rate_limited`, `auth_failed`, `timeout`,
  `content_blocked`, `unavailable`, `budget_exceeded`, `not_configured`.
- **Retries with backoff** (250 ms, 500 ms) for rate limits, timeouts and 5xx.
- **Timeout** per request via `AbortController`; the caller's `signal` aborts the
  upstream request when the widget closes.
- **Circuit breaker** per provider: 3 consecutive failures open it for 60 s; the
  chain then skips that provider.
- **Fallback chain**: `SUPPORT_AI_FALLBACKS` (or the admin-saved list) in order;
  the last resort is a knowledge-base-only answer plus "Talk to a person".
- **Daily token budget**: once `tokensUsedToday >= SUPPORT_AI_DAILY_TOKEN_BUDGET`
  the service stops calling providers and uses the KB fallback. The counter is
  in memory (resets on process restart; move it to Mongo/Redis for multi-instance
  deployments).
- **Streaming**: `streamChat()` is an async iterator for every provider. Adapters
  without native SSE yield a single chunk then `{ done: true }`.

## SSRF protection

Admin-entered endpoints are validated:

1. `https` only, unless the host is listed in `AI_ALLOWED_LOCAL_HOSTS`.
2. No credentials embedded in the URL.
3. Private/loopback/link-local/metadata addresses are rejected unless that exact
   host:port is allow-listed (needed for Ollama/LM Studio).
4. Hostnames are resolved and rejected if any A/AAAA record is private
   (DNS-rebinding guard).

## Adding an adapter in under 30 lines

1. Add an async function in `server/src/ai/adapters.js`:

```js
async function myVendor({ config, system, messages, temperature, maxTokens, signal }) {
  const payload = await postJson(`${config.baseUrl}/my-path`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: { model: config.model, system, messages, temperature, max_tokens: maxTokens },
    signal,
  });
  return {
    text: String(payload.output?.[0]?.text || '').trim(),
    usage: { inputTokens: payload.usage?.in || 0, outputTokens: payload.usage?.out || 0 },
  };
}
```

2. Register it in `ADAPTERS` (`'my-vendor': myVendor`).
3. Add a `PROVIDERS` entry with `{ adapter: 'my-vendor', label, baseUrl, keyEnv }`.
4. Add one mock-server test in `server/test/ai/ai.test.js`.

## Privacy policy notes

- Data is sent to the **configured provider only**; no provider is contacted when
  `SUPPORT_AI_ENABLED=false`, when the budget is exhausted, or after a provider's
  circuit breaker opens (the KB fallback is used instead).
- Redaction is best-effort pattern matching; it cannot guarantee catching every
  secret. The prompt itself forbids asking for passwords/codes.
- Help-widget conversations are retained for 90 days (TTL indexes) and can be
  deleted by the person from the widget (`Delete` action).
- Admin-saved API keys are encrypted at rest and never leave the server; logs
  never include request bodies or keys.
