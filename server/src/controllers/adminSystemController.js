/**
 * Admin "System health" extras: MongoDB storage usage and VM diagnostics.
 *
 * Storage is read-only reporting. Diagnostics only ever run a fixed,
 * allowlisted command (see utils/hostDiagnostics.js) — the request selects an
 * id, never a command line — and every run is written to the admin audit log.
 */
const mongoose = require('mongoose');
const admin = require('../admin/auth');
const { listChecks, runCheck, isKnownCheck } = require('../utils/hostDiagnostics');

const DEFAULT_LIMIT_MB = 512; // MongoDB Atlas free tier (M0) storage ceiling

function mongoConnected() {
  return mongoose.connection.readyState === 1 && Boolean(mongoose.connection.db);
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

/**
 * GET /api/admin/system/storage
 * Mongo database size vs the tier limit, plus the largest collections.
 */
async function storage(req, res) {
  if (!mongoConnected()) {
    return res.status(503).json({ message: 'The database is not connected.' });
  }
  try {
    const db = mongoose.connection.db;
    const stats = await db.stats({ scale: 1 });

    const envLimitMb = Number(process.env.MONGO_STORAGE_LIMIT_MB);
    const limitMb = Number.isFinite(envLimitMb) && envLimitMb >= 64 ? envLimitMb : DEFAULT_LIMIT_MB;
    // Atlas reports the underlying volume; prefer it when it looks real.
    const volumeBytes = toInt(stats.fsTotalSize);
    const storageBytes = toInt(stats.storageSize);
    const limitBytes = volumeBytes > storageBytes ? volumeBytes : limitMb * 1024 * 1024;
    const limitSource = volumeBytes > storageBytes ? 'reported by MongoDB (fsTotalSize)' : `MONGO_STORAGE_LIMIT_MB (${limitMb} MB)`;

    const indexBytes = toInt(stats.indexSize);
    const dataBytes = toInt(stats.dataSize);
    const usedBytes = storageBytes + indexBytes;
    const remainingBytes = Math.max(0, limitBytes - usedBytes);
    const percentUsed = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 1000) / 10) : 0;

    // Per-collection breakdown: largest first, capped so the response stays small.
    let collectionsTable = [];
    try {
      const names = (await db.listCollections({}, { nameOnly: true }).toArray())
        .map((row) => row.name)
        .filter((name) => !name.startsWith('system.'));
      const rows = await Promise.all(
        names.map(async (name) => {
          try {
            const collStats = await db.command({ collStats: name, scale: 1 });
            return {
              name,
              documents: toInt(collStats.count ?? collStats.objects),
              dataSizeBytes: toInt(collStats.size),
              storageSizeBytes: toInt(collStats.storageSize),
              indexSizeBytes: toInt(collStats.totalIndexSize ?? collStats.indexSize),
            };
          } catch {
            return { name, documents: 0, dataSizeBytes: 0, storageSizeBytes: 0, indexSizeBytes: 0 };
          }
        }),
      );
      rows.sort((a, b) => b.dataSizeBytes - a.dataSizeBytes);
      collectionsTable = rows.slice(0, 15);
    } catch {
      collectionsTable = [];
    }

    return res.json({
      database: db.databaseName,
      collections: toInt(stats.collections),
      documents: toInt(stats.objects),
      dataSizeBytes: dataBytes,
      storageSizeBytes: storageBytes,
      indexSizeBytes: indexBytes,
      usedBytes,
      remainingBytes,
      limitBytes,
      limitSource,
      percentUsed,
      collectionsTable,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin storage error:', error.message);
    return res.status(500).json({ message: 'Could not read the database storage.' });
  }
}

/**
 * GET /api/admin/system/diagnostics
 * The allowlist of host checks the admin UI can run.
 */
async function diagnostics(req, res) {
  return res.json({
    platform: process.platform,
    checks: listChecks(),
  });
}

/**
 * POST /api/admin/system/diagnostics/run   { checkId }
 * Runs exactly one allowlisted check and audits it.
 */
async function runDiagnostic(req, res) {
  const checkId = req.body?.checkId;
  if (typeof checkId !== 'string' || !/^[a-z0-9_]{2,40}$/.test(checkId)) {
    return res.status(400).json({ message: 'A diagnostic id is required.' });
  }
  // Defence in depth: the regex already limits the shape, this proves the id
  // maps to a fixed command in the allowlist.
  if (!isKnownCheck(checkId)) {
    await admin.audit('system_diagnostic_rejected', req, String(checkId).slice(0, 40)).catch(() => {});
    return res.status(404).json({ message: 'Unknown diagnostic.' });
  }
  try {
    const result = await runCheck(checkId);
    await admin.audit('system_diagnostic', req, `${checkId} (exit ${result.exitCode ?? 'n/a'})`).catch(() => {});
    return res.json(result);
  } catch (error) {
    console.error('Admin diagnostic error:', error.message);
    return res.status(500).json({ message: 'That diagnostic could not run.' });
  }
}

module.exports = { storage, diagnostics, runDiagnostic };
