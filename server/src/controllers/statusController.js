// Status controller
const Status = require('../models/Status');
const User = require('../models/User');
const storage = require('../utils/storage');
const statusMedia = require('../utils/statusMedia');
const { removeStatusWithMedia } = require('../utils/statusCleanup');

const MAX_CAPTION_LENGTH = 700;

function captionOf(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).slice(0, MAX_CAPTION_LENGTH).trim();
  return text || null;
}

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isLocalUpload(value) {
  return typeof value === 'string' && value.startsWith('/uploads/');
}

// @desc    Media rules for statuses (also used by the client to word errors)
// @route   GET /api/status/limits
// @access  Private
const getStatusLimits = (req, res) => res.json({ limits: statusMedia.describeLimits() });

// @desc    Upload a photo/video/audio file for a status
// @route   POST /api/status/media
// @access  Private
const uploadStatusMedia = async (req, res) => {
  const cleanup = async () => {
    if (!req.file) return;
    try {
      if (req.file.path) {
        const fs = require('fs');
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  };

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded', code: 'NO_FILE' });
    }

    const verdict = statusMedia.validateStatusMedia({
      mimetype: req.file.mimetype,
      size: req.file.size,
      durationSeconds: req.body && req.body.durationSeconds,
    });
    if (!verdict.ok) {
      await cleanup();
      return res.status(verdict.status).json({
        message: verdict.message,
        code: verdict.code,
        maxBytes: verdict.maxBytes,
        maxDurationSeconds: verdict.maxDurationSeconds,
      });
    }

    const subdir = verdict.kind === 'image' ? 'status' : verdict.kind === 'video' ? 'videos' : 'audio';
    const stored = await storage.persistUpload(req, subdir);

    return res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        url: stored.url,
        provider: stored.provider,
        publicId: stored.publicId || null,
        mimetype: req.file.mimetype,
        size: stored.bytes != null ? stored.bytes : req.file.size,
        mediaType: verdict.kind,
        originalname: req.file.originalname,
      },
    });
  } catch (error) {
    console.error('Status media upload error:', error);
    await cleanup();
    const message =
      error && error.code === 'LIMIT_FILE_SIZE'
        ? 'That file is larger than the 50 MB limit.'
        : 'Could not store the file. Please try again.';
    return res.status(error && error.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ message });
  }
};

// @desc    Get contacts' statuses
// @route   GET /api/status
// @access  Private
const getStatuses = async (req, res) => {
  try {
    // Only my contacts (plus my own) — this previously returned every status in
    // the database, so people saw updates from accounts they had never added.
    const me = await User.findById(req.user._id).select('contacts');

    const visibleUserIds = [
      req.user._id,
      ...((me && me.contacts) || []),
    ];

    const statuses = await Status.find({ userId: { $in: visibleUserIds } })
      .sort({ createdAt: -1 }) // Newest first
      .populate('userId', '_id displayName avatarUrl')
      // Populate the viewer list so the owner can see WHO viewed their status
      // instead of a bare count.
      .populate('viewedBy', '_id displayName avatarUrl');

    // Old documents predate mediaType. Treat a mediaUrl without one as an image
    // so every client sees a complete shape.
    const shaped = statuses.map((status) => {
      const json = status.toJSON();
      if (json.mediaUrl && !json.mediaType) json.mediaType = 'image';
      return json;
    });

    res.json(shaped);
  } catch (error) {
    console.error('Get statuses error:', error);
    res.status(500).json({ message: 'Server error fetching statuses' });
  }
};

// @desc    Create new status (text caption and/or photo/video/audio)
// @route   POST /api/status
// @access  Private
const createStatus = async (req, res) => {
  try {
    const body = req.body || {};
    const text = captionOf(body.text ?? body.caption);
    const mediaUrlRaw = body.mediaUrl ?? body.media_url ?? null;
    const mediaUrl = typeof mediaUrlRaw === 'string' && mediaUrlRaw.trim() ? mediaUrlRaw.trim() : null;

    if (!text && !mediaUrl) {
      const requested = String(body.mediaType || '').toLowerCase();
      if (requested === 'video' || requested === 'audio') {
        return res.status(400).json({
          message: 'That status type needs an uploaded file.',
          code: 'MEDIA_REQUIRED',
        });
      }
      return res.status(400).json({
        message: 'Add a caption, a photo, a video or a voice note before posting.',
        code: 'EMPTY_STATUS',
      });
    }

    if (mediaUrl && !isLocalUpload(mediaUrl) && !isRemoteUrl(mediaUrl)) {
      return res.status(400).json({ message: 'That media URL is not valid.', code: 'INVALID_MEDIA_URL' });
    }

    let mediaType = body.mediaType ? String(body.mediaType).toLowerCase() : null;
    if (mediaUrl && !mediaType) {
      // Backward compatibility: older clients only send mediaUrl, which was
      // always an image.
      mediaType = body.mimetype ? statusMedia.kindFor(body.mimetype) || 'image' : 'image';
    }
    if (mediaType && !Status.KINDS.includes(mediaType)) {
      return res.status(400).json({ message: 'Unsupported status media type.', code: 'INVALID_MEDIA_TYPE' });
    }
    if ((mediaType === 'video' || mediaType === 'audio') && !mediaUrl) {
      return res.status(400).json({
        message: 'That status type needs an uploaded file.',
        code: 'MEDIA_REQUIRED',
      });
    }

    const mediaSize = body.mediaSize != null ? Number(body.mediaSize) : null;
    if (mediaUrl && body.mimetype) {
      // Re-check the limits when the client tells us the file facts.
      const verdict = statusMedia.validateStatusMedia({
        mimetype: body.mimetype,
        size: mediaSize != null ? mediaSize : 1,
        durationSeconds: body.durationSeconds,
      });
      if (!verdict.ok) {
        return res.status(verdict.status).json({
          message: verdict.message,
          code: verdict.code,
          maxBytes: verdict.maxBytes,
          maxDurationSeconds: verdict.maxDurationSeconds,
        });
      }
    } else if (mediaSize != null) {
      const limit = statusMedia.LIMITS[mediaType || 'image'];
      if (Number.isFinite(mediaSize) && mediaSize > limit.maxBytes) {
        return res.status(413).json({
          message: `That file is larger than the ${statusMedia.formatMb(limit.maxBytes)} limit.`,
          code: 'MEDIA_TOO_LARGE',
          maxBytes: limit.maxBytes,
        });
      }
    }

    const thumbnailUrl =
      typeof body.thumbnailUrl === 'string' && (isLocalUpload(body.thumbnailUrl) || isRemoteUrl(body.thumbnailUrl))
        ? body.thumbnailUrl
        : null;

    let durationSeconds = body.durationSeconds != null ? Number(body.durationSeconds) : null;
    if (durationSeconds != null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
      durationSeconds = null;
    }

    const status = await Status.create({
      userId: req.user._id,
      text,
      mediaUrl,
      mediaType: mediaUrl ? mediaType || 'image' : null,
      mimetype: body.mimetype ? String(body.mimetype).slice(0, 120) : null,
      mediaSize: mediaSize != null && Number.isFinite(mediaSize) ? mediaSize : null,
      mediaPublicId: body.mediaPublicId ? String(body.mediaPublicId).slice(0, 200) : null,
      mediaProvider: body.mediaProvider ? String(body.mediaProvider).slice(0, 40) : null,
      thumbnailUrl: mediaType === 'video' ? thumbnailUrl : null,
      durationSeconds,
    });

    const populatedStatus = await Status.findById(status._id)
      .populate('userId', '_id displayName avatarUrl');

    res.status(201).json(populatedStatus);
  } catch (error) {
    console.error('Create status error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Invalid status data' });
    }
    res.status(500).json({ message: 'Server error creating status' });
  }
};

// @desc    Delete status (and its stored file)
// @route   DELETE /api/status/:id
// @access  Private
const deleteStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: 'Status not found' });
    }

    // Check if user owns the status
    if (!status.userId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to delete this status' });
    }

    await removeStatusWithMedia(status);

    res.json({ message: 'Status deleted' });
  } catch (error) {
    console.error('Delete status error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid status ID' });
    }
    res.status(500).json({ message: 'Server error deleting status' });
  }
};

// @desc    Mark status as viewed
// @route   POST /api/status/:id/view
// @access  Private
const viewStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: 'Status not found' });
    }

    // Check if user has already viewed this status
    const hasViewed = status.viewedBy.some(id => id.equals(req.user._id));
    if (!hasViewed) {
      status.viewedBy.push(req.user._id);
      await status.save();
    }

    res.json({ message: 'Status marked as viewed' });
  } catch (error) {
    console.error('View status error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid status ID' });
    }
    res.status(500).json({ message: 'Server error marking status as viewed' });
  }
};

// @desc    Report a status (abuse)
// @route   POST /api/status/:id/report
const reportStatus = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Report = require('../models/Report');
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      return res.status(400).json({ message: 'Invalid status id.' });
    }
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found.' });
    if (String(status.userId) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot report your own status.' });
    }
    const reason = ['spam', 'abuse', 'harassment', 'impersonation', 'scam', 'other'].includes(req.body?.reason)
      ? req.body.reason
      : 'other';
    const report = await Report.create({
      reporterId: req.user._id,
      targetUserId: status.userId,
      targetStatusId: status._id,
      reason,
      details: String(req.body?.details || '').slice(0, 2000),
      messageSnapshot: String(status.caption || status.mediaUrl || '').slice(0, 500),
    });
    return res.status(201).json({ message: 'Report received. Thank you.', reportId: String(report._id), reason });
  } catch (error) {
    console.error('Report status error:', error.message);
    return res.status(500).json({ message: 'Could not send the report.' });
  }
};

module.exports = {
  getStatuses,
  getStatusLimits,
  uploadStatusMedia,
  createStatus,
  deleteStatus,
  viewStatus,
  reportStatus,
};
