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
 * The origin comes from SITE_URL (default https://chatgram-xi.vercel.app) so the
 * same build works on a custom domain without editing any page.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUIDES, LANGUAGES, SITE } from '../content/site.mjs';
import en from '../content/landing.en.mjs';
import rw from '../content/landing.rw.mjs';
import fr from '../content/landing.fr.mjs';
import sw from '../content/landing.sw.mjs';
import { GUIDES_CONTENT } from '../content/guides.mjs';
import { renderGuidePage, renderLocalePage, renderManifest, renderNotFound, renderRobots, renderSitemap } from './templates.mjs';
import { validateSite } from './validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING = path.resolve(__dirname, '..');
const DIST = path.join(LANDING, 'dist');
const CONTENT = { en, rw, fr, sw };

function resolveSiteUrl() {
  const raw = (process.env.SITE_URL || SITE.defaultUrl).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`SITE_URL is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`SITE_URL must use https:// (got ${raw})`);
  if (parsed.search || parsed.hash) throw new Error('SITE_URL must not contain a query string or hash');
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

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

  /* Public files (screenshots, QR, docs page, icons) are copied verbatim. */
  await cp(path.join(LANDING, 'public'), DIST, { recursive: true });

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
  const entries = [
    ...LANGUAGES.map((l) => ({ path: l.path, lastmod: today })),
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
