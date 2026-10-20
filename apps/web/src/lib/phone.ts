/**
 * Phone handling without libphonenumber.
 *
 * Covers the common cases well enough for sign-in: detect a phone number,
 * normalise it to E.164 with a chosen dial code, and validate the length.
 * A full libphonenumber port can replace `normalizePhone` later — the call
 * sites do not change.
 */

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  dial: string; // E.164 dial code, e.g. "+250"
  name: string;
  /** Typical national significant number length. */
  length: number;
}

export const COUNTRIES: Country[] = [
  { code: 'RW', dial: '+250', name: 'Rwanda', length: 9 },
  { code: 'KE', dial: '+254', name: 'Kenya', length: 9 },
  { code: 'UG', dial: '+256', name: 'Uganda', length: 9 },
  { code: 'TZ', dial: '+255', name: 'Tanzania', length: 9 },
  { code: 'BI', dial: '+257', name: 'Burundi', length: 8 },
  { code: 'CD', dial: '+243', name: 'DR Congo', length: 9 },
  { code: 'NG', dial: '+234', name: 'Nigeria', length: 10 },
  { code: 'ZA', dial: '+27', name: 'South Africa', length: 9 },
  { code: 'GB', dial: '+44', name: 'United Kingdom', length: 10 },
  { code: 'US', dial: '+1', name: 'United States', length: 10 },
  { code: 'IN', dial: '+91', name: 'India', length: 10 },
  { code: 'FR', dial: '+33', name: 'France', length: 9 },
];

export const DEFAULT_COUNTRY = COUNTRIES[0]!; // Rwanda +250

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** True when the input looks like a phone number rather than an email. */
export function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isEmail(trimmed)) return false;
  // Starts with +, or is mostly digits with phone-ish separators.
  if (trimmed.startsWith('+')) return true;
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 6) return false;
  return /^[\d\s()\-]+$/.test(trimmed);
}

/**
 * Convert user input to E.164 using the selected dial code.
 * `0788 123 456` + `+250` -> `+250788123456`
 */
export function normalizePhone(value: string, dial: string): string {
  const digits = value.replace(/[^\d]/g, '');
  const dialDigits = dial.replace(/[^\d]/g, '');

  // Already includes the country code.
  if (digits.startsWith(dialDigits) && digits.length > dialDigits.length) {
    return `+${digits}`;
  }
  // Local trunk prefix (Rwanda: 0).
  const national = digits.startsWith('0') ? digits.slice(1) : digits;
  return `+${dialDigits}${national}`;
}

export function isValidPhone(value: string, country: Country): boolean {
  const e164 = normalizePhone(value, country.dial);
  const national = e164.slice(country.dial.length);
  return national.length >= country.length - 1 && national.length <= country.length + 1;
}

export interface IdentifierResult {
  ok: boolean;
  /** Value to send to the backend. */
  value: string;
  kind: 'email' | 'phone' | 'unknown';
  error?: 'email' | 'phone' | 'required';
}

/** Validate "email or phone" input and return the value to submit. */
export function resolveIdentifier(raw: string, country: Country): IdentifierResult {
  const value = raw.trim();
  if (!value) return { ok: false, value, kind: 'unknown', error: 'required' };

  if (isEmail(value)) return { ok: true, value: value.toLowerCase(), kind: 'email' };
  if (looksLikePhone(value)) {
    return isValidPhone(value, country)
      ? { ok: true, value: normalizePhone(value, country.dial), kind: 'phone' }
      : { ok: false, value, kind: 'phone', error: 'phone' };
  }
  return { ok: false, value, kind: 'unknown', error: 'email' };
}

/** 0–4 password strength score with a human label key. */
export function passwordStrength(password: string): { score: number; key: string } {
  if (!password) return { score: 0, key: 'strengthWeak' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const capped = Math.min(4, score);
  const key =
    capped <= 1 ? 'strengthWeak' : capped === 2 ? 'strengthFair' : capped === 3 ? 'strengthGood' : 'strengthStrong';
  return { score: capped, key };
}
