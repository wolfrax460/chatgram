/**
 * Validates the generated static site. Run by scripts/build.mjs after rendering.
 *
 * The checks are intentionally boring and explicit: title/meta lengths, canonical
 * and hreflang tags, JSON-LD (parse + required fields + FAQ parity), sitemap,
 * robots, image dimensions and the anchors/strings the existing Playwright
 * landing spec looks for.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

export async function validateSite({ distDir, siteUrl, locales, guideContents, guideMeta }) {
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
    check(android && android.fileSize === '1116911', `${label} MobileApplication fileSize must be 1116911`);
    check(android && android.softwareVersion, `${label} MobileApplication needs softwareVersion`);
    check(android && android.offers && String(android.offers.price) === '0', `${label} MobileApplication offers.price must be 0`);

    const windows = findNode(nodes, 'SoftwareApplication');
    check(windows && windows.operatingSystem, `${label} SoftwareApplication needs operatingSystem`);
    check(windows && windows.downloadUrl === `${siteUrl}/downloads/chatgram-windows-setup.exe`, `${label} SoftwareApplication downloadUrl must be the EXE`);
    check(windows && windows.fileSize === '81824358', `${label} SoftwareApplication fileSize must be 81824358`);
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
    check(html.includes('href="/downloads/chatgram-windows-setup.exe"'), `${label} missing real Windows download link`);
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
        'v1.1.2',
        '#download',
      ]) {
        check(html.includes(needle), `[en] missing expected copy "${needle}" for the existing Playwright landing spec`);
      }
      check(html.includes('81,824,358'), '[en] Windows size must state the real 81,824,358 bytes');
      check(html.includes('1,116,911'), '[en] Android size must state the real 1,116,911 bytes');
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
    const words = visibleWordCount(html);
    check(words >= 400 && words <= 700, `[guide ${content.slug}] visible word count is ${words} (needs 400-700)`);
    notes.push(`guide ${content.slug}: ${words} words`);
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

  /* ----------------------------------------------------- sitemap / robots */
  const sitemap = await readFile(path.join(distDir, 'sitemap.xml'), 'utf8');
  const sitemapPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expectedPaths = [
    `${siteUrl}/`,
    ...locales.filter((l) => l.path !== '/').map((l) => `${siteUrl}${l.path}`),
    ...guideContents.map((g) => `${siteUrl}${guideMeta.get(g.slug).path}`),
  ];
  for (const url of expectedPaths) check(sitemapPaths.includes(url), `sitemap is missing ${url}`);
  check(sitemapPaths.length === expectedPaths.length, `sitemap has ${sitemapPaths.length} URLs, expected ${expectedPaths.length}`);
  check((sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length === expectedPaths.length, 'sitemap entries must all have lastmod');
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
