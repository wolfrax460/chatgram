/**
 * (Re)creates two TEST accounts for the presence smoke test with a plain
 * password (the User model hashes it on save). Removes any previous smoke
 * accounts first. Cleanup after the test is done by the same script with
 * --cleanup.
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
}

async function cleanup() {
  const User = require('../src/models/User');
  const Chat = require('../src/models/Chat');
  const Message = require('../src/models/Message');
  const old = await User.find({ email: /^presence-smoke-.*@chatgram\.test$/ }).select('_id').lean();
  if (!old.length) return 0;
  const ids = old.map((u) => u._id);
  const chats = await Chat.find({ participants: { $in: ids } }).select('_id').lean();
  await Message.deleteMany({ chatId: { $in: chats.map((c) => c._id) } });
  await Chat.deleteMany({ _id: { $in: chats.map((c) => c._id) } });
  await User.deleteMany({ _id: { $in: ids } });
  return old.length;
}

async function main() {
  await connect();
  const removed = await cleanup();
  if (removed) console.log(`removed ${removed} old smoke account(s)`);
  if (process.argv.includes('--cleanup')) {
    console.log('cleanup done');
    await mongoose.disconnect();
    return;
  }

  const User = require('../src/models/User');
  const run = Date.now().toString(36);
  const password = `Smoke-${run}-Aa1!`;
  const users = [];
  for (const label of ['a', 'b']) {
    const email = `presence-smoke-${label}-${run}@chatgram.test`;
    const user = await User.create({
      displayName: `PRESENCE SMOKE ${label.toUpperCase()} ${run}`,
      email,
      password, // plain: the schema hashes it
      isOnline: true, // deliberately stuck
      lastSeen: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });
    users.push({ id: String(user._id), email, label });
  }
  console.log('SMOKE_JSON ' + JSON.stringify({ run, password, users }));
  await mongoose.disconnect();
}

main().catch((e) => { console.error('failed:', e.message); process.exit(1); });
