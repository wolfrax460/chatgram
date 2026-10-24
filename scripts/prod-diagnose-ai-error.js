/** Print the exact AI failure for the support assistant, without the key. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openai-compatible', 'none'];

async function main() {
  const ai = require('./src/support/aiProvider');
  const cfg = ai.resolveConfig();
  console.log('provider:', cfg.provider, '| model:', cfg.model, '| base:', cfg.baseUrl, '| keyLength:', cfg.apiKey.length);

  // Show the exact provider error (status + message only).
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const message = body?.error?.message || body?.message || String(text).slice(0, 300);
  console.log(`HTTP ${response.status} in ${Date.now() - started}ms | ${message}`);

  // Does the model exist on this account?
  try {
    const models = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    const list = await models.json().catch(() => null);
    console.log('models endpoint:', models.status, '| has configured model:', Array.isArray(list?.data) ? list.data.some((m) => m.id === cfg.model) : 'n/a');
  } catch (error) {
    console.log('models endpoint failed:', error.message);
  }

  // Schema check: is the stored DB key selectable?
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  const SupportSettings = require('./src/models/SupportSettings');
  const plain = await SupportSettings.findOne({ key: 'global' }).lean();
  const selected = await SupportSettings.findOne({ key: 'global' }).select('+aiApiKey').lean();
  console.log('DB settings aiApiKey visible without +select:', Boolean(plain?.aiApiKey), '| with +aiApiKey:', Boolean(selected?.aiApiKey), '| length:', selected?.aiApiKey ? String(selected.aiApiKey).trim().length : 0);
  if (selected?.aiApiKey) {
    const key = String(selected.aiApiKey);
    console.log('DB key has whitespace:', /\s/.test(key), '| starts gsk_/sk-:', /^(gsk_|sk-)/.test(key.trim()), '| equals env key:', key.trim() === (process.env.AI_API_KEY || '').trim());
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('diagnose failed:', error.message);
  process.exit(1);
});
