/**
 * Human support replies → help-widget conversations.
 *
 * When the Support account replies in the desk conversation, the existing reply
 * hook propagates it to the ticket. This bridge additionally stores it as an
 * `agent` message in the help conversation that escalated that ticket:
 *  - logged-in users get it live over their socket (`help:message`),
 *  - guests get it on the widget's next poll (the widget polls while open).
 */
const { HelpConversation, HelpMessage } = require('./models');
const realtime = require('../utils/realtime');
const User = require('../models/User');

async function deliverAgentReply(ticketId, text, senderId) {
  if (!ticketId || !text) return null;
  const conversation = await HelpConversation.findOne({ ticketId });
  if (!conversation) return null;

  let authorName = 'Chatgram Support';
  try {
    if (senderId) {
      const sender = await User.findById(senderId._id || senderId).select('displayName').lean();
      if (sender?.displayName) authorName = sender.displayName;
    }
  } catch {
    /* best effort */
  }

  const message = await HelpMessage.create({
    conversationId: conversation._id,
    role: 'agent',
    text: String(text).slice(0, 4000),
    authorName,
  });
  conversation.unreadForUser = (conversation.unreadForUser || 0) + 1;
  conversation.lastMessageAt = new Date();
  conversation.assigneeId = senderId?._id || senderId || null;
  await conversation.save();

  if (conversation.userId) {
    realtime.emitToUser(conversation.userId, 'help:message', {
      conversationId: String(conversation._id),
      message: {
        id: String(message._id),
        role: message.role,
        text: message.text,
        authorName: message.authorName,
        createdAt: message.createdAt,
      },
    });
  }

  return message;
}

module.exports = { deliverAgentReply };
