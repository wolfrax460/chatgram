/** English landing page copy (served at "/"). */
export default {
  code: 'en',
  meta: {
    // 51 characters
    title: 'Chatgram: Free Messaging App for Android & Windows',
    // 136 characters
    description:
      'Chatgram is a free messaging app for Android, Windows and the web, with groups, 24-hour status, voice and video calls and Chatgram AI.',
    ogImageAlt:
      'Chatgram app icon next to a Chatgram AI conversation, with the words free messaging app for Android, Windows and the web',
  },
  ui: {
    skipToContent: 'Skip to content',
    mainNavigation: 'Main navigation',
    downloadLabel: 'Chatgram downloads',
    toggleMenu: 'Toggle menu',
    themeGroup: 'Colour theme',
    themeLight: 'Light theme',
    themeDark: 'Dark theme',
    themeSystem: 'System theme',
    openApp: 'Open Chatgram',
  },
  hero: {
    badge: 'Free · No adverts · One account everywhere',
    h1: 'Chatgram: the <em>free messaging app</em> for Android, Windows and the web',
    lead: 'Chatgram keeps you close to the people who matter: real-time chat with voice notes and media, groups with join requests, 24-hour status, voice and video calls, and Chatgram AI for questions and writing help. One account everywhere, in English, Kinyarwanda, French and Swahili.',
    ctaPrimary: { label: 'Open Chatgram in your browser', href: '/web/' },
    ctaSecondary: { label: 'Download the app', href: '#download' },
    ctaWeb: 'Open web app',
    platformAndroid: 'Android',
    platformWindows: 'Windows',
    platformWeb: 'Web — no install',
  },
  facts: [
    { title: 'Calls built in', sub: 'Voice, video and screen share' },
    { title: 'Four languages', sub: 'English, Kinyarwanda, French, Swahili' },
    { title: 'Two-step verification', sub: 'Authenticator app + recovery codes' },
    { title: 'No adverts, no tracking', sub: 'Your conversations are not the product' },
  ],
  nav: {
    links: [
      { href: '#features', label: 'Features' },
      { href: '#calls', label: 'Calls' },
      { href: '#preview', label: 'Preview' },
      { href: '#security', label: 'Privacy' },
      { href: '#download', label: 'Downloads' },
      { href: '#faq', label: 'FAQ' },
    ],
  },
  features: {
    eyebrow: 'Features',
    title: 'Everything you need to stay in touch',
    lead: 'Every item below is live in the app today — not a someday list.',
    items: [
      {
        title: 'Messaging, in detail',
        body: 'Real-time messages with delivery and read receipts, voice notes, photos and files, replies, edits, stars, search and pinned group messages.',
      },
      {
        title: 'Calls that fit the moment',
        body: 'One-to-one and group calls, voice or video, with screen share, mute, camera control and a live timer. Group calls hold up to 12 people, 6 of them on camera.',
      },
      {
        title: 'Status that tells you who saw',
        body: 'Share a photo, video or voice status that disappears after 24 hours — and see exactly who viewed it, newest first.',
      },
      {
        title: 'Groups with real controls',
        body: 'Group photo, admins and permissions, join-request approval, invite links, pinned messages and @mentions.',
      },
      {
        title: 'Chatgram AI, as a normal chat',
        body: 'Chatgram AI sits in your chat list like any contact: ask anything in English, Kinyarwanda, French or Swahili, get streamed answers, rate them, or mention @Chatgram AI in a group.',
      },
      {
        title: 'Notifications that arrive',
        body: 'Android and Windows notifications with the real permission state, a test notification, separate message and call channels, and a do-not-disturb schedule.',
      },
      {
        title: 'Privacy you can switch',
        body: 'Two-step verification with recovery codes, sessions you can sign out, per-person privacy switches and optional read receipts. Messages are encrypted in transit — not end-to-end, and the page says so.',
      },
      {
        title: 'Windows and Android apps',
        body: 'Both apps update themselves: Android checks for a newer APK, downloads it, verifies the checksum and asks you to install; Windows checks in the background and restarts to update.',
      },
    ],
  },
  calls: {
    eyebrow: 'Calls',
    title: 'Calls that work — and tell you when they do not',
    lead: 'Voice or video, one person or a whole group, on all three platforms. The call screen shows what is actually happening instead of leaving you guessing.',
    items: [
      {
        title: 'One-to-one and group',
        body: 'Call a contact from the chat header or start a group call. A group call holds up to 12 people; the first 6 can use video and everyone else joins with audio.',
      },
      {
        title: 'Audio and video',
        body: 'Start voice or video, mute the microphone, turn the camera off, and switch between earpiece, speaker and Bluetooth on Android.',
      },
      {
        title: 'Screen share',
        body: 'Share a window or tab during a call where the browser or desktop app allows it, with a clear sharing bar on the receiving side.',
      },
      {
        title: 'TURN relay for difficult networks',
        body: 'Chatgram mints short-lived TURN credentials for calls that cannot connect directly, so strict NATs and mobile networks have a relay fallback. If a relay cannot be reached, the diagnostics say so.',
      },
      {
        title: 'Diagnostics and a “no media” retry',
        body: 'The call screen reports the ICE state, the candidate pair, whether a relay is configured, bytes in and out and how many remote tracks are playing. When no media arrives, Chatgram retries the connection and shows the reason.',
      },
    ],
    note: 'Calls are peer-to-peer with a TURN relay fallback. Quality depends on both networks — the diagnostics exist so a bad call can be explained instead of guessed at.',
  },
  messaging: {
    eyebrow: 'Messaging',
    title: 'The small things that make chat feel right',
    lead: 'The same conversation on every device, with the controls you reach for every day.',
    items: [
      {
        title: 'Voice notes',
        body: 'Record a voice note in one tap and send it; it plays back inline with its duration.',
      },
      {
        title: 'Replies, edits and deletes',
        body: 'Reply to one specific message, edit your own text with an “edited” label, delete for yourself or delete for everyone.',
      },
      {
        title: 'Stars and pins',
        body: 'Star messages you want to find again, and pin one important message to the top of a group.',
      },
      {
        title: 'Search and shared media',
        body: 'Search your chats and open the photos, videos and links from a conversation in one place.',
      },
      {
        title: 'Photos, video and files',
        body: 'Send images, video and documents with real upload progress and a retry that keeps the file.',
      },
    ],
    note: 'Read receipts and delivery ticks are part of the conversation — and you can turn read receipts off.',
  },
  preview: {
    eyebrow: 'Preview',
    title: 'Take a look inside',
    lead: 'The same app on every platform, designed to feel familiar from the first tap.',
    shots: [
      {
        shot: 'chats',
        alt: 'Chatgram in dark mode showing the chat list with a group, contacts and unread badges',
        caption: 'Your conversations, with Chatgram AI in the list',
      },
      {
        shot: 'conversation',
        alt: 'A Chatgram conversation in dark mode showing sent messages with delivery and read ticks',
        caption: 'Live chat with delivery and read ticks',
      },
    ],
    wide: {
      shot: 'ai',
      alt: 'Chatgram AI open as a normal conversation inside the Chatgram app',
      caption: 'Chatgram AI is just another conversation',
    },
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Your conversations stay yours',
    lead: 'Practical privacy you can see and control — not marketing language.',
    items: [
      {
        title: 'Encrypted in transit',
        body: 'Every request and every socket runs over HTTPS and WSS with a valid TLS certificate, renewed automatically.',
      },
      {
        title: 'Two-step verification',
        body: 'Add an authenticator app to your account, with ten single-use recovery codes in case you lose the phone.',
      },
      {
        title: 'Privacy, per person',
        body: 'Online status, last seen, photo, about, phone and email are each yours to switch off — and read receipts are optional.',
      },
      {
        title: 'Sessions you control',
        body: 'See every signed-in device and sign out the others in one tap. Changing your password signs them out for you.',
      },
      {
        title: 'Reports reach a real person',
        body: 'Reports land in an admin inbox, and reported content can be reviewed by authorised team members. Every admin action is written to an audit log, and blocked accounts cannot message or call you.',
      },
      {
        title: 'Guarded on the server',
        body: 'Chat, role and privacy rules are enforced server-side, never trusted from the app. Logins are rate limited and repeated failures lock the account temporarily.',
      },
    ],
    note: 'Messages are encrypted in transit and stored on the server, so the server can read them. End-to-end encryption is the top item on the roadmap — we will not claim it before it ships.',
  },
  downloads: {
    eyebrow: 'Download',
    title: 'Download Chatgram for Android, Windows or the web',
    lead: 'One account works across all three. Start on your phone, continue on your PC.',
    stripLabel: 'Current published builds',
    versionLabel: 'Version',
    sizeLabel: 'Size',
    releasedLabel: 'Released',
    fileLabel: 'File',
    shaLabel: 'SHA-256',
    requiresLabel: 'Requires',
    bytesSuffix: 'bytes',
    checksumNote: 'Checksums identify the exact published file — compare the full value before you install.',
    cachedNote:
      'Showing the last published build while the release feed is unreachable. Check the version below before installing.',
    windows: {
      label: 'Windows',
      title: 'Chatgram for Windows',
      meta: 'Installer · Unsigned',
      cta: 'Download for Windows',
      note: 'If Windows SmartScreen warns you, choose “More info” then “Run anyway”.',
      alt: 'Windows 10 or newer, 64-bit · updates itself from /downloads.',
      steps: [
        'Download and run the installer.',
        'SmartScreen may warn because the build is unsigned — click “More info” → “Run anyway”.',
        'Verify the file with Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256.',
        'Chatgram starts and stays in the tray when closed; future updates install automatically.',
      ],
    },
    android: {
      label: 'Android',
      title: 'Chatgram for Android',
      meta: 'APK · Debug-signed',
      cta: 'Download APK',
      note: 'Allow “Install unknown apps” for your browser or Files app when Android asks.',
      alt: 'Sideload only · camera and microphone are requested only when a call or voice note needs them.',
      steps: [
        'Download the APK, then allow “Install unknown apps” for your browser or Files app.',
        'Open the file, install it and launch Chatgram.',
        'This is a direct-download build, not a Play Store release. Chatgram updates itself afterwards.',
      ],
      qrAlt: 'QR code that opens the Chatgram Android APK download',
      qrCaption: 'Scan to install',
    },
    web: {
      label: 'Web',
      title: 'Chatgram in your browser',
      meta: 'No install · Any modern browser',
      body: 'The same account and the same chats — open the web app in any modern browser. Nothing to download.',
      cta: 'Open in browser',
      alt: 'Chrome, Edge, Firefox or Safari.',
      steps: ['Open Chatgram in this browser.', 'Sign in with the same account you use on your phone or PC.'],
    },
  },
  steps: {
    eyebrow: 'Getting started',
    title: 'Up and running in three steps',
    lead: 'From first launch to your first message in under a minute.',
    items: [
      {
        title: 'Create your account',
        body: 'Sign up with your email address, or continue with Google. We send a 6-digit code to confirm it is really you.',
      },
      {
        title: 'Add your contacts',
        body: 'Search for someone by name, email or phone number and add them. Your contact list stays private to you.',
      },
      {
        title: 'Start chatting',
        body: 'Tap a contact to say hello, send a photo or voice note, start a group, or call them — voice or video.',
      },
    ],
  },
  whatsNew: {
    eyebrow: "What's new",
    title: 'Release notes',
    lead: 'Everything that shipped in the current versions.',
    platformLabels: { windows: 'Windows', android: 'Android', web: 'Web' },
    releases: [
      {
        platform: 'android',
        version: '1.1.7',
        date: '27 October 2026',
        items: [
          'Push notifications through Firebase Cloud Messaging (FCM): messages and calls now arrive even when Chatgram is closed or in the background.',
          'Full-screen incoming call: an incoming call wakes the screen with a full-screen Answer / Decline screen (including on the lock screen) instead of a small banner.',
          'Call diagnostics: a new diagnostics screen records connection quality, the ICE/relay path and the failure reason, so a dropped or silent call can be investigated.',
        ],
      },
      {
        platform: 'windows',
        version: '1.1.2',
        date: '27 October 2026',
        items: [
          'Notification settings that show the real Windows notification state, with a one-click shortcut to the Windows notification settings page.',
          'Incoming-call alert: a Windows toast plus a tray alert announces an incoming call, and clicking it brings Chatgram to the front.',
          'Ships the current web client: Chatgram AI as a standard conversation, group AI mentions, statuses and the admin dashboard features.',
        ],
      },
      {
        platform: 'android',
        version: '1.1.6',
        date: '27 October 2026',
        items: [
          'Notification settings that show the real permission state, open the Android notification settings and send a test notification',
          'A battery-optimisation prompt, so Android stops delaying background notifications',
          'A ringtone call channel and a native speaker / earpiece / Bluetooth switch for calls',
          'Calls: the other person\x27s video starts by itself (an avatar shows instead of a play button), "Calling…" becomes the timer once someone joins, and the incoming screen shows who is calling',
        ],
      },
      {
        platform: 'android',
        version: '1.1.5',
        date: '27 October 2026',
        items: [
          'In-app updates: Chatgram checks for a newer APK, downloads it over Wi-Fi or mobile data (whichever is available), verifies the checksum and offers "Update ready: tap to install"',
          'An update-required screen when the installed version is no longer supported',
          'No silent installs: Android asks for the installer approval once, and nothing installs without a tap',
        ],
      },
      {
        platform: 'windows',
        version: '1.1.1',
        date: '27 October 2026',
        items: [
          'Desktop app with tray, taskbar badge and auto-update from /downloads',
          'Start-on-login and native notifications',
          'Background update downloads with a "Restart to install" prompt; updates install on quit',
          'A blocking update screen when a version is forced or below the minimum',
          'Unsigned build — see the SmartScreen guide before installing',
        ],
      },
      {
        platform: 'android',
        version: '1.1.2',
        date: '27 October 2026',
        items: [
          'Fixed the crash on launch ("Chatgram keeps stopping") — the launcher class and the packaged config now match',
          'Smaller optimised build with the same signing key, so it installs in place over 1.1.0',
          'The keyboard no longer covers the message box, and a friendly offline page explains when the server cannot be reached',
        ],
      },
      {
        platform: 'web',
        version: '1.1.0',
        date: '25 October 2026',
        items: [
          'Chatgram AI as a standard conversation, plus group @Chatgram AI mentions',
          'Voice and video calls for one-to-one and group chats',
          'Moderation tools, data requests and an admin dashboard',
        ],
      },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Chatgram questions, answered',
    lead: 'If your question is not answered here, ask in the app and we will add it.',
    items: [
      {
        q: 'Is Chatgram free?',
        a: 'Yes. There are no adverts, subscriptions or in-app purchases, and no premium tier.',
      },
      {
        q: 'Do I need a separate account for each device?',
        a: 'No. One account works on Android, Windows and the web. Sign in with the same email on every device and your chats are already there.',
      },
      {
        q: 'How do I download the Chatgram app?',
        a: 'Use the Downloads section on this page: “Download for Windows” gives you the installer and “Download APK” gives you the Android build. Both links point at the current files published under /downloads/, and the cards list the exact version, size and SHA-256.',
      },
      {
        q: 'Is Chatgram available in Rwanda?',
        a: 'Yes. Chatgram runs on any Android phone or Windows PC, supports English, Kinyarwanda, French and Swahili, and works with Rwandan +250 phone numbers in contacts and account settings.',
      },
      {
        q: 'How do I install the Android app?',
        a: 'Download the APK, open it, and allow “Install unknown apps” for your browser or file manager when Android asks. Chatgram is not distributed through the Play Store yet, so this is expected. The full steps are in the Android download and install guide.',
      },
      {
        q: 'Windows shows a warning when I start the app. Is that normal?',
        a: 'Yes. The installer is not code-signed yet, so Windows SmartScreen may warn you the first time. Choose “More info” then “Run anyway”. The Windows download and SmartScreen guide has the exact steps and how to verify the file.',
      },
      {
        q: 'What is Chatgram AI and which languages does it speak?',
        a: 'Chatgram AI answers questions, helps with writing and translates between English, Kinyarwanda, French and Swahili. It appears in your chat list like any other contact, and in a group you can mention @Chatgram AI. It can make mistakes, and answers are processed by a third-party AI provider.',
      },
      {
        q: 'Do notifications work when the app is closed?',
        a: 'On Android 1.1.7 and newer, messages and calls arrive through Firebase Cloud Messaging even when Chatgram is closed or in the background. On Windows, the desktop app shows notifications while it is running, including from the tray.',
      },
      {
        q: 'Are my messages end-to-end encrypted?',
        a: 'Not yet. Messages are encrypted in transit (HTTPS/WSS) and stored on the server, but the server can read them. End-to-end encryption is the top item on the roadmap.',
      },
      {
        q: 'Can I make calls?',
        a: 'Yes — voice and video calls are built in. Tap the phone or video icon in a chat header. Direct chats call one person; group calls can include up to 12 people at once, with video for the first 6.',
      },
    ],
    guidesTitle: 'Step-by-step guides',
  },
  footer: {
    tagline: 'Simple, reliable messaging on every device you use.',
    productTitle: 'Product',
    product: [
      { href: '#features', label: 'Features' },
      { href: '#calls', label: 'Calls' },
      { href: '#preview', label: 'Preview' },
      { href: '#download', label: 'Downloads' },
      { href: '/web/', label: 'Open the web app' },
    ],
    helpTitle: 'Help',
    help: [
      { href: '#how', label: 'Getting started' },
      { href: '#whats-new', label: "What's new" },
      { href: '#faq', label: 'FAQ' },
    ],
    guidesTitle: 'Guides',
    legalTitle: 'Legal',
    legal: [{ href: '/docs/', label: 'Terms & Privacy' }],
    bottom: '© {year} Chatgram. All rights reserved.',
    stack: 'Chatgram for Android · Windows · the web',
  },
};
