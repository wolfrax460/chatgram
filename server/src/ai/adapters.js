/**
 * HTTP adapters. Every adapter has the same shape:
 *
 *   chat({ config, system, messages, temperature, maxTokens, signal })
 *     -> { text, usage: { inputTokens, outputTokens } }
 *
 * Streaming is exposed by `streamChat` as an async iterator of text chunks; the
 * service falls back to one chunk for adapters that do not stream.
 */
const { AiError } = require('./errors');

function keyOf(config) {
  return config.apiKey || '';
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function mapHttpError(status, payload) {
  const message = payload?.error?.message || payload?.message || payload?.raw || `HTTP ${status}`;
  const fail = (code, text) => {
    const error = new AiError(code, text);
    // Keep the HTTP status on the error so failure logging can report
    // "provider + HTTP status" without parsing the message.
    error.status = Number(status) || null;
    return error;
  };
  if (status === 401 || status === 403) return fail('auth_failed', `Authentication failed: ${message}`);
  if (status === 429) return fail('rate_limited', `Rate limited: ${message}`);
  if (status === 408) return fail('timeout', `Timed out: ${message}`);
  if (status === 400 && /content|policy|safety|block/i.test(String(message))) {
    return fail('content_blocked', `Blocked by the provider: ${message}`);
  }
  if (status >= 500) return fail('unavailable', `Provider unavailable: ${message}`);
  return fail('unavailable', `Provider error (${status}): ${message}`);
}

async function postJson(url, { headers, body, signal, timeoutMs }) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new AiError('timeout', 'The provider did not answer in time.');
    throw new AiError('unavailable', `Could not reach the provider: ${error.message}`);
  }
  void timeoutMs;
  const payload = await readJson(response);
  if (!response.ok) throw mapHttpError(response.status, payload);
  return payload;
}

/* ------------------------------------------------------- OpenAI-compatible */

function openAiBody({ system, messages, temperature, maxTokens }) {
  return {
    model: undefined, // filled by caller
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.text,
    }))],
    temperature,
    max_tokens: maxTokens,
  };
}

async function openAiCompatible({ config, system, messages, temperature, maxTokens, signal }) {
  const body = openAiBody({ system, messages, temperature, maxTokens });
  body.model = config.model;
  const payload = await postJson(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    headers: config.apiKey ? { Authorization: `Bearer ${keyOf(config)}` } : {},
    body,
    signal,
  });
  const text = payload?.choices?.[0]?.message?.content;
  const trimmed = Array.isArray(text)
    ? text.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
    : String(text || '');
  return {
    text: trimmed.trim(),
    usage: {
      inputTokens: payload?.usage?.prompt_tokens || 0,
      outputTokens: payload?.usage?.completion_tokens || 0,
    },
  };
}

/* -------------------------------------------------------------- Anthropic */

async function anthropic({ config, system, messages, temperature, maxTokens, signal }) {
  const payload = await postJson(`${config.baseUrl.replace(/\/+$/, '')}/messages`, {
    headers: {
      'x-api-key': keyOf(config),
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: config.model,
      system: system || undefined,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: message.text }],
      })),
    },
    signal,
  });
  const text = (payload?.content || [])
    .map((part) => (part?.type === 'text' ? part.text : ''))
    .join('');
  return {
    text: String(text).trim(),
    usage: {
      inputTokens: payload?.usage?.input_tokens || 0,
      outputTokens: payload?.usage?.output_tokens || 0,
    },
  };
}

/* ------------------------------------------------------------ Google Gemini */

async function gemini({ config, system, messages, temperature, maxTokens, signal }) {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(keyOf(config))}`;
  const payload = await postJson(url, {
    headers: {},
    body: {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.text }],
      })),
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    },
    signal,
  });
  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || '')
    .join('');
  return {
    text: String(text).trim(),
    usage: {
      inputTokens: payload?.usageMetadata?.promptTokenCount || 0,
      outputTokens: payload?.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

/* ----------------------------------------------------------------- Cohere */

async function cohere({ config, system, messages, temperature, maxTokens, signal }) {
  const payload = await postJson(`${config.baseUrl.replace(/\/+$/, '')}/chat`, {
    headers: { Authorization: `Bearer ${keyOf(config)}` },
    body: {
      model: config.model,
      message: messages[messages.length - 1]?.text || '',
      preamble: system || undefined,
      chatHistory: messages.slice(0, -1).map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        message: message.text,
      })),
      temperature,
      max_tokens: maxTokens,
    },
    signal,
  });
  return {
    text: String(payload?.text || '').trim(),
    usage: {
      inputTokens: payload?.usage?.tokens?.input_tokens || payload?.meta?.billed_units?.input_tokens || 0,
      outputTokens: payload?.usage?.tokens?.output_tokens || payload?.meta?.billed_units?.output_tokens || 0,
    },
  };
}

/**
 * Default NVIDIA NIM model for the Help/Support assistant.
 *
 * NVIDIA publishes the Nemotron "Super 120B" as `nvidia/nemotron-3-super-120b-a12b`
 * on build.nvidia.com (OpenAI-compatible NIM endpoint, /v1/chat/completions).
 * `NVIDIA_MODEL` overrides it (e.g. for a self-hosted NIM container).
 */
const NVIDIA_DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/** Key env var for a provider (empty for local providers). Never read elsewhere. */
function envKeyFor(provider) {
  const entry = PROVIDERS[provider];
  if (!entry || !entry.keyEnv) return '';
  return String(process.env[entry.keyEnv] || '');
}

/** Default model for providers that ship one (currently only NVIDIA NIM). */
function defaultModelFor(provider) {
  return String(PROVIDERS[provider]?.defaultModel || '');
}

/**
 * Effective base URL. `NVIDIA_BASE_URL` is a test/proxy override for the fixed
 * NIM endpoint; admin-entered base URLs are validated separately (SSRF guard).
 */
function baseUrlFor(provider) {
  if (provider === 'nvidia' && process.env.NVIDIA_BASE_URL) {
    return String(process.env.NVIDIA_BASE_URL).trim().replace(/\/+$/, '');
  }
  return String(PROVIDERS[provider]?.baseUrl || '');
}

/* --------------------------------------------------------------- registry */

const ADAPTERS = {
  'openai-compatible': openAiCompatible,
  anthropic,
  gemini,
  cohere,
};

/**
 * Provider table. `keyEnv` names the env var used when no key is configured in
 * the admin settings; local providers need no key.
 */
const PROVIDERS = {
  openai: { adapter: 'openai-compatible', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  'azure-openai': {
    adapter: 'openai-compatible',
    label: 'Azure OpenAI',
    baseUrl: '',
    keyEnv: 'AZURE_OPENAI_API_KEY',
    note: 'Set the base URL to https://<resource>.openai.azure.com/openai/deployments/<deployment> and put the api-version in the URL.',
  },
  anthropic: { adapter: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', keyEnv: 'ANTHROPIC_API_KEY' },
  gemini: {
    adapter: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
  },
  mistral: { adapter: 'openai-compatible', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY' },
  groq: { adapter: 'openai-compatible', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  together: { adapter: 'openai-compatible', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', keyEnv: 'TOGETHER_API_KEY' },
  openrouter: { adapter: 'openai-compatible', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  deepseek: { adapter: 'openai-compatible', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY' },
  xai: { adapter: 'openai-compatible', label: 'xAI', baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY' },
  // NVIDIA NIM: OpenAI-compatible, fixed hosted endpoint, key only via NVIDIA_API_KEY
  // (or the encrypted admin key). Model defaults to Nemotron Super 120B.
  nvidia: {
    adapter: 'openai-compatible',
    label: 'NVIDIA NIM (Nemotron)',
    baseUrl: NVIDIA_BASE_URL,
    keyEnv: 'NVIDIA_API_KEY',
    defaultModel: NVIDIA_DEFAULT_MODEL,
    note: 'Hosted NIM endpoint. Set NVIDIA_API_KEY (server .env); NVIDIA_MODEL overrides the model.',
  },
  cohere: { adapter: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.com/v2', keyEnv: 'COHERE_API_KEY' },
  ollama: { adapter: 'openai-compatible', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', keyEnv: '' },
  lmstudio: { adapter: 'openai-compatible', label: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', keyEnv: '' },
  llamacpp: { adapter: 'openai-compatible', label: 'llama.cpp (local)', baseUrl: 'http://127.0.0.1:8080/v1', keyEnv: '' },
  vllm: { adapter: 'openai-compatible', label: 'vLLM (local)', baseUrl: 'http://127.0.0.1:8000/v1', keyEnv: '' },
  custom: { adapter: 'openai-compatible', label: 'Custom OpenAI-compatible', baseUrl: '', keyEnv: 'CUSTOM_AI_API_KEY' },
};

function adapterFor(provider) {
  const entry = PROVIDERS[provider];
  if (!entry) throw new AiError('unavailable', `Unknown AI provider "${provider}".`);
  return ADAPTERS[entry.adapter];
}

module.exports = {
  PROVIDERS,
  ADAPTERS,
  adapterFor,
  mapHttpError,
  postJson,
  NVIDIA_DEFAULT_MODEL,
  NVIDIA_BASE_URL,
  envKeyFor,
  defaultModelFor,
  baseUrlFor,
};
