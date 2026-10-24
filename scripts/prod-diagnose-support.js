/** Read-only production diagnosis for the silent support assistant. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const User = require('./src/models/User');
  const SupportSettings = require('./src/models/SupportSettings');
  const SupportTicket = require('./src/models/SupportTicket');
  const Message = require('./src/models/Message');
  const Chat = require('./src/models/Chat');

  const flags = [
    'SUPPORT_AGENT_ENABLED',
    'SUPPORT_AI_ENABLED',
    'SUPPORT_AI_LAYER',
    'SUPPORT_AI_PROVIDER',
    'SUPPORT_AI_MODEL',
    'AI_PROVIDER',
    'AI_MODEL',
    'AI_ENABLED',
    'CHATGRAM_ADMIN_EMAIL',
  ];
  console.log('ENV FLAGS:');
  for (const name of flags) {
    const value = process.env[name];
    console.log(`  ${name} = ${value === undefined ? '(unset)' : value === '' ? '(empty)' : String(value).slice(0, 40)}`);
  }
  for (const name of ['AI_API_KEY', 'GROQ_API_KEY', 'SUPPORT_AI_API_KEY']) {
    const value = process.env[name] || '';
    console.log(`  ${name} = ${value ? `set (length ${value.length}, prefix ${value.slice(0, 3)}...)` : '(unset)'}`);
  }

  const s = await SupportSettings.findOne({}).lean();
  console.log('\nSUPPORT SETTINGS DOC:');
  if (!s) {
    console.log('  (none — env defaults are used)');
  } else {
    const safe = {
      aiEnabled: s.aiEnabled,
      agentEnabled: s.agentEnabled,
      aiProvider: s.aiProvider,
      aiModel: s.aiModel,
      aiBaseUrl: s.aiBaseUrl,
      hasAiApiKey: Boolean(s.aiApiKey),
      aiKeyLength: s.aiApiKey ? String(s.aiApiKey).length : 0,
      supportNotifyEmailSet: Boolean(s.supportNotifyEmail),
      telegramChatIdSet: Boolean(s.telegramChatId),
      updatedAt: s.updatedAt,
    };
    console.log(' ', JSON.stringify(safe, null, 2));
  }

  const support = await User.findOne({ isSupportAccount: true }).select('_id displayName email createdAt');
  console.log('\nSUPPORT ACCOUNT:', support ? `${support.displayName} (${support._id})` : 'MISSING');

  const ticketCount = await SupportTicket.countDocuments({});
  const openTickets = await SupportTicket.countDocuments({ status: 'open' });
  console.log('TICKETS: total', ticketCount, 'open', openTickets);

  if (support) {
    const supportChats = await Chat.find({ type: 'direct', participants: support._id }).select('_id participants updatedAt').lean();
    console.log('SUPPORT CONVERSATIONS:', supportChats.length);
    for (const chat of supportChats.slice(-5)) {
      const last = await Message.find({ chatId: chat._id, isDeleted: { $ne: true } })
        .sort({ sentAt: -1 })
        .limit(3)
        .select('senderId content createdAt')
        .lean();
      const other = chat.participants.map(String).filter((id) => id !== String(support._id));
      const otherUser = await User.findById(other[0]).select('_id displayName').lean();
      const ticketForChat = await SupportTicket.exists({ chatId: chat._id });
      console.log(`  chat ${chat._id} with ${otherUser?.displayName || other[0]} | ticket=${Boolean(ticketForChat)} | last messages:`);
      for (const m of last.reverse()) {
        const who = String(m.senderId) === String(support._id) ? 'SUPPORT' : 'USER';
        console.log(`    ${who}: ${String(m.content || '').slice(0, 80).replace(/\n/g, ' ')}`);
      }
    }
    const assigned = await db.collection('supporttickets').countDocuments({ chatId: { $ne: null } });
    console.log('TICKETS LINKED TO A CHAT:', assigned);
  }

  // Does the resolved AI provider answer at all? (Never print the key.)
  const ai = require('./src/support/aiProvider');
  const info = ai.assistantInfo();
  console.log('\nRESOLVED AI:', JSON.stringify(info));
  const cfg = ai.resolveConfig();
  console.log('RESOLVED CONFIG (safe):', JSON.stringify({
    enabled: cfg.enabled,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    keyLength: cfg.apiKey ? String(cfg.apiKey).length : 0,
  }));
  const started = Date.now();
  const answer = await ai.askAssistant({ system: 'Reply with the single word OK', messages: [{ role: 'user', text: 'ping' }], maxTokens: 20 });
  console.log('AI TEST:', answer ? `OK in ${Date.now() - started}ms -> ${String(answer).slice(0, 80)}` : `FAILED in ${Date.now() - started}ms`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('DIAGNOSIS FAILED:', error.message);
  process.exit(1);
});
