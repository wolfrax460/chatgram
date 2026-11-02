/**
 * Public URL / origin helpers (single source of truth).
 *
 * Origin allow-list:
 *   ALLOWED_ORIGINS (comma separated, exact origins) when set,
 *   otherwise CLIENT_URL (comma separated) — backwards compatible.
 *
 * Canonical public site URL:
 *   PUBLIC_SITE_URL || SITE_URL || first CLIENT_URL entry ||
 *   'https://chatgram-xi.vercel.app'
 *
 * `isOurHost` recognises both Chatgram hosts so release URLs/media links keep
 * working after the domain cutover to https://chatgram.qd.je.
 */
const DEFAULT_PUBLIC_SITE_URL = 'https://chatgram-xi.vercel.app';
const OUR_HOSTS = new Set(['chatgram-xi.vercel.app', 'chatgram.qd.je']);

function clean(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/\/+$/, '');
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(clean)
    .filter(Boolean);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function firstHttpUrl(values) {
  for (const value of values) {
    const candidate = clean(value);
    if (isHttpUrl(candidate)) return candidate;
  }
  return '';
}

/** Exact origins accepted by CORS / Socket.IO (ALLOWED_ORIGINS, else CLIENT_URL). */
function originAllowList() {
  const configured = clean(process.env.ALLOWED_ORIGINS) ? process.env.ALLOWED_ORIGINS : process.env.CLIENT_URL;
  return splitList(configured);
}

/** Canonical public site (links, downloads, Telegram links, platform settings). */
function publicSiteUrl() {
  return firstHttpUrl([
    process.env.PUBLIC_SITE_URL,
    process.env.SITE_URL,
    ...splitList(process.env.CLIENT_URL),
  ]) || DEFAULT_PUBLIC_SITE_URL;
}

/** True for the two Chatgram hostnames (old Vercel + new qd.je domain). */
function isOurHost(host) {
  const value = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return OUR_HOSTS.has(value);
}

function isOurUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return isOurHost(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_PUBLIC_SITE_URL,
  OUR_HOSTS,
  originAllowList,
  publicSiteUrl,
  isOurHost,
  isOurUrl,
  splitList,
};
