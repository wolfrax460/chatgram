/**
 * Multi-provider LLM adapter for the support assistant.
 *
 * One interface, several backends. The provider is chosen with AI_PROVIDER:
 *
 *   anthropic          Claude (native Messages API)
 *   openai             OpenAI /v1/chat/completions
 *   gemini             Google Gemini generateContent
 *   openai-compatible  anything speaking the OpenAI schema with its own
 *                      base URL — Groq, OpenRouter, Together, DeepSeek,
 *                      Mistral, Fireworks, Ollama, LM Studio, vLLM, …
 *   none               disabled (falls back to the knowledge base)
 *
 * Env:
 *   AI_PROVIDER=openai-compatible
 *   AI_BASE_URL=https://api.groq.com/openai/v1
 *   AI_API_KEY=...
 *   SUPPORT_AI_MODEL=llama-3.3-70b-versatile
 *   AI_MAX_TOKENS=400           (output cap)
 *
 * Back-compat: ANTHROPIC_API_KEY alone still selects the anthropic provider.
 */

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openai-compatible', 'none'];

/** Last provider failure, safe to show in the admin dashboard (never the key). */
let lastError = null;

function classifyError(message) {
  const text = String(message || '');
  if (/\b401\b|invalid api key|unauthoriz|authentication/i.test(text)) return 'invalid_key';
  if (/\b403\b|forbidden/i.test(text)) return 'invalid_key';
  if (/\b429\b|rate limit|quota|too many requests/i.test(text)) return 'quota';
  if (/\b404\b|model.*(not found|does not exist)|decommissioned/i.test(text)) return 'model_not_found';
  if (/\b400\b|bad request|tool choice/i.test(text)) return 'bad_request';
  if (/abort|timeout|timed out/i.test(text)) return 'timeout';
  if (/empty|no content/i.test(text)) return 'empty_answer';
  return 'network';
}

function setLastError(code, message) {
  lastError = {
    code,
    message: String(message || '').slice(0, 300),
    at: new Date().toISOString(),
  };
}

function getLastError() {
  return lastError;
}

function clearLastError() {
  lastError = null;
}

/** Keys that would never be valid: whitespace, absurd length. */
function looksLikeKey(value) {
  const key = String(value || '');
  return key.length >= 20 && key.length <= 500 && key.trim() === key && !/\s/.test(key);
}

function resolveConfig() {
  const explicit = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  const model = (process.env.SUPPORT_AI_MODEL || '').trim();

  let provider = PROVIDERS.includes(explicit) ? explicit : '';
  let apiKey = (process.env.AI_API_KEY || '').trim();
  let baseUrl = (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '');

  // Legacy single-provider setup.
  if (!provider && process.env.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
    apiKey = apiKey || process.env.ANTHROPIC_API_KEY.trim();
  }
  if (!provider && process.env.OPENAI_API_KEY) {
    provider = 'openai';
    apiKey = apiKey || process.env.OPENAI_API_KEY.trim();
  }
  if (!provider && process.env.GEMINI_API_KEY) {
    provider = 'gemini';
    apiKey = apiKey || process.env.GEMINI_API_KEY.trim();
  }
  if (!provider) provider = 'none';

  if (provider === 'openai' && !baseUrl) baseUrl = 'https://api.openai.com/v1';
  if (provider === 'anthropic' && !baseUrl) baseUrl = 'https://api.anthropic.com/v1';
  if (provider === 'gemini' && !baseUrl) baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  const resolver = provider === 'openai' || provider === 'openai-compatible';
  const fallbackModel =
    provider === 'anthropic'
      ? 'claude-3-5-haiku-latest'
      : provider === 'gemini'
        ? 'gemini-1.5-flash'
        : 'gpt-4o-mini';

  return {
    provider,
    apiKey,
    baseUrl,
    model: model || fallbackModel,
    maxTokens: Number(process.env.AI_MAX_TOKENS || 400),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
    usesOpenAiSchema: resolver,
    enabled: process.env.SUPPORT_AI_ENABLED === 'true' && provider !== 'none' && Boolean(apiKey),
  };
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || text.slice(0, 200);
      throw new Error(`${response.status}: ${String(detail).slice(0, 300)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- providers */

async function callAnthropic(cfg, system, messages) {
  const data = await postJson(
    `${cfg.baseUrl}/messages`,
    { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
    },
    cfg.timeoutMs,
  );
  const part = Array.isArray(data?.content) ? data.content.find((c) => c.type === 'text') : null;
  return part?.text ?? '';
}

async function callOpenAiSchema(cfg, system, messages) {
  const data = await postJson(
    `${cfg.baseUrl}/chat/completions`,
    { Authorization: `Bearer ${cfg.apiKey}` },
    {
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: 0.3,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))],
    },
    cfg.timeoutMs,
  );
  return data?.choices?.[0]?.message?.content ?? '';
}

async function callGemini(cfg, system, messages) {
  const data = await postJson(
    `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
    {},
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
      generationConfig: { maxOutputTokens: cfg.maxTokens, temperature: 0.3 },
    },
    cfg.timeoutMs,
  );
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => p.text ?? '').join('');
}

/* ------------------------------------------------------------------ api */

/**
 * Optional bridge to the provider-agnostic layer in `server/src/ai`.
 *
 * When `SUPPORT_AI_LAYER=true` all support/help AI calls go through the new
 * service (same interface, encrypted admin settings, fallback chain, circuit
 * breaker, budget, redaction, SSRF). When it is off, the legacy adapters below
 * keep working unchanged.
 */
function useNewLayer() {
  return String(process.env.SUPPORT_AI_LAYER || '') === 'true';
}

function layerInfo() {
  return {
    enabled: String(process.env.SUPPORT_AI_ENABLED || '') === 'true',
    provider: process.env.SUPPORT_AI_PROVIDER || '',
    // Env view only: database overrides are visible in the admin AI panel.
    model: process.env.SUPPORT_AI_PROVIDER ? process.env.SUPPORT_AI_MODEL || '' : null,
  };
}

/**
 * Ask the configured model. Resolves to a trimmed answer, or null when the
 * assistant is disabled or the request fails (callers fall back to the KB).
 */
async function askAssistant({ system, messages, maxTokens }) {
  if (useNewLayer()) {
    try {
      const result = await require('../ai/service').chat({
        system,
        messages: (messages || []).map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          text: String(message.text || ''),
        })),
        maxTokens: maxTokens ? Math.min(Number(maxTokens) || 400, 2000) : undefined,
        allowContact: true, // support prompts handle their own contact collection
      });
      const clean = String(result.text || '').trim();
      return clean || null;
    } catch (error) {
      console.warn('Support AI (new layer) error:', error.message);
      return null;
    }
  }

  const cfg = resolveConfig();
  if (!cfg.enabled) return null;
  if (maxTokens) cfg.maxTokens = Math.min(Number(maxTokens) || cfg.maxTokens, 2000);

  const trimmed = messages.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    text: String(m.text || '').slice(0, 1500),
  }));

  const fallbackKey = process.env.AI_API_KEY_FALLBACK;
  const canFallBack = Boolean(fallbackKey) && fallbackKey !== cfg.apiKey && looksLikeKey(fallbackKey);

  const callOnce = async (activeCfg) => {
    if (activeCfg.provider === 'anthropic') return callAnthropic(activeCfg, system, trimmed);
    if (activeCfg.provider === 'gemini') return callGemini(activeCfg, system, trimmed);
    return callOpenAiSchema(activeCfg, system, trimmed);
  };

  try {
    let answer = await callOnce(cfg);
    let clean = String(answer || '').trim();

    // Reasoning models can spend the whole budget on hidden tokens and return
    // an empty answer; give them one chance with a bigger cap.
    if (!clean && cfg.maxTokens < 1600) {
      const bigger = { ...cfg, maxTokens: Math.min(cfg.maxTokens * 2, 1600) };
      answer = await callOnce(bigger);
      clean = String(answer || '').trim();
    }

    if (!clean) {
      setLastError('empty_answer', 'The provider returned an empty answer.');
      return null;
    }
    clearLastError();
    return clean.slice(0, cfg.maxTokens * 6);
  } catch (error) {
    let code = classifyError(error.message);
    if (code === 'invalid_key' && canFallBack) {
      // The stored dashboard key is dead but the server env key still works.
      try {
        const retryCfg = { ...cfg, apiKey: fallbackKey };
        const answer = await callOnce(retryCfg);
        const clean = String(answer || '').trim();
        if (clean) {
          setLastError('stored_key_invalid', 'The saved API key was rejected; the server environment key is being used.');
          return clean.slice(0, cfg.maxTokens * 6);
        }
      } catch (retryError) {
        code = classifyError(retryError.message);
      }
    }
    setLastError(code, error.message);
    console.warn('Support AI error:', error.message);
    return null;
  }
}

function assistantInfo() {
  if (useNewLayer()) return layerInfo();
  const cfg = resolveConfig();
  return { enabled: cfg.enabled, provider: cfg.provider, model: cfg.enabled ? cfg.model : null };
}

module.exports = {
  askAssistant,
  assistantInfo,
  resolveConfig,
  PROVIDERS,
  useNewLayer,
  classifyError,
  getLastError,
  clearLastError,
};
