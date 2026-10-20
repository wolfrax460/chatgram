// App version tracking + update policy
const ClientVersion = require('../models/ClientVersion');

/**
 * Semantic-ish version comparison.
 * Returns -1, 0 or 1. Tolerates "1.2", "1.2.3", "1.2.3+7" and junk.
 */
function compareVersions(a, b) {
  const parse = (value) =>
    String(value || '0')
      .split('+')[0] // drop build metadata
      .split('.')
      .map((part) => parseInt(part.replace(/[^0-9]/g, ''), 10) || 0);

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** The release the server currently advertises. Change these in .env. */
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

/** What should THIS client do? */
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

// @desc    Current release policy (no reporting)
// @route   GET /api/app/version
// @access  Public
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

module.exports = { heartbeat, versionInfo, versionUsage, compareVersions, policy, evaluate };
