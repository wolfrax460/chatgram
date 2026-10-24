/**
 * Redaction of private data before anything is sent to an AI provider.
 *
 * Passwords, codes, tokens, API keys, card numbers, full phone numbers and
 * email addresses are replaced. A user who is deliberately giving contact details
 * for a ticket can pass `allowContact: true`.
 */

const PATTERNS = [
  // Explicit "password is xyz" style statements.
  [/((?:password|passwd|pwd|passcode)\s*(?:is|=|:|--)?\s*)(\S+)/gi, '$1[redacted]'],
  [/((?:otp|2fa|verification|recovery|auth(?:entication)?)\s*code\s*(?:is|=|:|--)?\s*)(\d{4,10})/gi, '$1[redacted]'],
  // Bearer tokens and key formats.
  [/\b(?:bearer\s+)[A-Za-z0-9._-]{12,}\b/gi, 'bearer [redacted]'],
  [/\b(?:sk|pk|rk|api|key)[-_][A-Za-z0-9]{12,}\b/g, '[redacted-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted-jwt]'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-secret]'],
  // Card numbers (13-19 digits, optional separators).
  [/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-card]'],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,5}\d{2,4}/g;

function redact(text, options = {}) {
  let value = String(text ?? '');
  if (!value) return value;
  for (const [pattern, replacement] of PATTERNS) {
    value = value.replace(pattern, replacement);
  }
  if (!options.allowContact) {
    value = value.replace(EMAIL, '[redacted-email]');
    // Only redact phone-like strings of 9+ digits to avoid mangling dates/ids.
    value = value.replace(PHONE, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 9 ? '[redacted-phone]' : match;
    });
  }
  return value;
}

/** Redact a message array, keeping roles/shape identical. */
function redactMessages(messages, options = {}) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => ({
    ...message,
    text: redact(message.text, options),
  }));
}

module.exports = { redact, redactMessages };
