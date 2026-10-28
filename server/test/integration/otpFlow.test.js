/**
 * Email / phone one-time-code flow (verification codes in MongoDB).
 *
 *   cd server && node test/integration/otpFlow.test.js
 *
 * Requires a staging API on E2E_API_URL (default http://127.0.0.1:5000) with
 * DEV_SHOW_CODES=true (staging does this) and the same Mongo database in
 * MONGODB_URI. Start the isolated API with VERIFICATION_CODE_TTL_MINUTES=20
 * and run this test with OTP_EXPECT_TTL_SECONDS=1200 to prove the TTL is
 * configurable; without those it asserts the response and the DB agree.
 *
 * Covers the reported production problems:
 *  - a code still verifies 10 minutes after it was created;
 *  - a code starting with 0 verifies when submitted as a JSON number (leading
 *    zero dropped) or with spaces;
 *  - a code past its TTL is rejected with the expired response, not "invalid";
 *  - pressing Resend several times does not invalidate the earlier emails
 *    (every code still inside its own lifetime verifies); the retained history
 *    is bounded.
 */
const mongoose = require('mongoose');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const EXPECTED_TTL_SECONDS = Number(process.env.OTP_EXPECT_TTL_SECONDS || 0);
const run = Date.now().toString(36);

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

async function api(method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, body: payload };
}

let counter = 0;
function targetFor(label) {
  counter += 1;
  return `otp-test-${run}-${label}-${counter}@chatgram.test`;
}

async function send(target) {
  const result = await api('POST', '/api/auth/verification/send', { identifier: target });
  if (result.status !== 200 || !result.body?.devCode) {
    throw new Error(`send ${target}: ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
  }
  return result.body;
}

async function checkCode(target, code) {
  return api('POST', '/api/auth/verification/check', { identifier: target, code });
}

async function main() {
  console.log('\nOTP flow (TTL, leading zero, resend history)\n');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const VerificationCode = require('../../src/models/VerificationCode');

  const createdTargets = [];
  /** Skip the 60 s resend cooldown without waiting, for a controlled target. */
  async function backdateSend(target) {
    await VerificationCode.updateOne({ target }, { $set: { lastSentAt: new Date(Date.now() - 61_000) } });
  }

  try {
    /* ------------------------------------------------- TTL is configurable */
    const ttlTarget = targetFor('ttl');
    createdTargets.push(ttlTarget);
    const sent = await send(ttlTarget);
    const row = await VerificationCode.findOne({ target: ttlTarget }).lean();
    const dbWindowSeconds = row ? Math.round((new Date(row.expiresAt) - new Date(row.createdAt)) / 1000) : null;
    check('send reports the code lifetime in seconds', Number(sent.expiresInSeconds) > 0, sent.expiresInSeconds);
    check('the stored expiresAt window matches the reported lifetime', dbWindowSeconds === Number(sent.expiresInSeconds), { dbWindowSeconds, reported: sent.expiresInSeconds });
    if (EXPECTED_TTL_SECONDS > 0) {
      check(`the lifetime follows VERIFICATION_CODE_TTL_MINUTES (${EXPECTED_TTL_SECONDS}s)`, Number(sent.expiresInSeconds) === EXPECTED_TTL_SECONDS, sent.expiresInSeconds);
    }
    // Consume it so the doc does not linger for the later assertions.
    await checkCode(ttlTarget, sent.devCode);

    /* ------------------------------------ a 10-minute-old code still works */
    const agedTarget = targetFor('aged');
    createdTargets.push(agedTarget);
    const aged = await send(agedTarget);
    await VerificationCode.updateOne(
      { target: agedTarget },
      { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } },
    );
    const agedResult = await checkCode(agedTarget, aged.devCode);
    check('a code created 10 minutes ago still verifies', agedResult.status === 200 && agedResult.body?.verified === true, { status: agedResult.status, body: agedResult.body });

    /* -------------------------------------------------- leading-zero codes */
    // Generate codes until one starts with 0 (expected in ~1/10 sends).
    async function zeroLeadingCode(label) {
      const target = targetFor(label);
      createdTargets.push(target);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const issued = await send(target);
        if (String(issued.devCode).startsWith('0')) return { target, code: issued.devCode };
        await backdateSend(target);
      }
      return null;
    }

    const numericZero = await zeroLeadingCode('zero-numeric');
    check('a zero-leading code can be generated for the test', Boolean(numericZero), null);
    if (numericZero) {
      // What a client that does Number(code) sends: "012345" -> 12345.
      const result = await checkCode(numericZero.target, Number(numericZero.code));
      check('a zero-leading code verifies when submitted as a number', result.status === 200 && result.body?.verified === true, { status: result.status, body: result.body });
    }

    const spacedZero = await zeroLeadingCode('zero-spaces');
    check('a second zero-leading code can be generated for the test', Boolean(spacedZero), null);
    if (spacedZero) {
      const spaced = ` ${spacedZero.code.slice(0, 3)} ${spacedZero.code.slice(3)} `;
      const result = await checkCode(spacedZero.target, spaced);
      check('a zero-leading code with spaces verifies (trimmed, re-padded)', result.status === 200 && result.body?.verified === true, { status: result.status, body: result.body });
    }

    /* ------------------------------------------------------ expired code */
    const expiredTarget = targetFor('expired');
    createdTargets.push(expiredTarget);
    const expired = await send(expiredTarget);
    await VerificationCode.updateOne({ target: expiredTarget }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredResult = await checkCode(expiredTarget, expired.devCode);
    check('a past-TTL code is rejected with the expired code', expiredResult.status === 400 && expiredResult.body?.code === 'CODE_EXPIRED', { status: expiredResult.status, body: expiredResult.body });
    check('the expired response tells the client to request a new code', /expired/i.test(String(expiredResult.body?.message || '')), expiredResult.body?.message);

    /* ------------------------------------------- Resend keeps older codes */
    const resendTarget = targetFor('resend');
    createdTargets.push(resendTarget);
    const first = await send(resendTarget);
    await backdateSend(resendTarget);
    await send(resendTarget);
    await backdateSend(resendTarget);
    const third = await send(resendTarget);
    const firstAfterResends = await checkCode(resendTarget, first.devCode);
    check(
      'after two Resends the first emailed code still verifies',
      firstAfterResends.status === 200 && firstAfterResends.body?.verified === true,
      { status: firstAfterResends.status, body: firstAfterResends.body },
    );
    // The third send's doc was consumed by the check above (single use); that is
    // expected. A fresh target proves the newest code from a chain also works.
    const newestTarget = targetFor('newest');
    createdTargets.push(newestTarget);
    await send(newestTarget);
    await backdateSend(newestTarget);
    await send(newestTarget);
    await backdateSend(newestTarget);
    const newest = await send(newestTarget);
    const newestResult = await checkCode(newestTarget, newest.devCode);
    check('the newest code from a Resend chain verifies', newestResult.status === 200 && newestResult.body?.verified === true, { status: newestResult.status, body: newestResult.body });

    /* ------------------------------------------- history is bounded at 5 */
    const boundedTarget = targetFor('bounded');
    createdTargets.push(boundedTarget);
    const oldest = await send(boundedTarget);
    for (let index = 0; index < 6; index += 1) {
      await backdateSend(boundedTarget);
      await send(boundedTarget);
    }
    const oldestAfterMany = await checkCode(boundedTarget, oldest.devCode);
    check(
      'codes beyond the bounded resend history are no longer accepted',
      oldestAfterMany.status === 400 && oldestAfterMany.body?.code === 'CODE_INVALID',
      { status: oldestAfterMany.status, body: oldestAfterMany.body },
    );

    /* ------------------------------- a wrong code still counts as an attempt */
    const attemptsTarget = targetFor('attempts');
    createdTargets.push(attemptsTarget);
    const attemptCode = await send(attemptsTarget);
    const wrong = String((Number(attemptCode.devCode) + 1) % 1_000_000).padStart(6, '0');
    const wrongResult = await checkCode(attemptsTarget, wrong);
    check('a wrong code is rejected as invalid (not expired)', wrongResult.status === 400 && wrongResult.body?.code === 'CODE_INVALID', { status: wrongResult.status, body: wrongResult.body });
    const afterWrong = await VerificationCode.findOne({ target: attemptsTarget }).lean();
    check('a wrong guess increments the attempt counter', Number(afterWrong?.attempts) === 1, afterWrong?.attempts);
  } finally {
    if (createdTargets.length) {
      await VerificationCode.deleteMany({ target: { $in: createdTargets } });
    }
    const leftover = await VerificationCode.countDocuments({ target: { $in: createdTargets } });
    if (leftover !== 0) console.log(`  note: ${leftover} test code row(s) could not be removed`);
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('OTP flow test crashed:', String((error && error.stack) || error).slice(0, 1000));
  process.exit(1);
});
