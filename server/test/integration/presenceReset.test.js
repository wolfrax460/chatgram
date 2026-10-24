/**
 * Integration test: startup presence reset.
 *
 *   cd server && node test/integration/presenceReset.test.js
 *
 * Connects directly to the local MongoDB (never production). A crash used to
 * leave `isOnline: true` behind forever; this proves the reset clears those
 * flags, keeps `lastSeen` as the last known activity, and leaves offline users
 * untouched. It also proves the dry run changes nothing.
 */
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const run = Date.now().toString(36);
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
  console.log(`\npresence reset integration test against ${MONGODB_URI.replace(/\/\/[^@]*@/, '//****@')}\n`);
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

  const User = require('../../src/models/User');
  const { resetStuckPresence } = require('../../src/utils/presence');
  const collection = User.collection;

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const ids = [];

  // Stuck online with a known lastSeen.
  const stuckKnown = await collection.insertOne({
    displayName: `Presence stuck ${run}`,
    email: `presence-stuck-${run}@chatgram.test`,
    isOnline: true,
    lastSeen: threeDaysAgo,
    createdAt: new Date(),
  });
  ids.push(stuckKnown.insertedId);

  // Stuck online and never seen.
  const stuckNoSeen = await collection.insertOne({
    displayName: `Presence never seen ${run}`,
    email: `presence-noseen-${run}@chatgram.test`,
    isOnline: true,
    lastSeen: null,
    createdAt: new Date(),
  });
  ids.push(stuckNoSeen.insertedId);

  // Already offline: must not be touched.
  const offline = await collection.insertOne({
    displayName: `Presence offline ${run}`,
    email: `presence-offline-${run}@chatgram.test`,
    isOnline: false,
    lastSeen: threeDaysAgo,
    createdAt: new Date(),
  });
  ids.push(offline.insertedId);

  // ------------------------------------------------------------- dry run
  const dry = await resetStuckPresence({ dryRun: true });
  check('dry run reports the flagged users', dry.scanned >= 2, String(dry.scanned));
  check('dry run changes nothing', dry.changed === 0, String(dry.changed));
  check('dry run names the stuck users', dry.users.some((u) => u.displayName === `Presence stuck ${run}`));
  const afterDry = await collection.findOne({ _id: stuckKnown.insertedId });
  check('the flag is still set after a dry run', afterDry.isOnline === true);

  // ---------------------------------------------------------------- apply
  const applied = await resetStuckPresence();
  check('apply reports what it changed', applied.changed >= 2, String(applied.changed));

  const known = await collection.findOne({ _id: stuckKnown.insertedId });
  check('a stuck flag is cleared', known.isOnline === false);
  check(
    'lastSeen keeps the last known activity',
    known.lastSeen && Math.abs(new Date(known.lastSeen).getTime() - threeDaysAgo.getTime()) < 2000,
    String(known.lastSeen),
  );

  const noSeen = await collection.findOne({ _id: stuckNoSeen.insertedId });
  check('a stuck flag with no lastSeen is cleared', noSeen.isOnline === false);
  check('a missing lastSeen is filled in on reset', Boolean(noSeen.lastSeen));

  const untouched = await collection.findOne({ _id: offline.insertedId });
  check('an already-offline user is left alone', untouched.isOnline === false);
  check(
    'an already-offline user keeps their old lastSeen',
    Math.abs(new Date(untouched.lastSeen).getTime() - threeDaysAgo.getTime()) < 2000,
  );

  // A second run is a no-op.
  const again = await resetStuckPresence();
  check('re-running finds only genuinely flagged users', again.scanned < dry.scanned, `${again.scanned} vs ${dry.scanned}`);

  await collection.deleteMany({ _id: { $in: ids } });
  await mongoose.disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error('Test crashed:', error.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
