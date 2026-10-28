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
 * NVIDIA NIM (Nemotron Super 120B) is tried FIRST for the Help/Support assistant
 * whenever `NVIDIA_API_KEY` is set in the server env (model: `NVIDIA_MODEL`,
 * default nvidia/nemotron-3-super-120b-a12b; endpoint override: `NVIDIA_BASE_URL`).
 * If the key is missing, or the NVIDIA call fails (429/5xx/auth/...), the provider
 * configured below is used as the fallback, so behaviour without the key is
 * exactly what it was before NVIDIA support existed.
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

const { NVIDIA_DEFAULT_MODEL, NVIDIA_BASE_URL } = require('../ai/adapters');
const { recordProviderFailure } = require('../ai/failureInbox');

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openai-compatible', 'nvidia', 'none'];

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
  if (provider === 'nvidia') {
    apiKey = apiKey || String(process.env.NVIDIA_API_KEY || '').trim();
    if (!baseUrl) baseUrl = String(process.env.NVIDIA_BASE_URL || NVIDIA_BASE_URL).trim().replace(/\/+$/, '');
  }

  const resolver = provider === 'openai' || provider === 'openai-compatible' || provider === 'nvidia';
  const fallbackModel =
    provider === 'anthropic'
      ? 'claude-3-5-haiku-latest'
      : provider === 'gemini'
        ? 'gemini-1.5-flash'
        : provider === 'nvidia'
          ? String(process.env.NVIDIA_MODEL || NVIDIA_DEFAULT_MODEL).trim()
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

/**
 * Env-only NVIDIA NIM config, tried before the provider above. Returns null when
 * NVIDIA_API_KEY is missing (or the assistant is explicitly switched off), so a
 * deployment without the key behaves exactly as before.
 */
function nvidiaConfig() {
  const apiKey = String(process.env.NVIDIA_API_KEY || '').trim();
  if (!apiKey) return null;
  if (String(process.env.SUPPORT_AI_ENABLED || '') === 'false') return null;
  return {
    provider: 'nvidia',
    apiKey,
    baseUrl: String(process.env.NVIDIA_BASE_URL || NVIDIA_BASE_URL).trim().replace(/\/+$/, ''),
    model: String(process.env.NVIDIA_MODEL || NVIDIA_DEFAULT_MODEL).trim(),
    maxTokens: Number(process.env.AI_MAX_TOKENS || 400),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
    usesOpenAiSchema: true,
    enabled: true,
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
      // Keep the HTTP status on the error so failure reports can show
      // "provider + HTTP status" without echoing response bodies or headers.
      const error = new Error(`${response.status}: ${String(detail).slice(0, 300)}`);
      error.status = response.status;
      throw error;
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
        // Route through the per-feature chain (admin-selectable NVIDIA NIM first
        // via the service's env NVIDIA entry, configured providers after it).
        feature: 'support',
      });
      const clean = String(result.text || '').trim();
      return clean || null;
    } catch (error) {
      console.warn('Support AI (new layer) error:', error.message);
      return null;
    }
  }

  const cfg = resolveConfig();
  const nvidia = nvidiaConfig();
  if (!nvidia && !cfg.enabled) return null;

  const trimmed = messages.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    text: String(m.text || '').slice(0, 1500),
  }));
  const requestedMaxTokens = maxTokens ? Math.min(Number(maxTokens) || 400, 2000) : null;

  const callOnce = async (activeCfg) => {
    if (activeCfg.provider === 'anthropic') return callAnthropic(activeCfg, system, trimmed);
    if (activeCfg.provider === 'gemini') return callGemini(activeCfg, system, trimmed);
    return callOpenAiSchema(activeCfg, system, trimmed);
  };

  // NVIDIA NIM (Nemotron) first when the key exists, then the provider that was
  // configured before this feature (today's behaviour) as the fallback.
  const attempts = [];
  if (nvidia) {
    attempts.push({
      ...nvidia,
      label: 'nvidia',
      maxTokens: Math.min(requestedMaxTokens || nvidia.maxTokens, 2000),
    });
  }
  if (cfg.enabled && (!nvidia || cfg.provider !== 'nvidia')) {
    attempts.push({
      ...cfg,
      label: 'legacy',
      maxTokens: Math.min(requestedMaxTokens || cfg.maxTokens, 2000),
    });
  }

  const fallbackKey = process.env.AI_API_KEY_FALLBACK;
  const canFallBack = cfg.enabled && Boolean(fallbackKey)
    && fallbackKey !== cfg.apiKey && looksLikeKey(fallbackKey);

  for (const attempt of attempts) {
    try {
      let answer = await callOnce(attempt);
      let clean = String(answer || '').trim();

      // Reasoning models can spend the whole budget on hidden tokens and return
      // an empty answer; give them one chance with a bigger cap.
      if (!clean && attempt.maxTokens < 1600) {
        answer = await callOnce({ ...attempt, maxTokens: Math.min(attempt.maxTokens * 2, 1600) });
        clean = String(answer || '').trim();
      }

      if (!clean) {
        setLastError('empty_answer', 'The provider returned an empty answer.');
        await recordProviderFailure({ provider: attempt.provider, code: 'empty_answer' });
        continue;
      }
      clearLastError();
      return clean.slice(0, attempt.maxTokens * 6);
    } catch (error) {
      let code = classifyError(error.message);
      let failureStatus = error.status;
      let failureMessage = error.message;

      if (attempt.label === 'legacy' && code === 'invalid_key' && canFallBack) {
        // The stored dashboard key is dead but the server env key still works.
        try {
          const retryClean = String(await callOnce({ ...attempt, apiKey: fallbackKey }) || '').trim();
          if (retryClean) {
            setLastError('stored_key_invalid', 'The saved API key was rejected; the server environment key is being used.');
            return retryClean.slice(0, attempt.maxTokens * 6);
          }
        } catch (retryError) {
          code = classifyError(retryError.message);
          failureStatus = retryError.status;
          failureMessage = retryError.message;
        }
      }

      setLastError(code, failureMessage);
      // Content-free: provider name + sanitized code only (never the key/prompt).
      await recordProviderFailure({ provider: attempt.provider, status: failureStatus, code });
      console.warn('Support AI error:', String(failureMessage || '').slice(0, 160));
      continue; // next provider (NVIDIA failed -> existing provider)
    }
  }
  return null;
}

function assistantInfo() {
  if (useNewLayer()) return layerInfo();
  const nvidia = nvidiaConfig();
  if (nvidia) return { enabled: true, provider: 'nvidia', model: nvidia.model };
  const cfg = resolveConfig();
  return { enabled: cfg.enabled, provider: cfg.provider, model: cfg.enabled ? cfg.model : null };
}

module.exports = {
  askAssistant,
  assistantInfo,
  resolveConfig,
  nvidiaConfig,
  PROVIDERS,
  useNewLayer,
  classifyError,
  getLastError,
  clearLastError,
};
