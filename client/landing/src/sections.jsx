import { Reveal } from './reveal.jsx';
import { useState } from 'react';

/* ------------------------------------------------------------------ icons */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const Icon = {
  chat: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </svg>
  ),
  mic: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 18 5.5-5.5 4 4L17 13l4 4" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9M18 20a5.6 5.6 0 0 0-2-4.3" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  devices: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="2" y="4" width="13" height="10" rx="2" />
      <path d="M6 18h7" />
      <rect x="16" y="9" width="6" height="11" rx="1.6" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 9 4.5 9 6-.3.8-1.3 2.1-2.8 3.2M6.5 8.2C4.5 9.6 3.4 11.2 3 12c.7 1.4 4 6 9 6 1 0 1.9-.2 2.8-.5" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M17 6l2 2M15 4l2 2" />
    </svg>
  ),
  server: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  ),
  windows: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5.5 10.5 4.4v7.1H3V5.5Zm8.6-1.3L21 2.7v8.8h-9.4V4.2ZM3 12.6h7.5v7.1L3 18.5v-5.9Zm8.6 0H21v8.8l-9.4-1.5v-7.3Z" />
    </svg>
  ),
  android: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.2 8.4h11.6c.5 0 .9.4.9.9v7.3a1.6 1.6 0 0 1-1.6 1.6H6.9a1.6 1.6 0 0 1-1.6-1.6V9.3c0-.5.4-.9.9-.9Zm-2.1.2c.6 0 1 .5 1 1v5c0 .6-.4 1-1 1s-1-.4-1-1v-5c0-.5.4-1 1-1Zm15.8 0c.6 0 1 .5 1 1v5c0 .6-.4 1-1 1s-1-.4-1-1v-5c0-.5.4-1 1-1ZM8.3 18.6h1.5v2.6c0 .6-.4 1-1 1s-1-.4-1-1v-2.6Zm6 0h1.5v2.6c0 .6-.4 1-1 1s-1-.4-1-1v-2.6ZM8.7 7.2 7.5 5.1a.3.3 0 0 1 .1-.4.3.3 0 0 1 .4.1l1.2 2.2a6.6 6.6 0 0 1 5.6 0l1.2-2.2a.3.3 0 0 1 .5.3l-1.2 2.1H8.7Zm1.5-1.6a.55.55 0 1 0 0-1.1.55.55 0 0 0 0 1.1Zm3.6 0a.55.55 0 1 0 0-1.1.55.55 0 0 0 0 1.1Z" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.8 6.8 0 0 0 10.2 10.2Z" />
    </svg>
  ),
  monitor: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.5" />
      <path d="M12 17h.01" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6Z" />
      <path d="M12 14v7" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M6.5 3.5h3l1.4 4-2 1.4a12 12 0 0 0 5.2 5.2l1.4-2 4 1.4v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
    </svg>
  ),
};

/* -------------------------------------------------------------- primitives */
export function Section({ id, eyebrow, title, lead, children, alt = false }) {
  return (
    <section id={id} className={alt ? 'section section-alt' : 'section'}>
      <div className="wrap">
        {(eyebrow || title) && (
          <Reveal className="section-head">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h2>{title}</h2>}
            {lead && <p>{lead}</p>}
          </Reveal>
        )}
        <Reveal delay={90}>{children}</Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ quick facts */
const FACTS = [
  { icon: Icon.devices, label: '3 platforms', sub: 'Android, Windows, Web' },
  { icon: Icon.key, label: 'Two-step verification', sub: 'TOTP with recovery codes' },
  { icon: Icon.shield, label: 'Privacy per contact', sub: 'You decide what each person sees' },
  { icon: Icon.server, label: 'No adverts, no tracking', sub: 'Your conversations are not the product' },
];

export function Facts() {
  return (
    <div className="facts">
      {FACTS.map(({ icon, label, sub }) => (
        <div className="fact" key={label}>
          <span className="fact-icon">{icon}</span>
          <div>
            <strong>{label}</strong>
            <span>{sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- features */
const FEATURES = [
  {
    icon: Icon.chat,
    title: 'Real-time chat',
    body: 'Messages arrive the instant they are sent, with delivered and read receipts, typing indicators and optimistic sending that recovers from a dropped connection.',
  },
  {
    icon: Icon.mic,
    title: 'Voice notes',
    body: 'Hold to record and send a voice message — far quicker than typing when you are on the move.',
  },
  {
    icon: Icon.image,
    title: 'Photos, video & files',
    body: 'Send images, video and documents. Media opens full-screen, and uploads show real progress with cancel and retry.',
  },
  {
    icon: Icon.phone,
    title: 'Voice & video calls',
    body: 'Call one person or a whole group — voice or video, up to 20 people at once, with mute, camera toggle and a call timer.',
  },
  {
    icon: Icon.users,
    title: 'Groups with real tools',
    body: 'Group photo, admins, member roles and permissions. The last admin leaving promotes the next member, so a group is never orphaned.',
  },
  {
    icon: Icon.shield,
    title: 'Approval & invite links',
    body: 'Require an admin to approve new members, or share a revocable invite link. People request to join; you decide.',
  },
  {
    icon: Icon.pin,
    title: 'Powerful message actions',
    body: 'Reply, edit, forward, star, pin, react, @mention and report — with “seen by” lists on group messages.',
  },
  {
    icon: Icon.clock,
    title: '24-hour status',
    body: 'Share photos, video or audio that vanish after a day. See exactly who viewed them, and the files are deleted when they expire.',
  },
  {
    icon: Icon.key,
    title: 'Two-step verification',
    body: 'Protect your account with an authenticator app and ten single-use recovery codes. Passwords are changeable from Settings.',
  },
  {
    icon: Icon.eyeOff,
    title: 'Privacy and safety',
    body: 'Choose who sees your online status, last seen, photo, about, phone and email. Block, mute or report anyone who crosses a line.',
  },
  {
    icon: Icon.bell,
    title: 'Do not disturb',
    body: 'Set quiet hours once and they follow you to every device — notifications and sounds stay silent until morning.',
  },
  {
    icon: Icon.help,
    title: 'Help centre & AI assistant',
    body: 'Searchable help articles, an AI assistant that answers instantly, and a one-tap hand-off to a human when it cannot.',
  },
  {
    icon: Icon.sparkles || Icon.help,
    title: 'Chatgram AI conversation',
    body: 'Chatgram AI sits at the top of your chat list like any contact: ask anything, get streamed markdown answers, copy or rate them, clear the chat or start a new conversation. Mention @Chatgram AI in a group when an admin enables it.',
  },
  {
    icon: Icon.windows || Icon.devices,
    title: 'Windows and Android apps',
    body: 'Install Chatgram for Windows (tray, taskbar badge, auto-update) or sideload the Android APK. Both use the same account and the same web build as the browser.',
  },
];

export function Features() {
  return (
    <div className="grid grid-4">
      {FEATURES.map(({ icon, title, body }) => (
        <article className="card" key={title}>
          <span className="icon">{icon}</span>
          <h3>{title}</h3>
          <p>{body}</p>
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ screenshots */
const PHONE_SHOTS = [
  {
    src: '/assets/landing-chat-list.png',
    alt: 'Chatgram dark chat list with the pinned Chatgram AI row, groups and unread badges',
    caption: 'Your conversations, with Chatgram AI on top',
  },
  {
    src: '/assets/landing-conversation.png',
    alt: 'A dark Chatgram conversation with delivery ticks',
    caption: 'Live chat with delivery and read ticks',
  },
];

const WIDE_SHOT = {
  src: '/assets/landing-ai.png',
  alt: 'Chatgram AI open as a normal conversation inside the app',
  caption: 'Chatgram AI is just another conversation',
};

export function Screenshots() {
  return (
    <>
      <div className="shots shots-phones">
        {PHONE_SHOTS.map(({ src, alt, caption }) => (
          <figure className="shot" key={src}>
            <div className="shot-frame">
              <img src={src} alt={alt} loading="lazy" />
            </div>
            <figcaption>{caption}</figcaption>
          </figure>
        ))}
      </div>
      <figure className="shot shot-wide">
        <div className="shot-frame">
          <img src={WIDE_SHOT.src} alt={WIDE_SHOT.alt} loading="lazy" />
        </div>
        <figcaption>{WIDE_SHOT.caption}</figcaption>
      </figure>
    </>
  );
}

/* ---------------------------------------------------------------- security */
const SECURITY = [
  {
    icon: Icon.lock,
    title: 'Encrypted in transit',
    body: 'Every request and every socket runs over HTTPS and WSS with a valid TLS certificate, renewed automatically.',
  },
  {
    icon: Icon.key,
    title: 'Two-step verification',
    body: 'Add an authenticator app to your account, with ten single-use recovery codes in case you lose the phone.',
  },
  {
    icon: Icon.eyeOff,
    title: 'Privacy, per person',
    body: 'Online status, last seen, photo, about, phone and email are each yours to switch off — and read receipts are optional.',
  },
  {
    icon: Icon.devices,
    title: 'Sessions you control',
    body: 'Access tokens are short-lived and refreshed automatically. See every signed-in device and sign out the others in one tap. Changing your password does it for you.',
  },
  {
    icon: Icon.shield,
    title: 'Block, mute and report',
    body: 'Blocked accounts cannot message or call you. Reports reach a real inbox, not a void.',
  },
  {
    icon: Icon.server,
    title: 'Guarded on the server',
    body: 'Every chat, role and privacy rule is enforced server-side, never trusted from the app. Logins are rate limited and repeated failures lock the account temporarily.',
  },
];

export function Security() {
  return (
    <div className="grid grid-2">
      {SECURITY.map(({ icon, title, body }) => (
        <article className="card card-row" key={title}>
          <span className="icon">{icon}</span>
          <div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- download */
export const DOWNLOADS = {
  android: '/downloads/chatgram-android.apk',
  windows: '/downloads/chatgram-windows-setup.exe',
  web: '/web/',
};

const PLATFORMS = [
  {
    key: 'android',
    icon: Icon.android,
    label: 'Android',
    title: 'Chatgram for Android',
    meta: 'APK · Install directly',
    cta: 'Download APK',
    href: DOWNLOADS.android,
    note: 'Allow “Install unknown apps” when prompted.',
    req: 'Android 6.0 or newer',
  },
  {
    key: 'windows',
    icon: Icon.windows,
    label: 'Windows',
    title: 'Chatgram for Windows',
    meta: 'Installer · Unsigned',
    cta: 'Download for Windows',
    href: DOWNLOADS.windows,
    note: 'If Windows warns you, choose “More info” then “Run anyway”.',
    req: 'Windows 10 or newer, 64-bit',
  },
  {
    key: 'web',
    icon: Icon.globe,
    label: 'Web',
    title: 'Chatgram in your browser',
    meta: 'No install · Any modern browser',
    cta: 'Open Chatgram',
    href: DOWNLOADS.web,
    note: 'Nothing to download — just sign in.',
    req: 'Chrome, Edge, Firefox or Safari',
  },
];

export function Download({ sizes }) {
  return (
    <>
      <div className="grid grid-3">
        {PLATFORMS.map((p) => (
          <div className="dl-card" key={p.key}>
            <div className="dl-top">
              <span className="dl-icon">{p.icon}</span>
              <span className="plat">{p.label}</span>
            </div>
            <h3>{p.title}</h3>
            <div className="meta">
              {p.meta}
              {sizes[p.key] ? ` · ${sizes[p.key]} MB` : ''}
            </div>
            <div className="req">{p.req}</div>
            <a
              className={p.key === 'web' ? 'btn btn-ghost full' : 'btn btn-primary full'}
              href={p.href}
            >
              {p.cta}
            </a>
            <div className="alt">{p.note}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- steps */
const STEPS = [
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
];

export function Steps() {
  return (
    <div className="grid grid-3">
      {STEPS.map((s, i) => (
        <div className="step" key={s.title}>
          <span className="num">{i + 1}</span>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- changelog */
const RELEASES = [
  {
    version: '1.1',
    date: 'October 2026',
    items: [
      'Voice and video calls — one-to-one, or group calls with up to 20 people',
      'Two-step verification with an authenticator app and ten single-use recovery codes',
      'Change your password from Settings — every other device is signed out automatically',
      'Tap anyone to open their profile: photo, about, presence, common groups and shared media',
      'Block, unblock, mute and report, with read-receipt privacy',
      'Video and audio status updates, with auto-advance, hold to pause and arrow-key navigation',
      'Group join-request approval and revocable invite links',
      'Group permissions, pinned messages, @mentions, shared-media browser and “seen by”',
      'Edit, forward, star, react to and report individual messages',
      'Account settings: change email or phone, review active sessions, delete your account',
      'Do-not-disturb schedule that follows you to every device',
      'Help centre with 37 articles, an AI assistant and a one-tap hand-off to a human',
      'Rebuilt sign-in and sign-up that fit short laptop screens without clipping',
    ],
  },
  {
    version: '1.0',
    date: 'October 2026',
    items: [
      'First public release for Android, Windows and the web',
      'Real-time messaging with delivery and read receipts',
      'Voice notes, photos, video and document sharing',
      'Group chats with admin roles',
      '24-hour status updates with viewer lists',
      'Sign in with Google, plus email verification codes',
      'Online-status privacy with per-contact exceptions',
    ],
  },
];

export function Changelog() {
  return (
    <div className="changelog">
      {RELEASES.map((r) => (
        <div className="release" key={r.version}>
          <div className="release-head">
            <span className="tag">v{r.version}</span>
            <span className="release-date">{r.date}</span>
          </div>
          <ul>
            {r.items.map((item) => (
              <li key={item}>
                <span className="tick">{Icon.check}</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- roadmap */
const ROADMAP = [
  { status: 'next', title: 'End-to-end encrypted messages', body: 'Encrypt message contents so only the two participants can read them — the server included.' },
  { status: 'next', title: 'Calls beyond 20 people', body: 'Bigger rooms need a media server (an SFU) rather than peer-to-peer mesh — that is the next step for calls.' },
  { status: 'next', title: 'Push notifications', body: 'Get notified when the app is closed, on Android and Windows.' },
  { status: 'planned', title: 'Message search', body: 'Search across all of your conversations.' },
  { status: 'planned', title: 'Backup and export', body: 'Download your own conversation history at any time.' },
];

export function Roadmap() {
  return (
    <div className="roadmap">
      {ROADMAP.map((r) => (
        <div className="road-item" key={r.title}>
          <span className={`pill pill-${r.status}`}>{r.status === 'next' ? 'In progress' : 'Planned'}</span>
          <div>
            <h3>{r.title}</h3>
            <p>{r.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- faq */
const FAQS = [
  {
    q: 'Is Chatgram free?',
    a: 'Yes. There are no adverts, subscriptions or in-app purchases, and no premium tier.',
  },
  {
    q: 'Do I need a separate account for each device?',
    a: 'No. One account works on Android, Windows and the web. Sign in with the same email on every device and your chats are already there.',
  },
  {
    q: 'Can I use it without installing anything?',
    a: 'Yes — open the web app in any modern browser. Nothing to download, and it is the same account and interface as the installed apps.',
  },
  {
    q: 'Is there two-step verification?',
    a: 'Yes. In Settings → Security you can add an authenticator app by scanning a QR code, and you get ten single-use recovery codes in case you lose the phone.',
  },
  {
    q: 'How do I install the Android app?',
    a: 'Download the APK, open it, and allow “Install unknown apps” for your browser or file manager when Android asks. Chatgram is not distributed through the Play Store yet, so this is expected.',
  },
  {
    q: 'Windows shows a warning when I start the app. Is that normal?',
    a: 'Yes. The installer is not code-signed yet, so Windows SmartScreen may warn you the first time. Choose “More info” then “Run anyway”.',
  },
  {
    q: 'Who can see when I am online?',
    a: 'You decide. In Settings → Privacy each item — online status, last seen, profile photo, about, phone and email — can be switched off, and read receipts are optional too.',
  },
  {
    q: 'Are my messages end-to-end encrypted?',
    a: 'Not yet. Messages are encrypted in transit (HTTPS/WSS) and stored on the server, but the server can read them. End-to-end encryption is the top item on the roadmap.',
  },
  {
    q: 'What if I cannot find an answer?',
    a: 'The in-app help centre has 37 articles and an AI assistant that answers from them. If it cannot help, one tap hands the conversation to a person and creates a support ticket.',
  },
  {
    q: 'Can I make calls?',
    a: 'Yes — voice and video calls are built in. Tap the phone or video icon in a chat header. Direct chats call one person; group chats ring everyone online, and up to 20 people can be in a single call.',
  },
  {
    q: 'What happens to my photos and voice notes?',
    a: 'They are stored in the cloud and referenced by the app, so they stay available across your devices rather than living only on the machine that uploaded them. Status media is deleted when it expires after 24 hours.',
  },
];

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="faq">
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div className={isOpen ? 'faq-item open' : 'faq-item'} key={item.q}>
            <button
              type="button"
              className="faq-q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? -1 : i)}
            >
              <span>{item.q}</span>
              <span className="faq-sign" aria-hidden="true">
                {isOpen ? '–' : '+'}
              </span>
            </button>
            {isOpen && <div className="faq-a">{item.a}</div>}
          </div>
        );
      })}
    </div>
  );
}
