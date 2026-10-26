/**
 * App releases (9b item 9, extended in Chunk 7A). One document per platform
 * (windows / android / web) holding the published version, file URL, checksums,
 * size, release notes, versionCode, the minimum supported version, the
 * force-update flag and the withdrawn flag. The landing Downloads tab, the
 * desktop/mobile apps and GET /api/app/version read from here.
 */
const mongoose = require('mongoose');

const appReleaseSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['windows', 'android', 'web'], required: true, unique: true, index: true },
    version: { type: String, default: '', maxlength: 40 },
    /** Monotonic build number for Android (versionCode); 0 when unknown. */
    versionCode: { type: Number, default: 0, min: 0 },
    fileName: { type: String, default: '', maxlength: 120 },
    fileUrl: { type: String, default: '', maxlength: 500 },
    sha256: { type: String, default: '', maxlength: 64 },
    /** Windows installers also publish a SHA-512 for electron-updater verification. */
    sha512: { type: String, default: '', maxlength: 128 },
    sizeBytes: { type: Number, default: 0 },
    releaseNotes: { type: String, default: '', maxlength: 4000 },
    minSupportedVersion: { type: String, default: '', maxlength: 40 },
    forceUpdate: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    /** A withdrawn release is never offered to clients (the version stays for the record). */
    withdrawn: { type: Boolean, default: false },
    withdrawnAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    updatedBy: { type: String, default: 'admin' },
  },
  { timestamps: true },
);

module.exports = mongoose.models.AppRelease || mongoose.model('AppRelease', appReleaseSchema);
