/**
 * Provider-agnostic AI layer.
 *
 * One interface — `chat({ messages, system, stream, signal })` — with adapters
 * for every major vendor plus any OpenAI-compatible endpoint (Groq, Together,
 * OpenRouter, DeepSeek, xAI, Mistral, Fireworks, Azure OpenAI, Ollama, LM Studio,
 * llama.cpp, vLLM, …). Nothing here hardcodes a model name.
 *
 * See docs/ai-providers.md.
 */
const { service, AiError, ERROR_CODES } = require('./service');
const { PROVIDERS, ADAPTERS } = require('./adapters');
const { getEffectiveSettings, updateSettings, maskedSettings, keyLast4 } = require('./settings');
const { redact } = require('./redact');
const { validateBaseUrl } = require('./ssrf');

module.exports = {
  service,
  AiError,
  ERROR_CODES,
  PROVIDERS,
  ADAPTERS,
  getEffectiveSettings,
  updateSettings,
  maskedSettings,
  keyLast4,
  redact,
  validateBaseUrl,
};
