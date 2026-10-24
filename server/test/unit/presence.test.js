/**
 * Unit test: live-socket presence registry.
 *
 *   cd server && node test/unit/presence.test.js
 *
 * No DB, no API process. Covers the rules that make presence trustworthy:
 * a user is online while they hold at least one socket, multi-device is counted
 * correctly, and a socket that stops heartbeating becomes stale.
 */
const realtime = require('../../src/utils/realtime');

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

function main() {
  console.log('\npresence registry unit test (no DB, no API)\n');

  // A fresh registry is empty.
  check('nobody is online at start', realtime.isUserOnline('u1') === false);

  // Connect / disconnect.
  realtime.trackSocket('u1', 's1');
  check('a user with a socket is online', realtime.isUserOnline('u1') === true);
  check('the socket is counted', realtime.socketCount() === 1 && realtime.onlineCount() === 1);

  const lastGone = realtime.untrackSocket('u1', 's1');
  check('removing the only socket reports "last connection gone"', lastGone === true);
  check('the user is offline once the socket is gone', realtime.isUserOnline('u1') === false);

  // Multi-device: two sockets, one goes, user stays online.
  realtime.trackSocket('u2', 'a');
  realtime.trackSocket('u2', 'b');
  const afterFirst = realtime.untrackSocket('u2', 'a');
  check('one of two sockets leaving does NOT mark the user offline', afterFirst === false);
  check('the user is still online with one device left', realtime.isUserOnline('u2') === true);
  const afterSecond = realtime.untrackSocket('u2', 'b');
  check('the last device leaving marks the user offline', afterSecond === true && realtime.isUserOnline('u2') === false);

  // Untracking something unknown must not throw or corrupt state.
  check('untracking an unknown user is harmless', realtime.untrackSocket('ghost', 'nope') === false);

  // Heartbeat staleness.
  realtime.trackSocket('u3', 'fresh');
  realtime.trackSocket('u3', 'stale');
  const now = Date.now();
  const stale = realtime.staleSocketIds(now + 120_000, 60_000);
  check(
    'sockets older than the stale window are reported',
    stale.length === 2 && stale.every((row) => row.userId === 'u3'),
    JSON.stringify(stale),
  );
  check(
    'nothing is stale while heartbeats are current',
    realtime.staleSocketIds(now, 60_000).filter((row) => row.socketId === 'fresh').length === 0,
  );

  realtime.untrackSocket('u3', 'fresh');
  realtime.untrackSocket('u3', 'stale');

  // Throttled DB persistence: first ping persists, an immediate second does not.
  realtime.trackSocket('u4', 's4');
  check('the first heartbeat asks to persist lastSeen', realtime.shouldPersistSeen('s4', 60_000) === true);
  check('an immediate second heartbeat is throttled', realtime.shouldPersistSeen('s4', 60_000) === false);
  realtime.untrackSocket('u4', 's4');

  // The default stale window is the 60s the docs promise.
  check('default stale window is 60s', realtime.staleAfterMs() === 60_000, String(realtime.staleAfterMs()));

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main();
