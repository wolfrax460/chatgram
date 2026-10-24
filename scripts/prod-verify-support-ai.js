/** Post-deploy verification of the support AI (prints no secrets). */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const settings = require('./src/support/settings');
  await settings.loadIntoEnv();
  const ai = require('./src/support/aiProvider');
  const cfg = ai.resolveConfig();
  console.log('runtime provider:', cfg.provider, '| model:', cfg.model, '| keyLength:', cfg.apiKey.length);
  console.log('fallback key available:', Boolean(process.env.AI_API_KEY_FALLBACK), '| fallback length:', (process.env.AI_API_KEY_FALLBACK || '').length);

  const started = Date.now();
  const answer = await ai.askAssistant({ system: 'Reply with the single word OK', messages: [{ role: 'user', text: 'ping' }], maxTokens: 60 });
  console.log('AI TEST:', answer ? `OK in ${Date.now() - started}ms -> ${String(answer).slice(0, 80)}` : `FAILED in ${Date.now() - started}ms`);
  console.log('LAST ERROR:', JSON.stringify(ai.getLastError()));

  const SupportSettings = require('./src/models/SupportSettings');
  const doc = await SupportSettings.findOne({ key: 'global' }).lean();
  console.log('DB key length:', doc?.aiApiKey ? String(doc.aiApiKey).length : 0, '| starts gsk_:', /^gsk_/.test(String(doc?.aiApiKey || '')));

  await mongoose.disconnect();
}
main().catch((error) => { console.error('verify failed:', error.message); process.exit(1); });
