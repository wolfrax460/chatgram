#!/usr/bin/env node
/**
 * One-time presence cleanup.
 *
 * Clears `User.isOnline` flags that a crash or restart left stuck at true.
 * Presence is now derived from live sockets, so this only fixes what REST
 * payloads used to report (and what the admin tooling shows).
 *
 * Safe by construction: it never deletes users or any other data, keeps the
 * existing `lastSeen` as the last known activity, and does nothing unless
 * `--apply` is passed.
 *
 *   cd server
 *   node scripts/reset-presence.js            # dry run, prints what would change
 *   node scripts/reset-presence.js --apply    # actually clear the flags
 *
 * Requires MONGODB_URI, normally loaded from server/.env.
 */
require('dotenv').config();

const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set (expected in server/.env).');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });

  const { resetStuckPresence } = require('../src/utils/presence');
  const result = await resetStuckPresence({ dryRun: !APPLY, sampleLimit: 50 });

  console.log(`\npresence cleanup — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`  flagged online: ${result.scanned}`);
  if (result.users.length) {
    console.log('  users:');
    for (const user of result.users) {
      const seen = user.lastSeen ? new Date(user.lastSeen).toISOString() : 'never';
      console.log(`   - ${user.displayName} (last seen ${seen})`);
    }
  }
  console.log(`  changed: ${result.changed}`);
  if (!APPLY && result.scanned > 0) {
    console.log('\n  re-run with --apply to clear these flags\n');
  } else if (APPLY) {
    console.log('\n  done — users will show offline until they connect again\n');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('presence cleanup failed:', error.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
