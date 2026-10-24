/**
 * Group helpers shared by the chat and message controllers.
 *
 * - permission checks for the three admin-configurable switches,
 * - "system" messages ("Alice left", "Bob is now an admin"),
 * - @mention detection for group messages,
 * - the three socket emits every membership change must produce
 *   (`chat:updated`, `group:members`, `message:new`).
 */
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const realtime = require('../utils/realtime');

const PARTICIPANT_FIELDS = '_id displayName avatarUrl about isOnline lastSeen phone email';

function isAdmin(chat, userId) {
  return (chat.groupAdmins || []).some((id) => String(id) === String(userId));
}

function settingsOf(chat) {
  const settings = chat.groupSettings || {};
  return {
    whoCanEditInfo: settings.whoCanEditInfo === 'admins' ? 'admins' : 'all',
    whoCanSendMessages: settings.whoCanSendMessages === 'admins' ? 'admins' : 'all',
    whoCanAddMembers: settings.whoCanAddMembers === 'admins' ? 'admins' : 'all',
    requireApproval: settings.requireApproval === true,
  };
}

function canEditInfo(chat, userId) {
  return settingsOf(chat).whoCanEditInfo === 'all' || isAdmin(chat, userId);
}

function canSendMessages(chat, userId) {
  if (chat.type !== 'group') return true;
  return settingsOf(chat).whoCanSendMessages !== 'admins' || isAdmin(chat, userId);
}

function canAddMembers(chat, userId) {
  return settingsOf(chat).whoCanAddMembers !== 'admins' || isAdmin(chat, userId);
}

/** Create a persisted "system" message and broadcast it. */
async function postSystemMessage(chat, content, options = {}) {
  const senderId =
    options.senderId ||
    chat.groupCreatedBy ||
    (chat.groupAdmins && chat.groupAdmins[0]) ||
    chat.participants[0];
  const message = await Message.create({
    chatId: chat._id,
    senderId,
    type: 'system',
    content: String(content).slice(0, 500),
    sentAt: new Date(),
    deliveredTo: [...chat.participants],
    readBy: [...chat.participants],
  });
  await Chat.findByIdAndUpdate(chat._id, { lastMessage: message._id, updatedAt: new Date() });
  const populated = await Message.findById(message._id).populate('senderId', PARTICIPANT_FIELDS);
  realtime.emitToChat(chat._id, 'message:new', populated);
  return populated;
}

/** Push the fresh chat document to every member. */
async function broadcastChatUpdate(chatId) {
  const populated = await Chat.findById(chatId).populate('participants', PARTICIPANT_FIELDS);
  if (!populated) return null;
  realtime.joinUsersToChat(chatId, populated.participants.map((p) => String(p._id)));
  for (const participant of populated.participants) {
    realtime.emitToUser(participant._id, 'chat:updated', populated);
  }
  return populated;
}

/** Tell everyone the member list changed (clients refetch the roster). */
function broadcastMemberList(chatId) {
  realtime.emitToChat(chatId, 'group:members', { chatId: String(chatId) });
}

/**
 * Work out who was @mentioned. Mentions are `@DisplayName` (case-insensitive),
 * matching any other group member. Returns unique user ids, never the sender.
 */
async function mentionedUserIds(content, participants, senderId) {
  const text = String(content || '');
  if (!text.includes('@')) return [];
  const ids = (participants || []).map(String).filter((id) => id !== String(senderId));
  if (ids.length === 0) return [];
  const users = await User.find({ _id: { $in: ids } }).select('_id displayName').lean();
  const mentioned = new Set();
  const lower = text.toLowerCase();
  for (const user of users) {
    const name = String(user.displayName || '').toLowerCase();
    if (!name) continue;
    if (lower.includes(`@${name}`)) mentioned.add(String(user._id));
    else {
      // Also accept the first word: @Alice for "Alice Johnson".
      const first = name.split(/\s+/)[0];
      if (first.length >= 3 && lower.includes(`@${first}`)) mentioned.add(String(user._id));
    }
  }
  return [...mentioned];
}

/** Emit mention notifications to the mentioned users (in-app + desktop). */
function emitMentions(message, chat, mentioned) {
  if (!mentioned || mentioned.length === 0) return;
  for (const userId of mentioned) {
    realtime.emitToUser(userId, 'message:mention', {
      message,
      chatId: String(chat._id),
      groupName: chat.groupName || 'Group',
      chatType: chat.type,
    });
  }
}

module.exports = {
  PARTICIPANT_FIELDS,
  isAdmin,
  settingsOf,
  canEditInfo,
  canSendMessages,
  canAddMembers,
  postSystemMessage,
  broadcastChatUpdate,
  broadcastMemberList,
  mentionedUserIds,
  emitMentions,
};
