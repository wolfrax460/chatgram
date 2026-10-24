/**
 * Clear the stale dashboard AI key so the working server env key is used, then
 * verify the assistant answers. Settings-only mutation; prints no secrets.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const SupportSettings = require('./src/models/SupportSettings');
  const settings = require('./src/support/settings');
  const before = await SupportSettings.findOne({ key: 'global' }).lean();
  console.log('before: db key length', before?.aiApiKey ? String(before.aiApiKey).length : 0);
  await SupportSettings.updateOne({ key: 'global' }, { $set: { aiApiKey: null } });
  settings.invalidate();
  const after = await SupportSettings.findOne({ key: 'global' }).lean();
  console.log('after: db key length', after?.aiApiKey ? String(after.aiApiKey).length : 0);
  await mongoose.disconnect();
}
main().catch((error) => { console.error('clear failed:', error.message); process.exit(1); });
