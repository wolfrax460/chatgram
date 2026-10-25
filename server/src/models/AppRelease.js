/**
 * App releases (9b item 9). One document per platform (windows / android / web)
 * holding the published version, file URL, checksum, size, release notes, the
 * minimum supported version and the force-update flag. The landing Downloads tab
 * and the desktop/mobile apps read GET /api/app/releases.
 */
const mongoose = require('mongoose');

const appReleaseSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['windows', 'android', 'web'], required: true, unique: true, index: true },
    version: { type: String, default: '', maxlength: 40 },
    fileName: { type: String, default: '', maxlength: 120 },
    fileUrl: { type: String, default: '', maxlength: 500 },
    sha256: { type: String, default: '', maxlength: 64 },
    sizeBytes: { type: Number, default: 0 },
    releaseNotes: { type: String, default: '', maxlength: 4000 },
    minSupportedVersion: { type: String, default: '', maxlength: 40 },
    forceUpdate: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    releasedAt: { type: Date, default: null },
    updatedBy: { type: String, default: 'admin' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.AppRelease || mongoose.model('AppRelease', appReleaseSchema);
