/**
 * Update-check policy (Chunk 7A). Pure helpers so every rule is unit-testable:
 *
 *  - version/build comparison that never recommends a downgrade;
 *  - download URLs must stay on our own HTTPS domain (a foreign host is
 *    withheld from the response instead of being sent to the device);
 *  - the exact public payload shape + its stable ETag;
 *  - the public rate limiter used by GET /api/app/version.
 *
 * No secrets are read or returned here: only published release metadata and
 * the configured public URLs.
 */
const crypto = require('crypto');

const UPDATE_PLATFORMS = ['windows', 'android'];
/** A public check answers from a published AppRelease, or from the legacy env policy. */
const CACHE_SECONDS = 60;

/** Tolerant semantic-ish version parse: "1.2.3", "v1.2", "1.2.3+7". */
function parseVersionParts(value) {
  return String(value || '0')
    .split('+')[0] // build metadata is not part of the ordering
    .split('.')
    .map((part) => parseInt(String(part).replace(/[^0-9]/g, ''), 10) || 0);
}

/** Returns -1, 0 or 1 (same ordering the old appController used). */
function compareVersions(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** Build/versionCode comparison; missing values count as 0. */
function compareBuilds(a, b) {
  const left = Number(a) || 0;
  const right = Number(b) || 0;
  if (left > right) return 1;
  if (left < right) return -1;
  return 0;
}

function cleanVersion(value) {
  const text = String(value ?? '').trim().slice(0, 40);
  return /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/.test(text) ? text : '';
}

function cleanBuild(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

/** The anonymous install id is a random UUID-ish token; anything else is ignored. */
function cleanInstallId(value) {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(text) ? text : '';
}

/** Legacy release policy from the environment (pre-AppRelease deployments). */
function envPolicy() {
  return {
    version: String(process.env.APP_LATEST_VERSION || '').slice(0, 40),
    versionCode: 0,
    fileUrl: String(process.env.APP_UPDATE_URL || '').slice(0, 500),
    sha256: '',
    sha512: '',
    sizeBytes: 0,
    releaseNotes: String(process.env.APP_RELEASE_NOTES || '').slice(0, 4000),
    minSupportedVersion: String(process.env.APP_MIN_VERSION || '').slice(0, 40),
    forceUpdate: false,
    withdrawn: false,
    published: true,
    releasedAt: process.env.APP_RELEASED_AT || null,
  };
}

/* ----------------------------------------------------------------- domain */

function hostOf(rawUrl) {
  try {
    return new URL(String(rawUrl)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Our own hosts: the frontend, the API and any host listed in
 * APP_DOWNLOAD_HOSTS. Env-configured hosts are trusted; absolute download URLs
 * pointing anywhere else are withheld.
 */
function allowedHosts() {
  const hosts = new Set();
  const urls = [
    process.env.CLIENT_URL,
    process.env.SITE_URL,
    process.env.PUBLIC_URL,
    process.env.APP_PUBLIC_BASE_URL,
    process.env.APP_UPDATE_URL,
    process.env.APP_DOWNLOAD_BASE_URL,
  ];
  for (const url of urls) {
    const host = hostOf(url);
    if (host) hosts.add(host);
  }
  for (const entry of String(process.env.APP_DOWNLOAD_HOSTS || '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return hosts;
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Allow http only for local development, never for a public host.
 * Returns null when the URL may be served, or a short reason when it may not.
 */
function rejectReason(parsed, allowed) {
  if (!parsed) return 'invalid-url';
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!(isDev && isLocalHost(host))) return 'not-https';
  }
  if (!allowed.has(host) && !isLocalHost(host)) return 'foreign-host';
  return null;
}

/** Public base for a site-relative file path (e.g. /downloads/app.exe). */
function publicBase(requestOrigin) {
  const configured =
    process.env.APP_PUBLIC_BASE_URL || process.env.CLIENT_URL || process.env.SITE_URL || process.env.PUBLIC_URL || '';
  const raw = String(configured || requestOrigin || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

/**
 * Resolve a release fileUrl into a download URL the device may fetch.
 * Site-relative paths are expanded against our public base; absolute URLs are
 * only accepted when https + one of our hosts. Anything else yields
 * { url: null, allowed: false, reason }.
 */
function resolveDownloadUrl(fileUrl, { requestOrigin = '' } = {}) {
  const raw = String(fileUrl || '').trim();
  if (!raw) return { url: null, allowed: false, reason: 'missing-url' };
  const allowed = allowedHosts();
  if (/^https?:\/\//i.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    let parsed = null;
    try {
      parsed = new URL(raw);
    } catch {
      return { url: null, allowed: false, reason: 'invalid-url' };
    }
    const reason = rejectReason(parsed, allowed);
    if (reason) return { url: null, allowed: false, reason };
    return { url: parsed.toString(), allowed: true, reason: null };
  }
  const base = publicBase(requestOrigin);
  if (!base) return { url: null, allowed: false, reason: 'no-public-base' };
  let parsed = null;
  try {
    parsed = new URL(raw.startsWith('/') ? raw : `/${raw}`, base);
  } catch {
    return { url: null, allowed: false, reason: 'invalid-url' };
  }
  const reason = rejectReason(parsed, allowed);
  if (reason) return { url: null, allowed: false, reason };
  return { url: parsed.toString(), allowed: true, reason: null };
}

/** Origin of the current request (https behind the proxy), for relative paths. */
function requestOrigin(req) {
  try {
    const forwarded = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwarded || req.protocol || 'https';
    const host = req.get ? req.get('host') : req.headers?.host;
    return host ? `${protocol}://${host}` : '';
  } catch {
    return '';
  }
}

/* ---------------------------------------------------------------- evaluate */

/**
 * Decide what this client should do. Rules:
 *  - a withdrawn release is never offered (and never forces an update);
 *  - a newer installed version is never told to downgrade;
 *  - below the minimum supported version ⇒ updateRequired + forceUpdate.
 */
function evaluateUpdate({ release, currentVersion = '', currentBuild = 0 }) {
  const latestVersion = String(release?.version || '');
  const versionCode = Number(release?.versionCode) || 0;
  const minSupportedVersion = String(release?.minSupportedVersion || '');
  const withdrawn = release?.withdrawn === true;
  const current = currentVersion || '0.0.0';
  // Build comparison only makes sense when the release publishes a versionCode.
  const buildNewerInstalled = versionCode > 0 && compareBuilds(currentBuild, versionCode) > 0;
  const newerInstalled = compareVersions(current, latestVersion || '0.0.0') > 0 || buildNewerInstalled;

  if (!latestVersion || withdrawn || newerInstalled) {
    return {
      latestVersion,
      versionCode,
      minSupportedVersion,
      withdrawn,
      updateAvailable: false,
      updateRequired: false,
      forceUpdate: false,
    };
  }

  const behindLatest = compareVersions(current, latestVersion) < 0;
  const belowMinimum = Boolean(minSupportedVersion) && compareVersions(current, minSupportedVersion) < 0;
  return {
    latestVersion,
    versionCode,
    minSupportedVersion,
    withdrawn,
    updateAvailable: behindLatest,
    updateRequired: belowMinimum,
    // A force flag only matters when there really is something to install.
    forceUpdate: belowMinimum || (behindLatest && release?.forceUpdate === true),
  };
}

/** The public response body. Stable for a given DB state so the ETag works. */
function buildVersionPayload({ platform, release, currentVersion, currentBuild, requestOrigin: origin = '' }) {
  const evaluation = evaluateUpdate({ release, currentVersion, currentBuild });
  const urlInfo = evaluation.withdrawn ? { url: null, allowed: false, reason: 'withdrawn' } : resolveDownloadUrl(release?.fileUrl, { requestOrigin: origin });
  return {
    platform,
    latestVersion: evaluation.latestVersion,
    versionCode: evaluation.versionCode,
    url: urlInfo.url,
    sha256: String(release?.sha256 || ''),
    sha512: String(release?.sha512 || ''),
    size: Number(release?.sizeBytes) || 0,
    notes: String(release?.releaseNotes || ''),
    releasedAt: release?.releasedAt || null,
    minSupportedVersion: evaluation.minSupportedVersion,
    forceUpdate: evaluation.forceUpdate,
    withdrawn: evaluation.withdrawn,
    updateAvailable: evaluation.updateAvailable,
    updateRequired: evaluation.updateRequired,
    yourVersion: currentVersion || '0.0.0',
    urlAllowed: urlInfo.allowed,
    ...(urlInfo.allowed ? {} : { urlWithheldReason: urlInfo.reason || 'unavailable' }),
  };
}

/** Strong-ish weak ETag from the payload; identical bodies share it. */
function buildEtag(payload) {
  const digest = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  return `W/"${digest.slice(0, 32)}"`;
}

/** If-None-Match may be a list or "*"; compare weakly. */
function etagMatches(headerValue, etag) {
  const header = String(headerValue || '').trim();
  if (!header) return false;
  if (header === '*') return true;
  const target = String(etag || '').replace(/^W\//, '');
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .some((part) => part === target);
}

/* -------------------------------------------------------------- rate limit */

/**
 * Public update checks are cacheable (60 s) and cheap, so the limit is generous:
 * a device checks roughly once a day, plus retries on failed downloads.
 * `limit` overrides the default for tests; env can disable it for local staging.
 */
function createVersionLimiter({ limit = 120, windowMs = 10 * 60 * 1000 } = {}) {
  const expressRateLimit = require('express-rate-limit');
  return expressRateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.APP_VERSION_RATE_LIMIT_DISABLED === 'true',
    message: { message: 'Too many update checks. Try again in a few minutes.' },
  });
}

module.exports = {
  UPDATE_PLATFORMS,
  CACHE_SECONDS,
  compareVersions,
  compareBuilds,
  cleanVersion,
  cleanBuild,
  cleanInstallId,
  envPolicy,
  hostOf,
  allowedHosts,
  resolveDownloadUrl,
  requestOrigin,
  evaluateUpdate,
  buildVersionPayload,
  buildEtag,
  etagMatches,
  createVersionLimiter,
};
