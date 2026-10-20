/**
 * Wipes ALL application data so Chatgram starts like a brand-new install.
 *
 *   npm run db:reset          -> shows what would be deleted, deletes nothing
 *   npm run db:reset -- --yes -> actually deletes
 *
 * Removes:
 *   - every user (and therefore their contacts and logins)
 *   - every chat and group
 *   - every message
 *   - every status / story
 *   - every uploaded file (avatars, media, status images)
 *
 * Schema indexes are intentionally kept (deleteMany, not dropDatabase) so the
 * app does not have to rebuild them.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const connectDB = require('../src/utils/db');

// Mongoose pluralises "Status" to `status`, but be tolerant of either name.
const COLLECTIONS = ['users', 'chats', 'messages', 'status', 'statuses'];
// Honours UPLOAD_DIR, matching where the server actually stores files.
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads');
const UPLOAD_DIRS = ['avatars', 'media', 'status'];

async function main() {
  const confirmed = process.argv.includes('--yes') || process.argv.includes('-y');

  await connectDB({ exitOnFailure: true });
  const db = mongoose.connection.db;

  // ------------------------------------------------------------------ report
  const existing = await db.listCollections().toArray();
  const names = existing.map((c) => c.name);

  const counts = {};
  for (const name of COLLECTIONS) {
    if (!names.includes(name)) continue;
    counts[name] = await db.collection(name).countDocuments();
  }

  const uploadCounts = {};
  for (const dir of UPLOAD_DIRS) {
    const full = path.join(UPLOAD_ROOT, dir);
    uploadCounts[dir] = fs.existsSync(full)
      ? fs.readdirSync(full).filter((f) => fs.statSync(path.join(full, f)).isFile()).length
      : 0;
  }

  console.log('\nCurrent data in the database:\n');
  let total = 0;
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(12)} ${count}`);
    total += count;
  }
  console.log('');
  for (const [dir, count] of Object.entries(uploadCounts)) {
    console.log(`  uploads/${dir.padEnd(9)} ${count} file(s)`);
  }

  if (total === 0 && Object.values(uploadCounts).every((c) => c === 0)) {
    console.log('\nNothing to delete - the application is already empty.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  if (!confirmed) {
    console.log(
      '\n*** DRY RUN - nothing was deleted. ***\n\n' +
        'This permanently removes every account, chat, message and status.\n' +
        'There is no undo.\n\n' +
        'To go ahead:\n' +
        '    npm run db:reset -- --yes\n'
    );
    await mongoose.disconnect();
    process.exit(0);
  }

  // ------------------------------------------------------------------- wipe
  console.log('\nDeleting...\n');

  for (const name of Object.keys(counts)) {
    const result = await db.collection(name).deleteMany({});
    console.log(`  ${name.padEnd(12)} removed ${result.deletedCount}`);
  }

  // Uploaded files belong to the deleted accounts, so clear them too.
  let removedFiles = 0;
  for (const dir of UPLOAD_DIRS) {
    const full = path.join(UPLOAD_ROOT, dir);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      continue;
    }
    for (const entry of fs.readdirSync(full)) {
      const filePath = path.join(full, entry);
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
        removedFiles++;
      }
    }
  }
  console.log(`  ${'uploads'.padEnd(12)} removed ${removedFiles} file(s)`);

  // Double-check.
  const leftovers = {};
  for (const name of Object.keys(counts)) {
    leftovers[name] = await db.collection(name).countDocuments();
  }
  const remaining = Object.values(leftovers).reduce((a, b) => a + b, 0);

  console.log(
    remaining === 0
      ? '\nDone - the database is empty. Chatgram is ready for a fresh start.\n'
      : `\nWARNING: ${remaining} document(s) remain. Check the output above.\n`
  );

  await mongoose.disconnect();
  process.exit(remaining === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('Reset failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
