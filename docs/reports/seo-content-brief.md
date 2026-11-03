# SEO content brief — four long-form pages per language

Owner: Lead. Consumers: the `client/landing` static build (`scripts/build.mjs` → `scripts/templates.mjs` → `scripts/validate.mjs`).
Read `client/landing/content/landing.<code>.mjs` first for tone, terminology and existing wording in that language, and
`client/landing/content/guides.mjs` for the section style of the existing English guides.

## Deliverable (one file per language, nothing else)

| language | file | `updated` |
| --- | --- | --- |
| en | `client/landing/content/pages.en.mjs` | `3 November 2026` |
| rw | `client/landing/content/pages.rw.mjs` | `3 Ugushyingo 2026` |
| fr | `client/landing/content/pages.fr.mjs` | `3 novembre 2026` |
| sw | `client/landing/content/pages.sw.mjs` | `3 Novemba 2026` |

Plain ESM, no imports, no TypeScript:

```js
export const PAGES = {
  about:                { slug, title, description, h1, updated, intro, sections, faq },
  'is-chatgram-free':   { slug, title, description, h1, updated, intro, sections, faq },
  'whats-new':          { slug, title, description, h1, updated, intro, sections, faq },
  'privacy-and-safety': { slug, title, description, h1, updated, intro, sections, faq },
};
```

Keys and `slug` must be exactly those four strings, in that order.

## Field rules (the build fails on violations)

- `title` — 10–60 characters, unique per page, contains `Chatgram`.
- `description` — 70–155 characters, unique per page, plain text.
- `h1` — contains `Chatgram`, and is different wording from `title`.
- `updated` — the string from the table above.
- `intro` — plain text only, 50–90 words.
- `sections` — 4 to 6 items of `{ h2, html }`. `h2` is plain text; `html` is one or more blocks using only
  `<p>`, `<ul>`/`<li>`, `<ol>`/`<li>`, `<h3>`, `<blockquote>`, `<strong>`, `<em>` and internal links `<a href="/...">`.
  No `<h1>`, no `<h2>`, no images, no scripts, no external links.
- `faq` — 2 to 4 items of `{ q, a }`, plain text, each answer 25–70 words.
- Length: per page, `intro` + section `h2`s + section text + FAQ questions and answers must total **620–800 words**.

## Facts (use only these; invent nothing)

- Chatgram is a free messaging app made in Rwanda for Android, Windows and the web.
  Canonical site `https://chatgram.qd.je`; web app `/web/`; legal `/docs/`; guides `/guides/<slug>.html`.
- Android `1.1.7`, 1,589,034 bytes, Android 7.0+ (API 24), APK at `/downloads/chatgram-android.apk`, not on Google Play yet.
- Windows `1.1.6`, 86,263,690 bytes, Windows 10+ 64-bit, installer
  `https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe`, unsigned → SmartScreen warns:
  "More info" then "Run anyway".
- Web app `1.1.3`, nothing to install. One account works on every device (same email).
- Features: direct and group chats, 24-hour statuses, voice notes (waveform, 1.5x/2x speed), voice and video calls
  (group calls up to 12 people, video for the first 6), Chatgram AI in English/Kinyarwanda/French/Swahili
  (mention `@Chatgram AI` in a group; answers are handled by a third-party AI provider and can be wrong),
  dark mode, four interface languages, Android notifications via Firebase Cloud Messaging, Windows tray notifications.
- Honest limits: messages are encrypted in transit (HTTPS/WSS) and stored on the server, so the server can read them;
  end-to-end encryption is not implemented yet. The Windows installer is unsigned. The Android app is sideloaded.
  Chatgram AI can make mistakes.
- Price: free — no adverts, no subscriptions, no in-app purchases, no premium tier. Never promise future pricing or features.
- Changelog facts for `whats-new` (all real, 2026): voice notes with slide-to-cancel, lock, pause, waveform and playback
  speed (Android 1.1.3); reply cards and quoted replies; chat wallpapers (per chat or whole app); remote screen control
  from the Windows app; better screen-share quality; Settings rebuilt as a WhatsApp-style list with dedicated pages;
  protected account deletion (password + emailed code, 14-day grace period to cancel); Help reports that create GitHub
  issues; Android 1.1.7 push notifications when the app is closed; Windows 1.1.6.
- Internal links allowed: `/`, `/rw/`, `/fr/`, `/sw/`, `/web/`, `/docs/`,
  `/guides/how-to-use-chatgram.html`, `/guides/chatgram-android-download-install.html`,
  `/guides/chatgram-windows-download-smartscreen.html`, `/guides/chatgram-ai-four-languages.html`,
  `/downloads/chatgram-android.apk`.
- Forbidden: user numbers, download counts, ratings, reviews, awards, "most popular"/"best", security certifications,
  any claim of end-to-end encryption, criticism of other apps, invented dates or roadmaps.

## Page intent

- `about` — what Chatgram is, who it is for, the three platforms, the four languages, what works today, what does not yet.
- `is-chatgram-free` — the honest price answer: free, no ads, no subscriptions, no in-app purchases, no premium tier;
  where the APK and installer come from and that both are free; what "free" does and does not promise.
- `whats-new` — a dated changelog of the real items above, grouped by platform, with what each one means for the user.
- `privacy-and-safety` — what is protected (TLS in transit, account password, blocking/reporting, account deletion with
  grace period), what is not yet (no end-to-end encryption, server can read stored messages), and how to use Chatgram
  safely (verify downloads with the published SHA-256, use a strong password, report abuse via Help).

## Self-check (must print `OK all 4 pages valid`)

Replace `<code>` with the language code:

```
node -e "import('./client/landing/content/pages.<code>.mjs').then(({PAGES})=>{const keys=['about','is-chatgram-free','whats-new','privacy-and-safety'];const bad=[];if(JSON.stringify(Object.keys(PAGES))!==JSON.stringify(keys))bad.push('keys');for(const k of keys){const p=PAGES[k];if(!p){bad.push(k+' missing');continue}if(p.slug!==k)bad.push(k+' slug');if(!(p.title.length>=10&&p.title.length<=60&&p.title.includes('Chatgram')))bad.push(k+' title '+p.title.length);if(!(p.description.length>=70&&p.description.length<=155))bad.push(k+' desc '+p.description.length);if(!p.h1.includes('Chatgram'))bad.push(k+' h1');if(!(p.sections.length>=4&&p.sections.length<=6))bad.push(k+' sections');if(!(p.faq.length>=2&&p.faq.length<=4))bad.push(k+' faq');const body=[p.intro,...p.sections.map(s=>s.h2+' '+s.html.replace(/<[^>]+>/g,' ')),...p.faq.flatMap(f=>[f.q,f.a])].join(' ');const w=body.split(/\s+/).filter(Boolean).length;if(!(w>=620&&w<=800))bad.push(k+' words '+w);const html=p.sections.map(s=>s.html).join(' ');if(/<h[12][\s>]/i.test(html))bad.push(k+' inner heading');if(/https?:\/\//.test(html))bad.push(k+' external link')}console.log(bad.length?'FAIL '+bad.join('; '):'OK all 4 pages valid')})"
```

Write only your one file. Do not build, deploy, commit or edit anything else.
