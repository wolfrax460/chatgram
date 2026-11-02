/**
 * One source of the site address for everything the landing build generates.
 *
 * The site is moving to SITE_URL_NEW but the domain is not attached to Vercel
 * yet, so the build keeps emitting SITE_URL_OLD unless SITE_URL is set. That
 * means the default build is still correct on the current host, and the cutover
 * is one environment variable:
 *
 *   SITE_URL=https://chatgram.qd.je npm run build --prefix client/landing
 *
 * Used by scripts/build.mjs for canonical/hreflang/OG/Twitter URLs, JSON-LD,
 * sitemap.xml, robots.txt and the Android APK QR code.
 */

/** The host everything runs on today (and keeps working).
 *
 * NOTE: this literal is also the fallback inside apps/web (share links,
 * mediaPermissions copy) via `import.meta.env.VITE_SITE_URL`, so keep the two
 * values in sync until the cutover is finished.
 */
export const SITE_URL_OLD = 'https://chatgram-xi.vercel.app';

/** The new home. Only becomes canonical after DNS + Vercel domain + TLS work. */
export const SITE_URL_NEW = 'https://chatgram.qd.je';

/**
 * Resolve the origin for this build.
 *
 * @param {string | undefined} raw - process.env.SITE_URL (optional)
 * @returns {string} https origin without a trailing slash, query or hash
 */
export function resolveSiteUrl(raw = process.env.SITE_URL) {
  const candidate = (raw ?? '').trim() || SITE_URL_OLD;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`SITE_URL is not a valid URL: ${candidate}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`SITE_URL must use https:// (got ${candidate})`);
  if (parsed.search || parsed.hash) throw new Error('SITE_URL must not contain a query string or hash');
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}
