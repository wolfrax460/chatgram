/**
 * Statuses & media administration (9b item 5).
 *
 * Recent statuses (with their owner, report count and stored size) and the media
 * library across messages and statuses, plus audited removal. Note: message
 * attachments do not record their byte size, so storage totals only include
 * status media (sizes from Status.mediaSize); "orphaned Cloudinary files" is not
 * implemented because there is no media registry to compare against.
 */
const mongoose = require('mongoose');
const Status = require('../models/Status');
const Message = require('../models/Message');
const User = require('../models/User');
const Report = require('../models/Report');
const admin = require('../admin/auth');
const { removeStatusWithMedia } = require('../utils/statusCleanup');

const MEDIA_TYPES = ['image', 'video', 'audio', 'file'];
const MAX_PAGE = 100;

function pageOf(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

async function statusOwners(rows) {
  const ids = [...new Set(rows.map((row) => String(row.userId)).filter(Boolean))];
  const owners = ids.length ? await User.find({ _id: { $in: ids } }).select('displayName email avatarUrl status').lean() : [];
  return new Map(owners.map((owner) => [String(owner._id), owner]));
}

async function listStatuses(req, res) {
  try {
    const { page, limit, skip } = pageOf(req.query);
    const filter = {};
    const mediaType = String(req.query.mediaType || '');
    if (['image', 'video', 'audio', 'text'].includes(mediaType)) {
      filter.mediaType = mediaType === 'text' ? null : mediaType;
    }
    const [rows, total, reportCounts] = await Promise.all([
      Status.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Status.countDocuments(filter),
      Report.aggregate([
        { $match: { targetStatusId: { $ne: null }, status: 'open' } },
        { $group: { _id: '$targetStatusId', count: { $sum: 1 } } },
      ]),
    ]);
    const owners = await statusOwners(rows);
    const reportByStatus = new Map(reportCounts.map((row) => [String(row._id), row.count]));
    return res.json({
      statuses: rows.map((row) => {
        const owner = owners.get(String(row.userId));
        return {
          id: String(row._id),
          owner: owner ? { id: String(owner._id), displayName: owner.displayName, email: owner.email || '', status: owner.status || 'active' } : null,
          text: String(row.text || '').slice(0, 300),
          mediaType: row.mediaUrl ? (row.mediaType || 'image') : 'text',
          mediaUrl: row.mediaUrl || null,
          thumbnailUrl: row.thumbnailUrl || null,
          mediaBytes: row.mediaSize || 0,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt || null,
          reports: reportByStatus.get(String(row._id)) || 0,
        };
      }),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Admin statuses list error:', error.message);
    return res.status(500).json({ message: 'Could not load the statuses.' });
  }
}

async function deleteStatusAdmin(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) return res.status(400).json({ message: 'Invalid status id.' });
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found.' });
    await removeStatusWithMedia(status);
    await admin.audit('status_remove', req, String(status._id));
    return res.json({ message: 'Status removed.', id: String(status._id) });
  } catch (error) {
    console.error('Admin status delete error:', error.message);
    return res.status(500).json({ message: 'Could not remove the status.' });
  }
}

async function listMedia(req, res) {
  try {
    const { page, limit, skip } = pageOf(req.query);
    const source = String(req.query.source || '');
    const type = String(req.query.type || '');
    const matchTypes = type && MEDIA_TYPES.includes(type) ? [type] : MEDIA_TYPES;
    const take = Math.min(500, skip + limit);

    // The local staging MongoDB does not support every $unionWith form, so the
    // two collections are fetched and merged in memory (bounded by `take`).
    const messageFilter = { type: { $in: matchTypes }, mediaUrl: { $ne: null }, isDeleted: { $ne: true } };
    const statusFilter = { mediaUrl: { $ne: null }, ...(type && MEDIA_TYPES.includes(type) ? { mediaType: type } : {}) };
    const [messages, statuses, messageTotal, statusTotal, statusBytes] = await Promise.all([
      source === 'status' ? [] : Message.find(messageFilter).sort({ sentAt: -1 }).limit(take).select('type mediaUrl content sentAt senderId chatId').lean(),
      source === 'message' ? [] : Status.find(statusFilter).sort({ createdAt: -1 }).limit(take).select('mediaType mediaUrl thumbnailUrl mediaSize text createdAt userId').lean(),
      source === 'status' ? 0 : Message.countDocuments(messageFilter),
      source === 'message' ? 0 : Status.countDocuments(statusFilter),
      Status.aggregate([{ $match: { mediaUrl: { $ne: null } } }, { $group: { _id: null, sum: { $sum: { $ifNull: ['$mediaSize', 0] } } } }]),
    ]);

    const merged = [
      ...messages.map((row) => ({
        source: 'message',
        id: String(row._id),
        type: row.type,
        url: row.mediaUrl,
        thumbnailUrl: null,
        bytes: 0,
        caption: String(row.content || '').slice(0, 200),
        createdAt: row.sentAt,
        owner: row.senderId,
      })),
      ...statuses.map((row) => ({
        source: 'status',
        id: String(row._id),
        type: row.mediaType || 'image',
        url: row.mediaUrl,
        thumbnailUrl: row.thumbnailUrl || null,
        bytes: row.mediaSize || 0,
        caption: String(row.text || '').slice(0, 200),
        createdAt: row.createdAt,
        owner: row.userId,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = messageTotal + statusTotal;
    const rows = merged.slice(skip, skip + limit);
    const owners = await statusOwners(rows.map((row) => ({ userId: row.owner })));
    return res.json({
      media: rows.map((row) => {
        const owner = owners.get(String(row.owner));
        return {
          source: row.source,
          id: row.id,
          type: row.type,
          url: row.url,
          thumbnailUrl: row.thumbnailUrl,
          bytes: row.bytes,
          caption: row.caption,
          createdAt: row.createdAt,
          owner: owner ? { id: String(owner._id), displayName: owner.displayName, email: owner.email || '' } : null,
        };
      }),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      statusBytes: statusBytes[0]?.sum || 0,
    });
  } catch (error) {
    console.error('Admin media list error:', error.message);
    return res.status(500).json({ message: 'Could not load the media library.' });
  }
}

async function removeMedia(req, res) {
  try {
    const source = String(req.body?.source || '');
    const id = String(req.body?.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid media id.' });
    if (source === 'status') {
      const status = await Status.findById(id);
      if (!status) return res.status(404).json({ message: 'Status not found.' });
      await removeStatusWithMedia(status);
      await admin.audit('media_remove_status', req, id);
      return res.json({ message: 'Status media removed.' });
    }
    if (source === 'message') {
      const message = await Message.findById(id);
      if (!message) return res.status(404).json({ message: 'Message not found.' });
      message.isDeleted = true;
      await message.save({ validateBeforeSave: false });
      await admin.audit('media_remove_message', req, id);
      return res.json({ message: 'Message media removed for everyone.' });
    }
    return res.status(400).json({ message: 'Choose the media source (message or status).' });
  } catch (error) {
    console.error('Admin media remove error:', error.message);
    return res.status(500).json({ message: 'Could not remove the media.' });
  }
}

async function storageStats(req, res) {
  try {
    const [statusBytes, statusRows] = await Promise.all([
      Status.aggregate([{ $match: { mediaSize: { $gt: 0 } } }, { $group: { _id: null, sum: { $sum: '$mediaSize' } } }]),
      Status.aggregate([
        { $match: { mediaUrl: { $ne: null } } },
        { $group: { _id: '$userId', count: { $sum: 1 }, bytes: { $sum: { $ifNull: ['$mediaSize', 0] } } } },
        { $sort: { bytes: -1 } },
        { $limit: 10 },
      ]),
    ]);
    const [messageTotal, messageRows] = await Promise.all([
      Message.countDocuments({ type: { $in: MEDIA_TYPES }, mediaUrl: { $ne: null }, isDeleted: { $ne: true } }),
      Message.aggregate([
        { $match: { type: { $in: MEDIA_TYPES }, mediaUrl: { $ne: null }, isDeleted: { $ne: true } } },
        { $group: { _id: '$senderId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);
    const ownerIds = [...statusRows.map((row) => row._id), ...messageRows.map((row) => row._id)].filter(Boolean);
    const owners = ownerIds.length ? await User.find({ _id: { $in: ownerIds } }).select('displayName email').lean() : [];
    const ownerById = new Map(owners.map((owner) => [String(owner._id), owner]));
    const byUser = new Map();
    for (const row of statusRows) {
      const key = String(row._id);
      byUser.set(key, {
        owner: ownerById.get(key) ? { id: key, displayName: ownerById.get(key).displayName, email: ownerById.get(key).email || '' } : null,
        statusBytes: row.bytes || 0,
        statusCount: row.count || 0,
        messageCount: 0,
      });
    }
    for (const row of messageRows) {
      const key = String(row._id);
      const entry = byUser.get(key) || { owner: ownerById.get(key) ? { id: key, displayName: ownerById.get(key).displayName, email: ownerById.get(key).email || '' } : null, statusBytes: 0, statusCount: 0, messageCount: 0 };
      entry.messageCount = row.count || 0;
      byUser.set(key, entry);
    }
    return res.json({
      statuses: { bytes: statusBytes[0]?.sum || 0, mediaCount: (statusRows || []).reduce((sum, row) => sum + (row.count || 0), 0) },
      messages: { mediaCount: messageTotal },
      note: 'Message attachments do not record their size, so byte totals cover status media only. A media registry is needed for orphan detection.',
      topUsers: [...byUser.values()].sort((a, b) => b.statusBytes - a.statusBytes || b.messageCount - a.messageCount).slice(0, 10),
    });
  } catch (error) {
    console.error('Admin storage stats error:', error.message);
    return res.status(500).json({ message: 'Could not compute the storage stats.' });
  }
}

module.exports = { listStatuses, deleteStatusAdmin, listMedia, removeMedia, storageStats };
