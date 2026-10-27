/**
 * Unit tests for the desktop update decision logic (no Electron needed).
 *
 *   node apps/desktop/updater-logic.test.js
 */
const assert = require('node:assert/strict');
const { compareVersions, decideUpdate, backoffDelay, nextCheckDelay, describeAttempt } = require('./updater-logic');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    console.log(`  FAIL  ${name} -> ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\ndesktop update logic\n');

// --- compareVersions -------------------------------------------------------
test('equal versions compare as 0', () => assert.equal(compareVersions('1.1.0', '1.1.0'), 0));
test('newer patch wins', () => assert.equal(compareVersions('1.1.2', '1.1.1'), 1));
test('older patch loses', () => assert.equal(compareVersions('1.0.9', '1.1.0'), -1));
test('numeric, not lexical, comparison', () => assert.equal(compareVersions('1.10.0', '1.9.0'), 1));
test('missing parts count as zero', () => assert.equal(compareVersions('1.2', '1.2.0'), 0));
test('garbage is treated as zero, never NaN', () => assert.equal(compareVersions('', '0.0.0'), 0));

// --- decideUpdate ----------------------------------------------------------
test('up to date means no action', () =>
  assert.deepEqual(decideUpdate({ currentVersion: '1.1.0', latestVersion: '1.1.0' }), { action: 'none', reason: 'up-to-date' }));

test('an older installed build never downgrades', () =>
  assert.equal(decideUpdate({ currentVersion: '1.2.0', latestVersion: '1.1.0' }).action, 'none'));

test('newer available with no policy is optional', () =>
  assert.deepEqual(decideUpdate({ currentVersion: '1.1.0', latestVersion: '1.1.2' }), { action: 'optional', reason: 'newer-available' }));

test('forceUpdate makes it required', () =>
  assert.equal(decideUpdate({ currentVersion: '1.1.0', latestVersion: '1.2.0', forceUpdate: true }).action, 'required'));

test('below minSupportedVersion is required even without forceUpdate', () =>
  assert.equal(
    decideUpdate({ currentVersion: '1.0.0', latestVersion: '1.2.0', minSupportedVersion: '1.1.0' }).action,
    'required',
  ));

test('at minSupportedVersion is not required', () =>
  assert.equal(
    decideUpdate({ currentVersion: '1.1.0', latestVersion: '1.2.0', minSupportedVersion: '1.1.0' }).action,
    'optional',
  ));

test('a withdrawn release is never offered, even when forced', () =>
  assert.deepEqual(
    decideUpdate({ currentVersion: '1.0.0', latestVersion: '9.9.9', forceUpdate: true, withdrawn: true }),
    { action: 'none', reason: 'withdrawn' },
  ));

test('no latest version means no action', () =>
  assert.deepEqual(decideUpdate({ currentVersion: '1.1.0' }), { action: 'none', reason: 'no-latest' }));

test('empty input does not throw', () => assert.equal(decideUpdate().action, 'none'));

// --- backoff ---------------------------------------------------------------
test('backoff starts small and grows', () => {
  assert.equal(backoffDelay(1), 5_000);
  assert.equal(backoffDelay(2), 15_000);
  assert.equal(backoffDelay(3), 45_000);
  assert.ok(backoffDelay(4) > backoffDelay(3));
});
test('backoff is capped at 30 minutes', () => assert.equal(backoffDelay(99), 30 * 60_000));
test('backoff never returns zero or negative', () => {
  assert.ok(backoffDelay(0) >= 1_000);
  assert.ok(backoffDelay(-5) >= 1_000);
});

// --- schedule --------------------------------------------------------------
test('next check is about six hours away', () => {
  const delay = nextCheckDelay({ random: () => 0.5 });
  assert.equal(delay, 6 * 60 * 60_000);
});
test('jitter stays within ±15 minutes and never below a minute', () => {
  const low = nextCheckDelay({ random: () => 0 });
  const high = nextCheckDelay({ random: () => 1 });
  assert.ok(low >= 5.75 * 60 * 60_000 && low < 6 * 60 * 60_000);
  assert.ok(high > 6 * 60 * 60_000 && high <= 6.25 * 60 * 60_000);
  assert.ok(nextCheckDelay({ intervalMs: 0, jitterMs: 0 }) >= 60_000);
});
test('deterministic jitter for tests', () => {
  assert.equal(nextCheckDelay({ random: () => 0 }), 6 * 60 * 60_000 - 15 * 60_000);
});

test('attempt label is bounded', () => {
  assert.equal(describeAttempt(2), '2/6');
  assert.equal(describeAttempt(99), '6/6');
});

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES' : ''}\n`);
