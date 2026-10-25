/**
 * Admin data requests (9b item 15): create tracked export/delete requests,
 * process them (build the JSON export or delete the data), cancel scheduled
 * ones, and download a completed export. Every step is audited.
 */
const mongoose = require('mongoose');
const DataRequest = require('../models/DataRequest');
const User = require('../models/User');
const Message = require('../models/Message');
const Status = require('../models/Status');
const Chat = require('../models/Chat');
const Report = require('../models/Report');
const admin = require('../admin/auth');

const MAX_EXPORT_MESSAGES = 5000;

function serialize(row) {
  return {
    id: String(row._id),
    type: row.type,
    status: row.status,
    user: { id: String(row.userId), label: row.userLabel || '' },
    reason: row.reason || '',
    scheduledFor: row.scheduledFor || null,
    completedAt: row.completedAt || null,
    error: row.error || '',
    exportBytes: row.exportBytes || 0,
    createdAt: row.createdAt,
  };
}

async function findUser(req, res) {
  const id = String(req.body?.userId || req.params?.userId || '');
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: 'Choose a user for this request.' });
    return null;
  }
  const user = await User.findById(id);
  if (!user) {
    res.status(404).json({ message: 'User not found.' });
    return null;
  }
  if (user.isSupportAccount || user.isAiAccount) {
    res.status(400).json({ message: 'That account cannot be exported or deleted.' });
    return null;
  }
  return user;
}

async function listRequests(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter = {};
    if (['pending', 'scheduled', 'completed', 'cancelled', 'failed'].includes(String(req.query.status))) filter.status = String(req.query.status);
    if (['export', 'delete'].includes(String(req.query.type))) filter.type = String(req.query.type);
    const [rows, total] = await Promise.all([
      DataRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      DataRequest.countDocuments(filter),
    ]);
    return res.json({
      requests: rows.map(serialize),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Data requests list error:', error.message);
    return res.status(500).json({ message: 'Could not load the data requests.' });
  }
}

async function createRequest(req, res) {
  try {
    const user = await findUser(req, res);
    if (!user) return undefined;
    const type = String(req.body?.type || '');
    if (!['export', 'delete'].includes(type)) return res.status(400).json({ message: 'Choose export or delete.' });
    const pending = await DataRequest.findOne({ userId: user._id, type, status: { $in: ['pending', 'scheduled'] } });
    if (pending) return res.status(409).json({ message: `There is already a ${type} request for this user.` });
    const graceDays = Math.max(0, Math.min(365, Number(req.body?.graceDays) || 0));
    const request = await DataRequest.create({
      type,
      userId: user._id,
      userLabel: user.email || user.displayName || String(user._id),
      reason: String(req.body?.reason || '').slice(0, 500),
      status: type === 'delete' && graceDays > 0 ? 'scheduled' : 'pending',
      scheduledFor: type === 'delete' && graceDays > 0 ? new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000) : null,
    });
    await admin.audit('data_request_create', req, `${request._id} ${type} ${user._id}`);
    return res.status(201).json({ message: `${type === 'export' ? 'Export' : 'Deletion'} request created.`, request: serialize(request) });
  } catch (error) {
    console.error('Data request create error:', error.message);
    return res.status(500).json({ message: 'Could not create the data request.' });
  }
}

async function buildExport(user) {
  const [contacts, chats, messages, statuses] = await Promise.all([
    Promise.resolve((user.contacts || []).map(String)),
    Chat.find({ participants: user._id }).select('type groupName participants createdAt').lean(),
    Message.find({ senderId: user._id }).sort({ sentAt: -1 }).limit(MAX_EXPORT_MESSAGES).select('chatId type content mediaUrl sentAt isDeleted').lean(),
    Status.find({ userId: user._id }).select('text mediaUrl mediaType createdAt').lean(),
  ]);
  const contactIds = [...new Set(contacts.filter((id) => id !== String(user._id)))];
  const people = contactIds.length
    ? await User.find({ _id: { $in: contactIds } }).select('displayName email phone').lean()
    : [];
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: String(user._id),
      displayName: user.displayName,
      email: user.email || '',
      phone: user.phone || '',
      about: user.about || '',
      createdAt: user.createdAt,
      twoFactorEnabled: user.twoFactorEnabled === true,
      status: user.status || 'active',
    },
    contacts: contacts.map((id) => ({ userId: String(user._id), contactId: id })),
    contactProfiles: people.map((person) => ({ id: String(person._id), displayName: person.displayName, email: person.email || '', phone: person.phone || '' })),
    chats: chats.map((chat) => ({ id: String(chat._id), type: chat.type, groupName: chat.groupName || '', createdAt: chat.createdAt })),
    messages: messages.map((row) => ({
      chatId: String(row.chatId),
      type: row.type,
      content: row.isDeleted ? '' : row.content || '',
      mediaUrl: row.mediaUrl || null,
      sentAt: row.sentAt,
    })),
    statuses: statuses.map((row) => ({ text: row.text || '', mediaType: row.mediaType || null, mediaUrl: row.mediaUrl || null, createdAt: row.createdAt })),
    notes: `Messages are capped at ${MAX_EXPORT_MESSAGES} for download size.`,
  };
}

async function processRequest(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid request id.' });
    const request = await DataRequest.findById(id).select('+exportData');
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!['pending', 'scheduled'].includes(request.status)) {
      return res.status(400).json({ message: 'Only pending or scheduled requests can be processed.' });
    }
    const user = await User.findById(request.userId);
    if (!user) return res.status(404).json({ message: 'The user no longer exists.' });

    if (request.type === 'export') {
      const payload = await buildExport(user);
      const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      request.exportData = payload;
      request.exportBytes = bytes;
      request.status = 'completed';
      request.completedAt = new Date();
      request.error = '';
      await request.save();
      await admin.audit('data_request_export', req, `${request._id} ${user._id} ${bytes}b`);
      return res.json({ message: `Export ready (${Math.round(bytes / 1024)} KB).`, request: serialize(request) });
    }

    // Deletion.
    if (req.body?.confirm !== true) return res.status(400).json({ message: 'Deletion needs an explicit confirmation.' });
    const userId = user._id;
    const chatsWithUser = await Chat.find({ participants: userId }).select('_id participants').lean();
    const [messages, statuses, reports, contactPulls] = await Promise.all([
      Message.deleteMany({ senderId: userId }),
      Status.deleteMany({ userId }),
      Report.deleteMany({ $or: [{ reporterId: userId }, { targetUserId: userId }] }),
      User.updateMany({ contacts: userId }, { $pull: { contacts: userId } }),
    ]);
    await Message.updateMany({}, { $pull: { deliveredTo: userId, readBy: userId } });
    for (const chat of chatsWithUser) {
      const remaining = (chat.participants || []).filter((participant) => String(participant) !== String(userId));
      if (remaining.length === 0) {
        await Message.deleteMany({ chatId: chat._id });
        await Chat.deleteOne({ _id: chat._id });
      } else {
        await Chat.updateOne({ _id: chat._id }, { $set: { participants: remaining } });
      }
    }
    await User.deleteOne({ _id: userId });
    request.status = 'completed';
    request.completedAt = new Date();
    request.error = '';
    await request.save();
    await admin.audit('data_request_delete', req, `${request._id} ${userId}`);
    return res.json({
      message: 'User data deleted.',
      request: serialize(request),
      deleted: {
        messages: messages.deletedCount,
        statuses: statuses.deletedCount,
        contacts: contactPulls.modifiedCount || 0,
        reports: reports.deletedCount,
        chats: chatsWithUser.length,
      },
    });
  } catch (error) {
    console.error('Data request process error:', error.message);
    return res.status(500).json({ message: 'Could not process the data request.' });
  }
}

async function cancelRequest(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid request id.' });
    const request = await DataRequest.findById(id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!['pending', 'scheduled'].includes(request.status)) return res.status(400).json({ message: 'Only pending or scheduled requests can be cancelled.' });
    request.status = 'cancelled';
    request.completedAt = new Date();
    await request.save();
    await admin.audit('data_request_cancel', req, String(request._id));
    return res.json({ message: 'Request cancelled.', request: serialize(request) });
  } catch (error) {
    console.error('Data request cancel error:', error.message);
    return res.status(500).json({ message: 'Could not cancel the data request.' });
  }
}

async function downloadExport(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid request id.' });
    const request = await DataRequest.findById(id).select('+exportData');
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (request.type !== 'export' || request.status !== 'completed' || !request.exportData) {
      return res.status(400).json({ message: 'This export is not ready.' });
    }
    await admin.audit('data_request_download', req, String(request._id));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="chatgram-user-${request.userId}-export.json"`);
    return res.send(JSON.stringify(request.exportData, null, 2));
  } catch (error) {
    console.error('Data request download error:', error.message);
    return res.status(500).json({ message: 'Could not download the export.' });
  }
}

module.exports = { listRequests, createRequest, processRequest, cancelRequest, downloadExport };
