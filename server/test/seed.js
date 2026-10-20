/**
 * Seeds the database with demo data so the app can be tried immediately.
 *
 *   cd server && npm run seed
 *
 * Creates three users (password: password123), two direct chats, one group
 * chat, and a handful of messages. Safe to re-run: it clears the demo users
 * and their chats first.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = require('../src/utils/db');
const User = require('../src/models/User');
const Chat = require('../src/models/Chat');
const Message = require('../src/models/Message');

const DEMO_PASSWORD = 'password123';

const DEMO_USERS = [
  { displayName: 'Alice Johnson', email: 'alice@chatgram.dev', about: 'Available', phone: '+250780000001' },
  { displayName: 'Bob Smith', email: 'bob@chatgram.dev', about: 'At work', phone: '+250780000002' },
  { displayName: 'Carol White', email: 'carol@chatgram.dev', about: 'Busy', phone: '+250780000003' },
];

async function seed() {
  await connectDB({ exitOnFailure: true });

  // Never clobber a database that already holds real accounts. `npm run seed`
  // is called on every start, so this guard is what keeps your data safe.
  const force = process.argv.includes('--force') || process.argv.includes('-f');
  const existingUsers = await User.estimatedDocumentCount();

  if (existingUsers > 0 && !force) {
    console.log(
      `\nDatabase already has ${existingUsers} user(s) — skipping demo data.\n` +
        'Your accounts are untouched. To wipe the demo users and reload them:\n' +
        '  npm run reseed\n'
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  const emails = DEMO_USERS.map((u) => u.email);

  // Remove previous demo data.
  const oldUsers = await User.find({ email: { $in: emails } }).select('_id');
  const oldIds = oldUsers.map((u) => u._id);
  if (oldIds.length) {
    const oldChats = await Chat.find({ participants: { $in: oldIds } }).select('_id');
    await Message.deleteMany({ chatId: { $in: oldChats.map((c) => c._id) } });
    await Chat.deleteMany({ _id: { $in: oldChats.map((c) => c._id) } });
    await User.deleteMany({ _id: { $in: oldIds } });
    console.log(`Cleared ${oldIds.length} previous demo user(s)`);
  }

  // Create users (the pre-save hook hashes the password).
  const users = [];
  for (const spec of DEMO_USERS) {
    users.push(
      await User.create({
        displayName: spec.displayName,
        email: spec.email,
        phone: spec.phone,
        about: spec.about,
        password: DEMO_PASSWORD,
      })
    );
  }
  const [alice, bob, carol] = users;
  console.log(`Created ${users.length} demo users`);

  // ------------------------------------------------------------ direct chat
  async function createDirect(a, b, lines) {
    const chat = await Chat.create({ type: 'direct', participants: [a._id, b._id] });
    let last = null;
    let offset = lines.length;

    for (const line of lines) {
      const sender = line.from === 'a' ? a : b;
      last = await Message.create({
        chatId: chat._id,
        senderId: sender._id,
        type: 'text',
        content: line.text,
        sentAt: new Date(Date.now() - offset * 60 * 1000),
        deliveredTo: [a._id, b._id],
        readBy: line.read ? [a._id, b._id] : [sender._id],
      });
      offset--;
    }

    if (last) {
      await Chat.findByIdAndUpdate(chat._id, {
        lastMessage: last._id,
        updatedAt: last.sentAt,
      });
    }
    return chat;
  }

  const aliceBob = await createDirect(alice, bob, [
    { from: 'b', text: 'Hey Alice! How are you?', read: true },
    { from: 'a', text: 'Doing great, thanks! You?', read: true },
    { from: 'b', text: 'Pretty good. Want to grab coffee later?', read: true },
    { from: 'a', text: 'Sure — 4pm at the usual place?', read: true },
    { from: 'b', text: 'Perfect, see you there ☕', read: false },
  ]);

  await createDirect(alice, carol, [
    { from: 'a', text: 'Hi Carol, did you get the design files?', read: true },
    { from: 'c', text: 'Yes! Reviewing them now.', read: true },
    { from: 'c', text: 'The new layout looks great 🎉', read: false },
  ]);

  // ------------------------------------------------------------- group chat
  const group = await Chat.create({
    type: 'group',
    groupName: 'Project Team',
    participants: [alice._id, bob._id, carol._id],
    groupAdmins: [alice._id],
  });

  const groupLines = [
    { user: alice, text: 'Welcome to the team group!' },
    { user: bob, text: 'Glad to be here 👋' },
    { user: carol, text: 'Excited to get started.' },
  ];

  let lastGroup = null;
  let offset = groupLines.length;
  for (const line of groupLines) {
    lastGroup = await Message.create({
      chatId: group._id,
      senderId: line.user._id,
      type: 'text',
      content: line.text,
      sentAt: new Date(Date.now() - offset * 5 * 60 * 1000),
      deliveredTo: [alice._id, bob._id, carol._id],
      readBy: [alice._id, bob._id, carol._id],
    });
    offset--;
  }
  await Chat.findByIdAndUpdate(group._id, {
    lastMessage: lastGroup._id,
    updatedAt: lastGroup.sentAt,
  });

  console.log('\nDemo data ready — sign in with any of these:');
  console.log('  ------------------------------------------------------');
  for (const u of DEMO_USERS) {
    console.log(`  ${u.email.padEnd(22)}  ${DEMO_PASSWORD}`);
  }
  console.log('  ------------------------------------------------------');
  console.log(`\n  Direct chats: Alice↔Bob, Alice↔Carol`);
  console.log(`  Group chat:   "Project Team" (${group.participants.length} members)\n`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(async (error) => {
  console.error('Seed failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
