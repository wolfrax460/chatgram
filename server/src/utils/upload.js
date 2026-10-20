const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storageBackend = require('./storage');

// When Cloudinary is configured the file is held in memory just long enough to
// be streamed to Cloudinary — nothing is written to this VM's disk. Otherwise
// multer writes to UPLOAD_DIR as before.
//
// UPLOAD_DIR lets production point the local fallback at a persistent location
// (a mounted block volume, a Render disk, …).
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', '..', 'uploads');

const USE_CLOUDINARY = storageBackend.isEnabled();

const uploadDirs = ['avatars', 'media', 'status'];
if (!USE_CLOUDINARY) {
  uploadDirs.forEach((dir) => {
    const dirPath = path.join(UPLOAD_ROOT, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
}

/** Resolve which sub-folder a request should write into. */
function resolveSubdir(req) {
  // 1. Explicit body field (what the Flutter client sends).
  const type = req.body && req.body.type;
  if (type === 'avatar') return 'avatars';
  if (type === 'status') return 'status';

  // 2. Fall back to the route the request came in on.
  const url = req.originalUrl || req.baseUrl || '';
  if (url.includes('/avatar')) return 'avatars';
  if (url.includes('/status')) return 'status';

  return 'media';
}

const diskStorageEngine = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(UPLOAD_ROOT, resolveSubdir(req));
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    cb(null, `${base}-${uniqueSuffix}${ext}`);
  },
});

const storage = USE_CLOUDINARY ? multer.memoryStorage() : diskStorageEngine;

const allowedTypes = [
  // images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  // video
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  // audio / voice notes
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/zip',
];

const fileFilter = (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error(
      `Invalid file type "${file.mimetype}". Allowed: images, video, audio and common documents.`
    );
    err.status = 400;
    cb(err, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

module.exports = upload;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
module.exports.resolveSubdir = resolveSubdir;
module.exports.usingCloudinary = USE_CLOUDINARY;
