#!/usr/bin/env node
/**
 * Quick static check of a built landing site (no browser needed).
 *
 *   node scripts/check-dist.mjs            # checks ./dist
 *   node scripts/check-dist.mjs dist       # checks a custom directory
 *
 * Prints the real <title>, meta description, <h1> and FAQ counts for each
 * language page, then verifies sitemap.xml, robots.txt and the guide pages.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', process.argv[2] || 'dist');
const pages = [
  ['/', 'index.html'],
  ['/rw/', 'rw/index.html'],
  ['/fr/', 'fr/index.html'],
  ['/sw/', 'sw/index.html'],
];
const guides = [
  '/guides/how-to-use-chatgram.html',
  '/guides/chatgram-android-download-install.html',
  '/guides/chatgram-windows-download-smartscreen.html',
  '/guides/chatgram-ai-four-languages.html',
];

let failures = 0;
function ok(condition, message) {
  if (condition) {
    console.log(`  \u2713 ${message}`);
  } else {
    failures += 1;
    console.log(`  \u2717 ${message}`);
  }
}
function text(html, regex) {
  return (html.match(regex) || [])[1] || '';
}
function plain(html) {
  return html
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const [url, rel] of pages) {
  const html = await readFile(path.join(DIST, rel), 'utf8');
  const title = plain(text(html, /<title>([\s\S]*?)<\/title>/));
  const description = text(html, /<meta name="description" content="([^"]*)"/);
  const h1 = plain(text(html, /<h1>([\s\S]*?)<\/h1>/));
  const canonical = text(html, /<link rel="canonical" href="([^"]+)"/);
  const faqVisible = (html.match(/<details class="faq-item"/g) || []).length;
  const ld = JSON.parse(text(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
  const faqLd = (ld['@graph'] || []).find((node) => node['@type'] === 'FAQPage');
  console.log(`\n${url} -> ${rel}`);
  console.log(`  title (${title.length}): ${title}`);
  console.log(`  description (${description.length}): ${description}`);
  console.log(`  h1: ${h1}`);
  ok(title.length > 0 && title.length <= 60, 'title is within 60 characters');
  ok(description.length > 0 && description.length <= 155, 'meta description is within 155 characters');
  ok(h1.includes('Chatgram'), 'H1 includes the Chatgram brand');
  ok(canonical.endsWith(url), `canonical points at ${url}`);
  ok(faqVisible > 0, `${faqVisible} FAQ items are real HTML`);
  ok(Boolean(faqLd) && faqLd.mainEntity.length === faqVisible, 'FAQPage JSON-LD matches the visible FAQ count');
  ok(html.includes('hreflang="x-default"'), 'hreflang x-default present');
  ok(html.includes('/assets/og-image-1200x630.png'), '1200x630 og:image present');
  ok(html.includes('href="https://chatgram.duckdns.org/downloads/chatgram-windows-setup.exe"') && html.includes('href="/downloads/chatgram-android.apk"'), 'real download links present');
}

for (const rel of guides) {
  const file = path.join(DIST, rel);
  const info = await stat(file);
  const html = await readFile(file, 'utf8');
  console.log(`\n${rel}`);
  console.log(`  ${Math.round(info.size / 1024)} KB, h1: ${plain(text(html, /<h1>([\s\S]*?)<\/h1>/)).slice(0, 90)}`);
  ok(info.size > 4000, 'guide page has substantial real HTML');
  ok(html.includes('<h2>'), 'guide page has section headings');
}

const sitemap = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
const robots = await readFile(path.join(DIST, 'robots.txt'), 'utf8');
const notFound = await readFile(path.join(DIST, '404.html'), 'utf8');
console.log('\nsitemap.xml / robots.txt / 404.html');
console.log(`  sitemap URLs: ${(sitemap.match(/<loc>/g) || []).length}`);
console.log(`  sitemap lastmod entries: ${(sitemap.match(/<lastmod>/g) || []).length}`);
ok((sitemap.match(/<loc>/g) || []).length === 8, 'sitemap lists the 4 language pages + 4 guides');
ok(robots.includes('Sitemap: https://'), 'robots.txt points at the sitemap');
ok(!/admin/i.test(robots), 'robots.txt does not mention admin paths');
ok(notFound.includes('noindex'), '404.html is noindex');
ok(notFound.includes('That page is not here'), '404.html is a real branded page');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nall static checks passed');
}
