/**
 * English long-form content pages. Consumed by scripts/build.mjs and rendered by
 * scripts/templates.mjs::renderContentPage. The other languages mirror this file
 * key for key (pages.rw.mjs, pages.fr.mjs, pages.sw.mjs).
 *
 * Every fact here is checked against the shipped app or the public releases page.
 * No invented numbers, ratings or roadmap promises.
 */
export const PAGES = {
  about: {
    slug: 'about',
    title: 'About Chatgram: the messaging app built in Rwanda',
    description:
      'Chatgram is a free messaging app built in Rwanda for Android, Windows and the web, in English, Kinyarwanda, French and Swahili.',
    h1: 'Chatgram is a messaging app built in Rwanda',
    updated: '3 November 2026',
    intro:
      'Chatgram is a messaging app for Android, Windows and the web. It was built in Rwanda for people who want a straightforward chat app that speaks their language and runs on the phone they already own. This page explains what Chatgram does today, which platforms it supports, what it costs and what is still missing.',
    sections: [
      {
        h2: 'What Chatgram is',
        html: `<p>Chatgram is a single app with one account that works across three platforms: an Android app you install from an APK, a Windows desktop app you install from an installer, and a web app that runs in the browser with nothing to install. Sign in with the same email on each device and your chats, groups and status updates are already there.</p>
<p>It is not a social network. There is no feed, no follower count and no public profile to maintain. You talk to people you know, one at a time or in a group, and the conversations stay between you and them.</p>`,
      },
      {
        h2: 'Who it is for',
        html: `<p>Chatgram is made for everyday use in Rwanda and the wider East African region: phones with limited storage, data bundles that have to last the month, and conversations that mix Kinyarwanda, French, Swahili and English in the same group.</p>
<p>Because of that, the app is small, the interface runs in all four languages, and the Android build is under two megabytes. It works on Android 7.0 and newer, which covers the phones most people actually carry.</p>`,
      },
      {
        h2: 'What you can do today',
        html: `<ul>
<li>Direct chats and group chats with the usual replies, forwarding, editing and deletion.</li>
<li>Voice notes with a waveform, pause and resume, and playback speed of 1.5x or 2x.</li>
<li>Voice and video calls, including group calls with up to 12 people and video for the first six.</li>
<li>24-hour status updates that disappear on their own.</li>
<li>Chatgram AI, an assistant that answers questions and helps with writing in English, Kinyarwanda, French and Swahili. In a group you mention <strong>@Chatgram AI</strong> to include it.</li>
<li>Dark mode, four interface languages, notifications on Android through Firebase Cloud Messaging, and tray notifications on Windows.</li>
</ul>`,
      },
      {
        h2: 'What Chatgram does not do yet',
        html: `<p>Chatgram is honest about its limits, because you should know them before you type something private.</p>
<p>Messages are encrypted in transit with HTTPS and WSS, and they are stored on the server, which means the server can read them. End-to-end encryption, where only the two devices can read a message, is not implemented yet. The Windows installer is not code-signed, so Windows SmartScreen shows a warning the first time you run it. The Android app is distributed as an APK rather than through Google Play.</p>
<p>None of that makes Chatgram unusable, but none of it should be hidden from you either. If something matters, treat Chatgram the way you would treat any chat service that does not yet offer end-to-end encryption.</p>`,
      },
      {
        h2: 'How to get Chatgram',
        html: `<p>Download the <a href="/downloads/chatgram-android.apk">Android APK</a> and follow the install steps in the <a href="/guides/chatgram-android-download-install.html">Android download and install guide</a>. For Windows, the <a href="/guides/chatgram-windows-download-smartscreen.html">Windows download and SmartScreen guide</a> walks through the warning you will see the first time.</p>
<p>If you only want to try it, open the <a href="/web/">web app</a> in your browser. It is the same service with no install step. The <a href="/guides/how-to-use-chatgram.html">how to use Chatgram guide</a> covers accounts, contacts, groups, statuses and Chatgram AI in more detail.</p>`,
      },
    ],
    faq: [
      {
        q: 'Is Chatgram made in Rwanda?',
        a: 'Chatgram is built in Rwanda and designed for people in Rwanda and the wider East African region. Its interface and its AI assistant work in English, Kinyarwanda, French and Swahili.',
      },
      {
        q: 'Which devices does Chatgram run on?',
        a: 'Android 7.0 and newer through the APK, Windows 10 or newer 64-bit through the installer, and any modern browser through the web app. One account works on all three.',
      },
      {
        q: 'Is Chatgram the same as the web app?',
        a: 'Yes. The Android app, the Windows app and the web app are one service with the same account and the same chats. Choose whichever fits the device you are holding.',
      },
    ],
  },

  'is-chatgram-free': {
    slug: 'is-chatgram-free',
    title: 'Is Chatgram free? Price, ads and premium tiers',
    description:
      'Yes, Chatgram is free: no adverts, no subscriptions, no in-app purchases and no premium tier. What that covers, and what we do not promise.',
    h1: 'Chatgram is free to download and use',
    updated: '3 November 2026',
    intro:
      'People ask this before they install anything, and the answer is short: Chatgram costs nothing. There is no subscription, no premium tier, no in-app purchase and no advertising inside your chats. This page explains exactly what that means so you can decide whether to trust the answer.',
    sections: [
      {
        h2: 'What free means here',
        html: `<p>Every feature in Chatgram is available to every account. Direct and group chats, voice and video calls, group calls, 24-hour statuses, voice notes and Chatgram AI are all part of the same app, with no upgrade button and no locked screen.</p>
<p>The Android APK and the Windows installer are free to download too. You do not create an account to reach a paywall later, and you do not need a card for anything at any point.</p>`,
      },
      {
        h2: 'No adverts inside your chats',
        html: `<p>Chatgram does not put adverts between your messages, and it does not sell advertising placements in your conversation list. There are no sponsored chats, no promoted channels and no banner in the composer.</p>
<p>If that ever changed, the change would be described on this page and in the release notes before it appeared in the app.</p>`,
      },
      {
        h2: 'No subscriptions and no premium tier',
        html: `<p>There is nothing to subscribe to. Chatgram does not offer a paid plan with extra features, and there is no premium badge that changes what other people see.</p>
<p>The same is true of Chatgram AI. Asking the assistant a question does not cost anything and does not consume a credit.</p>`,
      },
      {
        h2: 'Every feature is in the free app',
        html: `<p>There is one version of Chatgram, not two. Group calls with up to twelve people, video for the first six, voice notes, statuses, Chatgram AI, dark mode and all four interface languages are in the app you download. Nothing unlocks after an invite, a purchase or a certain number of contacts.</p>
<p>Groups are not capped by price either. You can create a group for a family, a class or a work team without meeting a paid threshold, and the same goes for how many photos or voice notes you send inside a chat.</p>`,
      },
      {
        h2: 'What is not covered',
        html: `<p>Free does not mean there are no costs anywhere. Mobile data used by the app comes from your operator and is charged on your normal bundle, and the same is true for calls made over mobile data. Voice and video calls use data, so a long call uses more of it.</p>
<p>Chatgram also does not promise that the service will always be free forever. Prices and features can change. What it does promise is that any change would be written on this page and in the <a href="/whats-new/">release notes</a> rather than appearing silently.</p>`,
      },
      {
        h2: 'Where the downloads come from',
        html: `<p>The free <a href="/downloads/chatgram-android.apk">Android APK</a> and the Windows installer are published by the Chatgram team and listed with their real size and SHA-256 checksum on the home page. If a file asks you for money or comes from another site, it is not from us.</p>
<p>The <a href="/guides/chatgram-android-download-install.html">Android guide</a> and the <a href="/guides/chatgram-windows-download-smartscreen.html">Windows guide</a> explain how to check the file you downloaded.</p>`,
      },
    ],
    faq: [
      {
        q: 'Will Chatgram always be free?',
        a: 'Chatgram is free today, with no adverts, subscriptions or premium tier. Future pricing is not promised here; if anything changes it will be announced on this page and in the release notes first.',
      },
      {
        q: 'Do I need to pay for Chatgram AI?',
        a: 'No. Chatgram AI is part of the app and there are no credits, tokens or upgrades to buy. Answers are produced by a third-party AI provider and can be wrong.',
      },
      {
        q: 'Why is there no price in the app stores?',
        a: 'Because Chatgram is not in the app stores yet. The Android app is installed from an APK and the Windows app from an installer, both published directly by the Chatgram team.',
      },
    ],
  },

  'whats-new': {
    slug: 'whats-new',
    title: "What's new in Chatgram: release notes and updates",
    description:
      'Real Chatgram release notes: voice notes, replies, wallpapers, remote screen control, the Settings rebuild, account deletion and the current app versions.',
    h1: "What's new in Chatgram",
    updated: '3 November 2026',
    intro:
      'This page lists the changes that actually shipped in the Chatgram apps, newest first. It is written for the people using the app rather than for developers, so each entry says what changed and what it means for you. The current builds are Android 1.1.7, Windows 1.1.6 and web 1.1.3.',
    sections: [
      {
        h2: 'November 2026',
        html: `<p><strong>Android 1.1.7.</strong> Messages and calls now arrive as notifications even when Chatgram is closed or in the background, using Firebase Cloud Messaging. If you had to keep the app open to be reachable, that is no longer necessary.</p>
<p><strong>Windows 1.1.6.</strong> The desktop app keeps the same update path as before and now shares the same account, call and notification behaviour as the other two platforms. Notifications appear in the tray while the app is running, including when its window is closed.</p>`,
      },
      {
        h2: 'October 2026: messages and voice',
        html: `<ul>
<li>Voice notes with a real waveform, slide left to cancel, slide up to lock, pause and resume, and playback at 1.5x or 2x. Only one voice note plays at a time.</li>
<li>Reply cards with quoted replies and a preview in the composer, so a long group conversation stays readable.</li>
<li>Chat wallpapers, either per chat or for the whole app.</li>
<li>Settings rebuilt as a list of dedicated pages, so privacy, account, notifications and AI each have their own screen.</li>
</ul>`,
      },
      {
        h2: 'October 2026: calls and screens',
        html: `<ul>
<li>Remote screen control from the Windows app: while someone shares their screen, you can ask to control it. Nothing happens until the person sharing accepts.</li>
<li>Better screen-share quality during calls, with the bitrate adapting to the connection you actually have.</li>
</ul>`,
      },
      {
        h2: 'October 2026: safety and support',
        html: `<ul>
<li>Protected account deletion: you confirm with your password and a code sent to your email, and you have 14 days to cancel before the account is removed.</li>
<li>Help reports from inside the app now create a tracked issue for the team, so a problem you report is not lost in a chat message.</li>
</ul>`,
      },
      {
        h2: 'Why the web app updates differently',
        html: `<p>The web app at <a href="/web/">/web/</a> is served by the Chatgram team, so a new version arrives the next time you open it. Nothing to download, nothing to install.</p>
<p>The Android and Windows apps are installed files, so a new version arrives only when you install it. That is why the home page states the current version and checksum for each one, and why the release notes name the platform next to every change.</p>`,
      },
      {
        h2: 'How to get the current version',
        html: `<p>The <a href="/">download cards on the home page</a> always show the version, file size and SHA-256 of the files that are published right now. Install the newer Android APK over the old one, or run the newer Windows installer, and your chats stay on the server.</p>
<p>To check what you are running, open the app menu and look for the version, or read <a href="/web/version.json">version.json</a> for the web app. If you are not sure how to install an update, the <a href="/guides/chatgram-android-download-install.html">Android guide</a> and the <a href="/guides/chatgram-windows-download-smartscreen.html">Windows guide</a> both cover it.</p>`,
      },
    ],
    faq: [
      {
        q: 'How do I update the Android app?',
        a: 'Download the new APK from the home page and open it. Android installs it over the old version, and your chats, groups and statuses are still there because they live on your account, not on the phone.',
      },
      {
        q: 'How do I update the Windows app?',
        a: 'Run the current installer from the home page. Windows may warn you again because the build is not code-signed; choose More info and then Run anyway. Your chats are not affected.',
      },
      {
        q: 'Where can I see the version I have?',
        a: 'The app menu shows the version you are running. For the web app you can also open version.json, and the home page always lists the current builds for Android and Windows.',
      },
    ],
  },

  'privacy-and-safety': {
    slug: 'privacy-and-safety',
    title: 'Chatgram privacy and safety: what is protected',
    description:
      'What Chatgram protects today, what it does not protect yet, and how to use it safely: transport encryption, passwords, blocking, reporting and deletion.',
    h1: 'Chatgram privacy and safety, in plain words',
    updated: '3 November 2026',
    intro:
      'Most privacy pages tell you what you want to hear. This one tries to be exact: what Chatgram protects today, what it does not protect yet, and what you can do on your side. If something here matters to you, read it before you send a message you would not want a server operator to see.',
    sections: [
      {
        h2: 'What is protected today',
        html: `<p>Traffic between your device and the Chatgram server is encrypted in transit with HTTPS, and realtime traffic uses WSS. Someone on the same network cannot read your messages by watching the connection.</p>
<p>Your account is protected by your password, and deleting the account is a deliberate process: you confirm with your password plus a code sent to your email, and you have 14 days to cancel before the account and its data are removed.</p>`,
      },
      {
        h2: 'What is not protected yet',
        html: `<p>Messages are stored on the server, and the server can read them. That is how the service is built today: it is not end-to-end encrypted, so there is no promise that only your device and the recipient's device can read a message.</p>
<p>This is the most important sentence on this page. If your conversation needs end-to-end encryption, Chatgram does not offer it yet. We would rather tell you that than let you assume otherwise.</p>
<p>End-to-end encryption is the top item on the Chatgram roadmap, but a roadmap item is not a feature. Until it ships and is described in the <a href="/whats-new/">release notes</a>, the sentence above is what applies.</p>
<p>Two practical consequences: keep anything that must stay private out of chat, and remember that a screenshot, a forwarded message or a shared screen is outside the app's protection entirely.</p>`,
      },
      {
        h2: 'Chatgram AI and third-party processing',
        html: `<p>When you ask Chatgram AI a question, the text you send is processed by a third-party AI provider so that an answer can be generated. Do not paste passwords, card numbers or anything you would not want processed that way.</p>
<p>The assistant can be wrong. Treat its answers as a helpful draft, not as a source of truth, especially for medical, legal or financial questions.</p>`,
      },
      {
        h2: 'What you can do on your side',
        html: `<ul>
<li>Use a strong, unique password and never share a login code with anyone, including someone claiming to be from Chatgram.</li>
<li>Verify the files you install: the home page publishes the size and SHA-256 of the Android APK and the Windows installer, and both guides explain how to check them.</li>
<li>Block a contact you no longer want to hear from, and report abuse or a broken feature from the Help section in Settings so it reaches the team as a tracked issue.</li>
<li>Delete your account from Settings if you stop using Chatgram. The 14-day grace period exists so a mistake can be undone.</li>
</ul>`,
      },
      {
        h2: 'Where the rest of the detail lives',
        html: `<p>The formal terms, the data we hold and the rules for using Chatgram are in the <a href="/docs/">terms and privacy pages</a>. The <a href="/guides/how-to-use-chatgram.html">how to use guide</a> covers settings, groups and statuses, and the <a href="/whats-new/">release notes</a> say when something in this area changes.</p>
<p>If a change affects what is protected, it will be described there first, in the same language you are reading now.</p>`,
      },
    ],
    faq: [
      {
        q: 'Are my Chatgram messages end-to-end encrypted?',
        a: 'No, not yet. Messages are encrypted in transit with HTTPS and WSS, and they are stored on the server, which can read them. End-to-end encryption is not implemented in the current version.',
      },
      {
        q: 'What happens when I delete my account?',
        a: 'You confirm with your password and a code sent to your email. The account is then scheduled for deletion with a 14-day grace period, so you can cancel the request before the account and its data are removed.',
      },
      {
        q: 'Is it safe to install the APK from this site?',
        a: 'The APK and the Windows installer are published by the Chatgram team, with their real size and SHA-256 checksum listed on the home page. Compare the checksum before installing; both install guides show how.',
      },
    ],
  },
};
