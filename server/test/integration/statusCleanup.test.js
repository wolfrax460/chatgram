/**
 * Integration test: status expiry cleanup removes stored FILES as well as rows.
 *
 *   cd server && node test/integration/statusCleanup.test.js
 *
 * Connects directly to the local MongoDB (never production) and drives
 * utils/statusCleanup. No API process needed.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '..', '..', 'uploads');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function main() {
  console.log(`\nstatus cleanup integration test against ${MONGODB_URI.replace(/\/\/[^@]*@/, '//****@')}\n`);

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const Status = require('../../src/models/Status');
  const cleanup = require('../../src/utils/statusCleanup');

  const run = Date.now().toString(36);
  const dir = path.join(UPLOAD_ROOT, 'status');
  fs.mkdirSync(dir, { recursive: true });

  function fixtureFile(label) {
    const file = path.join(dir, `cleanup-test-${run}-${label}.png`);
    fs.writeFileSync(file, Buffer.from('not-really-a-png'));
    return file;
  }

  // --------------------------------------------------- legacy TTL index drop
  try {
    await Status.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400, name: 'createdAt_1' });
  } catch (error) {
    // already exists with the same options — fine
  }
  const drop = await cleanup.dropLegacyTtlIndex();
  check('legacy createdAt TTL index is dropped', drop.dropped === true, JSON.stringify(drop));
  const after = await Status.collection.indexes();
  const stillTtl = after.some(
    (index) => index.key && index.key.createdAt !== undefined && index.expireAfterSeconds !== undefined,
  );
  check('no TTL index remains on createdAt', stillTtl === false);
  check('expiresAt TTL index exists', after.some((index) => index.key && index.key.expiresAt !== undefined));
  const idempotent = await cleanup.dropLegacyTtlIndex();
  check('dropLegacyTtlIndex is safe to re-run', idempotent.dropped === false, JSON.stringify(idempotent));

  // ------------------------------------------------- expired row + its file
  const oldFile = fixtureFile('expired');
  const oldUrl = `/uploads/status/${path.basename(oldFile)}`;
  const expired = await Status.create({
    userId: new mongoose.Types.ObjectId(),
    text: 'old status',
    mediaType: 'image',
    mediaUrl: oldUrl,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  const oldThumb = fixtureFile('thumb');
  const expiredVideo = await Status.create({
    userId: new mongoose.Types.ObjectId(),
    text: 'old video',
    mediaType: 'video',
    mediaUrl: oldUrl.replace('.png', '.mp4'),
    thumbnailUrl: `/uploads/status/${path.basename(oldThumb)}`,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  // --------------------------------------------------------- fresh row stays
  const freshFile = fixtureFile('fresh');
  const fresh = await Status.create({
    userId: new mongoose.Types.ObjectId(),
    text: 'fresh status',
    mediaType: 'image',
    mediaUrl: `/uploads/status/${path.basename(freshFile)}`,
  });

  check('expired file exists before cleanup', fs.existsSync(oldFile));
  const result = await cleanup.runCleanup();
  check('cleanup reports deleted rows', result.deleted >= 2, JSON.stringify(result));
  check('expired status row is gone', (await Status.findById(expired._id)) === null);
  check('expired video status row is gone', (await Status.findById(expiredVideo._id)) === null);
  check('expired file is deleted from disk', fs.existsSync(oldFile) === false, oldFile);
  check('expired video thumbnail is deleted from disk', fs.existsSync(oldThumb) === false, oldThumb);
  check('fresh status row is kept', (await Status.findById(fresh._id)) !== null);
  check('fresh file is kept', fs.existsSync(freshFile) === true, freshFile);

  // ----------------------------------------------------------- re-run safety
  const second = await cleanup.runCleanup();
  check('cleanup is safe to re-run (deletes nothing new)', second.deleted === 0, JSON.stringify(second));

  // --------------------------------------------------------------- tidy up
  await Status.deleteMany({ _id: { $in: [fresh._id] } });
  for (const file of [oldFile, oldThumb, freshFile]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
  await mongoose.disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
