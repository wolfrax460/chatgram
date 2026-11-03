/**
 * Validates the generated static site. Run by scripts/build.mjs after rendering.
 *
 * The checks are intentionally boring and explicit: title/meta lengths, canonical
 * and hreflang tags, JSON-LD (parse + required fields + FAQ parity), sitemap,
 * robots, image dimensions and the anchors/strings the existing Playwright
 * landing spec looks for.
 */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { LANGUAGES, contentPagePath } from '../content/site.mjs';

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function decodeEntities(value) {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function visibleWordCount(html) {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const words = decodeEntities(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
  return words.length;
}

function extractLdJson(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return blocks.map((block, i) => {
    try {
      return JSON.parse(block);
    } catch (error) {
      fail(`JSON-LD block ${i + 1} is not valid JSON: ${error.message}`);
      return null;
    }
  });
}

function collectTypes(jsonLd) {
  const nodes = [];
  for (const block of jsonLd) {
    if (!block) continue;
    if (block['@graph']) nodes.push(...block['@graph']);
    else nodes.push(block);
  }
  return nodes;
}

function findNode(nodes, type) {
  return nodes.find((node) => node && node['@type'] === type);
}

function pngSize(buffer) {
  // PNG IHDR: 8-byte signature, 4-byte length, "IHDR", then width/height.
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function readHtml(distDir, relPath) {
  return readFile(path.join(distDir, relPath), 'utf8');
}

export async function validateSite({ distDir, siteUrl, locales, guideContents, guideMeta, contentPages = [] }) {
  const today = new Date().toISOString().slice(0, 10);

  /* ---------------------------------------------------------------- landing */
  for (const locale of locales) {
    const rel = locale.path === '/' ? 'index.html' : `${locale.path.replace(/^\/|\/$/g, '')}/index.html`;
    const html = await readHtml(distDir, rel);
    const canonical = `${siteUrl}${locale.path}`;
    const label = `[${locale.code}]`;

    const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    check(title.length > 0 && title.length <= 60, `${label} <title> must be 1-60 chars, got ${title.length}`);
    const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    check(description.length >= 70 && description.length <= 155, `${label} meta description must be 70-155 chars, got ${description.length}`);

    check(html.includes(`<link rel="canonical" href="${canonical}">`), `${label} missing self-referencing canonical ${canonical}`);
    for (const lang of ['en', 'rw', 'fr', 'sw']) {
      const alt = lang === 'en' ? `${siteUrl}/` : `${siteUrl}/${lang}/`;
      check(html.includes(`hreflang="${lang}" href="${alt}"`), `${label} missing hreflang="${lang}" -> ${alt}`);
    }
    check(html.includes(`hreflang="x-default" href="${siteUrl}/"`), `${label} missing hreflang x-default`);

    const h1s = html.match(/<h1[\s>]/g) || [];
    check(h1s.length === 1, `${label} must have exactly one <h1>, found ${h1s.length}`);
    check(/<h1>[^<]*Chatgram/.test(html) || /<h1>Chatgram/.test(html) || /<h1>.*Chatgram/s.test(html), `${label} H1 must include the Chatgram brand`);

    const esc = (value) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    for (const heading of [locale.features.title, locale.preview.title, locale.privacy.title, locale.downloads.title, locale.faq.title]) {
      check(html.includes(`<h2>${esc(heading)}</h2>`), `${label} missing required H2 "${heading}"`);
    }

    check(html.includes('property="og:image" content="' + `${siteUrl}/assets/og-image-1200x630.png"`), `${label} missing 1200x630 og:image`);
    check(html.includes('name="twitter:card" content="summary_large_image"'), `${label} missing twitter card`);
    check(html.includes('rel="manifest" href="/site.webmanifest"'), `${label} missing web app manifest`);
    check(html.includes('rel="apple-touch-icon"'), `${label} missing apple-touch-icon`);
    check(html.includes('name="theme-color"'), `${label} missing theme-color`);

    const jsonLd = extractLdJson(html);
    check(jsonLd.length >= 1, `${label} missing JSON-LD`);
    const nodes = collectTypes(jsonLd);
    const org = findNode(nodes, 'Organization');
    check(org && org.name === 'Chatgram' && org.url === `${siteUrl}/`, `${label} Organization JSON-LD needs name + url`);
    check(org && org.logo && org.logo.url, `${label} Organization JSON-LD needs a logo`);
    check(org && !('sameAs' in org), `${label} Organization JSON-LD must not invent sameAs profiles`);
    const site = findNode(nodes, 'WebSite');
    check(site && site.name === 'Chatgram' && site.url, `${label} WebSite JSON-LD needs name + url`);

    const android = findNode(nodes, 'MobileApplication');
    check(android && android.operatingSystem, `${label} MobileApplication needs operatingSystem`);
    check(android && android.downloadUrl === `${siteUrl}/downloads/chatgram-android.apk`, `${label} MobileApplication downloadUrl must be the APK`);
    check(android && android.fileSize === '1589034', `${label} MobileApplication fileSize must be 1589034`);
    check(android && android.softwareVersion, `${label} MobileApplication needs softwareVersion`);
    check(android && android.offers && String(android.offers.price) === '0', `${label} MobileApplication offers.price must be 0`);

    const windows = findNode(nodes, 'SoftwareApplication');
    check(windows && windows.operatingSystem, `${label} SoftwareApplication needs operatingSystem`);
    check(windows && windows.downloadUrl === 'https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe', `${label} SoftwareApplication downloadUrl must be the direct EXE URL`);
    check(windows && windows.fileSize === '86263690', `${label} SoftwareApplication fileSize must be 86263690`);
    check(windows && windows.softwareVersion, `${label} SoftwareApplication needs softwareVersion`);
    check(windows && windows.offers && String(windows.offers.price) === '0', `${label} SoftwareApplication offers.price must be 0`);

    const faq = findNode(nodes, 'FAQPage');
    check(faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length === locale.faq.items.length, `${label} FAQPage must match the visible FAQ item count`);
    if (faq && Array.isArray(faq.mainEntity)) {
      locale.faq.items.forEach((item, i) => {
        const node = faq.mainEntity[i];
        check(node && node.name === item.q, `${label} FAQPage question ${i + 1} does not match the visible question`);
        check(
          node && node.acceptedAnswer && node.acceptedAnswer.text === item.a,
          `${label} FAQPage answer ${i + 1} does not match the visible answer`,
        );
      });
    }
    check(!html.includes('aggregateRating'), `${label} must not include aggregateRating`);
    check(!/"review"\s*:/.test(html), `${label} must not include review markup`);
    check(!html.includes('http://'), `${label} must not contain insecure http:// links`);

    // Anchors and copy the existing Playwright landing spec relies on.
    for (const id of ['features', 'preview', 'security', 'download', 'how', 'whats-new', 'faq']) {
      check(html.includes(`id="${id}"`), `${label} missing #${id} anchor`);
    }
    check(html.includes('src="/assets/apk-qr.svg"'), `${label} missing APK QR image`);
    check(html.includes('href="https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe"'), `${label} missing real Windows download link`);
    check(html.includes('href="/downloads/chatgram-android.apk"'), `${label} missing real Android download link`);

    if (locale.code === 'en') {
      for (const needle of [
        'Download for Windows',
        'Download APK',
        'More info',
        'Run anyway',
        'Android 7.0+',
        'Install unknown apps',
        'Chatgram AI',
        'Windows and Android apps',
        'v1.1.7',
        '#download',
      ]) {
        check(html.includes(needle), `[en] missing expected copy "${needle}" for the existing Playwright landing spec`);
      }
      check(html.includes('86,263,690'), '[en] Windows size must state the real 86,263,690 bytes');
      check(html.includes('1,589,034'), '[en] Android size must state the real 1,589,034 bytes');
    }

    // FAQ parity: every visible question/answer is present as text in the page.
    for (const item of locale.faq.items) {
      check(html.includes(`<span>${esc(item.q)}</span>`), `${label} visible FAQ question missing: ${item.q}`);
      check(html.includes(`<p>${esc(item.a)}</p>`), `${label} visible FAQ answer missing for: ${item.q}`);
    }
  }

  /* ----------------------------------------------------------------- guides */
  for (const content of guideContents) {
    const meta = guideMeta.get(content.slug);
    if (!meta) {
      fail(`guide ${content.slug} has no metadata in site.mjs`);
      continue;
    }
    const html = await readHtml(distDir, meta.path.replace(/^\//, ''));
    check(meta.title.length <= 60, `[guide ${content.slug}] title is ${meta.title.length} chars (max 60)`);
    check(meta.description.length >= 70 && meta.description.length <= 160, `[guide ${content.slug}] description is ${meta.description.length} chars (70-160)`);
    const bodyWords = visibleWordCount([content.intro, ...content.sections.map((s) => `${s.h2} ${s.html}`)].join(' '));
    const words = visibleWordCount(html);
    check(bodyWords >= 600 && bodyWords <= 900, `[guide ${content.slug}] article body is ${bodyWords} words (needs 600-900)`);
    check(words >= 650 && words <= 1100, `[guide ${content.slug}] rendered page is ${words} words (needs 650-1100)`);
    notes.push(`guide ${content.slug}: ${bodyWords} body words`);
    check(html.includes(`<link rel="canonical" href="${siteUrl}${meta.path}">`), `[guide ${content.slug}] missing canonical`);
    check(html.includes(`<h1>`), `[guide ${content.slug}] missing H1`);
    const jsonLd = extractLdJson(html);
    const nodes = collectTypes(jsonLd);
    const article = findNode(nodes, 'TechArticle');
    check(article && article.headline && article.description, `[guide ${content.slug}] TechArticle needs headline + description`);
    check(findNode(nodes, 'BreadcrumbList'), `[guide ${content.slug}] missing BreadcrumbList`);
    const links = (html.match(/href="\/downloads\/[^"]+"/g) || []).map((h) => h.slice(6, -1));
    const allowed = new Set(['/downloads/chatgram-windows-setup.exe', '/downloads/chatgram-android.apk']);
    for (const link of links) check(allowed.has(link), `[guide ${content.slug}] unexpected download link ${link}`);
  }

  /* --------------------------------------------------------- content pages */
  for (const { code, path: pathname, meta, page } of contentPages) {
    const label = `[content ${code}/${meta.slug}]`;
    const rel = `${pathname.replace(/^\//, '')}index.html`;
    const html = await readHtml(distDir, rel);
    const canonical = `${siteUrl}${pathname}`;

    check(page.title.length >= 10 && page.title.length <= 60, `${label} title is ${page.title.length} chars (10-60)`);
    check(page.description.length >= 70 && page.description.length <= 155, `${label} description is ${page.description.length} chars (70-155)`);
    check(html.includes(`<link rel="canonical" href="${canonical}">`), `${label} missing self-referencing canonical ${canonical}`);
    for (const language of LANGUAGES) {
      const alt = `${siteUrl}${contentPagePath(meta.slug, language.code)}`;
      check(html.includes(`hreflang="${language.code}" href="${alt}"`), `${label} missing hreflang="${language.code}" -> ${alt}`);
    }
    check(
      html.includes(`hreflang="x-default" href="${siteUrl}${contentPagePath(meta.slug, 'en')}"`),
      `${label} missing hreflang x-default -> English page`,
    );

    const h1s = html.match(/<h1[\s>]/g) || [];
    check(h1s.length === 1, `${label} must have exactly one <h1>, found ${h1s.length}`);
    check(html.includes(`<html lang="${code}"`), `${label} <html lang> must be "${code}"`);
    const esc = (value) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    check(html.includes(`<h2>${esc(page.sections[0].h2)}</h2>`), `${label} first H2 is missing`);

    const bodyWords = visibleWordCount(
      [page.intro, ...page.sections.map((s) => `${s.h2} ${s.html}`), ...page.faq.flatMap((f) => [f.q, f.a])].join(' '),
    );
    check(bodyWords >= 600 && bodyWords <= 900, `${label} body has ${bodyWords} words (needs 600-900)`);
    notes.push(`content ${code}/${meta.slug}: ${bodyWords} words`);

    const nodes = collectTypes(extractLdJson(html));
    const webpage = nodes.find((node) => node && node['@type'] === 'WebPage');
    check(webpage && webpage.url === canonical, `${label} WebPage JSON-LD must carry the canonical url`);
    check(nodes.some((node) => node && node['@type'] === 'BreadcrumbList'), `${label} missing BreadcrumbList JSON-LD`);
    const faqNode = nodes.find((node) => node && node['@type'] === 'FAQPage');
    check(faqNode && faqNode.mainEntity.length === page.faq.length, `${label} FAQPage must match the visible FAQ items`);

    check(!html.includes('aggregateRating'), `${label} must not include aggregateRating`);
    check(!html.includes('http://'), `${label} must not contain insecure http:// links`);

    /* /web/, /api/ and /downloads/ are served by the app, the API and the
       download directory, not by files in dist/, so they are checked by name. */
    const runtimePaths = /^\/(web|api|downloads)(\/|$)/;
    const hrefs = [...new Set((html.match(/href="(\/[^"#]*)"/g) || []).map((h) => h.slice(6, -1)))];
    for (const href of hrefs) {
      if (runtimePaths.test(href)) continue;
      const target = path.join(distDir, href.replace(/^\//, ''));
      const candidates = href.endsWith('/') ? [path.join(target, 'index.html')] : [target, `${target}.html`, path.join(target, 'index.html')];
      let found = false;
      for (const candidate of candidates) {
        try {
          await access(candidate);
          found = true;
          break;
        } catch {
          /* try the next candidate */
        }
      }
      check(found, `${label} internal link ${href} does not resolve to a built file`);
    }
  }

  /* ----------------------------------------------------- sitemap / robots */
  const sitemap = await readFile(path.join(distDir, 'sitemap.xml'), 'utf8');
  const sitemapPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expectedPaths = [
    `${siteUrl}/`,
    ...locales.filter((l) => l.path !== '/').map((l) => `${siteUrl}${l.path}`),
    ...guideContents.map((g) => `${siteUrl}${guideMeta.get(g.slug).path}`),
    ...contentPages.map((c) => `${siteUrl}${c.path}`),
  ];
  for (const url of expectedPaths) check(sitemapPaths.includes(url), `sitemap is missing ${url}`);
  check(sitemapPaths.length === expectedPaths.length, `sitemap has ${sitemapPaths.length} URLs, expected ${expectedPaths.length}`);
  check((sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length === expectedPaths.length, 'sitemap entries must all have lastmod');
  check(sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'), 'sitemap must declare the xhtml namespace for hreflang alternates');
  check((sitemap.match(/<xhtml:link rel="alternate" hreflang="x-default"/g) || []).length === locales.length + contentPages.length, 'sitemap must carry an x-default alternate for every translated page');
  if (today) notes.push(`sitemap lastmod ${today}`);

  const robots = await readFile(path.join(distDir, 'robots.txt'), 'utf8');
  check(/Sitemap: https:\/\//.test(robots), 'robots.txt must contain an absolute https Sitemap line');
  check(robots.includes(`${siteUrl}/sitemap.xml`), 'robots.txt Sitemap must use SITE_URL');
  check(robots.includes('Disallow: /web/'), 'robots.txt must disallow /web/');
  check(robots.includes('Disallow: /api/'), 'robots.txt must disallow /api/');
  check(!/admin/i.test(robots), 'robots.txt must not mention admin paths');

  /* ----------------------------------------------------------- other files */
  const notFound = await readFile(path.join(distDir, '404.html'), 'utf8');
  check(notFound.includes('name="robots" content="noindex'), '404.html must be noindex');
  check(notFound.includes('Chatgram'), '404.html must be branded');

  const manifest = JSON.parse(await readFile(path.join(distDir, 'site.webmanifest'), 'utf8'));
  check(manifest.name === 'Chatgram' && manifest.theme_color === '#008069', 'site.webmanifest must carry the brand name/theme');

  const ogBuffer = await readFile(path.join(distDir, 'assets', 'og-image-1200x630.png'));
  const dims = pngSize(ogBuffer);
  check(dims && dims.width === 1200 && dims.height === 630, `og-image-1200x630.png must be exactly 1200x630, got ${JSON.stringify(dims)}`);

  const docs = await readFile(path.join(distDir, 'docs', 'index.html'), 'utf8');
  check(docs.includes('Chatgram'), '/docs/index.html must still be copied');

  // The new language pages must be reachable as real HTML files.
  for (const rel of ['rw/index.html', 'fr/index.html', 'sw/index.html']) {
    const html = await readHtml(distDir, rel);
    check(html.includes('<h1'), `${rel} must contain a real H1`);
  }

  return { failures, notes };
}
