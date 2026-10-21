/**
 * One password policy, used wherever an account SETS a new password
 * (change-password, reset-password). Sign-in is never blocked by a policy
 * change, so existing weak passwords keep working until the user rotates them.
 *
 * Rules (deliberately simple and explainable in the UI):
 *  - 8 to 128 characters
 *  - at least one letter and at least one digit
 *  - not one of the most common passwords
 *
 * Returns the same shape everywhere so the client can render the first problem
 * without guessing:
 *   { ok, problems: string[], code, strength: 'weak' | 'fair' | 'good' | 'strong' }
 */

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

// Small, high-signal deny list. Not a full dump — that would be a dependency.
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd',
  '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyui',
  'abc12345', 'iloveyou', 'admin123', 'welcome1', 'letmein1',
  'chatgram', 'chatgram1', 'chatgram123',
]);

function strengthOf(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score >= 5) return 'strong';
  if (score === 4) return 'good';
  if (score === 3) return 'fair';
  return 'weak';
}

function validatePassword(password) {
  const value = typeof password === 'string' ? password : '';
  const problems = [];

  if (value.length === 0) {
    return { ok: false, code: 'PASSWORD_REQUIRED', problems: ['Enter a password.'], strength: 'weak' };
  }
  if (value.length < MIN_LENGTH) {
    problems.push(`Use at least ${MIN_LENGTH} characters.`);
  }
  if (value.length > MAX_LENGTH) {
    problems.push(`Use at most ${MAX_LENGTH} characters.`);
  }
  if (!/[A-Za-z]/.test(value)) {
    problems.push('Include at least one letter.');
  }
  if (!/[0-9]/.test(value)) {
    problems.push('Include at least one number.');
  }
  if (COMMON.has(value.toLowerCase())) {
    problems.push('That password is too common. Choose something less predictable.');
  }

  return {
    ok: problems.length === 0,
    code: problems.length === 0 ? 'OK' : 'WEAK_PASSWORD',
    problems,
    strength: strengthOf(value),
    minLength: MIN_LENGTH,
    maxLength: MAX_LENGTH,
  };
}

module.exports = { validatePassword, strengthOf, MIN_LENGTH, MAX_LENGTH };
