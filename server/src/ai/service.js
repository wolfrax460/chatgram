/**
 * The AI service: one conversation interface over every provider.
 *
 *   await service.chat({ messages, system, signal, allowContact })
 *   for await (const chunk of service.streamChat({ ... })) { … }
 *
 * Responsibilities shared by all providers:
 *  - redact private data before sending,
 *  - retries with backoff + per-provider timeouts and abort-on-disconnect,
 *  - a circuit breaker per provider,
 *  - an ordered fallback chain that ends in a knowledge-base-only answer,
 *  - a daily token budget.
 */
const { AiError, ERROR_CODES } = require('./errors');
const { PROVIDERS, adapterFor, mapHttpError } = require('./adapters');
const { getEffectiveSettings } = require('./settings');
const { redactMessages, redact } = require('./redact');

const RETRYABLE = new Set([ERROR_CODES.UNAVAILABLE, ERROR_CODES.TIMEOUT, ERROR_CODES.RATE_LIMITED]);
const MAX_ATTEMPTS = 2;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

const breakers = new Map(); // provider -> { failures, openUntil }
const budgetUsage = new Map(); // yyyy-mm-dd -> tokens

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tokensUsedToday() {
  return budgetUsage.get(today()) || 0;
}

function addTokens(count) {
  const key = today();
  budgetUsage.set(key, (budgetUsage.get(key) || 0) + Math.max(0, Number(count) || 0));
  // Keep the map small.
  if (budgetUsage.size > 7) {
    for (const day of budgetUsage.keys()) {
      if (day !== key) budgetUsage.delete(day);
    }
  }
}

function breakerOpen(provider) {
  const entry = breakers.get(provider);
  return Boolean(entry && entry.openUntil > Date.now());
}

function noteSuccess(provider) {
  breakers.delete(provider);
}

function noteFailure(provider) {
  const entry = breakers.get(provider) || { failures: 0, openUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= BREAKER_THRESHOLD) {
    entry.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    entry.failures = 0;
    console.warn(`AI provider ${provider} circuit opened for ${BREAKER_COOLDOWN_MS / 1000}s`);
  }
  breakers.set(provider, entry);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-20)
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      text: String(message?.text || '').slice(0, 8000),
    }))
    .filter((message) => message.text.trim().length > 0);
}

function resolveChain(settings) {
  const chain = [];
  if (settings.provider && settings.model) {
    chain.push({
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl || PROVIDERS[settings.provider]?.baseUrl || '',
      apiKey: settings.apiKey,
    });
  }
  for (const fallback of settings.fallbacks) {
    chain.push({
      provider: fallback.provider,
      model: fallback.model,
      baseUrl: fallback.baseUrl || PROVIDERS[fallback.provider]?.baseUrl || '',
      apiKey: fallback.apiKey,
    });
  }
  return chain;
}

let providersModule = null;
function providerRegistry() {
  if (!providersModule) {
    try {
      providersModule = require('./providers');
    } catch {
      providersModule = null;
    }
  }
  return providersModule;
}

async function callProvider(entry, { system, messages, temperature, maxTokens, timeoutMs, signal }) {
  const adapter = adapterFor(entry.provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    const result = await adapter({
      config: entry,
      system,
      messages,
      temperature,
      maxTokens,
      signal: controller.signal,
    });
    return result;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * @param {object} options
 * @param {{role:'user'|'assistant', text:string}[]} options.messages
 * @param {string} [options.system]
 * @param {boolean} [options.allowContact]  keep emails/phones (ticket contact details)
 * @param {AbortSignal} [options.signal]
 * @param {() => string|Promise<string>} [options.kbFallback] knowledge-base-only answer
 */
async function chat(options = {}) {
  const settings = await getEffectiveSettings();
  const messages = redactMessages(normalizeMessages(options.messages), { allowContact: options.allowContact });
  const system = options.system ? redact(options.system, { allowContact: true }) : undefined;
  const kbFallback = options.kbFallback;

  if (!messages.length) throw new AiError(ERROR_CODES.NOT_CONFIGURED, 'A message is required.');

  let chain = [];
  if (options.feature) {
    const registry = providerRegistry();
    const featureChain = registry ? await registry.resolveFeatureChain(options.feature) : null;
    if (featureChain && featureChain.length > 0) chain = featureChain;
  }
  if (chain.length === 0) chain = resolveChain(settings);
  if (!settings.enabled || chain.length === 0) {
    if (kbFallback) {
      return {
        text: await kbFallback(),
        provider: 'kb',
        model: null,
        kbOnly: true,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    throw new AiError(ERROR_CODES.NOT_CONFIGURED, 'No AI provider is configured.');
  }

  if (tokensUsedToday() >= settings.dailyTokenBudget) {
    if (kbFallback) {
      return {
        text: await kbFallback(),
        provider: 'kb',
        model: null,
        kbOnly: true,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    throw new AiError(ERROR_CODES.BUDGET_EXCEEDED, 'The daily AI token budget is used up. Please try again tomorrow.');
  }

  let lastError = null;
  for (const entry of chain) {
    if (!entry.baseUrl) {
      lastError = new AiError(ERROR_CODES.NOT_CONFIGURED, `No endpoint configured for ${entry.provider}.`);
      continue;
    }
    if (breakerOpen(entry.provider)) {
      lastError = new AiError(ERROR_CODES.UNAVAILABLE, `${entry.provider} is cooling down after repeated failures.`);
      continue;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const attemptStarted = Date.now();
      try {
        const result = await callProvider(entry, {
          system,
          messages,
          temperature: options.temperature !== undefined ? options.temperature : settings.temperature,
          // Per-call override (the support agent replies with a smaller cap).
          maxTokens: options.maxTokens !== undefined ? options.maxTokens : settings.maxOutputTokens,
          timeoutMs: settings.timeoutMs,
          signal: options.signal,
        });
        noteSuccess(entry.provider);
        const registry = providerRegistry();
        const usage = result.usage || { inputTokens: 0, outputTokens: 0 };
        registry?.recordHealth?.(entry.key, {
          ok: true,
          latencyMs: Date.now() - attemptStarted,
          tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
        });
        const total =
          (usage.inputTokens || 0) + (usage.outputTokens || 0) ||
          estimateTokens(messages.map((m) => m.text).join(' ')) + estimateTokens(result.text);
        addTokens(total);
        return {
          text: String(result.text || ''),
          provider: entry.provider,
          providerKey: entry.key || entry.provider,
          model: entry.model,
          kbOnly: false,
          usage,
        };
      } catch (error) {
        lastError = error instanceof AiError ? error : new AiError(ERROR_CODES.UNAVAILABLE, error.message);
        providerRegistry()?.recordHealth?.(entry.key, { ok: false, latencyMs: Date.now() - attemptStarted, error: lastError.code });
        if (options.signal?.aborted) throw new AiError(ERROR_CODES.TIMEOUT, 'Request aborted.');
        if (!RETRYABLE.has(lastError.code) || attempt >= MAX_ATTEMPTS) break;
        await sleep(250 * attempt);
      }
    }
    noteFailure(entry.provider);
  }

  if (kbFallback) {
    return {
      text: await kbFallback(),
      provider: 'kb',
      model: null,
      kbOnly: true,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  throw lastError || new AiError(ERROR_CODES.UNAVAILABLE, 'No AI provider answered.');
}

/**
 * Streaming interface. The contract is the same for every provider: an async
 * iterator of text chunks, ending with a final `{ done: true }`-style chunk when
 * the provider supports it. Providers without native streaming yield one chunk.
 */
async function* streamChat(options = {}) {
  const result = await chat(options);
  yield { text: result.text, done: false, provider: result.provider };
  yield { text: '', done: true, provider: result.provider };
}

/** "Test connection": tiny prompt, reports success + latency + error code. */
async function testConnection(overrides = {}) {
  const settings = await getEffectiveSettings();
  const chain = resolveChain(settings);
  const primary = chain[0];
  if (!primary && !overrides.provider) {
    return { ok: false, code: ERROR_CODES.NOT_CONFIGURED, message: 'Choose a provider, model and API key first.' };
  }
  const entry = overrides.provider
    ? {
        provider: overrides.provider,
        model: overrides.model || settings.model,
        baseUrl: overrides.baseUrl || PROVIDERS[overrides.provider]?.baseUrl || '',
        apiKey: overrides.apiKey || settings.apiKey,
      }
    : primary;

  if (!entry.model) return { ok: false, code: ERROR_CODES.NOT_CONFIGURED, message: 'A model name is required.' };

  const started = Date.now();
  try {
    const result = await callProvider(entry, {
      system: 'You are a connection test. Reply with the single word: ok',
      messages: [{ role: 'user', text: 'ping' }],
      temperature: 0,
      maxTokens: 16,
      timeoutMs: Math.min(settings.timeoutMs, 15_000),
      signal: undefined,
    });
    const latencyMs = Date.now() - started;
    return {
      ok: true,
      provider: entry.provider,
      model: entry.model,
      latencyMs,
      sample: String(result.text || '').slice(0, 120),
    };
  } catch (error) {
    return {
      ok: false,
      provider: entry.provider,
      model: entry.model,
      latencyMs: Date.now() - started,
      code: error instanceof AiError ? error.code : ERROR_CODES.UNAVAILABLE,
      message: error.message,
    };
  }
}

function diagnostics() {
  return {
    tokensUsedToday: tokensUsedToday(),
    breakers: [...breakers.entries()].map(([provider, entry]) => ({
      provider,
      open: entry.openUntil > Date.now(),
      failures: entry.failures,
    })),
  };
}

const service = { chat, streamChat, testConnection, diagnostics };

module.exports = { service, chat, streamChat, testConnection, diagnostics, AiError, ERROR_CODES };


/**
 * Stream an answer for a feature through the provider chain.
 * OpenAI-compatible providers stream tokens (SSE); other adapters yield one chunk.
 */
async function* streamForFeature(options = {}) {
  const settings = await getEffectiveSettings();
  let chain = [];
  if (options.feature) {
    const registry = require('./providers');
    const featureChain = await registry.resolveFeatureChain(options.feature);
    if (featureChain && featureChain.length > 0) chain = featureChain;
  }
  if (chain.length === 0) chain = resolveChain(settings);
  if (chain.length === 0) throw new AiError(ERROR_CODES.NOT_CONFIGURED, 'No AI provider is configured.');
  if (tokensUsedToday() >= settings.dailyTokenBudget) {
    throw new AiError(ERROR_CODES.BUDGET_EXCEEDED, 'The daily AI token budget is used up.');
  }
  const messages = normalizeMessages(options.messages);
  const system = options.system ? redact(options.system, { allowContact: true }) : undefined;
  const maxTokens = options.maxTokens || settings.maxOutputTokens;
  const registry = providerRegistry();
  // A group answer is posted as one finished message, so it does not need live
  // deltas. Buffering means a provider that dies mid-stream cannot leave a
  // half answer that a fallback then duplicates.
  const buffered = options.buffer === true;
  const seen = new Set();
  let lastError = null;

  for (const entry of chain) {
    // De-duplicate by provider KEY: the production chain listed the same
    // provider as primary and fallback, so a rate-limited primary "fell back"
    // to the identical endpoint and failed again.
    const key = entry.key || entry.provider;
    if (!entry.baseUrl || seen.has(key) || breakerOpen(key)) continue;
    seen.add(key);

    const openAiCompatible = entry.provider === 'openai-compatible' || PROVIDERS[entry.provider]?.adapter === 'openai-compatible';
    const started = Date.now();
    if (!openAiCompatible) {
      // Adapters without native streaming: one chunk through the regular path.
      const parts = [];
      try {
        const result = await callProvider(entry, {
          system,
          messages: redactMessages(messages),
          temperature: settings.temperature,
          maxTokens,
          timeoutMs: settings.timeoutMs,
          signal: options.signal,
        });
        const usage = result.usage || { inputTokens: 0, outputTokens: 0 };
        addTokens((usage.inputTokens || 0) + (usage.outputTokens || 0));
        noteSuccess(key);
        registry?.recordHealth?.(key, {
          ok: true,
          latencyMs: Date.now() - started,
          tokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
        });
        const delta = { delta: String(result.text || ''), providerKey: key };
        if (buffered) parts.push(delta);
        else yield delta;
        const final = { delta: '', done: true, finishReason: null, providerKey: key };
        if (buffered) parts.push(final);
        else yield final;
        if (buffered) yield* parts;
        return;
      } catch (error) {
        lastError = error instanceof AiError ? error : new AiError(ERROR_CODES.UNAVAILABLE, error.message);
        noteFailure(key);
        registry?.recordHealth?.(key, { ok: false, latencyMs: Date.now() - started, error: lastError.code });
        if (options.signal?.aborted) throw new AiError(ERROR_CODES.TIMEOUT, 'Request aborted.');
        continue;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    const onAbort = () => controller.abort();
    if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
    const parts = [];
    try {
      const response = await fetch(`${entry.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${entry.apiKey}` },
        body: JSON.stringify({
          model: entry.model,
          stream: true,
          max_tokens: maxTokens,
          temperature: settings.temperature,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            ...redactMessages(messages).map((message) => ({ role: message.role, content: message.text })),
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw mapHttpError(response.status, payload);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let tokens = 0;
      let finishReason = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const choice = json?.choices?.[0];
            if (choice?.finish_reason) finishReason = String(choice.finish_reason);
            const delta = choice?.delta?.content;
            if (delta) {
              tokens += 1;
              const chunk = { delta: String(delta), providerKey: key };
              if (buffered) parts.push(chunk);
              else yield chunk;
            }
          } catch {
            /* ignore malformed keep-alive lines */
          }
        }
      }
      addTokens(tokens);
      noteSuccess(key);
      registry?.recordHealth?.(key, { ok: true, latencyMs: Date.now() - started, tokens });
      const final = { delta: '', done: true, finishReason, providerKey: key };
      if (buffered) parts.push(final);
      else yield final;
      if (buffered) yield* parts;
      return;
    } catch (error) {
      lastError = error instanceof AiError ? error : new AiError(ERROR_CODES.UNAVAILABLE, error.message);
      noteFailure(key);
      registry?.recordHealth?.(key, { ok: false, latencyMs: Date.now() - started, error: lastError.code });
      if (options.signal?.aborted) throw new AiError(ERROR_CODES.TIMEOUT, 'Request aborted.');
      // Try the next provider in the chain.
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError || new AiError(ERROR_CODES.UNAVAILABLE, 'No AI provider answered.');
}

// Callers do `const { service } = require('./service')` once, at load time, so the
// streamer must live on that object too (not only on module.exports).
service.streamForFeature = streamForFeature;
module.exports = { ...module.exports, service, streamForFeature };
