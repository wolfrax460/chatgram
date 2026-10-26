/**
 * App release management (admin) + the public release feed used by the apps and
 * the landing downloads page. No secrets are stored or returned.
 */
const AppRelease = require('../models/AppRelease');
const ClientVersion = require('../models/ClientVersion');
const admin = require('../admin/auth');
const appUpdate = require('../utils/appUpdate');

const PLATFORMS = ['windows', 'android', 'web'];
const VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,3}(-[0-9A-Za-z.-]{1,20})?$/;
const SHA_RE = /^[0-9a-f]{64}$/i;
const SHA512_RE = /^[0-9a-f]{128}$/i;

function serialize(row) {
  return {
    platform: row.platform,
    version: row.version || '',
    versionCode: Number(row.versionCode) || 0,
    fileName: row.fileName || '',
    fileUrl: row.fileUrl || '',
    sha256: row.sha256 || '',
    sha512: row.sha512 || '',
    sizeBytes: row.sizeBytes || 0,
    releaseNotes: row.releaseNotes || '',
    minSupportedVersion: row.minSupportedVersion || '',
    forceUpdate: row.forceUpdate === true,
    published: row.published === true,
    withdrawn: row.withdrawn === true,
    withdrawnAt: row.withdrawnAt || null,
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
  const sha512 = String(input?.sha512 || '').trim().toLowerCase();
  if (sha512 && !SHA512_RE.test(sha512)) {
    const error = new Error('The SHA-512 must be 128 hex characters.');
    error.status = 400;
    throw error;
  }
  const rawVersionCode = input?.versionCode;
  const versionCode = Number(rawVersionCode);
  if (rawVersionCode !== undefined && rawVersionCode !== null && rawVersionCode !== '' && (!Number.isInteger(versionCode) || versionCode < 0 || versionCode > 2_147_483_647)) {
    const error = new Error('The version code must be a whole number (Android versionCode).');
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
  const withdrawn = input?.withdrawn === true;
  if (published && (!version || !fileUrl)) {
    const error = new Error('A published release needs a version and a file URL.');
    error.status = 400;
    throw error;
  }
  return {
    platform,
    version,
    versionCode: Number.isInteger(versionCode) ? versionCode : 0,
    fileName: String(input?.fileName || '').trim().slice(0, 120),
    fileUrl,
    sha256,
    sha512,
    sizeBytes,
    releaseNotes: String(input?.releaseNotes || '').trim().slice(0, 4000),
    minSupportedVersion,
    forceUpdate: input?.forceUpdate === true,
    published,
    withdrawn,
    withdrawnAt: withdrawn ? new Date() : null,
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
        versionCode: 0,
        fileName: '',
        fileUrl: '',
        sha256: '',
        sha512: '',
        sizeBytes: 0,
        releaseNotes: '',
        minSupportedVersion: '',
        forceUpdate: false,
        published: false,
        withdrawn: false,
        withdrawnAt: null,
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
    await admin.audit('app_releases_update', req, normalized.map((item) => `${item.platform}:${item.withdrawn ? 'withdrawn' : item.version || 'draft'}`).join(' ').slice(0, 300));
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

/** Public feed: only published, non-withdrawn releases, no admin fields. */
async function publicReleases(req, res) {
  try {
    const rows = await AppRelease.find({ published: true, withdrawn: { $ne: true } }).lean();
    return res.json({
      releases: rows
        .sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform))
        .map((row) => ({
          platform: row.platform,
          version: row.version,
          versionCode: Number(row.versionCode) || 0,
          fileName: row.fileName,
          fileUrl: row.fileUrl,
          sha256: row.sha256 || '',
          sha512: row.sha512 || '',
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

/**
 * Admin "Versions in use" panel (Chunk 7A): aggregate counts only — platform,
 * version, number of installs and the last check time. No user ids, emails or
 * device ids leave this endpoint.
 */
async function versionsInUse(req, res) {
  try {
    const [rows, releases] = await Promise.all([
      ClientVersion.aggregate([
        {
          $group: {
            _id: { platform: '$platform', version: '$version' },
            devices: { $sum: 1 },
            lastSeen: { $max: '$lastSeen' },
          },
        },
        { $sort: { devices: -1 } },
      ]),
      AppRelease.find({}).lean(),
    ]);

    const releaseByPlatform = new Map(releases.map((row) => [row.platform, row]));
    const latestFor = (platform) => {
      const row = releaseByPlatform.get(platform);
      return row && row.published ? String(row.version || '') : '';
    };

    const versions = rows.map((row) => {
      const platform = row._id.platform;
      const latestVersion = latestFor(platform);
      return {
        platform,
        version: row._id.version,
        devices: row.devices,
        lastCheckAt: row.lastSeen,
        latestVersion,
        outdated: latestVersion ? appUpdate.compareVersions(row._id.version, latestVersion) < 0 : false,
        withdrawn: releaseByPlatform.get(platform)?.withdrawn === true,
      };
    });

    const platforms = PLATFORMS.map((platform) => {
      const matching = versions.filter((row) => row.platform === platform);
      return {
        platform,
        latestVersion: latestFor(platform),
        latestReleasedAt: releaseByPlatform.get(platform)?.releasedAt || null,
        withdrawn: releaseByPlatform.get(platform)?.withdrawn === true,
        devices: matching.reduce((sum, row) => sum + row.devices, 0),
        lastCheckAt: matching.reduce((latest, row) => (!latest || (row.lastCheckAt && row.lastCheckAt > latest) ? row.lastCheckAt : latest), null),
      };
    });

    const totalDevices = versions.reduce((sum, row) => sum + row.devices, 0);
    const lastCheckAt = platforms.reduce((latest, row) => (!latest || (row.lastCheckAt && row.lastCheckAt > latest) ? row.lastCheckAt : latest), null);
    await admin.audit('admin_versions_view', req, `${totalDevices} installs, ${versions.length} platform/version rows`);
    return res.json({
      generatedAt: new Date().toISOString(),
      totalDevices,
      lastCheckAt,
      platforms,
      versions,
    });
  } catch (error) {
    console.error('Admin versions-in-use error:', error.message);
    return res.status(500).json({ message: 'Could not load the versions in use.' });
  }
}

module.exports = { listReleases, saveReleases, publicReleases, versionsInUse, serialize, normalize };

