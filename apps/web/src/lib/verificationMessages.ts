/**
 * Truthful wording for a failed 6-digit verification code.
 *
 * The server answers a code check with HTTP 400 (or 429 for too many attempts)
 * and a machine-readable body:
 *
 *   { message, reason, code, canResend }
 *   code: CODE_MISSING | CODE_EXPIRED | CODE_INVALID | CODE_TOO_MANY_ATTEMPTS
 *
 * (server/src/controllers/verificationController.js `CODE_FAILURES`; the account
 * identifier-change confirm uses the same helper). `ApiError` already preserves
 * `code`, so the UI can say *why* the code failed instead of one generic
 * "invalid or expired" banner. Anything unrecognised returns null so callers
 * keep their existing wording.
 */
import { ApiError } from '@chatgram/api-client';

export interface VerificationFailure {
  /** i18n key for the banner. */
  key: string;
  /** Present for the polite "too many attempts" limit notice. */
  retryAfterSeconds?: number;
}

const CODE_MESSAGE_KEYS: Record<string, string> = {
  CODE_EXPIRED: 'errCodeExpired',
  CODE_INVALID: 'errCodeInvalid',
  CODE_MISSING: 'errCodeMissing',
};

/**
 * Map a thrown error from POST /api/auth/verification/check (or the identifier
 * confirm) to a message key, or null when this is not a verification-code
 * failure with a known code.
 */
export function verificationFailure(error: unknown): VerificationFailure | null {
  if (!(error instanceof ApiError)) return null;

  if (error.code === 'CODE_TOO_MANY_ATTEMPTS') {
    // The server's 429 body carries the polite wording but no seconds count;
    // the Auth screen shows a countdown, so reuse its "try again in Ns" notice.
    const match = /(\d+)\s*s/i.exec(error.message);
    return { key: 'errTooManyAttempts', retryAfterSeconds: match ? Number(match[1]) : 30 };
  }

  const key = error.code ? CODE_MESSAGE_KEYS[error.code] : undefined;
  return key ? { key } : null;
}
