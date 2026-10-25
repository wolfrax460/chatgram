/**
 * Shared account-data deletion (9b Users extras + user self-delete).
 *
 * Removes the user's statuses/media, direct chats and group memberships, pulls
 * them out of contacts/block lists and deletes the account. Used by the user's
 * own DELETE /api/auth/account and by the admin 30-day-grace purger.
 */
const User = require('../models/User');

async function deleteAccountData(userId, displayName = 'This user') {
  const name = displayName || 'This user';

  try {
    const Status = require('../models/Status');
    const statusCleanup = require('./statusCleanup');
    const statuses = await Status.find({ userId });
    for (const status of statuses) await statusCleanup.removeStatusWithMedia(status);
  } catch (error) {
    console.warn('Account deletion: status cleanup failed:', error.message);
  }

  try {
    const Chat = require('../models/Chat');
    const Message = require('../models/Message');
    const groupSystem = require('./groupSystem');

    const directChats = await Chat.find({ type: 'direct', participants: userId });
    for (const chat of directChats) {
      await Message.deleteMany({ chatId: chat._id });
      await Chat.deleteOne({ _id: chat._id });
    }

    const groups = await Chat.find({ type: 'group', participants: userId });
    for (const group of groups) {
      group.participants = group.participants.filter((id) => String(id) !== String(userId));
      group.groupAdmins = (group.groupAdmins || []).filter((id) => String(id) !== String(userId));
      if (group.participants.length === 0) {
        await Message.deleteMany({ chatId: group._id });
        await Chat.deleteOne({ _id: group._id });
        continue;
      }
      if (group.groupAdmins.length === 0) group.groupAdmins = [group.participants[0]];
      await group.save();
      await groupSystem.postSystemMessage(group, `${name} deleted their account`);
      await groupSystem.broadcastChatUpdate(group._id);
      groupSystem.broadcastMemberList(group._id);
    }
  } catch (error) {
    console.warn('Account deletion: chat cleanup failed:', error.message);
  }

  try {
    await User.updateMany({}, { $pull: { contacts: userId, blocked: userId, onlineStatusExceptions: userId } });
  } catch (error) {
    console.warn('Account deletion: contact cleanup failed:', error.message);
  }

  try {
    const UserSession = require('../models/UserSession');
    const LoginEvent = require('../models/LoginEvent');
    const UserWarning = require('../models/UserWarning');
    await Promise.all([
      UserSession.deleteMany({ userId }),
      LoginEvent.deleteMany({ userId }),
      UserWarning.deleteMany({ userId }),
    ]);
  } catch (error) {
    console.warn('Account deletion: session cleanup failed:', error.message);
  }

  await User.deleteOne({ _id: userId });
}

module.exports = { deleteAccountData };
