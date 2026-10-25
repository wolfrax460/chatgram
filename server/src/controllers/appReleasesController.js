/**
 * App release management (admin) + the public release feed used by the apps and
 * the landing downloads page. No secrets are stored or returned.
 */
const AppRelease = require('../models/AppRelease');
const admin = require('../admin/auth');

const PLATFORMS = ['windows', 'android', 'web'];
const VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,3}(-[0-9A-Za-z.-]{1,20})?$/;
const SHA_RE = /^[0-9a-f]{64}$/i;

function serialize(row) {
  return {
    platform: row.platform,
    version: row.version || '',
    fileName: row.fileName || '',
    fileUrl: row.fileUrl || '',
    sha256: row.sha256 || '',
    sizeBytes: row.sizeBytes || 0,
    releaseNotes: row.releaseNotes || '',
    minSupportedVersion: row.minSupportedVersion || '',
    forceUpdate: row.forceUpdate === true,
    published: row.published === true,
    releasedAt: row.releasedAt || null,
    updatedAt: row.updatedAt,
  };
}

/** Validate one release payload; returns a normalized object or throws a 400 error. */
function normalize(input) {
  const platform = String(input?.platform || '').toLowerCase();
  if (!PLATFORMS.includes(platform)) {
    const error = new Error('Choose windows, android or web.');
    error.status = 400;
    throw error;
  }
  const version = String(input?.version || '').trim();
  if (version && !VERSION_RE.test(version)) {
    const error = new Error('Version must look like 1.2.3.');
    error.status = 400;
    throw error;
  }
  const minSupportedVersion = String(input?.minSupportedVersion || '').trim();
  if (minSupportedVersion && !VERSION_RE.test(minSupportedVersion)) {
    const error = new Error('The minimum supported version must look like 1.2.3.');
    error.status = 400;
    throw error;
  }
  const sha256 = String(input?.sha256 || '').trim().toLowerCase();
  if (sha256 && !SHA_RE.test(sha256)) {
    const error = new Error('The SHA-256 must be 64 hex characters.');
    error.status = 400;
    throw error;
  }
  const fileUrl = String(input?.fileUrl || '').trim();
  if (fileUrl && !/^https?:\/\//i.test(fileUrl) && !/^\/[a-z0-9/_.-]+$/i.test(fileUrl)) {
    const error = new Error('The file URL must be an https URL or a site path like /downloads/app.exe.');
    error.status = 400;
    throw error;
  }
  const sizeBytes = Math.max(0, Math.min(2_000_000_000, Number(input?.sizeBytes) || 0));
  const published = input?.published === true;
  if (published && (!version || !fileUrl)) {
    const error = new Error('A published release needs a version and a file URL.');
    error.status = 400;
    throw error;
  }
  return {
    platform,
    version,
    fileName: String(input?.fileName || '').trim().slice(0, 120),
    fileUrl,
    sha256,
    sizeBytes,
    releaseNotes: String(input?.releaseNotes || '').trim().slice(0, 4000),
    minSupportedVersion,
    forceUpdate: input?.forceUpdate === true,
    published,
    releasedAt: published ? new Date() : null,
  };
}

async function listReleases(req, res) {
  try {
    const rows = await AppRelease.find({}).lean();
    const byPlatform = new Map(rows.map((row) => [row.platform, serialize(row)]));
    return res.json({
      releases: PLATFORMS.map((platform) => byPlatform.get(platform) || {
        platform,
        version: '',
        fileName: '',
        fileUrl: '',
        sha256: '',
        sizeBytes: 0,
        releaseNotes: '',
        minSupportedVersion: '',
        forceUpdate: false,
        published: false,
        releasedAt: null,
        updatedAt: null,
      }),
    });
  } catch (error) {
    console.error('Admin releases list error:', error.message);
    return res.status(500).json({ message: 'Could not load the releases.' });
  }
}

async function saveReleases(req, res) {
  try {
    const items = Array.isArray(req.body?.releases) ? req.body.releases : [];
    if (items.length === 0 || items.length > PLATFORMS.length) {
      return res.status(400).json({ message: 'Send one entry per platform.' });
    }
    const normalized = items.map(normalize);
    const seen = new Set();
    for (const item of normalized) {
      if (seen.has(item.platform)) return res.status(400).json({ message: `Duplicate platform "${item.platform}".` });
      seen.add(item.platform);
    }
    for (const item of normalized) {
      await AppRelease.updateOne(
        { platform: item.platform },
        {
          $set: {
            ...item,
            releasedAt: item.published ? item.releasedAt : null,
            updatedBy: 'admin',
          },
        },
        { upsert: true },
      );
    }
    await admin.audit('app_releases_update', req, normalized.map((item) => `${item.platform}:${item.version || 'draft'}`).join(' ').slice(0, 300));
    const rows = await AppRelease.find({}).lean();
    const byPlatform = new Map(rows.map((row) => [row.platform, serialize(row)]));
    return res.json({
      message: 'Releases saved.',
      releases: PLATFORMS.map((platform) => byPlatform.get(platform)),
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Admin releases save error:', error.message);
    return res.status(500).json({ message: 'Could not save the releases.' });
  }
}

/** Public feed: only published releases, no admin fields. */
async function publicReleases(req, res) {
  try {
    const rows = await AppRelease.find({ published: true }).lean();
    return res.json({
      releases: rows
        .sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform))
        .map((row) => ({
          platform: row.platform,
          version: row.version,
          fileName: row.fileName,
          fileUrl: row.fileUrl,
          sha256: row.sha256,
          sizeBytes: row.sizeBytes || 0,
          releaseNotes: row.releaseNotes,
          minSupportedVersion: row.minSupportedVersion,
          forceUpdate: row.forceUpdate === true,
          releasedAt: row.releasedAt,
        })),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Public releases error:', error.message);
    return res.status(500).json({ message: 'Could not load the releases.' });
  }
}

module.exports = { listReleases, saveReleases, publicReleases };
