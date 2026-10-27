/**
 * Media shared by every language version of the landing page.
 *
 * The files are real assets that live under public/assets and are produced by
 * scripts/make-assets.py:
 *
 *   chatgram-icon.svg  - the same app mark the web app ships
 *                        (copied from apps/web/public/chatgram-icon.svg)
 *   people-*.jpg/webp  - illustrative photos of people using a phone, resized and
 *                        compressed from the project's own imagery. They are NOT
 *                        app screenshots and every figure that uses one says so.
 *
 * Keeping the dimensions here lets the templates emit width/height attributes so
 * the page does not shift while images load.
 */
export const ICON = {
  svg: '/assets/chatgram-icon.svg',
  png192: '/assets/icon-192.png',
  png512: '/assets/icon-512.png',
};

export const PHOTOS = {
  friends: {
    jpg: '/assets/people-friends-phone.jpg',
    webp: '/assets/people-friends-phone.webp',
    width: 960,
    height: 960,
  },
  duo: {
    jpg: '/assets/people-two-friends.jpg',
    webp: '/assets/people-two-friends.webp',
    width: 860,
    height: 860,
  },
};
