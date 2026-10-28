/**
 * Shared data for the static Chatgram landing site.
 *
 * Everything here is used by scripts/build.mjs to render real HTML. The origin
 * comes from the SITE_URL environment variable at build time (see build.mjs),
 * so nothing in this file is tied to a deployment domain.
 */

export const SITE = {
  name: 'Chatgram',
  defaultUrl: 'https://chatgram-xi.vercel.app',
  appPath: '/web/',
  legalPath: '/docs/',
  brandColor: '#008069',
  darkColor: '#0b141a',
};

/** The four language versions of the marketing site. */
export const LANGUAGES = [
  { code: 'en', htmlLang: 'en', path: '/', label: 'English', nativeLabel: 'English', ogLocale: 'en_US' },
  { code: 'rw', htmlLang: 'rw', path: '/rw/', label: 'Kinyarwanda', nativeLabel: 'Ikinyarwanda', ogLocale: 'rw_RW' },
  { code: 'fr', htmlLang: 'fr', path: '/fr/', label: 'Français', nativeLabel: 'Français', ogLocale: 'fr_FR' },
  { code: 'sw', htmlLang: 'sw', path: '/sw/', label: 'Kiswahili', nativeLabel: 'Kiswahili', ogLocale: 'sw_KE' },
];

/**
 * Real screenshots of the current web build. The legacy `landing-*.png` files are
 * kept for backwards compatibility (the existing Playwright landing spec fetches
 * those exact URLs); the site itself uses the descriptive names below.
 */
export const SCREENSHOTS = {
  chats: {
    png: '/assets/chatgram-app-chats-dark.png',
    webp760: '/assets/chatgram-app-chats-dark-760.webp',
    webp1366: '/assets/chatgram-app-chats-dark-1366.webp',
    width: 1366,
    height: 860,
  },
  conversation: {
    png: '/assets/chatgram-app-conversation-dark.png',
    webp760: '/assets/chatgram-app-conversation-dark-760.webp',
    webp1366: '/assets/chatgram-app-conversation-dark-1366.webp',
    width: 1366,
    height: 860,
  },
  ai: {
    png: '/assets/chatgram-ai-chat-dark.png',
    webp760: '/assets/chatgram-ai-chat-dark-760.webp',
    webp1366: '/assets/chatgram-ai-chat-dark-1366.webp',
    width: 1366,
    height: 860,
  },
};

/**
 * The published builds. Sizes are the real Content-Length values served from
 * /downloads/ (checked with a HEAD request on the production domain); checksums
 * are the published SHA-256 values. The release feed (GET /api/app/releases) is
 * used at runtime to refresh version/date/notes, but a feed row that still points
 * at one of the previous builds is ignored so the page never claims a checksum
 * for the wrong file (see STALE_FEED_HASH_PREFIXES).
 */
export const RELEASES = {
  windows: {
    platform: 'windows',
    version: '1.1.3',
    fileName: 'chatgram-windows-setup.exe',
    fileUrl: '/downloads/chatgram-windows-setup.exe',
    sizeBytes: 82151571,
    sizeMB: '78.3',
    shaShort: '85365a85…61d4aa',
    shaFull: '85365a8562f37c56c4d3e87bd9e66cca5638331d22f8ebcd8c24e1207a61d4aa',
    releasedText: '27 October 2026',
    releasedISO: '2026-10-27',
    requirements: 'Windows 10 or newer, 64-bit',
  },
  android: {
    platform: 'android',
    version: '1.1.7',
    fileName: 'chatgram-android.apk',
    fileUrl: '/downloads/chatgram-android.apk',
    sizeBytes: 1589034,
    sizeMB: '1.5',
    shaShort: '0e8b5d1d…e388a8',
    shaFull: '0e8b5d1d42938883af71c8fb28e25014d958116bb2967126c599f0845ae388a8',
    releasedText: '27 October 2026',
    releasedISO: '2026-10-27',
    requirements: 'Android 7.0+ (API 24)',
  },
  web: {
    platform: 'web',
    version: '1.1.3',
    fileName: '',
    fileUrl: '/web/',
    sizeBytes: 0,
    releasedText: '27 October 2026',
    releasedISO: '2026-10-27',
  },
};

/** Feed rows that still describe the previous installers must not overwrite the
 * verified size/checksum above. These prefixes belong to the 2026-10-25 builds
 * (the broken 1.1.0 Android APK was replaced by 1.1.2, then by 1.1.3 with in-app
 * updates, on 2026-10-27). */
export const STALE_FEED_HASH_PREFIXES = ['1943d51a', 'a5891a58', '1dfe75cb', 'c9882047'];

export const OG_IMAGE = {
  path: '/assets/og-image-1200x630.png',
  width: 1200,
  height: 630,
};

/** The four static guides. Labels are translated per locale for footer links. */
export const GUIDES = [
  {
    slug: 'how-to-use-chatgram',
    path: '/guides/how-to-use-chatgram.html',
    title: 'How to use Chatgram: account, chats, groups and status',
    description:
      'Set up a Chatgram account, add contacts, send messages, create a group, post a 24-hour status and use Chatgram AI on Android, Windows or the web.',
    label: {
      en: 'How to use Chatgram',
      rw: 'Uko ukoresha Chatgram',
      fr: 'Comment utiliser Chatgram',
      sw: 'Jinsi ya kutumia Chatgram',
    },
  },
  {
    slug: 'chatgram-android-download-install',
    path: '/guides/chatgram-android-download-install.html',
    title: 'Chatgram Android download and install guide',
    description:
      'Download the Chatgram Android APK, allow installs from your browser, verify the checksum and fix the most common sideload problems.',
    label: {
      en: 'Chatgram Android download and install',
      rw: 'Gukura no gushyira Chatgram kuri Android',
      fr: 'Télécharger et installer Chatgram sur Android',
      sw: 'Kupakua na kufunga Chatgram kwenye Android',
    },
  },
  {
    slug: 'chatgram-windows-download-smartscreen',
    path: '/guides/chatgram-windows-download-smartscreen.html',
    title: 'Chatgram Windows download and SmartScreen help',
    description:
      'Get the Chatgram Windows installer, get past the SmartScreen warning for this unsigned build, verify the file hash and keep it up to date.',
    label: {
      en: 'Chatgram Windows download and SmartScreen',
      rw: 'Gukura Chatgram kuri Windows na SmartScreen',
      fr: 'Télécharger Chatgram pour Windows et SmartScreen',
      sw: 'Kupakua Chatgram kwenye Windows na SmartScreen',
    },
  },
  {
    slug: 'chatgram-ai-four-languages',
    path: '/guides/chatgram-ai-four-languages.html',
    title: 'Chatgram AI: what it can do in four languages',
    description:
      'What Chatgram AI can do in English, Kinyarwanda, French and Swahili: questions, writing help, translations and summaries, plus its real limits.',
    label: {
      en: 'Chatgram AI in English, Kinyarwanda, French and Swahili',
      rw: 'Chatgram AI mu Cyongereza, Ikinyarwanda, Igifaransa n\'Ikiswahili',
      fr: 'Chatgram AI en anglais, kinyarwanda, français et swahili',
      sw: 'Chatgram AI kwa Kiingereza, Kinyarwanda, Kifaransa na Kiswahili',
    },
  },
];

export const guideByPath = new Map(GUIDES.map((g) => [g.path, g]));
