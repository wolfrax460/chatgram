#!/usr/bin/env node
/**
 * Remove bad system-answer messages from Chatgram.
 *
 * Two kinds of bad rows are detected:
 *  1. the AI placeholder ("I don't have a confirmed answer on that yet, I've
 *     noted it for the team.") sent by a HUMAN account — the placeholder must
 *     never be delivered as an answer;
 *  2. system-answer messages ("Chatgram AI answer: …") that landed in a
 *     person-to-person chat (a chat with no Chatgram Support / AI participant).
 *
 * Dry run by default: it prints counts and samples and writes nothing.
 * With --apply it writes a JSON backup of every affected document first, then
 * deletes only those messages, recomputes the chat-list preview (lastMessage) for
 * the affected chats and removes knowledge-base entries whose answer is the
 * placeholder. Normal user messages are never touched.
 *
 * Usage (on the API host, with its .env):
 *   CHATGRAM_SERVER_DIR=/home/ubuntu/chatgram/server node cleanup-bad-system-answers.js
 *   CHATGRAM_SERVER_DIR=/home/ubuntu/chatgram/server node cleanup-bad-system-answers.js --apply
 */
const fs = require('fs');
const path = require('path');

const serverDir = process.env.CHATGRAM_SERVER_DIR || path.join(__dirname, '..', 'server');
const apply = process.argv.includes('--apply');
const mongoose = require(path.join(serverDir, 'node_modules', 'mongoose'));
require(path.join(serverDir, 'node_modules', 'dotenv')).config({ path: path.join(serverDir, '.env') });

const FALLBACK_RE = /i\s*don['’]?t\s+have\s+a\s+confirmed\s+answer\s+on\s+that\s+yet[,.]?\s*i['’]?ve\s+noted\s+it\s+for\s+the\s+team/i;
const LABEL_RE = /^\s*Chatgram\s+AI\s+answer\s*:/i;

function preview(text, size = 90) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, size);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const messages = db.collection('messages');
  const chats = db.collection('chats');
  const users = db.collection('users');
  const kb = db.collection('aiknowledges');

  const systemUsers = await users
    .find({ isSupportAccount: true }, { projection: { _id: 1, displayName: 1 } })
    .toArray();
  const aiUsers = await users.find({ isAiAccount: true }, { projection: { _id: 1 } }).toArray();
  const systemIds = new Set([...systemUsers, ...aiUsers].map((user) => String(user._id)));

  const chatCache = new Map();
  async function chatInfo(chatId) {
    const key = String(chatId);
    if (chatCache.has(key)) return chatCache.get(key);
    const chat = await chats.findOne({ _id: chatId });
    const hasSystem = Boolean(chat && (chat.participants || []).some((id) => systemIds.has(String(id))));
    const info = { chat, hasSystem };
    chatCache.set(key, info);
    return info;
  }

  const senderCache = new Map();
  async function senderInfo(senderId) {
    const key = String(senderId);
    if (senderCache.has(key)) return senderCache.get(key);
    const user = await users.findOne({ _id: senderId }, { projection: { displayName: 1, email: 1, isSupportAccount: 1, isAiAccount: 1 } });
    senderCache.set(key, user);
    return user;
  }

  const bad = [];
  const cursor = messages.find({ isDeleted: { $ne: true } }).batchSize(500);
  for await (const message of cursor) {
    const content = String(message.content || '');
    const senderSystem = systemIds.has(String(message.senderId));
    // A labelled "system answer" that landed in a chat with no system account.
    if (LABEL_RE.test(content)) {
      const info = await chatInfo(message.chatId);
      if (info.chat && !info.hasSystem) {
        bad.push({ message, reason: 'system_answer_in_person_chat' });
        continue;
      }
    }
    // The placeholder sent by a human account (in any chat).
    if (FALLBACK_RE.test(content) && !senderSystem) {
      bad.push({ message, reason: 'fallback_text_sent_by_human' });
    }
  }

  const kbBad = await kb.find({ answer: FALLBACK_RE }).toArray();

  console.log(`mode: ${apply ? 'APPLY' : 'DRY RUN (no changes)'}`);
  console.log(`system accounts: ${systemUsers.map((u) => u.displayName || String(u._id)).join(', ') || '(none)'}`);
  console.log(`bad messages found: ${bad.length}`);
  const byReason = {};
  for (const row of bad) byReason[row.reason] = (byReason[row.reason] || 0) + 1;
  for (const [reason, count] of Object.entries(byReason)) console.log(`  ${reason}: ${count}`);
  const affectedChats = [...new Set(bad.map((row) => String(row.message.chatId)))];
  console.log(`affected chats: ${affectedChats.length}`);
  console.log(`knowledge-base entries with the placeholder answer: ${kbBad.length}`);

  for (const row of bad.slice(0, 50)) {
    const sender = await senderInfo(row.message.senderId);
    const info = await chatInfo(row.message.chatId);
    console.log(
      `  - ${row.reason} | msg=${row.message._id} | chat=${row.message.chatId} (${info.chat?.type || '?'}) | sender=${sender?.displayName || row.message.senderId}${sender?.email ? ` <${sender.email}>` : ''} | ${preview(row.message.content)}`,
    );
  }
  if (bad.length > 50) console.log(`  … and ${bad.length - 50} more`);

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to back up, delete these messages, fix the chat previews and clean the placeholder KB entries.');
    await mongoose.disconnect();
    return;
  }

  if (bad.length === 0 && kbBad.length === 0) {
    console.log('Nothing to clean.');
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const backupDir = path.join(serverDir, 'backups');
  await fs.promises.mkdir(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `cleanup-bad-system-answers-${stamp}.json`);
  const chatDocs = await chats.find({ _id: { $in: affectedChats.map((id) => new mongoose.Types.ObjectId(id)) } }).toArray();
  await fs.promises.writeFile(
    backupFile,
    JSON.stringify({ createdAt: new Date().toISOString(), badMessages: bad.map((row) => ({ reason: row.reason, message: row.message })), chats: chatDocs, kbEntries: kbBad }, null, 2),
    'utf8',
  );
  console.log(`\nBackup written: ${backupFile} (${bad.length} messages, ${affectedChats.length} chats, ${kbBad.length} KB entries)`);

  if (bad.length) {
    const result = await messages.deleteMany({ _id: { $in: bad.map((row) => row.message._id) } });
    console.log(`Deleted ${result.deletedCount} bad messages.`);
  }
  if (kbBad.length) {
    const result = await kb.deleteMany({ _id: { $in: kbBad.map((row) => row._id) } });
    console.log(`Deleted ${result.deletedCount} placeholder knowledge-base entries.`);
  }

  let previews = 0;
  for (const chatId of affectedChats) {
    const newest = await messages.findOne({ chatId: new mongoose.Types.ObjectId(chatId) }, { sort: { sentAt: -1, _id: -1 } });
    await chats.updateOne(
      { _id: new mongoose.Types.ObjectId(chatId) },
      { $set: { lastMessage: newest ? newest._id : null }, $currentDate: { updatedAt: true } },
    );
    previews += 1;
  }
  console.log(`Recomputed the chat-list preview for ${previews} chats.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('cleanup failed:', String((error && error.stack) || error).slice(0, 800));
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
