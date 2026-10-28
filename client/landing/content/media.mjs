/**
 * Media shared by every language version of the landing page.
 *
 * The files are real assets that live under public/assets and are produced by
 * scripts/make-assets.py:
 *
 *   chatgram-icon.svg - the same app mark the web app ships
 *                       (copied from apps/web/public/chatgram-icon.svg)
 *   chatgram-app-*.png/webp - real screenshots of the current web build, used in
 *                       the hero, preview and messaging sections (their paths and
 *                       dimensions live in content/site.mjs SCREENSHOTS)
 *
 * Keeping the icon paths here lets the templates reference one source.
 */
export const ICON = {
  svg: '/assets/chatgram-icon.svg',
  png192: '/assets/icon-192.png',
  png512: '/assets/icon-512.png',
};
