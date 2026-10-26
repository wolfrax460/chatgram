/**
 * The four static guide pages. Each is rendered to real HTML by
 * scripts/build.mjs, which also checks the visible word count is 400-700 and
 * validates the JSON-LD. Paths/titles/descriptions live in site.mjs.
 */
export const GUIDES_CONTENT = [
  {
    slug: 'how-to-use-chatgram',
    h1: 'How to use Chatgram: from first sign-in to your first group',
    updated: '26 October 2026',
    intro:
      'Chatgram is a free messaging app for Android, Windows and the web. This guide covers the first session: your account, contacts, messages, groups, status and Chatgram AI.',
    sections: [
      {
        h2: 'What you need to get started',
        html: `<p>You need an email address or a Google account. Chatgram runs on Android 7.0 or newer, on 64-bit Windows 10 or newer, and in any current Chrome, Edge, Firefox or Safari. The same account works on all three, so you can start on your phone and continue on your PC.</p>
<p>Install it here: the <a href="/downloads/chatgram-android.apk">Android APK</a> is 4,127,661 bytes (3.9 MB) and the <a href="/downloads/chatgram-windows-setup.exe">Windows installer</a> is 81,824,358 bytes (78.0 MB). Or open the <a href="/web/">web app</a> and sign in there; it is the same account.</p>`,
      },
      {
        h2: 'Create your account',
        html: `<ol>
<li>Open Chatgram and choose <strong>Sign up</strong>.</li>
<li>Enter your email and a password, or choose <strong>Continue with Google</strong>.</li>
<li>Type the six-digit code that arrives in your inbox.</li>
<li>Add a display name and, if you like, a profile photo.</li>
</ol>
<p>Then open <strong>Settings → Privacy</strong>: online status, last seen, photo, about, phone and email can each be hidden from everyone, from contacts only, or from specific people.</p>`,
      },
      {
        h2: 'Add the people you talk to',
        html: `<p>Type a name, an email address or a phone number into the search field on the Chats screen. Phone numbers use international format, for example <strong>+250788123456</strong> for a Rwandan number. Tap the person and choose <strong>Add contact</strong>; an alias you set is visible only to you.</p>`,
      },
      {
        h2: 'Send your first message',
        html: `<p>Tap a contact, type in the box at the bottom and send. Ticks next to the message show when it reached the server, when it was delivered and when it was read. If the connection drops mid-send, Chatgram keeps the message and retries.</p>
<ul>
<li><strong>Voice note:</strong> hold the microphone button, speak, then release.</li>
<li><strong>Photo, video or file:</strong> use the attachment button; upload progress is shown.</li>
<li><strong>More actions:</strong> long-press or right-click a message to reply, edit, forward, star, react or report.</li>
</ul>`,
      },
      {
        h2: 'Start or join a group',
        html: `<p>Press the new-chat button, choose <strong>New group</strong>, pick members and give the group a name and photo. The creator is the first admin and can add or remove people, change the photo and decide who may send messages.</p>
<p>Switch on join-request approval to vet new members by hand, or share a revocable invite link when you want the door open temporarily. Messages you pin stay at the top, and typing @ followed by a name mentions someone directly.</p>`,
      },
      {
        h2: 'Post a 24-hour status',
        html: `<p>Open the Status tab to share a photo, a video or a voice recording with the people you choose. It disappears after 24 hours and its media is deleted when it expires. Tap your own status to see who viewed it.</p>`,
      },
      {
        h2: 'Use Chatgram AI',
        html: `<p>Chatgram AI is pinned at the top of the chat list and behaves like any conversation. Ask a question, paste a paragraph to rewrite, or ask for a translation between English, Kinyarwanda, French and Swahili. Answers stream in, can be copied and can be rated. In groups where an admin enabled it, mention @Chatgram AI to bring an answer into the discussion.</p>`,
      },
      {
        h2: 'Keep your account safe',
        html: `<p>Turn on two-step verification in <strong>Settings → Security</strong>: scan the QR code with an authenticator app and store the ten single-use recovery codes safely. The same page lists every signed-in session, with a one-tap way to sign the others out. Block, mute or report anyone who crosses a line from their profile or the chat menu.</p>
<p>The in-app help centre has 37 articles and an AI assistant; if it cannot help, one tap opens a support ticket with a person. Platform guides: <a href="/guides/chatgram-android-download-install.html">Android install</a>, <a href="/guides/chatgram-windows-download-smartscreen.html">Windows and SmartScreen</a>, <a href="/guides/chatgram-ai-four-languages.html">Chatgram AI</a>.</p>`,
      },
    ],
  },
  {
    slug: 'chatgram-android-download-install',
    h1: 'Chatgram Android download and install: the complete steps',
    updated: '26 October 2026',
    intro:
      'Chatgram for Android is a direct-download APK, not a Play Store release. This guide covers the real file details, how to allow the install safely, how to verify the checksum and what to do when Android blocks the file.',
    sections: [
      {
        h2: 'Check the file before you download',
        html: `<p>The current Android build is version 1.1.0, package ID <strong>app.chatgram.android</strong>, and requires Android 7.0 (API 24) or newer. It is a debug-signed build intended for direct installation.</p>
<ul>
<li><strong>File:</strong> chatgram-android.apk</li>
<li><strong>Size:</strong> 4,127,661 bytes (3.9 MB)</li>
<li><strong>Download link:</strong> <a href="/downloads/chatgram-android.apk">download chatgram-android.apk</a></li>
</ul>
<p>Download it only from this site or from the Chatgram download page, and never from a message someone sent you. The published file is served over HTTPS from /downloads/.</p>`,
      },
      {
        h2: 'Download the APK',
        html: `<ol>
<li>On your Android phone, open this page and tap <strong>Download APK</strong>.</li>
<li>If your browser asks whether to keep the file, confirm the download.</li>
<li>Open the notifications shade, or the Downloads app, when the file finishes.</li>
</ol>`,
      },
      {
        h2: 'Allow the install from your browser or file manager',
        html: `<p>Android blocks apps from sources other than the Play Store by default. The first time you open the APK, the system shows a warning and offers a settings link.</p>
<ol>
<li>Tap <strong>Settings</strong> on the warning.</li>
<li>Switch on <strong>Allow from this source</strong> (Android 8 and newer) or <strong>Install unknown apps</strong> for the browser or file manager you used.</li>
<li>Go back and tap <strong>Install</strong>.</li>
</ol>
<p>You can switch the permission off again after installing; it is only needed for this file.</p>`,
      },
      {
        h2: 'Verify the SHA-256 checksum (optional, recommended)',
        html: `<p>A checksum proves the file you downloaded is exactly the file that was published. The SHA-256 for this build is:</p>
<p><code>1dfe75cb8ac6475fcc29d81a667114a41fe9cc2f1b95379cb92ce693662eb0da</code></p>
<p>On a PC, run <code>Get-FileHash chatgram-android.apk -Algorithm SHA256</code> in PowerShell or <code>sha256sum chatgram-android.apk</code> on Linux, and compare the result. If the values differ, delete the file and download it again.</p>`,
      },
      {
        h2: 'First launch and permissions',
        html: `<p>Open Chatgram and sign in with the same account you use on Windows or the web. Camera and microphone permissions are requested only when you start a video call, record a voice note or attach a photo, so you can safely decline them until you need those features. Allow notifications if you want message alerts while the app is in the background.</p>`,
      },
      {
        h2: 'If the install fails',
        html: `<ul>
<li><strong>“App not installed” or a parse error:</strong> the download was cut short. Delete the file, free some storage and download it again; check the checksum afterwards.</li>
<li><strong>Play Protect flags the file:</strong> that is expected for a debug-signed build outside the Play Store. Confirm that the file came from this page, then allow the install. Do not disable Play Protect permanently.</li>
<li><strong>The Install button stays grey:</strong> the “Allow from this source” switch is still off for the app that opened the file. Open Settings, find that switch again and retry.</li>
<li><strong>Old Android version:</strong> the app needs Android 7.0 or newer. Update Android or use the web app in Chrome instead.</li>
</ul>
<p>Chatgram for Android is not on the Play Store yet, so updates are installed by downloading the newest APK from the same download page. Your account and conversations are stored on the server, so installing a newer build keeps everything in place.</p>`,
      },
    ],
  },
  {
    slug: 'chatgram-windows-download-smartscreen',
    h1: 'Chatgram for Windows: download, SmartScreen and checksum help',
    updated: '26 October 2026',
    intro:
      'The Chatgram Windows installer is unsigned, so Windows SmartScreen may warn you the first time you run it. This guide explains the real file details, the exact SmartScreen steps, how to verify the download and how updates work.',
    sections: [
      {
        h2: 'Check the file before you download',
        html: `<p>The current desktop build is version 1.1.0 for 64-bit Windows 10 or newer. It is an unsigned NSIS installer, which is why SmartScreen can warn about it.</p>
<ul>
<li><strong>File:</strong> chatgram-windows-setup.exe</li>
<li><strong>Size:</strong> 81,824,358 bytes (78.0 MB)</li>
<li><strong>Download link:</strong> <a href="/downloads/chatgram-windows-setup.exe">download chatgram-windows-setup.exe</a></li>
</ul>
<p>Only download the installer from this site. If a message or another website offers you a Chatgram .exe, treat it as untrusted.</p>`,
      },
      {
        h2: 'Run the installer past SmartScreen',
        html: `<ol>
<li>Open your Downloads folder and double-click <strong>chatgram-windows-setup.exe</strong>.</li>
<li>If a blue window says <em>Windows protected your PC</em>, click <strong>More info</strong>.</li>
<li>Check that the app name is Chatgram and the publisher is unknown, then click <strong>Run anyway</strong>.</li>
<li>Follow the installer, then launch Chatgram from the Start menu.</li>
</ol>
<p>This warning appears because the build is not code-signed yet, not because Windows found anything wrong with the file. Do not turn SmartScreen off globally to get around it; click through the warning for this one file and leave the protection on for everything else.</p>`,
      },
      {
        h2: 'Verify the SHA-256 checksum',
        html: `<p>If you want to be certain the download is intact, open PowerShell in the folder that holds the installer and run:</p>
<p><code>Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256</code></p>
<p>The current Windows build's checksum begins with <strong>c9882047</strong> and ends with <strong>53ab3</strong>; the complete value is published with the release feed the download cards read from. If your hash does not match the published value for the version you downloaded, delete the file and download it again.</p>`,
      },
      {
        h2: 'After installation',
        html: `<p>The desktop app uses the same account and the same conversations as Android and the web. Sign in once and your chats are already there. Closing the window leaves Chatgram running in the system tray, so notifications keep arriving; use the tray menu to open it again or to quit completely. Start-on-login is available in Settings if you want it to open with Windows.</p>`,
      },
      {
        h2: 'How updates work',
        html: `<p>The Windows build checks the published release feed under /downloads/ and installs a newer version when one is published, so you do not need to download a new installer by hand each time. If an automatic update fails, download the installer again from this page and run it over the existing installation; your account data stays on the server and is not affected.</p>`,
      },
      {
        h2: 'Troubleshooting',
        html: `<ul>
<li><strong>No “Run anyway” button:</strong> expand “More info” first — the button only appears after that. If the window still blocks you, the file may have been altered in transit; delete it and download again.</li>
<li><strong>Antivirus quarantines the installer:</strong> an unsigned executable can be heuristically flagged. Verify the checksum and, if it matches, add an exception for this file rather than disabling your antivirus.</li>
<li><strong>The app will not start:</strong> confirm you are on 64-bit Windows 10 or newer. Try running the installer again as the same user; if the tray icon disappears, reopen Chatgram from the Start menu.</li>
<li><strong>Uninstall:</strong> use Windows Settings → Apps → Chatgram → Uninstall. Your chats remain on the server, so signing in again on any device restores them.</li>
</ul>`,
      },
    ],
  },
  {
    slug: 'chatgram-ai-four-languages',
    h1: 'Chatgram AI: what it can do in English, Kinyarwanda, French and Swahili',
    updated: '26 October 2026',
    intro:
      'Chatgram AI is the assistant built into the Chatgram messaging app. It lives at the top of the chat list, answers in the app, and works in English, Kinyarwanda, French and Swahili. Here is what it is good at, how to reach it and what it cannot do.',
    sections: [
      {
        h2: 'Where to find Chatgram AI',
        html: `<p>Chatgram AI is pinned above your conversations, so it behaves like any other contact. Open it, type a question and press send; the answer streams into the conversation like a normal message. You can also open it from the chat search by choosing the <strong>Ask Chatgram AI</strong> row, keep several conversations over time, clear the thread or start a new one. In a group where an administrator has enabled it, typing @Chatgram AI mentions the assistant in the discussion.</p>`,
      },
      {
        h2: 'Questions and explanations',
        html: `<p>Ask a factual question, ask for a short explanation, or ask it to simplify something you paste in. It can explain a term in Kinyarwanda, answer a follow-up in French, or turn a long paragraph into a few bullet points in Swahili. Because the answer appears as a normal message, you can copy it, quote it in a reply or forward it to someone else.</p>`,
      },
      {
        h2: 'Writing and rewriting',
        html: `<p>Chatgram AI is useful for the writing we all put off: a polite message to a client, a short announcement for a group, a reply that needs to sound firm without being rude. Ask for a draft, then ask it to make the text shorter, friendlier or more formal.</p>`,
      },
      {
        h2: 'Translation between the four languages',
        html: `<p>Translation is one of the most useful things Chatgram AI does in this region. Some example requests:</p>
<ul>
<li><strong>English:</strong> “Translate this paragraph into Kinyarwanda and keep it formal.”</li>
<li><strong>Kinyarwanda:</strong> “Semura ubu butumwa mu Gifaransa, kandi kubike ku rwego rumwe.”</li>
<li><strong>French:</strong> « Traduis ce message en swahili, puis explique la nuance. »</li>
<li><strong>Swahili:</strong> “Tafsiri ujumbe huu kwa Kinyarwanda na Kiingereza, kisha niambie tofauti.”</li>
</ul>
<p>Always read a translation before sending it to someone else. Short sentences give better results than long messages with several ideas.</p>`,
      },
      {
        h2: 'Summaries, notes and everyday help',
        html: `<p>Paste a long message, a set of notes or a page of text and ask for a summary, a list of action points or a title that fits. It can also help with simple maths and step-by-step explanations, draft a list of questions for a meeting, or suggest how to reply to a difficult message.</p>`,
      },
      {
        h2: 'Its real limits',
        html: `<p>Chatgram AI can be wrong. It is a language model, not a search engine, so facts, names, dates and figures should be checked before you rely on them. Answers are processed by a third-party AI provider, and the app shows a reminder that the assistant can make mistakes. Do not share passwords, one-time codes or private documents you would not want processed elsewhere, and do not use it as the only source for medical, legal or financial decisions. Messages sent to it are not end-to-end encrypted, just like the rest of Chatgram today.</p>`,
      },
      {
        h2: 'When it cannot help',
        html: `<p>The in-app help centre has 37 articles that the assistant can answer from, covering downloads, privacy settings, groups, calls and account changes. If the answer is still not good enough, use the hand-off action: it opens a support ticket and passes the conversation to a person. That is the fastest route for account-specific problems.</p>`,
      },
      {
        h2: 'Get the app',
        html: `<p>Chatgram AI is part of the free app on every platform: <a href="/downloads/chatgram-android.apk">download the Android APK</a> (4,127,661 bytes), <a href="/downloads/chatgram-windows-setup.exe">download the Windows installer</a> (81,824,358 bytes), or <a href="/web/">open Chatgram in your browser</a>. The account and the conversations are the same everywhere.</p>`,
      },
    ],
  },
];
