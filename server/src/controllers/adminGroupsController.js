/**
 * Groups administration (9b item 4).
 *
 * List/search groups, inspect members and open reports, then freeze (read-only),
 * change the owner, remove a member or delete the group. Every change is audited;
 * admins can never post messages into a group. Freezing is enforced in the
 * message send path (REST and sockets) with code GROUP_FROZEN.
 */
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Report = require('../models/Report');
const admin = require('../admin/auth');

const MAX_PAGE = 100;

function summary(chat, owner, reportedCount) {
  return {
    id: String(chat._id),
    name: chat.groupName || 'Group',
    avatar: chat.groupAvatar || '',
    description: chat.groupDescription || '',
    memberCount: (chat.participants || []).length,
    adminCount: (chat.groupAdmins || []).length,
    owner: owner ? { id: String(owner._id), displayName: owner.displayName, email: owner.email || '' } : null,
    createdAt: chat.createdAt,
    lastActivity: chat.updatedAt,
    frozen: chat.groupFrozen === true,
    aiMentions: chat.groupSettings?.aiMentions === true,
    reported: reportedCount,
  };
}

async function listGroups(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || '').trim();
    const filter = { type: 'group' };
    if (search) {
      filter.groupName = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (String(req.query.filter) === 'frozen') filter.groupFrozen = true;
    if (String(req.query.filter) === 'reported') {
      const reportedChatIds = await Report.distinct('chatId', { chatId: { $ne: null }, status: 'open' });
      filter._id = { $in: reportedChatIds };
    }
    const [chats, total] = await Promise.all([
      Chat.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Chat.countDocuments(filter),
    ]);
    const ownerIds = chats.map((chat) => chat.groupCreatedBy).filter(Boolean);
    const reportCounts = await Report.aggregate([
      { $match: { chatId: { $in: chats.map((chat) => chat._id) }, status: 'open' } },
      { $group: { _id: '$chatId', count: { $sum: 1 } } },
    ]);
    const reportByChat = new Map(reportCounts.map((row) => [String(row._id), row.count]));
    const owners = ownerIds.length ? await User.find({ _id: { $in: ownerIds } }).select('displayName email').lean() : [];
    const ownerById = new Map(owners.map((owner) => [String(owner._id), owner]));
    return res.json({
      groups: chats.map((chat) => summary(chat, ownerById.get(String(chat.groupCreatedBy)), reportByChat.get(String(chat._id)) || 0)),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Admin groups list error:', error.message);
    return res.status(500).json({ message: 'Could not load the groups.' });
  }
}

async function groupDetail(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid group id.' });
    const chat = await Chat.findOne({ _id: req.params.id, type: 'group' }).lean();
    if (!chat) return res.status(404).json({ message: 'Group not found.' });
    const memberIds = (chat.participants || []).map(String);
    const [members, owner, reports, messageCount] = await Promise.all([
      User.find({ _id: { $in: memberIds } }).select('displayName email avatarUrl status createdAt').lean(),
      chat.groupCreatedBy ? User.findById(chat.groupCreatedBy).select('displayName email').lean() : null,
      Report.find({ chatId: chat._id }).sort({ createdAt: -1 }).limit(10).lean(),
      Message.countDocuments({ chatId: chat._id }),
    ]);
    const admins = new Set((chat.groupAdmins || []).map(String));
    return res.json({
      group: summary(
        chat,
        owner,
        reports.filter((report) => report.status === 'open').length,
      ),
      messageCount,
      members: members
        .map((member) => ({
          id: String(member._id),
          displayName: member.displayName,
          email: member.email || '',
          avatarUrl: member.avatarUrl || '',
          status: member.status || 'active',
          joinedAt: null,
          isAdmin: admins.has(String(member._id)),
          isOwner: Boolean(chat.groupCreatedBy && String(chat.groupCreatedBy) === String(member._id)),
        }))
        .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || Number(b.isAdmin) - Number(a.isAdmin) || a.displayName.localeCompare(b.displayName)),
      reports: reports.map((report) => ({
        id: String(report._id),
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
        details: String(report.details || '').slice(0, 300),
      })),
    });
  } catch (error) {
    console.error('Admin group detail error:', error.message);
    return res.status(500).json({ message: 'Could not load the group.' });
  }
}

async function findGroup(req, res) {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
    res.status(400).json({ message: 'Invalid group id.' });
    return null;
  }
  const chat = await Chat.findOne({ _id: req.params.id, type: 'group' });
  if (!chat) {
    res.status(404).json({ message: 'Group not found.' });
    return null;
  }
  return chat;
}

async function freezeGroup(req, res) {
  try {
    const chat = await findGroup(req, res);
    if (!chat) return undefined;
    const frozen = req.body?.frozen === true;
    chat.groupFrozen = frozen;
    await chat.save({ validateBeforeSave: false });
    await admin.audit(frozen ? 'group_freeze' : 'group_unfreeze', req, String(chat._id));
    return res.json({ message: frozen ? 'Group frozen: members cannot post until it is unfrozen.' : 'Group unfrozen.', frozen });
  } catch (error) {
    console.error('Admin group freeze error:', error.message);
    return res.status(500).json({ message: 'Could not update the group.' });
  }
}

async function changeOwner(req, res) {
  try {
    const chat = await findGroup(req, res);
    if (!chat) return undefined;
    const userId = String(req.body?.userId || '');
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ message: 'Choose a new owner.' });
    if (!chat.participants.some((participant) => String(participant) === userId)) {
      return res.status(400).json({ message: 'The new owner must be a member of the group.' });
    }
    const user = await User.findById(userId).select('displayName').lean();
    if (!user) return res.status(404).json({ message: 'That user no longer exists.' });
    chat.groupCreatedBy = userId;
    if (!chat.groupAdmins.some((participant) => String(participant) === userId)) chat.groupAdmins.push(userId);
    await chat.save({ validateBeforeSave: false });
    await admin.audit('group_change_owner', req, `${chat._id} ${userId}`);
    return res.json({ message: `${user.displayName} is now the group owner.` });
  } catch (error) {
    console.error('Admin group owner error:', error.message);
    return res.status(500).json({ message: 'Could not change the owner.' });
  }
}

async function removeMember(req, res) {
  try {
    const chat = await findGroup(req, res);
    if (!chat) return undefined;
    const userId = String(req.params.userId || '');
    if (!chat.participants.some((participant) => String(participant) === userId)) {
      return res.status(404).json({ message: 'That user is not a member of this group.' });
    }
    chat.participants = chat.participants.filter((participant) => String(participant) !== userId);
    chat.groupAdmins = chat.groupAdmins.filter((participant) => String(participant) !== userId);
    if (chat.groupCreatedBy && String(chat.groupCreatedBy) === userId) chat.groupCreatedBy = null;
    await chat.save({ validateBeforeSave: false });
    await admin.audit('group_remove_member', req, `${chat._id} ${userId}`);
    return res.json({ message: 'Member removed from the group.' });
  } catch (error) {
    console.error('Admin group remove member error:', error.message);
    return res.status(500).json({ message: 'Could not remove the member.' });
  }
}

async function deleteGroup(req, res) {
  try {
    const chat = await findGroup(req, res);
    if (!chat) return undefined;
    const chatId = chat._id;
    await Message.deleteMany({ chatId });
    await Report.updateMany({ chatId }, { $set: { status: 'actioned', resolution: 'group_deleted', resolvedAt: new Date(), resolvedBy: 'admin' } });
    await Chat.deleteOne({ _id: chatId });
    await admin.audit('group_delete', req, String(chatId));
    return res.json({ message: 'Group and its messages were deleted.' });
  } catch (error) {
    console.error('Admin group delete error:', error.message);
    return res.status(500).json({ message: 'Could not delete the group.' });
  }
}

module.exports = { listGroups, groupDetail, freezeGroup, changeOwner, removeMember, deleteGroup };
