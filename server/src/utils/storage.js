/**
 * Storage backend for uploaded media.
 *
 * Two modes, chosen by environment:
 *
 *  1. **Cloudinary** when CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET are set.
 *     Files are streamed to Cloudinary and the database stores the absolute
 *     `https://res.cloudinary.com/...` URL. Nothing touches the VM's disk, so
 *     media survives redeploys and is backed up by Cloudinary.
 *
 *  2. **Local disk** otherwise (development, or a deployment that has not been
 *     configured yet). Behaviour is unchanged from before: multer writes into
 *     UPLOAD_DIR and the URL is a server-relative `/uploads/...` path.
 *
 * The SDK is required lazily so a deployment without Cloudinary never loads it.
 */
const CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const API_KEY = (process.env.CLOUDINARY_API_KEY || '').trim();
const API_SECRET = (process.env.CLOUDINARY_API_SECRET || '').trim();
const ROOT_FOLDER = (process.env.CLOUDINARY_FOLDER || 'chatgram').trim();

/** Is Cloudinary fully configured? */
function isEnabled() {
  return Boolean(CLOUD_NAME && API_KEY && API_SECRET);
}

let configured = false;
function sdk() {
  let v2;
  try {
    ({ v2 } = require('cloudinary'));
  } catch (error) {
    throw new Error(
      'Cloudinary is configured in .env but the "cloudinary" package is not installed. ' +
        'Run: npm ci --omit=dev'
    );
  }
  if (!configured) {
    v2.config({ cloud_name: CLOUD_NAME, api_key: API_KEY, api_secret: API_SECRET, secure: true });
    configured = true;
  }
  return v2;
}

/** Cloudinary groups audio under `video`, documents under `raw`. */
function resourceTypeFor(mimetype) {
  if (!mimetype) return 'auto';
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'video';
  return 'raw';
}

/** Strip characters Cloudinary dislikes in a public id. */
function safeName(originalname) {
  return String(originalname || 'file')
    .replace(/\.[^.]+$/, '') // drop extension; Cloudinary adds its own
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60) || 'file';
}

/**
 * Persist `req.file` and return the URL to store in the database.
 *
 * @param {object} req     Express request with a multer file attached
 * @param {string} subdir  'media' | 'avatars' | 'status'
 * @returns {Promise<{url:string, provider:string, bytes:number, publicId?:string}>}
 */
async function persistUpload(req, subdir) {
  const file = req.file;
  if (!file) throw new Error('persistUpload called without req.file');

  // ---- local disk -------------------------------------------------------
  if (!isEnabled()) {
    return {
      url: `/uploads/${subdir}/${file.filename}`,
      provider: 'local',
      bytes: file.size,
    };
  }

  // ---- Cloudinary -------------------------------------------------------
  if (!file.buffer) {
    throw new Error(
      'Cloudinary storage is enabled but multer used disk storage. ' +
        'Check that CLOUDINARY_* was set BEFORE the server started.'
    );
  }

  const cloudinary = sdk();
  const resourceType = resourceTypeFor(file.mimetype);

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${ROOT_FOLDER}/${subdir}`,
        resource_type: resourceType,
        public_id: `${safeName(file.originalname)}-${Date.now()}`,
        // Keep orientation correct for phone photos.
        ...(resourceType === 'image' ? { image_metadata: true } : {}),
      },
      (error, uploaded) => (error ? reject(error) : resolve(uploaded))
    );
    stream.end(file.buffer);
  });

  return {
    url: result.secure_url,
    provider: 'cloudinary',
    bytes: result.bytes,
    publicId: result.public_id,
  };
}

/** Delete a previously uploaded file (best effort). */
async function destroyUpload(publicId, mimetype) {
  if (!isEnabled() || !publicId) return false;
  try {
    await sdk().uploader.destroy(publicId, { resource_type: resourceTypeFor(mimetype) });
    return true;
  } catch (error) {
    console.warn('Cloudinary delete failed:', error.message);
    return false;
  }
}

module.exports = {
  isEnabled,
  persistUpload,
  destroyUpload,
  resourceTypeFor,
  configuredCloudName: () => (isEnabled() ? CLOUD_NAME : null),
  rootFolder: ROOT_FOLDER,
};
