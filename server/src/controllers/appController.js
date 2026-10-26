// App version tracking + update policy.
//
// Chunk 7A: GET /api/app/version is the public update check used by the Windows
// and Android apps. It answers from the published AppRelease row (falling back to
// the legacy APP_* env policy on deployments with no release row yet), records
// the anonymous install id for the admin "Versions in use" panel, enforces our
// own HTTPS domain for the download URL and never recommends a downgrade.
const ClientVersion = require('../models/ClientVersion');
const AppRelease = require('../models/AppRelease');
const appUpdate = require('../utils/appUpdate');

const { compareVersions } = appUpdate;

/** The legacy release policy from the environment. */
function policy() {
  const latest = process.env.APP_LATEST_VERSION || '1.0.0';
  const minimum = process.env.APP_MIN_VERSION || '0.0.0';
  return {
    latestVersion: latest,
    minimumVersion: minimum,
    updateUrl: process.env.APP_UPDATE_URL || '',
    releaseNotes: process.env.APP_RELEASE_NOTES || '',
    releasedAt: process.env.APP_RELEASED_AT || null,
  };
}

/** What should THIS client do? (legacy heartbeat shape) */
function evaluate(clientVersion) {
  const p = policy();
  const version = clientVersion || '0.0.0';

  const belowMinimum = compareVersions(version, p.minimumVersion) < 0;
  const behindLatest = compareVersions(version, p.latestVersion) < 0;

  return {
    ...p,
    yourVersion: version,
    // Blocking: too old to talk to this server safely.
    updateRequired: belowMinimum,
    // Non-blocking: a newer release exists.
    updateAvailable: !belowMinimum && behindLatest,
  };
}

// @desc    App reports its version; server records it and answers the policy
// @route   POST /api/app/heartbeat
// @access  Public
const heartbeat = async (req, res) => {
  try {
    const platform = String(req.body.platform || 'unknown').slice(0, 20);
    const version = String(req.body.version || '0.0.0').slice(0, 20);
    const deviceId = String(req.body.deviceId || '').slice(0, 64);

    if (deviceId) {
      await ClientVersion.updateOne(
        { platform, version, deviceId },
        {
          $set: { lastSeen: new Date(), ...(req.user ? { userId: req.user._id } : {}) },
          $setOnInsert: { firstSeen: new Date() },
        },
        { upsert: true }
      );
    }

    res.json(evaluate(version));
  } catch (error) {
    console.error('Version heartbeat error:', error);
    // Never let telemetry break the app.
    res.json(evaluate(req.body && req.body.version));
  }
};

/** The release to advertise: the published AppRelease row, else the env policy. */
async function resolveRelease(platform) {
  try {
    const row = await AppRelease.findOne({ platform }).lean();
    if (row && row.published === true) return { release: row, source: 'release' };
  } catch (error) {
    console.warn('App release lookup failed:', String(error?.message || error).slice(0, 160));
  }
  return { release: appUpdate.envPolicy(), source: 'env' };
}

/** Record the anonymous install id (never linked to a user from this route). */
async function recordInstall(platform, version, installId) {
  if (!installId) return;
  try {
    await ClientVersion.updateOne(
      { platform, version, deviceId: installId },
      {
        $set: { lastSeen: new Date() },
        $setOnInsert: { firstSeen: new Date() },
      },
      { upsert: true }
    );
  } catch (error) {
    // Update checks must never fail because telemetry failed.
    console.warn('Client version record failed:', String(error?.message || error).slice(0, 160));
  }
}

// @desc    Public update check for the apps (ETag + short cache).
// @route   GET /api/app/version?platform=windows|android&current=<version>&build=<versionCode>&id=<install id>
// @access  Public
const updateCheck = async (req, res) => {
  const platform = String(req.query.platform || '').toLowerCase();
  if (!appUpdate.UPDATE_PLATFORMS.includes(platform)) {
    return res.status(400).json({ message: 'Choose platform=windows or platform=android.' });
  }

  const currentVersion = appUpdate.cleanVersion(req.query.current);
  const currentBuild = appUpdate.cleanBuild(req.query.build);
  const installId = appUpdate.cleanInstallId(req.query.id);
  const { release, source } = await resolveRelease(platform);

  const payload = {
    ...appUpdate.buildVersionPayload({
      platform,
      release,
      currentVersion,
      currentBuild,
      requestOrigin: appUpdate.requestOrigin(req),
    }),
    source,
  };

  await recordInstall(platform, currentVersion || '0.0.0', installId);

  const etag = appUpdate.buildEtag(payload);
  res.set('Cache-Control', `public, max-age=${appUpdate.CACHE_SECONDS}`);
  res.set('ETag', etag);
  res.set('Access-Control-Expose-Headers', 'ETag, Cache-Control');
  if (appUpdate.etagMatches(req.headers?.['if-none-match'], etag)) {
    return res.status(304).end();
  }
  return res.json(payload);
};

/** Kept for compatibility: the old no-argument policy response. */
const versionInfo = (req, res) => {
  res.json(evaluate(req.query.version));
};

// @desc    Which versions are in use
// @route   GET /api/app/versions
// @access  Public (aggregate counts only, no personal data)
const versionUsage = async (req, res) => {
  try {
    const rows = await ClientVersion.aggregate([
      {
        $group: {
          _id: { platform: '$platform', version: '$version' },
          devices: { $sum: 1 },
          lastSeen: { $max: '$lastSeen' },
        },
      },
      { $sort: { devices: -1 } },
    ]);

    const policyNow = policy();
    const totalDevices = rows.reduce((sum, r) => sum + r.devices, 0);

    res.json({
      policy: policyNow,
      totalDevices,
      versions: rows.map((row) => ({
        platform: row._id.platform,
        version: row._id.version,
        devices: row.devices,
        lastSeen: row.lastSeen,
        outdated: compareVersions(row._id.version, policyNow.latestVersion) < 0,
      })),
    });
  } catch (error) {
    console.error('Version usage error:', error);
    res.status(500).json({ message: 'Server error reading version usage' });
  }
};

module.exports = {
  heartbeat,
  updateCheck,
  versionInfo,
  versionUsage,
  compareVersions,
  policy,
  evaluate,
};
