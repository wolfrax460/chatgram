/**
 * Media shared by every language version of the landing page.
 *
 * The files are real assets that live under public/assets and are produced by
 * scripts/make-assets.py:
 *
 *   chatgram-icon.svg - the same app mark the web app ships
 *                       (copied from apps/web/public/chatgram-icon.svg)
 *   chatgram-app-*.png/webp - real screenshots of the current web build, used in
 *                       the preview and messaging sections (paths and dimensions
 *                       live in content/site.mjs SCREENSHOTS)
 *   chatgram-phone-*.webp - phone-sized crops of the two real phone-portrait
 *                       captures (web-chat-list.png, web-conversation.png), used
 *                       by the hero phone mockup.
 *
 * Keeping the paths here lets the templates reference one source.
 */
export const ICON = {
  svg: '/assets/chatgram-icon.svg',
  png192: '/assets/icon-192.png',
  png512: '/assets/icon-512.png',
};

/**
 * The hero phone mockup only uses captures that really exist in the repo as
 * portrait phone screenshots. There are exactly two of those; the desktop
 * screenshots (1366x860) stay in the preview section further down the page.
 */
export const PHONE_SCREENS = {
  chats: {
    png: '/assets/web-chat-list.png',
    webp430: '/assets/chatgram-phone-chats-430.webp',
    webp860: '/assets/chatgram-phone-chats-860.webp',
    width: 1290,
    height: 2796,
  },
  conversation: {
    png: '/assets/web-conversation.png',
    webp430: '/assets/chatgram-phone-conversation-430.webp',
    webp860: '/assets/chatgram-phone-conversation-860.webp',
    width: 1290,
    height: 2796,
  },
};
