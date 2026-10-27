// Status model (for Stories/Status feature)
const mongoose = require('mongoose');

const KINDS = ['image', 'video', 'audio'];

const statusSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Caption. Works for text-only statuses and for any media type.
  text: {
    type: String,
    default: null
  },
  mediaUrl: {
    type: String,
    default: null
  },
  // 'image' | 'video' | 'audio'. Null for text-only statuses. Older documents
  // (before video/audio existed) have no mediaType; readers treat a mediaUrl
  // without a mediaType as an image.
  mediaType: {
    type: String,
    enum: [...KINDS, null],
    default: null
  },
  mimetype: {
    type: String,
    default: null
  },
  mediaSize: {
    type: Number,
    default: null
  },
  // Needed to delete the stored file when the status is deleted/expired.
  mediaPublicId: {
    type: String,
    default: null
  },
  mediaProvider: {
    type: String,
    default: null
  },
  // Poster frame for video statuses (an uploaded image).
  thumbnailUrl: {
    type: String,
    default: null
  },
  // Client-reported duration for video/audio; validated server-side.
  durationSeconds: {
    type: Number,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Cleanup runs at 24h and removes the stored file before the row. The TTL
  // index is a safety net only, so it fires later (25h) than the cleanup job.
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    expires: 25 * 60 * 60
  },
  // WHO viewed: ids of every user who opened this status (de-duplicated — the
  // view endpoint only pushes the first time). Kept as a plain ObjectId array
  // so the existing feed populate and every current client keep working.
  viewedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // WHEN each viewer last viewed, keyed by the viewer's user id. This is the
  // only thing that was missing for the owner-only "Viewed by" list: `viewedBy`
  // has never stored per-view timestamps. It is a separate map (not a change to
  // `viewedBy`) so no existing consumer breaks. Hidden from normal queries with
  // `select: false` so the populated feed does not leak view times; the
  // owner-only viewers endpoint opts in with `.select('+viewedAt')`.
  //
  // Views recorded before this field existed have no entry and are returned as
  // `viewedAt: null`. Statuses live 24 h, so that gap closes on its own within
  // a day of deploying.
  viewedAt: {
    type: Map,
    of: Date,
    select: false,
    default: () => new Map()
  }
}, {
  timestamps: false // createdAt is explicit; expiresAt drives the TTL index
});

// Indexes for faster queries.
statusSchema.index({ userId: 1 });
statusSchema.index({ 'viewedBy': 1 });
statusSchema.index({ createdAt: -1 });

// Hide internal fields when converting to JSON
statusSchema.methods.toJSON = function() {
  const status = this.toObject();
  // Remove internal Mongoose properties if needed
  return status;
};

module.exports = mongoose.model('Status', statusSchema);
module.exports.KINDS = KINDS;
