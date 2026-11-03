#!/usr/bin/env node
/**
 * Static site build for the Chatgram landing page.
 *
 *   npm run build --prefix client/landing
 *
 * Produces real, crawlable HTML in dist/:
 *   /                    English landing page
 *   /rw/  /fr/  /sw/     Kinyarwanda, French and Swahili landing pages
 *   /guides/*.html       four long-form content pages
 *   404.html, sitemap.xml, robots.txt, site.webmanifest
 *
 * The origin comes from SITE_URL (see content/site-url.mjs; default is the
 * current host) so the same build works on a custom domain without editing any
 * page. The Android APK QR code is generated from that same origin.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_PAGES, CONTENT_UPDATED_ISO, GUIDES, LANGUAGES, RELEASES, contentPagePath } from '../content/site.mjs';
import { resolveSiteUrl } from '../content/site-url.mjs';
import en from '../content/landing.en.mjs';
import rw from '../content/landing.rw.mjs';
import fr from '../content/landing.fr.mjs';
import sw from '../content/landing.sw.mjs';
import { GUIDES_CONTENT } from '../content/guides.mjs';
import * as pagesEn from '../content/pages.en.mjs';
import * as pagesRw from '../content/pages.rw.mjs';
import * as pagesFr from '../content/pages.fr.mjs';
import * as pagesSw from '../content/pages.sw.mjs';
import { renderContentPage, renderGuidePage, renderLocalePage, renderManifest, renderNotFound, renderRobots, renderSitemap } from './templates.mjs';
import { qrSvg } from './qr.mjs';
import { validateSite } from './validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING = path.resolve(__dirname, '..');
const DIST = path.join(LANDING, 'dist');
const CONTENT = { en, rw, fr, sw };
const PAGE_CONTENT = { en: pagesEn.PAGES, rw: pagesRw.PAGES, fr: pagesFr.PAGES, sw: pagesSw.PAGES };

function assetHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 10);
}

async function write(relPath, contents) {
  const target = path.join(DIST, relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
  return target;
}

async function main() {
  const siteUrl = resolveSiteUrl();
  const locales = [en, rw, fr, sw];
  const today = new Date().toISOString().slice(0, 10);

  console.log(`==> Chatgram landing build`);
  console.log(`    SITE_URL=${siteUrl}`);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, 'static'), { recursive: true });

  /* Public files (screenshots, docs page, icons) are copied verbatim. */
  await cp(path.join(LANDING, 'public'), DIST, { recursive: true });

  /* The APK QR code encodes an absolute URL, so it is generated from SITE_URL
     here instead of shipping a checked-in image that would go stale when the
     site moves to a new host. */
  const apkUrl = `${siteUrl}${RELEASES.android.fileUrl}`;
  await write('assets/apk-qr.svg', qrSvg(apkUrl));
  console.log(`    qr   /assets/apk-qr.svg -> ${apkUrl}`);

  /* One small CSS + one small JS file, content-hashed for immutable caching. */
  const css = [
    await readFile(path.join(LANDING, 'src', 'styles.css'), 'utf8'),
    await readFile(path.join(LANDING, 'src', 'pages.css'), 'utf8'),
  ].join('\n');
  const js = await readFile(path.join(LANDING, 'src', 'site.js'), 'utf8');
  const cssHref = `/static/site-${assetHash(css)}.css`;
  const jsHref = `/static/site-${assetHash(js)}.js`;
  await write(cssHref.replace(/^\//, ''), css);
  await write(jsHref.replace(/^\//, ''), js);
  console.log(`    css ${cssHref} (${(Buffer.byteLength(css) / 1024).toFixed(1)} KB)`);
  console.log(`    js  ${jsHref} (${(Buffer.byteLength(js) / 1024).toFixed(1)} KB)`);

  /* Landing pages, one real HTML file per language. */
  for (const locale of LANGUAGES) {
    const content = CONTENT[locale.code];
    const rel = locale.path === '/' ? 'index.html' : path.join(locale.path.replace(/^\/|\/$/g, ''), 'index.html');
    await write(rel, renderLocalePage({ locale: content, siteUrl, cssHref, jsHref }));
    console.log(`    wrote ${rel.replace(/\\/g, '/')}  (${locale.code})`);
  }

  /* Guide pages. */
  const guideMeta = new Map(GUIDES.map((g) => [g.slug, g]));
  for (const content of GUIDES_CONTENT) {
    const meta = guideMeta.get(content.slug);
    if (!meta) throw new Error(`guides.mjs has ${content.slug} but site.mjs does not list it`);
    await write(meta.path.replace(/^\//, ''), renderGuidePage({ content, guide: meta, siteUrl, cssHref, jsHref }));
    console.log(`    wrote ${meta.path}`);
  }

  /* 404, sitemap, robots, web manifest. */
  await write('404.html', renderNotFound({ siteUrl, cssHref, jsHref }));

  /* Long-form content pages: /about/, /fr/about/ ... one real HTML file each. */
  const contentPages = [];
  for (const locale of LANGUAGES) {
    const bundle = PAGE_CONTENT[locale.code];
    for (const meta of CONTENT_PAGES) {
      const page = bundle[meta.slug];
      if (!page) throw new Error(`pages.${locale.code}.mjs is missing "${meta.slug}"`);
      const pathname = contentPagePath(meta.slug, locale.code);
      await write(`${pathname.replace(/^\//, '')}index.html`, renderContentPage({ page, meta, language: locale, siteUrl, cssHref, jsHref }));
      contentPages.push({ code: locale.code, path: pathname, meta, page });
      console.log(`    wrote ${pathname}  (${locale.code})`);
    }
  }

  const landingAlternates = [
    ...LANGUAGES.map((l) => ({ hreflang: l.code, path: l.path })),
    { hreflang: 'x-default', path: '/' },
  ];
  const entries = [
    ...LANGUAGES.map((l) => ({ path: l.path, lastmod: today, alternates: landingAlternates })),
    ...contentPages.map(({ path: pathname, meta }) => ({
      path: pathname,
      lastmod: CONTENT_UPDATED_ISO,
      alternates: [
        ...LANGUAGES.map((l) => ({ hreflang: l.code, path: contentPagePath(meta.slug, l.code) })),
        { hreflang: 'x-default', path: contentPagePath(meta.slug, 'en') },
      ],
    })),
    ...GUIDES.map((g) => ({ path: g.path, lastmod: today })),
  ];
  await write('sitemap.xml', renderSitemap({ siteUrl, entries, lastmod: today }));
  await write('robots.txt', renderRobots(siteUrl));
  await write('site.webmanifest', renderManifest());

  /* Validate everything that was written. */
  const { failures, notes } = await validateSite({
    distDir: DIST,
    siteUrl,
    locales: LANGUAGES.map((language) => ({ ...CONTENT[language.code], path: language.path, htmlLang: language.htmlLang })),
    guideContents: GUIDES_CONTENT,
    guideMeta,
    contentPages,
  });

  for (const note of notes) console.log(`    · ${note}`);
  if (failures.length) {
    console.error(`\n==> ${failures.length} validation failure(s):`);
    for (const failure of failures) console.error(`    ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n==> build OK: ${entries.length + 1} HTML entry points + 404, sitemap, robots, manifest`);
}

main().catch((error) => {
  console.error(`\n==> build failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
