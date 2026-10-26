/** English landing page copy (served at "/"). */
export default {
  code: 'en',
  meta: {
    // 51 characters
    title: 'Chatgram: Free Messaging App for Android & Windows',
    // 128 characters
    description:
      'Chatgram is a free messaging app for Android, Windows and the web, with groups, 24-hour status, voice and video calls and Chatgram AI.',
    ogImageAlt:
      'Chatgram app icon next to a Chatgram AI conversation, with the words free messaging app for Android, Windows and the web',
  },
  ui: {
    skipToContent: 'Skip to content',
    mainNavigation: 'Main navigation',
    languageLabel: 'Language',
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
    lead: 'Chatgram keeps you close to the people who matter: real-time chat, voice notes, photos, groups, 24-hour status, voice and video calls, and Chatgram AI for questions and writing help. One account everywhere, and the app speaks English, Kinyarwanda, French and Swahili — with Rwandan +250 numbers working in contacts and account settings.',
    ctaPrimary: { label: 'Open Chatgram in your browser', href: '/web/' },
    ctaSecondary: { label: 'Download the app', href: '#download' },
    platformAndroid: 'Android',
    platformWindows: 'Windows',
    platformWeb: 'Web — no install',
  },
  facts: [
    { title: '3 platforms', sub: 'Android, Windows and web' },
    { title: 'Two-step verification', sub: 'Authenticator app + recovery codes' },
    { title: 'Privacy per contact', sub: 'You decide what each person sees' },
    { title: 'No adverts, no tracking', sub: 'Your conversations are not the product' },
  ],
  nav: {
    links: [
      { href: '#features', label: 'Features' },
      { href: '#preview', label: 'Preview' },
      { href: '#security', label: 'Privacy' },
      { href: '#download', label: 'Downloads' },
      { href: '#whats-new', label: "What's new" },
      { href: '#faq', label: 'FAQ' },
    ],
  },
  features: {
    eyebrow: 'Features',
    title: 'Everything you need to stay in touch',
    lead: 'Every item below is live in the app today — not a someday list.',
    items: [
      {
        title: 'Real-time chat',
        body: 'Messages arrive the instant they are sent, with delivery and read receipts, typing indicators and sending that recovers from a dropped connection.',
      },
      {
        title: 'Groups with real tools',
        body: 'Group photo, admins and permissions, join-request approval, revocable invite links, pinned messages and @mentions.',
      },
      {
        title: 'Voice and video calls',
        body: 'Call one person or a whole group — voice or video, up to 20 people at once, with mute, camera toggle, screen share and a call timer.',
      },
      {
        title: 'Photos, video, voice notes and files',
        body: 'Send images, video, documents and recorded voice notes. Media opens full-screen and uploads show real progress with retry.',
      },
      {
        title: '24-hour status',
        body: 'Share a photo, video or voice status that disappears after a day, and see exactly who viewed it.',
      },
      {
        title: 'Chatgram AI',
        body: 'Chatgram AI sits at the top of your chat list like any contact: ask anything in English, Kinyarwanda, French or Swahili, get streamed answers, rate them or start a new conversation.',
      },
      {
        title: 'Two-step verification',
        body: 'Protect your account with an authenticator app and ten single-use recovery codes, and change your password from Settings.',
      },
      {
        title: 'Windows and Android apps',
        body: 'Install Chatgram for Windows (tray, taskbar badge, auto-update) or sideload the Android APK — the same account and the same chats as the browser.',
      },
    ],
  },
  preview: {
    eyebrow: 'Preview',
    title: 'Take a look inside',
    lead: 'The same app on every platform, designed to feel familiar from the first tap.',
    shots: [
      {
        shot: 'chats',
        alt: 'Chatgram in dark mode showing the chat list with the pinned Chatgram AI row, a group and unread badges',
        caption: 'Your conversations, with Chatgram AI on top',
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
        title: 'Block, mute and report',
        body: 'Blocked accounts cannot message or call you. Reports reach a real inbox, not a void.',
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
        'This is a direct-download build, not a Play Store release.',
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
        body: 'Tap a contact to say hello. Send photos and voice notes, or create a group to talk to several people at once.',
      },
    ],
  },
  whatsNew: {
    eyebrow: "What's new",
    title: 'Release notes',
    lead: 'Everything that shipped in the current version.',
    platformLabels: { windows: 'Windows', android: 'Android', web: 'Web' },
    releases: [
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
      {
        platform: 'windows',
        version: '1.1.0',
        date: '25 October 2026',
        items: [
          'Desktop app with tray, taskbar badge and auto-update from /downloads',
          'Start-on-login and native notifications',
          'Unsigned build — see the SmartScreen guide before installing',
        ],
      },
      {
        platform: 'android',
        version: '1.1.0',
        date: '25 October 2026',
        items: [
          'First direct-download Android build (debug-signed, sideload only)',
          'Application id app.chatgram.android, Android 7.0 or newer',
          'Camera and microphone permission only when a call or voice note needs them',
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
        a: 'Use the Downloads section on this page: “Download for Windows” gives you the 78 MB installer and “Download APK” gives you the 3.9 MB Android build. Both links point at the current files published under /downloads/.',
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
        a: 'Chatgram AI answers questions, helps with writing and translates between English, Kinyarwanda, French and Swahili. It can make mistakes, and answers are processed by a third-party AI provider.',
      },
      {
        q: 'Are my messages end-to-end encrypted?',
        a: 'Not yet. Messages are encrypted in transit (HTTPS/WSS) and stored on the server, but the server can read them. End-to-end encryption is the top item on the roadmap.',
      },
      {
        q: 'Can I make calls?',
        a: 'Yes — voice and video calls are built in. Tap the phone or video icon in a chat header. Direct chats call one person; group calls can include up to 20 people at once.',
      },
    ],
    guidesTitle: 'Step-by-step guides',
  },
  footer: {
    tagline: 'Simple, reliable messaging on every device you use.',
    productTitle: 'Product',
    product: [
      { href: '#features', label: 'Features' },
      { href: '#preview', label: 'Preview' },
      { href: '#download', label: 'Downloads' },
      { href: '/web/', label: 'Open the web app' },
    ],
    helpTitle: 'Help',
    help: [
      { href: '#how', label: 'Getting started' },
      { href: '#faq', label: 'FAQ' },
    ],
    guidesTitle: 'Guides',
    legalTitle: 'Legal',
    legal: [{ href: '/docs/', label: 'Terms & Privacy' }],
    languageTitle: 'Language',
    bottom: '© {year} Chatgram. All rights reserved.',
    stack: 'Chatgram for Android · Windows · the web',
  },
};
