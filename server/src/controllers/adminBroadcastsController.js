/**
 * Admin announcements & broadcasts (9b item 8).
 *
 *  - banners: publish a dismissible in-app banner (GET /api/app/announcements).
 *  - messages: send a real direct message from the official Chatgram account to
 *    a segment (all / active last 30 days / new last 7 days / selected), now or
 *    scheduled. Sending requires an explicit confirm flag and is audited.
 */
const mongoose = require('mongoose');
const Broadcast = require('../models/Broadcast');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const realtime = require('../utils/realtime');
const admin = require('../admin/auth');

const MAX_RECIPIENTS = 5000;
const BATCH = 50;

function publicBroadcast(row) {
  return {
    id: String(row._id),
    kind: row.kind,
    title: row.title || '',
    body: row.body,
    link: row.link || '',
    segment: row.segment,
    status: row.status,
    scheduledAt: row.scheduledAt,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    recipientCount: row.recipientCount || 0,
    sentCount: row.sentCount || 0,
    failedCount: row.failedCount || 0,
    lastError: row.lastError || '',
    publishedAt: row.publishedAt,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

/** Official sender: the support account, else the configured admin account. */
async function officialSender() {
  const support = await User.findOne({ isSupportAccount: true }).select('_id displayName').lean();
  if (support) return support;
  const adminEmail = String(process.env.CHATGRAM_ADMIN_EMAIL || '').toLowerCase();
  if (adminEmail) {
    const adminUser = await User.findOne({ email: adminEmail }).select('_id displayName').lean();
    if (adminUser) return adminUser;
  }
  // Last resort: any admin-role account (the configured Chatgram Admin user).
  const roleAdmin = await User.findOne({ role: 'admin' }).select('_id displayName').lean();
  return roleAdmin || null;
}

function segmentFilter(segment, broadcast) {
  const base = { isSupportAccount: { $ne: true }, isAiAccount: { $ne: true }, status: { $ne: 'banned' } };
  if (segment === 'selected') {
    return { ...base, _id: { $in: (broadcast.recipientIds || []).slice(0, MAX_RECIPIENTS) } };
  }
  if (segment === 'active') {
    return { ...base, lastSeen: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };
  }
  if (segment === 'new') {
    return { ...base, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } };
  }
  return base;
}

async function recipientsFor(broadcast, limit = MAX_RECIPIENTS) {
  return User.find(segmentFilter(broadcast.segment, broadcast))
    .select('_id displayName')
    .limit(limit)
    .lean();
}

/** GET /broadcasts — paginated list. */
async function list(req, res) {
  try {
    const page = Math.max(0, Math.floor(Number(req.query?.page) || 0));
    const limit = Math.min(50, Math.max(1, Math.round(Number(req.query?.limit) || 20)));
    const filter = {};
    if (req.query?.kind) filter.kind = String(req.query.kind);
    if (req.query?.status) filter.status = String(req.query.status);
    const [rows, total] = await Promise.all([
      Broadcast.find(filter).sort({ createdAt: -1 }).skip(page * limit).limit(limit).lean(),
      Broadcast.countDocuments(filter),
    ]);
    return res.json({ broadcasts: rows.map(publicBroadcast), page, limit, total });
  } catch (error) {
    console.error('Broadcast list failed:', error.message);
    return res.status(500).json({ message: 'Could not load the announcements.' });
  }
}

/** POST /broadcasts — create a draft. */
async function create(req, res) {
  try {
    const kind = req.body?.kind === 'message' ? 'message' : 'banner';
    const body = String(req.body?.body || '').trim();
    if (body.length < 2) return res.status(400).json({ message: 'Write the text to publish (at least 2 characters).' });
    if (body.length > (kind === 'banner' ? 300 : 2000)) {
      return res.status(400).json({ message: `The text is too long for a ${kind} (max ${kind === 'banner' ? 300 : 2000} characters).` });
    }
    const title = String(req.body?.title || '').trim().slice(0, 120);
    const link = String(req.body?.link || '').trim();
    if (link && !(link.startsWith('/') || /^https?:\/\//i.test(link))) {
      return res.status(400).json({ message: 'The link must be a /path or an https(s) URL.' });
    }
    const segment = ['all', 'active', 'new', 'selected'].includes(String(req.body?.segment || '')) ? String(req.body.segment) : 'all';
    const recipientIds = Array.isArray(req.body?.recipientIds) ? req.body.recipientIds.filter((id) => mongoose.isValidObjectId(id)).slice(0, MAX_RECIPIENTS) : [];
    if (segment === 'selected' && recipientIds.length === 0) {
      return res.status(400).json({ message: 'Pick at least one recipient for a selected broadcast.' });
    }

    let scheduledAt = null;
    let status = 'draft';
    if (req.body?.scheduledAt) {
      const when = new Date(String(req.body.scheduledAt));
      if (Number.isNaN(when.getTime())) return res.status(400).json({ message: 'The schedule date is not valid.' });
      if (when.getTime() < Date.now() - 60_000) return res.status(400).json({ message: 'The schedule date is in the past.' });
      scheduledAt = when;
      status = 'scheduled';
    }

    const startsAt = req.body?.startsAt ? new Date(String(req.body.startsAt)) : null;
    const endsAt = req.body?.endsAt ? new Date(String(req.body.endsAt)) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) return res.status(400).json({ message: 'The start date is not valid.' });
    if (endsAt && Number.isNaN(endsAt.getTime())) return res.status(400).json({ message: 'The end date is not valid.' });
    if (startsAt && endsAt && endsAt <= startsAt) return res.status(400).json({ message: 'The banner must end after it starts.' });

    const created = await Broadcast.create({
      kind,
      title,
      body,
      link,
      segment,
      recipientIds,
      status,
      scheduledAt,
      startsAt,
      endsAt,
      createdBy: req.adminSession?._id ? String(req.adminSession._id) : '',
    });
    await admin.audit('announcement_create', req, `${kind} ${created._id} segment=${segment}${scheduledAt ? ` at=${scheduledAt.toISOString()}` : ''}`);
    return res.status(201).json({ broadcast: publicBroadcast(created) });
  } catch (error) {
    console.error('Broadcast create failed:', error.message);
    return res.status(500).json({ message: 'Could not save the announcement.' });
  }
}

/** GET /broadcasts/:id/preview — recipient count + a sample. */
async function preview(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid announcement id.' });
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ message: 'Announcement not found.' });
    const sample = await recipientsFor(broadcast, 5);
    const total = await User.countDocuments(segmentFilter(broadcast.segment, broadcast));
    return res.json({
      broadcast: publicBroadcast(broadcast),
      recipientCount: Math.min(total, MAX_RECIPIENTS),
      capped: total > MAX_RECIPIENTS,
      sample: sample.map((row) => ({ id: String(row._id), displayName: row.displayName || 'Chatgram user' })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not preview the announcement.' });
  }
}

/** Deliver a message broadcast; shared by "send now" and the scheduler. */
async function deliverMessage(broadcast) {
  const sender = await officialSender();
  if (!sender) throw new Error('No official Chatgram account is available to send from.');
  const recipients = await recipientsFor(broadcast);
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < recipients.length; index += BATCH) {
    const batch = recipients.slice(index, index + BATCH);
    /* eslint-disable no-await-in-loop */
    for (const recipient of batch) {
      try {
        let chat = await Chat.findOne({ type: 'direct', participants: { $all: [sender._id, recipient._id] } });
        if (!chat) {
          chat = await Chat.create({ type: 'direct', participants: [sender._id, recipient._id] });
        }
        const message = await Message.create({
          chatId: chat._id,
          senderId: sender._id,
          type: 'text',
          content: broadcast.body,
          sentAt: new Date(),
          deliveredTo: [sender._id],
          readBy: [sender._id],
        });
        await Chat.findByIdAndUpdate(chat._id, { lastMessage: message._id, updatedAt: new Date() });
        realtime.joinUsersToChat(chat._id, [String(sender._id), String(recipient._id)]);
        const populated = await Message.findById(message._id).populate('senderId', '_id displayName avatarUrl phone').lean();
        realtime.emitToChat(chat._id, 'message:new', populated);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.warn('Broadcast delivery failed for', String(recipient._id), error.message);
      }
    }
  }
  broadcast.recipientCount = recipients.length;
  broadcast.sentCount = sent;
  broadcast.failedCount = failed;
  broadcast.sentAt = new Date();
  broadcast.status = sent > 0 ? 'sent' : 'failed';
  if (failed > 0 && sent === 0) broadcast.lastError = 'Every delivery failed.';
  await broadcast.save();
  return broadcast;
}

/** POST /broadcasts/:id/send — publish a banner or send a message broadcast. */
async function send(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid announcement id.' });
    if (req.body?.confirm !== true) {
      return res.status(400).json({ message: 'Confirm the send first.', code: 'CONFIRM_REQUIRED' });
    }
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ message: 'Announcement not found.' });
    if (!['draft', 'scheduled', 'failed'].includes(broadcast.status)) {
      return res.status(409).json({ message: `This announcement is already ${broadcast.status}.`, code: 'ALREADY_SENT' });
    }

    if (broadcast.kind === 'banner') {
      broadcast.status = 'sent';
      broadcast.publishedAt = new Date();
      broadcast.sentAt = new Date();
      broadcast.startsAt = broadcast.startsAt || new Date();
      await broadcast.save();
      await admin.audit('announcement_publish', req, `banner ${broadcast._id}`);
      return res.json({ message: 'Banner published.', broadcast: publicBroadcast(broadcast) });
    }

    broadcast.status = 'sending';
    await broadcast.save();
    const delivered = await deliverMessage(broadcast);
    await admin.audit('announcement_send', req, `message ${broadcast._id} recipients=${delivered.recipientCount} sent=${delivered.sentCount} failed=${delivered.failedCount}`);
    return res.json({
      message: `Broadcast sent to ${delivered.sentCount} of ${delivered.recipientCount} accounts${delivered.failedCount ? ` (${delivered.failedCount} failed)` : ''}.`,
      broadcast: publicBroadcast(delivered),
    });
  } catch (error) {
    console.error('Broadcast send failed:', error.message);
    const broadcast = mongoose.isValidObjectId(req.params.id) ? await Broadcast.findById(req.params.id).catch(() => null) : null;
    if (broadcast) {
      broadcast.status = 'failed';
      broadcast.lastError = String(error.message).slice(0, 200);
      await broadcast.save().catch(() => {});
    }
    return res.status(500).json({ message: error.message || 'Could not send the announcement.' });
  }
}

/** POST /broadcasts/:id/cancel */
async function cancel(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid announcement id.' });
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ message: 'Announcement not found.' });
    if (!['draft', 'scheduled'].includes(broadcast.status)) {
      return res.status(409).json({ message: 'Only drafts and scheduled announcements can be cancelled.' });
    }
    broadcast.status = 'cancelled';
    await broadcast.save();
    await admin.audit('announcement_cancel', req, `${broadcast._id}`);
    return res.json({ message: 'Announcement cancelled.', broadcast: publicBroadcast(broadcast) });
  } catch (error) {
    return res.status(500).json({ message: 'Could not cancel the announcement.' });
  }
}

/** DELETE /broadcasts/:id — drafts/cancelled only; sent announcements stay for the audit trail. */
async function remove(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid announcement id.' });
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ message: 'Announcement not found.' });
    if (!['draft', 'cancelled'].includes(broadcast.status)) {
      return res.status(409).json({ message: 'Sent announcements are kept for the record and cannot be deleted.' });
    }
    await broadcast.deleteOne();
    await admin.audit('announcement_delete', req, `${broadcast._id}`);
    return res.json({ message: 'Announcement deleted.' });
  } catch (error) {
    return res.status(500).json({ message: 'Could not delete the announcement.' });
  }
}

/** Public: GET /api/app/announcements — the active in-app banner. */
async function publicBanner(req, res) {
  try {
    const now = new Date();
    const banner = await Broadcast.findOne({
      kind: 'banner',
      status: 'sent',
      body: { $ne: '' },
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    })
      .sort({ sentAt: -1 })
      .lean();
    return res.json({
      banner: banner
        ? { id: String(banner._id), title: banner.title || '', body: banner.body, link: banner.link || '', publishedAt: banner.publishedAt || banner.sentAt }
        : null,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the announcement.' });
  }
}

/** Scheduler tick: deliver scheduled broadcasts that are due. */
async function runDue() {
  const due = await Broadcast.find({ status: 'scheduled', scheduledAt: { $lte: new Date() } }).limit(5);
  for (const broadcast of due) {
    broadcast.status = broadcast.kind === 'banner' ? 'sent' : 'sending';
    if (broadcast.kind === 'banner') {
      broadcast.publishedAt = new Date();
      broadcast.sentAt = new Date();
      await broadcast.save();
      continue;
    }
    await broadcast.save();
    await deliverMessage(broadcast).catch(async (error) => {
      broadcast.status = 'failed';
      broadcast.lastError = String(error.message).slice(0, 200);
      await broadcast.save().catch(() => {});
    });
  }
  return due.length;
}

module.exports = { list, create, preview, send, cancel, remove, publicBanner, runDue, deliverMessage };
