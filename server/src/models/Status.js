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
  viewedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
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
