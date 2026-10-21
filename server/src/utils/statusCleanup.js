/**
 * Status (story) lifecycle.
 *
 * Statuses live 24 hours. The row is easy to delete; the stored image/video/
 * audio file is not, so this job:
 *
 *   1. removes the legacy TTL index on `createdAt` (the old design let Mongo
 *      delete the row at 24h, which orphaned the uploaded file forever),
 *   2. periodically deletes every status older than 24h together with its
 *      stored file,
 *   3. is safe to run repeatedly, on several processes, and after downtime.
 *
 * The schema keeps a 25h TTL index on `expiresAt` as a safety net: the cleanup
 * job runs hourly-ish and therefore always gets to the file first.
 */

const Status = require('../models/Status');
const storage = require('./storage');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

let timer = null;
let running = false;

/** Drop the old createdAt TTL index once. Safe to call on every boot. */
async function dropLegacyTtlIndex() {
  try {
    const indexes = await Status.collection.indexes();
    const legacy = indexes.find(
      (index) =>
        index.key &&
        Object.keys(index.key).length === 1 &&
        index.key.createdAt !== undefined &&
        index.expireAfterSeconds !== undefined
    );
    if (!legacy) return { dropped: false };
    await Status.collection.dropIndex(legacy.name);
    console.log(`Status cleanup: dropped legacy TTL index ${legacy.name}`);
    return { dropped: true, name: legacy.name };
  } catch (error) {
    // A missing collection or a racing process is fine.
    if (error && error.code !== 26 /* NamespaceNotFound */) {
      console.warn('Status cleanup: could not inspect indexes:', error.message);
    }
    return { dropped: false, error: error.message };
  }
}

/** Delete one status row and the file(s) it points at. */
async function removeStatusWithMedia(status) {
  if (!status) return false;
  await storage.deleteStoredFile({
    url: status.mediaUrl,
    publicId: status.mediaPublicId,
    mimetype: status.mimetype,
  });
  // Video posters are separate uploads; delete them too.
  if (typeof status.thumbnailUrl === 'string' && status.thumbnailUrl.startsWith('/uploads/')) {
    await storage.deleteStoredFile({ url: status.thumbnailUrl });
  }
  await Status.deleteOne({ _id: status._id });
  return true;
}

/**
 * Run one cleanup pass.
 * @param {{ now?: Date, olderThanMs?: number }} [options]
 */
async function runCleanup(options = {}) {
  if (running) return { skipped: true, deleted: 0 };
  running = true;
  try {
    const now = options.now instanceof Date ? options.now : new Date();
    const olderThanMs = Number(options.olderThanMs) || DAY_MS;
    const cutoff = new Date(now.getTime() - olderThanMs);

    const expired = await Status.find({ createdAt: { $lt: cutoff } })
      .select('_id mediaUrl mediaPublicId mimetype thumbnailUrl')
      .limit(500);

    let deleted = 0;
    let filesDeleted = 0;
    for (const status of expired) {
      const fileGone =
        (status.mediaUrl &&
          (await storage.deleteStoredFile({
            url: status.mediaUrl,
            publicId: status.mediaPublicId,
            mimetype: status.mimetype,
          }))) ||
        false;
      if (fileGone) filesDeleted += 1;
      if (typeof status.thumbnailUrl === 'string' && status.thumbnailUrl.startsWith('/uploads/')) {
        if (await storage.deleteStoredFile({ url: status.thumbnailUrl })) filesDeleted += 1;
      }
      await Status.deleteOne({ _id: status._id });
      deleted += 1;
    }

    if (deleted > 0) {
      console.log(`Status cleanup: removed ${deleted} expired status(es), ${filesDeleted} file(s)`);
    }
    return { skipped: false, deleted, filesDeleted, checked: expired.length };
  } finally {
    running = false;
  }
}

/**
 * Start the periodic job. Called once at boot after MongoDB connects.
 * The timer is unref'd so it never keeps the process alive on its own.
 */
function startStatusCleanup({ intervalMs } = {}) {
  const every = Number(intervalMs) || DEFAULT_INTERVAL_MS;
  if (timer) return timer;

  dropLegacyTtlIndex()
    .catch(() => undefined)
    .then(() => runCleanup())
    .catch((error) => console.warn('Status cleanup failed:', error.message));

  timer = setInterval(() => {
    runCleanup().catch((error) => console.warn('Status cleanup failed:', error.message));
  }, every);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function stopStatusCleanup() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startStatusCleanup,
  stopStatusCleanup,
  runCleanup,
  removeStatusWithMedia,
  dropLegacyTtlIndex,
  DAY_MS,
};
