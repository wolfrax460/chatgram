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
  { icon: Icon.shield, label: 'Private by default', sub: 'Contacts are yours alone' },
  { icon: Icon.lock, label: 'Encrypted in transit', sub: 'HTTPS and WSS only' },
  { icon: Icon.server, label: 'Self-hosted', sub: 'No adverts, no tracking' },
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
    body: 'Messages arrive the instant they are sent over a live connection, with delivered and read receipts.',
  },
  {
    icon: Icon.mic,
    title: 'Voice notes',
    body: 'Hold to record and send a voice message — far quicker than typing when you are on the move.',
  },
  {
    icon: Icon.image,
    title: 'Photos & video',
    body: 'Send images and videos that open full-screen with pinch-to-zoom and in-app playback.',
  },
  {
    icon: Icon.users,
    title: 'Group chats',
    body: 'Bring people together, add or remove members, and promote admins to help manage the group.',
  },
  {
    icon: Icon.clock,
    title: 'Status updates',
    body: 'Share a moment that disappears after 24 hours, and see exactly who viewed it.',
  },
  {
    icon: Icon.search,
    title: 'Private contacts',
    body: 'Add people by name, email or phone. Only the contacts you add can appear in your list.',
  },
  {
    icon: Icon.eyeOff,
    title: 'Presence control',
    body: 'Hide your online status from everyone, or keep it visible and hide it from specific people.',
  },
  {
    icon: Icon.devices,
    title: 'One account, everywhere',
    body: 'Sign in on Android, Windows and the web with the same account and pick up where you left off.',
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
const SHOTS = [
  { src: '/assets/android-app.png', alt: 'Chatgram chat list on Android', caption: 'Your conversations' },
  { src: '/assets/android-register.png', alt: 'Chatgram sign-up screen', caption: 'Sign up in seconds' },
  { src: '/assets/android-landing.png', alt: 'Chatgram welcome screen', caption: 'Built for every platform' },
];

export function Screenshots() {
  return (
    <div className="shots">
      {SHOTS.map(({ src, alt, caption }) => (
        <figure className="shot" key={src}>
          <div className="shot-frame">
            <img src={src} alt={alt} loading="lazy" />
          </div>
          <figcaption>{caption}</figcaption>
        </figure>
      ))}
    </div>
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
    title: 'Short-lived sessions',
    body: 'Access tokens are valid for minutes and refresh automatically. Signing out revokes the session server-side.',
  },
  {
    icon: Icon.users,
    title: 'Contacts stay private',
    body: 'Contact lists are personal. Nobody can browse the directory of accounts — you add who you want.',
  },
  {
    icon: Icon.eyeOff,
    title: 'You control presence',
    body: 'Online status and last-seen are opt-in. Turn them off entirely, or hide them from chosen contacts.',
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
  android: 'https://chatgram.duckdns.org/downloads/chatgram.apk',
  windows: 'https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe',
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
    meta: 'ZIP · Portable, no installer',
    cta: 'Download for Windows',
    href: DOWNLOADS.windows,
    note: 'Unzip anywhere and run chatgram.exe.',
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
    version: '1.0.0',
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
  { status: 'next', title: 'End-to-end encrypted messages', body: 'Encrypt message contents so only the two participants can read them.' },
  { status: 'next', title: 'Push notifications', body: 'Get notified when the app is closed, on Android and Windows.' },
  { status: 'planned', title: 'Message search', body: 'Search across all of your conversations.' },
  { status: 'planned', title: 'Video calling', body: 'One-to-one and group video calls.' },
  { status: 'planned', title: 'Message backup & export', body: 'Download your own conversation history at any time.' },
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
    a: 'No. One account works on Android, Windows and the web. Sign in with the same email on every device.',
  },
  {
    q: 'How do I install the Android app?',
    a: 'Download the APK, open it, and allow “Install unknown apps” for your browser or file manager when Android asks. Chatgram is not distributed through the Play Store yet, so this is expected.',
  },
  {
    q: 'Windows shows a warning when I start the app. Is that normal?',
    a: 'Yes. The app is not code-signed, so Windows SmartScreen may warn you the first time. Choose “More info” then “Run anyway”.',
  },
  {
    q: 'Who can see when I am online?',
    a: 'You decide. In Settings → Privacy you can hide your online status from everybody, or keep it on and hide it from specific contacts.',
  },
  {
    q: 'Are my messages end-to-end encrypted?',
    a: 'Not yet. Messages are currently encrypted in transit (HTTPS/WSS) and stored on the server, but not end-to-end encrypted. End-to-end encryption is the top item on the roadmap.',
  },
  {
    q: 'Can I use Chatgram with people on another network?',
    a: 'Yes. The apps connect to a hosted server over the internet, so you can chat with anyone anywhere as long as they have an account.',
  },
  {
    q: 'What happens to my photos and voice notes?',
    a: 'They are stored in the cloud and referenced by the app, so they stay available across your devices rather than living only on the machine that uploaded them.',
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
