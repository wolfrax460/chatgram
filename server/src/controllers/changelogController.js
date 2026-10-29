/**
 * Public changelog: published (not withdrawn) AppRelease rows merged with the
 * curated entries in server/src/data/changelog.js. Newest first, cacheable for
 * five minutes. No admin/secret fields are exposed.
 */
const AppRelease = require('../models/AppRelease');
const CURATED = require('../data/changelog');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

function releaseEntry(row) {
  const entry = {
    version: row.version || row.platform,
    platform: row.platform,
    releasedAt: row.releasedAt || row.updatedAt || row.createdAt || null,
    notes: String(row.releaseNotes || '').slice(0, 4000),
  };
  if (row.fileUrl) entry.url = row.fileUrl;
  return entry;
}

function curatedEntry(row) {
  const entry = {
    version: String(row.version || ''),
    platform: String(row.platform || 'web'),
    releasedAt: row.releasedAt || null,
    notes: String(row.notes || ''),
  };
  if (row.url) entry.url = row.url;
  return entry;
}

function timeOf(entry) {
  const time = entry.releasedAt ? new Date(entry.releasedAt).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

// @desc    Public changelog (published releases + curated web-only entries)
// @route   GET /api/app/changelog?limit=20
// @access  Public
const changelog = async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const rows = await AppRelease.find({
      published: true,
      withdrawn: { $ne: true },
      version: { $ne: '' },
    })
      .select('platform version releaseNotes releasedAt updatedAt createdAt fileUrl')
      .lean();
    const entries = [...rows.map(releaseEntry), ...CURATED.map(curatedEntry)]
      .sort((a, b) => timeOf(b) - timeOf(a))
      .slice(0, limit);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ entries, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Changelog error:', error.message);
    return res.status(500).json({ message: 'Could not load the changelog.' });
  }
};

module.exports = { changelog, clampLimit, releaseEntry, curatedEntry };
