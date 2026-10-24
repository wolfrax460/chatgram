/**
 * Unit test: two-factor authentication (TOTP, secret encryption, recovery codes).
 *
 *   cd server && node test/unit/twoFactor.test.js
 *
 * Needs no database and no API process.
 *
 * This exists because of a regression that reached production silently: the
 * dependency went from otplib 12 to 13, and v13 removed the `authenticator`
 * helper this controller calls. Nothing in the suite touched 2FA, so a plain
 * `npm ci` on the server broke enrolment and locked out every account that had
 * 2FA enabled — while the build and every other test stayed green.
 */
const fs = require('node:fs');
const path = require('node:path');

const { authenticator } = require('otplib');
const tf = require('../../src/controllers/twoFactorController');

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

function otplibMajor() {
  const pkg = path.join(__dirname, '..', '..', 'node_modules', 'otplib', 'package.json');
  return Number(JSON.parse(fs.readFileSync(pkg, 'utf8')).version.split('.')[0]);
}

function main() {
  console.log('\n2FA unit test (no DB, no API)\n');

  // --------------------------------------------------------------- dependency
  const major = otplibMajor();
  check(
    'otplib still exposes the v12 `authenticator` helper',
    typeof authenticator === 'object' && authenticator !== null,
    'otplib v13 removed it — migrate twoFactorController before upgrading',
  );
  check('otplib is pinned to major 12', major === 12, `installed major=${major}`);

  // --------------------------------------------------------------------- TOTP
  const secret = authenticator.generateSecret();
  const token = authenticator.generate(secret);
  const other = token === '000000' ? '111111' : '000000';

  check('generated secret is base32-ish', /^[A-Z2-7]+$/.test(secret), secret);
  check('generated token is 6 digits', /^\d{6}$/.test(token), token);
  check('verifyCode accepts a correct code', tf.verifyCode(secret, token) === true);
  check('verifyCode rejects a wrong code', tf.verifyCode(secret, other) === false);
  check('verifyCode rejects a non-numeric code', tf.verifyCode(secret, 'abcdef') === false);
  check('verifyCode rejects a code of wrong length', tf.verifyCode(secret, '12345') === false);
  check('verifyCode rejects a missing secret', tf.verifyCode('', token) === false);
  check('verifyCode tolerates whitespace in the code', tf.verifyCode(secret, ` ${token} `) === true);

  // ------------------------------------------------------------ secret at rest
  const encrypted = tf.encrypt(secret);
  check('encrypt does not return the plaintext secret', encrypted !== secret && !encrypted.includes(secret));
  check('encrypt output is iv.tag.data', /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(encrypted));
  check('decrypt reverses encrypt', tf.decrypt(encrypted) === secret);
  check('decrypt of garbage returns empty string', tf.decrypt('not-a-payload') === '');
  check('two encryptions of the same secret differ (random IV)', tf.encrypt(secret) !== tf.encrypt(secret));

  // ------------------------------------------------------------ recovery codes
  const codes = tf.newRecoveryCodes();
  check('ten recovery codes are generated', codes.length === 10, String(codes.length));
  check('recovery codes are unique', new Set(codes).size === 10);
  check('recovery codes are human-friendly (XXXXX-XXXXX)', codes.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)), codes[0]);
  check(
    'recovery codes avoid ambiguous characters (no 0/O/1/I)',
    codes.every((c) => !/[01OI]/.test(c)),
    codes[0],
  );
  check('hashCode is stable and 64 hex chars', /^[0-9a-f]{64}$/.test(tf.hashCode(codes[0])), tf.hashCode(codes[0]));
  check(
    'hashCode ignores case, spaces and dashes',
    tf.hashCode('a1b2c-3d4e5') === tf.hashCode('A1B2C3D4E5') &&
      tf.hashCode('A1B2C 3D4E5') === tf.hashCode('A1B2C3D4E5'),
  );
  check('different recovery codes hash differently', tf.hashCode(codes[0]) !== tf.hashCode(codes[1]));

  // ------------------------------------------------------------------- result
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main();
