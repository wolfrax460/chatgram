/**
 * HTML templates for the static Chatgram landing site.
 *
 * Real HTML is rendered at build time (no client-side rendering for content), and
 * the markup reuses the design tokens/classes from src/styles.css so the existing
 * look and feel is preserved.
 */
import { ICON, PHOTOS } from '../content/media.mjs';
import { GUIDES, LANGUAGES, OG_IMAGE, RELEASES, SCREENSHOTS, SITE } from '../content/site.mjs';

/* ------------------------------------------------------------------ helpers */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** JSON for a <script> block: escape the sequence that could close the tag. */
export function safeJson(value) {
  return JSON.stringify(value, null, 0).replace(/<\//g, '<\\/');
}

export function formatBytes(bytes) {
  return Number(bytes).toLocaleString('en-US');
}

/* -------------------------------------------------------------------- icons */
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  chat: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-4.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/></svg>`,
  users: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9M18 20a5.6 5.6 0 0 0-2-4.3"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M6.5 3.5h3l1.4 4-2 1.4a12 12 0 0 0 5.2 5.2l1.4-2 4 1.4v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"/></svg>`,
  image: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5.5 4 4L17 13l4 4"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  help: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.5"/><path d="M12 17h.01"/></svg>`,
  key: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M17 6l2 2M15 4l2 2"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M18.5 15.5 19.4 18l2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9.9-2.5Z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></svg>`,
  windows: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5 10.5 4.4v7.1H3V5.5Zm8.6-1.3L21 2.7v8.8h-9.4V4.2ZM3 12.6h7.5v7.1L3 18.5v-5.9Zm8.6 0H21v8.8l-9.4-1.5v-7.3Z"/></svg>`,
  android: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.2 8.4h11.6c.5 0 .9.4.9.9v7.3a1.6 1.6 0 0 1-1.6 1.6H6.9a1.6 1.6 0 0 1-1.6-1.6V9.3c0-.5.4-.9.9-.9Zm-2.1.2c.6 0 1 .5 1 1v5c0 .6-.4 1-1 1s-1-.4-1-1v-5c0-.5.4-1 1-1Zm15.8 0c.6 0 1 .5 1 1v5c0 .6-.4 1-1 1s-1-.4-1-1v-5c0-.5.4-1 1-1ZM8.3 18.6h1.5v2.6c0 .6-.4 1-1 1s-1-.4-1-1v-2.6Zm6 0h1.5v2.6c0 .6-.4 1-1 1s-1-.4-1-1v-2.6ZM8.7 7.2 7.5 5.1a.3.3 0 0 1 .1-.4.3.3 0 0 1 .4.1l1.2 2.2a6.6 6.6 0 0 1 5.6 0l1.2-2.2a.3.3 0 0 1 .5.3l-1.2 2.1H8.7Zm1.5-1.6a.55.55 0 1 0 0-1.1.55.55 0 0 0 0 1.1Zm3.6 0a.55.55 0 1 0 0-1.1.55.55 0 0 0 0 1.1Z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  devices: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><rect x="2" y="4" width="13" height="10" rx="2"/><path d="M6 18h7"/><rect x="16" y="9" width="6" height="11" rx="1.6"/></svg>`,
  activity: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 9 4.5 9 6-.3.8-1.3 2.1-2.8 3.2M6.5 8.2C4.5 9.6 3.4 11.2 3 12c.7 1.4 4 6 9 6 1 0 1.9-.2 2.8-.5"/></svg>`,
  server: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>`,
  check: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.8 6.8 0 0 0 10.2 10.2Z"/></svg>`,
  monitor: `<svg viewBox="0 0 24 24" ${stroke} aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
};

/* Feature cards map one-to-one onto locale.features.items (8 items). */
const FEATURE_ICONS = ['chat', 'phone', 'clock', 'users', 'spark', 'bell', 'lock', 'refresh'];
const CALL_ICONS = ['phone', 'devices', 'monitor', 'server', 'activity'];
const PRIVACY_ICONS = ['lock', 'key', 'eyeOff', 'devices', 'shield', 'server'];
const FACT_ICONS = ['phone', 'globe', 'key', 'shield'];

const LOGO = `<img class="logo" src="${ICON.svg}" alt="" width="30" height="30" decoding="async">`;

const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('chatgram-theme');var t=s&&s!=='system'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

/* --------------------------------------------------------------------- head */
function head({
  siteUrl,
  htmlLang,
  title,
  description,
  canonicalPath,
  ogImageAlt,
  ogLocale,
  jsonLd,
  alternates = [],
  preload = '',
  cssHref,
  jsHref,
  robots = 'index, follow, max-image-preview:large',
}) {
  const canonical = `${siteUrl}${canonicalPath}`;
  const ogImage = `${siteUrl}${OG_IMAGE.path}`;
  const altLines = alternates
    .map((a) => `  <link rel="alternate" hreflang="${a.hreflang}" href="${siteUrl}${a.path}">`)
    .join('\n');
  const ogAlternates = alternates
    .filter((a) => a.hreflang !== 'x-default' && a.hreflang !== htmlLang)
    .map((a) => `  <meta property="og:locale:alternate" content="${a.ogLocale}">`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${htmlLang}" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${e(title)}</title>
  <meta name="description" content="${e(description)}">
  <meta name="robots" content="${e(robots)}">
  <meta name="theme-color" content="#008069" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0b141a" media="(prefers-color-scheme: dark)">
  <link rel="canonical" href="${canonical}">
${altLines}
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/svg+xml" href="${ICON.svg}">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Chatgram">
  <meta property="og:locale" content="${ogLocale}">
${ogAlternates}
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${OG_IMAGE.width}">
  <meta property="og:image:height" content="${OG_IMAGE.height}">
  <meta property="og:image:alt" content="${e(ogImageAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${e(title)}">
  <meta name="twitter:description" content="${e(description)}">
  <meta name="twitter:image" content="${ogImage}">
  <meta name="twitter:image:alt" content="${e(ogImageAlt)}">
${preload}
  <script>${THEME_SCRIPT}</script>
  <link rel="stylesheet" href="${cssHref}">
  <script defer src="${jsHref}"></script>
  <script type="application/ld+json">${safeJson(jsonLd)}</script>
</head>`;
}

/* ------------------------------------------------------------------- header */
function header(locale) {
  const links = locale.nav.links
    .map((l) => `        <a href="${l.href}">${e(l.label)}</a>`)
    .join('\n');

  return `  <a class="skip-link" href="#main">${e(locale.ui.skipToContent)}</a>
  <header class="site-header">
    <div class="wrap nav">
      <a class="brand-link" href="/" aria-label="Chatgram home">${LOGO}<span>Chatgram</span></a>
      <nav class="nav-links" id="site-nav" aria-label="${e(locale.ui.mainNavigation)}">
${links}
      </nav>
      <div class="nav-spacer"></div>
      <div class="theme-switch" role="group" aria-label="${e(locale.ui.themeGroup)}">
        <button type="button" class="theme-opt" data-theme-mode="light" aria-pressed="false" title="${e(locale.ui.themeLight)}">${ICONS.sun}<span class="sr-only">${e(locale.ui.themeLight)}</span></button>
        <button type="button" class="theme-opt" data-theme-mode="dark" aria-pressed="true" title="${e(locale.ui.themeDark)}">${ICONS.moon}<span class="sr-only">${e(locale.ui.themeDark)}</span></button>
        <button type="button" class="theme-opt" data-theme-mode="system" aria-pressed="false" title="${e(locale.ui.themeSystem)}">${ICONS.monitor}<span class="sr-only">${e(locale.ui.themeSystem)}</span></button>
      </div>
      <a class="btn btn-primary nav-cta" href="/web/">${e(locale.ui.openApp)}</a>
      <button type="button" class="nav-toggle" aria-label="${e(locale.ui.toggleMenu)}" aria-expanded="false" aria-controls="site-nav">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>`;
}

/* ------------------------------------------------------------------ figures */
function photoFigure(photo, { className = '', loading = 'lazy', high = false }) {
  const source = PHOTOS[photo.key];
  return `      <figure class="photo ${className}">
        <picture>
          <source type="image/webp" srcset="${source.webp}" width="${source.width}" height="${source.height}">
          <img src="${source.jpg}" width="${source.width}" height="${source.height}" alt="${e(photo.alt)}"${high ? ' fetchpriority="high"' : ''} loading="${loading}" decoding="async">
        </picture>
        <figcaption><span class="photo-label">${e(photo.label)}</span> ${e(photo.caption)}</figcaption>
      </figure>`;
}

/* ---------------------------------------------------------------- sections */
function hero(locale) {
  return `    <section class="hero">
      <div class="wrap hero-inner">
        <div class="hero-copy">
          <span class="hero-badge"><span class="dot"></span>${e(locale.hero.badge)}</span>
          <h1>${locale.hero.h1}</h1>
          <p class="lead">${e(locale.hero.lead)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="${locale.hero.ctaPrimary.href}">${e(locale.hero.ctaPrimary.label)}</a>
            <a class="btn btn-light btn-lg" href="${locale.hero.ctaSecondary.href}">${e(locale.hero.ctaSecondary.label)}</a>
          </div>
          <div class="hero-platforms">
            <span>${ICONS.android} ${e(locale.hero.platformAndroid)} ${RELEASES.android.sizeMB} MB</span>
            <span>${ICONS.windows} ${e(locale.hero.platformWindows)} ${RELEASES.windows.sizeMB} MB</span>
            <span>${ICONS.globe} ${e(locale.hero.platformWeb)}</span>
          </div>
        </div>
        <div class="hero-art">
${photoFigure({ ...locale.hero.photo, key: 'friends' }, { className: 'photo-hero testid-hero-photo', loading: 'eager', high: true })}
        </div>
      </div>
    </section>
    <div class="wrap">
      <div class="facts">
${locale.facts
  .map(
    (f, i) =>
      `        <div class="fact"><span class="fact-icon">${ICONS[FACT_ICONS[i]] || ICONS.check}</span><div><strong>${e(f.title)}</strong><span>${e(f.sub)}</span></div></div>`,
  )
  .join('\n')}
      </div>
    </div>`;
}

function sectionHead(block) {
  return `        <div class="section-head">
          <span class="eyebrow">${e(block.eyebrow)}</span>
          <h2>${e(block.title)}</h2>
          <p>${e(block.lead)}</p>
        </div>`;
}

function features(locale) {
  const items = locale.features.items
    .map(
      (item, i) => `          <article class="card">
            <span class="icon">${ICONS[FEATURE_ICONS[i]] || ICONS.help}</span>
            <h3>${e(item.title)}</h3>
            <p>${e(item.body)}</p>
          </article>`,
    )
    .join('\n');
  return `    <section class="section" id="features">
      <div class="wrap">
${sectionHead(locale.features)}
        <div class="grid grid-4">
${items}
        </div>
      </div>
    </section>`;
}

function calls(locale) {
  const items = locale.calls.items
    .map(
      (item, i) => `          <article class="card card-row">
            <span class="icon">${ICONS[CALL_ICONS[i]] || ICONS.phone}</span>
            <div><h3>${e(item.title)}</h3><p>${e(item.body)}</p></div>
          </article>`,
    )
    .join('\n');
  return `    <section class="section section-alt" id="calls">
      <div class="wrap">
${sectionHead(locale.calls)}
        <div class="grid grid-2 calls-grid">
${items}
        </div>
        <p class="privacy-note">${e(locale.calls.note)}</p>
      </div>
    </section>`;
}

function messaging(locale) {
  const items = locale.messaging.items
    .map((item) => `            <li><span class="tick">${ICONS.check}</span><div><strong>${e(item.title)}</strong> ${e(item.body)}</div></li>`)
    .join('\n');
  return `    <section class="section" id="messaging">
      <div class="wrap split">
        <div class="split-copy">
          <span class="eyebrow">${e(locale.messaging.eyebrow)}</span>
          <h2>${e(locale.messaging.title)}</h2>
          <p class="split-lead">${e(locale.messaging.lead)}</p>
          <ul class="tick-list">
${items}
          </ul>
          <p class="privacy-note">${e(locale.messaging.note)}</p>
        </div>
        <div class="split-media">
${photoFigure({ ...locale.messaging.photo, key: 'duo' }, { className: 'photo-duo testid-showcase-photo' })}
        </div>
      </div>
    </section>`;
}

function screenshotFigure(locale, entry, className) {
  const shot = SCREENSHOTS[entry.shot];
  return `        <figure class="shot ${className}">
          <div class="shot-frame">
            <picture>
              <source type="image/webp" srcset="${shot.webp760} 760w, ${shot.webp1366} 1366w" sizes="(max-width: 640px) 88vw, 380px">
              <img src="${shot.png}" width="${shot.width}" height="${shot.height}" alt="${e(entry.alt)}" loading="lazy" decoding="async">
            </picture>
          </div>
          <figcaption>${e(entry.caption)}</figcaption>
        </figure>`;
}

function preview(locale) {
  const shots = locale.preview.shots.map((s) => screenshotFigure(locale, s, '')).join('\n');
  const wide = screenshotFigure(locale, locale.preview.wide, 'shot-wide');
  return `    <section class="section section-alt" id="preview">
      <div class="wrap">
${sectionHead(locale.preview)}
        <div class="shots shots-phones">
${shots}
        </div>
${wide}
      </div>
    </section>`;
}

function privacy(locale) {
  const items = locale.privacy.items
    .map(
      (item, i) => `          <article class="card card-row">
            <span class="icon">${ICONS[PRIVACY_ICONS[i]] || ICONS.shield}</span>
            <div><h3>${e(item.title)}</h3><p>${e(item.body)}</p></div>
          </article>`,
    )
    .join('\n');
  return `    <section class="section" id="security">
      <div class="wrap">
${sectionHead(locale.privacy)}
        <div class="grid grid-2">
${items}
        </div>
        <p class="privacy-note">${e(locale.privacy.note)}</p>
      </div>
    </section>`;
}

function releaseStrip(locale) {
  const chip = (platform, label, size) =>
    `        <span class="release-chip" data-release-chip data-platform="${platform}"><span>${e(label)}</span><strong>v${e(RELEASES[platform].version)}</strong>${
      size === null ? '' : ` · ${e(RELEASES[platform].sizeMB)} MB`
    }</span>`;
  return `        <div class="release-strip" role="group" aria-label="${e(locale.downloads.stripLabel)}">
          <span class="release-strip-label">${e(locale.downloads.stripLabel)}</span>
${chip('windows', locale.downloads.windows.label, RELEASES.windows.sizeMB)}
${chip('android', locale.downloads.android.label, RELEASES.android.sizeMB)}
${chip('web', locale.downloads.web.label, null)}
        </div>`;
}

function dlCard(locale, platform, release) {
  const copy = locale.downloads[platform];
  const steps = copy.steps.map((s) => `            <li>${e(s)}</li>`).join('\n');
  const icon = platform === 'windows' ? ICONS.windows : platform === 'android' ? ICONS.android : ICONS.globe;
  const sha = platform === 'windows' || platform === 'android' ? release.shaFull || release.shaShort : '';
  const metaLabel =
    platform === 'web'
      ? e(copy.meta)
      : `<span data-release-version data-version-prefix="${e(locale.downloads.versionLabel)}">${e(locale.downloads.versionLabel)} ${release.version}</span> · ${e(copy.meta)}`;

  const details =
    platform === 'web'
      ? `          <p class="dl-body">${e(copy.body)}</p>
          <ol class="install-steps">
${steps}
          </ol>`
      : `          <dl class="dl-meta">
            <div><dt>${e(locale.downloads.sizeLabel)}</dt><dd>${release.sizeMB} MB (${formatBytes(release.sizeBytes)} ${e(locale.downloads.bytesSuffix)})</dd></div>
            <div><dt>${e(locale.downloads.releasedLabel)}</dt><dd data-release-date>${e(release.releasedText)}</dd></div>
            <div><dt>${e(locale.downloads.fileLabel)}</dt><dd>${e(release.fileName)}</dd></div>
            <div class="wide"><dt>${e(locale.downloads.shaLabel)}</dt><dd><span class="sha"><code>${e(sha)}</code></span></dd></div>
            <div class="wide"><dt>${e(locale.downloads.requiresLabel)}</dt><dd>${e(release.requirements)}</dd></div>
          </dl>
          <ol class="install-steps">
${steps}
          </ol>`;

  const qr =
    platform === 'android'
      ? `          <figure class="dl-qr">
            <img src="/assets/apk-qr.svg" alt="${e(copy.qrAlt)}" loading="lazy" width="96" height="96">
            <figcaption>${e(copy.qrCaption)}</figcaption>
          </figure>`
      : '';

  const buttonClass = platform === 'windows' || platform === 'android' ? 'btn btn-primary full' : 'btn btn-light full';
  const body =
    platform === 'android'
      ? `          <div class="dl-android">
${details}
${qr}
          </div>`
      : details;

  return `        <div class="dl-card" data-platform="${platform}">
          <div class="dl-top"><span class="dl-icon">${icon}</span><span class="plat">${e(copy.label)}</span><span class="dl-version">v${e(release.version)}</span></div>
          <h3>${e(copy.title)}</h3>
          <div class="meta">${metaLabel}</div>
${body}
          <a class="${buttonClass}" href="${release.fileUrl}" data-release-link>${e(copy.cta)}</a>
          <div class="alt">${e(copy.alt)}</div>
        </div>`;
}

function downloads(locale) {
  return `    <section class="section section-alt" id="download">
      <div class="wrap">
${sectionHead(locale.downloads)}
${releaseStrip(locale)}
        <div class="dl-notice" data-cached-notice hidden>${e(locale.downloads.cachedNote)}</div>
        <div class="grid grid-3">
${dlCard(locale, 'windows', RELEASES.windows)}
${dlCard(locale, 'android', RELEASES.android)}
${dlCard(locale, 'web', RELEASES.web)}
        </div>
        <p class="dl-checksum-note">${e(locale.downloads.checksumNote)}</p>
      </div>
    </section>`;
}

function steps(locale) {
  const items = locale.steps.items
    .map(
      (s, i) => `          <div class="step"><span class="num">${i + 1}</span><h3>${e(s.title)}</h3><p>${e(s.body)}</p></div>`,
    )
    .join('\n');
  return `    <section class="section" id="how">
      <div class="wrap">
${sectionHead(locale.steps)}
        <div class="grid grid-3">
${items}
        </div>
      </div>
    </section>`;
}

function whatsNew(locale) {
  const cards = locale.whatsNew.releases
    .map(
      (r) => `          <div class="release">
            <div class="release-head"><span class="tag">v${e(r.version)}</span><span class="release-date">${e(locale.whatsNew.platformLabels[r.platform] || r.platform)} · ${e(r.date)}</span></div>
            <ul>
${r.items.map((item) => `              <li><span class="tick">${ICONS.check}</span>${e(item)}</li>`).join('\n')}
            </ul>
          </div>`,
    )
    .join('\n');
  const p = locale.whatsNew.platformLabels;
  return `    <section class="section section-alt" id="whats-new" data-whats-new data-platform-windows="${e(p.windows)}" data-platform-android="${e(p.android)}" data-platform-web="${e(p.web)}">
      <div class="wrap">
${sectionHead(locale.whatsNew)}
        <div class="changelog" data-release-notes>
${cards}
        </div>
      </div>
    </section>`;
}

function faq(locale) {
  const items = locale.faq.items
    .map(
      (item, i) => `        <details class="faq-item"${i === 0 ? ' open' : ''}>
          <summary class="faq-q"><span>${e(item.q)}</span><span class="faq-sign" aria-hidden="true"></span></summary>
          <div class="faq-a"><p>${e(item.a)}</p></div>
        </details>`,
    )
    .join('\n');
  const guides = GUIDES.map(
    (g) => `          <li><a href="${g.path}">${e(g.label[locale.code])}</a></li>`,
  ).join('\n');
  return `    <section class="section" id="faq">
      <div class="wrap">
${sectionHead(locale.faq)}
        <div class="faq">
${items}
        </div>
        <div class="related-guides">
          <h3>${e(locale.faq.guidesTitle)}</h3>
          <ul>
${guides}
          </ul>
        </div>
      </div>
    </section>`;
}

function footer(locale) {
  const linkList = (links) => links.map((l) => `          <a href="${l.href}">${e(l.label)}</a>`).join('\n');
  const guideLinks = GUIDES.map(
    (g) => `          <a href="${g.path}">${e(g.label[locale.code])}</a>`,
  ).join('\n');

  return `  <footer class="site-footer">
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <a class="brand-link" href="/" aria-label="Chatgram home">${LOGO}<span>Chatgram</span></a>
          <p class="foot-tag">${e(locale.footer.tagline)}</p>
        </div>
        <div>
          <h4>${e(locale.footer.productTitle)}</h4>
${linkList(locale.footer.product)}
        </div>
        <div>
          <h4>${e(locale.footer.helpTitle)}</h4>
${linkList(locale.footer.help)}
${locale.footer.legal.map((l) => `          <a href="${l.href}">${e(l.label)}</a>`).join('\n')}
        </div>
        <div>
          <h4>${e(locale.footer.guidesTitle)}</h4>
${guideLinks}
        </div>
      </div>
      <div class="foot-bottom">
        <span>${e(locale.footer.bottom.replace('{year}', String(new Date().getFullYear())))}</span>
        <span>${e(locale.footer.stack)}</span>
      </div>
    </div>
  </footer>`;
}

/* -------------------------------------------------------------------- JSON-LD */
export function softwareJsonLd(siteUrl, lang = 'en') {
  const orgId = `${siteUrl}/#organization`;
  const publisher = { '@id': orgId };
  return [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: 'Chatgram',
      url: `${siteUrl}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}${ICON.svg}`,
        width: 512,
        height: 512,
      },
      description: 'Chatgram is a free messaging app for Android, Windows and the web.',
    },
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: `${siteUrl}/`,
      name: 'Chatgram',
      inLanguage: lang,
      publisher,
    },
    {
      '@type': 'MobileApplication',
      name: 'Chatgram for Android',
      operatingSystem: 'Android 7.0 and newer',
      applicationCategory: 'SocialNetworkingApplication',
      softwareVersion: RELEASES.android.version,
      fileSize: String(RELEASES.android.sizeBytes),
      downloadUrl: `${siteUrl}/downloads/chatgram-android.apk`,
      url: `${siteUrl}/`,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
      publisher,
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Chatgram for Windows',
      operatingSystem: 'Windows 10 and newer (64-bit)',
      applicationCategory: 'SocialNetworkingApplication',
      softwareVersion: RELEASES.windows.version,
      fileSize: String(RELEASES.windows.sizeBytes),
      downloadUrl: `${siteUrl}/downloads/chatgram-windows-setup.exe`,
      url: `${siteUrl}/`,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
      publisher,
    },
  ];
}

export function faqJsonLd(siteUrl, locale, pagePath) {
  return {
    '@type': 'FAQPage',
    '@id': `${siteUrl}${pagePath}#faq`,
    mainEntity: locale.faq.items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

/* ---------------------------------------------------------------------- pages */
export function renderLocalePage({ locale, siteUrl, cssHref, jsHref }) {
  const alternates = [
    ...LANGUAGES.map((l) => ({ hreflang: l.code, path: l.path, ogLocale: l.ogLocale })),
    { hreflang: 'x-default', path: '/', ogLocale: 'en_US' },
  ];
  const heroPhoto = PHOTOS.friends;
  const preload = `  <link rel="preload" as="image" type="image/webp" href="${heroPhoto.webp}" imagesrcset="${heroPhoto.webp}" imagesizes="(max-width: 900px) 92vw, 470px" fetchpriority="high">`;
  const language = LANGUAGES.find((l) => l.code === locale.code);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [...softwareJsonLd(siteUrl, language.htmlLang), faqJsonLd(siteUrl, locale, language.path)],
  };
  const htmlLang = language.htmlLang;
  const pageMeta = { ...locale.meta };

  return `${head({
    siteUrl,
    htmlLang,
    title: pageMeta.title,
    description: pageMeta.description,
    canonicalPath: language.path,
    ogImageAlt: pageMeta.ogImageAlt,
    ogLocale: language.ogLocale,
    jsonLd,
    alternates,
    preload,
    cssHref,
    jsHref,
  })}
<body>
${header(locale)}
  <main id="main">
${hero(locale)}
${features(locale)}
${calls(locale)}
${messaging(locale)}
${preview(locale)}
${privacy(locale)}
${downloads(locale)}
${steps(locale)}
${whatsNew(locale)}
${faq(locale)}
  </main>
${footer(locale)}
</body>
</html>
`;
}

export function renderGuidePage({ content, guide, siteUrl, cssHref, jsHref }) {
  const canonicalPath = guide.path;
  const alternates = [
    { hreflang: 'en', path: guide.path, ogLocale: 'en_US' },
    { hreflang: 'x-default', path: guide.path, ogLocale: 'en_US' },
  ];
  const orgId = `${siteUrl}/#organization`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name: 'Chatgram',
        url: `${siteUrl}/`,
        logo: { '@type': 'ImageObject', url: `${siteUrl}${ICON.svg}`, width: 512, height: 512 },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${siteUrl}${guide.path}#breadcrumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Chatgram home', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: content.h1, item: `${siteUrl}${guide.path}` },
        ],
      },
      {
        '@type': 'TechArticle',
        '@id': `${siteUrl}${guide.path}#article`,
        headline: content.h1,
        description: guide.description,
        inLanguage: 'en',
        datePublished: '2026-10-26',
        dateModified: '2026-10-26',
        author: { '@type': 'Organization', name: 'Chatgram', url: `${siteUrl}/` },
        publisher: { '@id': orgId },
        mainEntityOfPage: `${siteUrl}${guide.path}`,
        image: `${siteUrl}${OG_IMAGE.path}`,
        about: 'Chatgram messaging app',
      },
    ],
  };

  const sections = content.sections
    .map((s) => `        <h2>${e(s.h2)}</h2>\n${s.html.split('\n').map((line) => `        ${line}`).join('\n')}`)
    .join('\n');

  const related = GUIDES.filter((g) => g.path !== guide.path)
    .map((g) => `            <li><a href="${g.path}">${e(g.title)}</a></li>`)
    .join('\n');

  return `${head({
    siteUrl,
    htmlLang: 'en',
    title: guide.title,
    description: guide.description,
    canonicalPath,
    ogImageAlt: `Chatgram guide: ${guide.title}`,
    ogLocale: 'en_US',
    jsonLd,
    alternates,
    preload: '',
    cssHref,
    jsHref,
  })}
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap nav">
      <a class="brand-link" href="/" aria-label="Chatgram home">${LOGO}<span>Chatgram</span></a>
      <div class="nav-spacer"></div>
      <a class="btn btn-primary nav-cta" href="/web/">Open Chatgram</a>
    </div>
  </header>
  <main id="main">
    <div class="guide-head">
      <div class="wrap">
        <nav class="guide-breadcrumb" aria-label="Breadcrumb"><a href="/">Chatgram home</a><span aria-hidden="true">/</span><span>${e(guide.title)}</span></nav>
        <h1>${e(content.h1)}</h1>
        <p class="guide-meta">Updated ${e(content.updated)} · Chatgram guides</p>
      </div>
    </div>
    <div class="wrap">
      <article class="guide-body">
        <p class="guide-intro">${e(content.intro)}</p>
${sections}
        <div class="guide-related">
          <h2>More Chatgram guides</h2>
          <ul>
${related}
          </ul>
          <p><a href="/#download">Download Chatgram for Android or Windows</a> · <a href="/#faq">Chatgram FAQ</a> · <a href="/web/">Open the web app</a></p>
        </div>
      </article>
    </div>
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <div class="foot-bottom">
        <span>© ${new Date().getFullYear()} Chatgram. All rights reserved.</span>
        <span><a href="/">Home</a> · <a href="/docs/">Terms &amp; Privacy</a></span>
      </div>
    </div>
  </footer>
</body>
</html>
`;
}

export function renderNotFound({ siteUrl, cssHref, jsHref }) {
  return `${head({
    siteUrl,
    htmlLang: 'en',
    title: 'Page not found — Chatgram',
    description: 'The page you asked for does not exist. Go to the Chatgram home page, the downloads or the help guides.',
    canonicalPath: '/404.html',
    ogImageAlt: 'Chatgram',
    ogLocale: 'en_US',
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Page not found', isPartOf: { '@id': `${siteUrl}/#website` } },
    alternates: [],
    preload: '',
    cssHref,
    jsHref,
    robots: 'noindex, follow',
  })}
<body>
  <header class="site-header">
    <div class="wrap nav">
      <a class="brand-link" href="/" aria-label="Chatgram home">${LOGO}<span>Chatgram</span></a>
      <div class="nav-spacer"></div>
      <a class="btn btn-primary nav-cta" href="/web/">Open Chatgram</a>
    </div>
  </header>
  <main id="main">
    <div class="error-page">
      <div class="wrap error-inner">
        <span class="eyebrow">404</span>
        <h1>That page is not here</h1>
        <p class="lead">The link may be old or mistyped. These pages do exist:</p>
        <ul class="error-links">
          <li><a href="/">Chatgram home (English)</a></li>
          <li><a href="/rw/">Chatgram mu Kinyarwanda</a></li>
          <li><a href="/fr/">Chatgram en français</a></li>
          <li><a href="/sw/">Chatgram kwa Kiswahili</a></li>
          <li><a href="/#download">Download Chatgram for Android and Windows</a></li>
          <li><a href="/guides/how-to-use-chatgram.html">How to use Chatgram</a></li>
        </ul>
      </div>
    </div>
  </main>
</body>
</html>
`;
}

export function renderSitemap({ siteUrl, entries, lastmod }) {
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${siteUrl}${entry.path}</loc>
    <lastmod>${entry.lastmod || lastmod}</lastmod>
  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function renderRobots(siteUrl) {
  return `# Chatgram robots policy
User-agent: *
Allow: /
# The web app is a client-side application with private screens; keep it out of
# search results. Operator routes are never listed here on purpose.
Disallow: /web/
Disallow: /api/
Disallow: /downloads/

Sitemap: ${siteUrl}/sitemap.xml
`;
}

export function renderManifest() {
  return `{
  "name": "Chatgram",
  "short_name": "Chatgram",
  "description": "Free messaging app for Android, Windows and the web.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0b141a",
  "theme_color": "#008069",
  "icons": [
    { "src": "/assets/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
`;
}
