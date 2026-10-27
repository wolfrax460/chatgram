/**
 * Unit test: one-time code store (email verification / phone OTP).
 *
 *   cd server && node test/unit/verificationStore.test.js
 *
 * No DB, no API process: with MongoDB not connected the store uses its
 * in-memory fallback, which is exactly the code path a DB outage takes. The
 * module's clock is moved forward instead of waiting 15 real minutes.
 *
 * Covers the rules users notice: the 15-minute lifetime, the 60 s resend
 * cooldown, the old code still working after a resend, MAX_ATTEMPTS, wrong
 * codes not consuming the code, and a correct code being single-use.
 */
const store = require('../../src/utils/verificationStore');

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

function wrongCodeFor(code) {
  return code === '000000' ? '111111' : '000000';
}

async function main() {
  console.log('\nverification store unit test (no DB, no API)\n');

  // A controllable clock. TTL tests must not wait a quarter of an hour.
  let now = Date.UTC(2026, 0, 1, 12, 0, 0);
  store.setClockForTests(() => now);

  check('code lifetime is 15 minutes', store.TTL_MS === 15 * 60 * 1000, String(store.TTL_MS));
  check('the advertised lifetime is 15 minutes', store.TTL_MINUTES === 15, String(store.TTL_MINUTES));
  check('resend cooldown is 60 s', store.RESEND_COOLDOWN_MS === 60 * 1000);
  check('max attempts is 5', store.MAX_ATTEMPTS === 5);

  /* -------------------------------------------------------- issue + cooldown */
  await store.clear();
  const first = await store.issue('email', 'User@Example.COM ');
  check('a code is issued', first.ok === true, JSON.stringify(first));
  check('the code is 6 digits', /^[0-9]{6}$/.test(first.code), first.code);
  check('the response says how long the code lives', first.expiresInSeconds === 900, first.expiresInSeconds);

  const immediateResend = await store.issue('email', 'user@example.com');
  check('an immediate resend is refused', immediateResend.ok === false, JSON.stringify(immediateResend));
  check(
    'the refusal carries retryAfterSeconds',
    Number.isInteger(immediateResend.retryAfterSeconds) && immediateResend.retryAfterSeconds > 0 && immediateResend.retryAfterSeconds <= 60,
    immediateResend.retryAfterSeconds,
  );

  now += 30_000;
  const halfCooldown = await store.issue('email', 'user@example.com');
  check(
    'the cooldown counts down (30 s left)',
    halfCooldown.ok === false && halfCooldown.retryAfterSeconds === 30,
    JSON.stringify(halfCooldown),
  );

  now += 30_000; // exactly 60 s after the first send
  const resent = await store.issue('email', 'user@example.com');
  check('a resend works once the cooldown has passed', resent.ok === true, JSON.stringify(resent));
  check('the resend returns a new code', resent.ok === true && resent.code !== first.code);

  // Users tap "resend" when delivery is slow, then type whichever message
  // arrived first: the replaced code must still work until its own expiry.
  const oldStillWorks = await store.check('email', 'USER@example.com', first.code);
  check('the previous code still works after a resend', oldStillWorks.ok === true, JSON.stringify(oldStillWorks));
  const newGoneAfterUse = await store.check('email', 'user@example.com', resent.code);
  check('checking the old code consumes the pending record', newGoneAfterUse.ok === false && newGoneAfterUse.reason === 'missing');

  /* ------------------------------------------------------------- TTL expiry */
  await store.clear();
  const ttl = await store.issue('phone', '+250780000001');
  now += store.TTL_MS - 1000;
  const justInside = await store.check('phone', '+250780000001', ttl.code);
  check('a code still works one second before the 15 minutes end', justInside.ok === true, JSON.stringify(justInside));

  await store.clear();
  const expired = await store.issue('phone', '+250780000001');
  now += store.TTL_MS + 1000;
  const expiredResult = await store.check('phone', '+250780000001', expired.code);
  check(
    'an expired code is reported as expired, not "wrong" or "missing"',
    expiredResult.ok === false && expiredResult.reason === 'expired',
    JSON.stringify(expiredResult),
  );

  // Expired rows are retained briefly for that answer, then dropped.
  await store.clear();
  const stale = await store.issue('phone', '+250780000001');
  now += store.TTL_MS + store.EXPIRED_RETENTION_MS + 1000;
  const purged = await store.check('phone', '+250780000001', stale.code);
  check(
    'an old expired row is purged and reported as missing',
    purged.ok === false && purged.reason === 'missing',
    JSON.stringify(purged),
  );

  /* -------------------------------------------------------------- attempts */
  await store.clear();
  const attempts = await store.issue('email', 'attempts@example.com');
  let lastWrong = null;
  for (let i = 0; i < store.MAX_ATTEMPTS; i += 1) {
    lastWrong = await store.check('email', 'attempts@example.com', wrongCodeFor(attempts.code));
  }
  check('a wrong code is reported as invalid', lastWrong.ok === false && lastWrong.reason === 'invalid', JSON.stringify(lastWrong));

  const locked = await store.check('email', 'attempts@example.com', attempts.code);
  check(
    'after MAX_ATTEMPTS the next check says too_many_attempts',
    locked.ok === false && locked.reason === 'too_many_attempts',
    JSON.stringify(locked),
  );
  const lockedGone = await store.check('email', 'attempts@example.com', attempts.code);
  check('a burned code is removed', lockedGone.ok === false && lockedGone.reason === 'missing');

  /* ------------------------------------------------------- success consumes */
  await store.clear();
  const good = await store.issue('email', 'once@example.com');
  const wrongFirst = await store.check('email', 'once@example.com', wrongCodeFor(good.code));
  check('a wrong guess does not consume the code', wrongFirst.ok === false && wrongFirst.reason === 'invalid');
  const accepted = await store.check('email', 'once@example.com', good.code);
  check('the correct code is accepted', accepted.ok === true, JSON.stringify(accepted));
  const replay = await store.check('email', 'once@example.com', good.code);
  check(
    'the correct code cannot be used twice',
    replay.ok === false && replay.reason === 'missing',
    JSON.stringify(replay),
  );

  /* --------------------------------------------------- channel / target key */
  await store.clear();
  const emailCode = await store.issue('email', 'one@example.com');
  const phoneCode = await store.issue('phone', 'one@example.com');
  const emailAccepted = await store.check('email', 'one@example.com', emailCode.code);
  const phoneAccepted = await store.check('phone', 'one@example.com', phoneCode.code);
  check('email and phone channels keep separate codes', emailAccepted.ok === true && phoneAccepted.ok === true);

  await store.clear();
  const missing = await store.check('email', 'never-sent@example.com', '123456');
  check('checking a target with no code says missing', missing.ok === false && missing.reason === 'missing');

  store.setClockForTests(null);
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 900));
  process.exit(1);
});
