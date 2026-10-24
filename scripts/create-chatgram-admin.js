/**
 * Create/refresh the Chatgram Admin account and deliver queued AI inbox questions.
 * Run on the server:  node scripts/create-chatgram-admin.js   (password on stdin)
 */
const path = require('path');
const fs = require('fs');
require('../server/node_modules/dotenv').config({ path: path.join(__dirname, '../server/.env') });
const mongoose = require('../server/node_modules/mongoose');
const User = require('../server/src/models/User');
const ai = require('../server/src/ai/chatgram');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.split(/[\r\n]/)[0]));
  });
}

(async () => {
  const password = await readStdin();
  if (!password || password.length < 24) {
    console.error('A 24+ character password is required on stdin.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const email = String(process.env.CHATGRAM_ADMIN_EMAIL || 'terminal123b@gmail.com').toLowerCase().trim();
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({
      displayName: 'Chatgram Admin',
      email,
      about: 'Official Chatgram Admin inbox for the AI team.',
      avatarUrl: '/web/assistant-avatar.svg',
      isSupportAccount: false,
      mustChangePassword: true,
    });
  }
  user.password = password;
  user.displayName = user.displayName || 'Chatgram Admin';
  user.mustChangePassword = true;
  await user.save();
  const delivery = await ai.deliverQueuedInboxToAdmin();
  console.log(JSON.stringify({ created: true, email: user.email, id: String(user._id), delivered: delivery.delivered, remaining: delivery.remaining }));
  await mongoose.disconnect();
})().catch((error) => {
  console.error('failed:', error.message);
  process.exit(1);
});
