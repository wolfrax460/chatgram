#!/usr/bin/env node
/**
 * SEO audit for the Chatgram marketing site.
 *
 * Dependency-free (Node 20+, global fetch/AbortSignal), no build step:
 *
 *   node scripts/seo-audit.mjs [--origin https://chatgram.qd.je] [--dist client/landing/dist] [--json] [--quiet]
 *
 * Default mode fetches the eight public pages and the site files from the live
 * HTTPS origin. `--dist DIR` audits the generated static build instead; checks
 * that need the network are marked SKIP. `--json` prints only the machine
 * readable report, `--quiet` prints only the one line summary.
 *
 * Exit code: 1 when any check FAILs, 0 otherwise.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ORIGIN = 'https://chatgram.qd.je';
const DEFAULT_DIST = 'client/landing/dist';
const TIMEOUT_MS = 10_000;
const MAX_CONCURRENCY = 4;
const MAX_INTERNAL_LINKS = 120;
const VERCEL_HOST = 'https://chatgram-xi.vercel.app/';
const USER_AGENT = 'chatgram-seo-audit/1.0';

/** Pages audited in both modes. `file` is the path inside a `--dist` build. */
const LOCALES = ['en', 'rw', 'fr', 'sw'];
const CONTENT_SLUGS = ['about', 'is-chatgram-free', 'whats-new', 'privacy-and-safety'];
const REQUIRED_HREFLANGS = [...LOCALES, 'x-default'];

const PAGES = [
  ...LOCALES.map((code) => ({
    path: code === 'en' ? '/' : `/${code}/`,
    file: code === 'en' ? 'index.html' : `${code}/index.html`,
    translated: true,
  })),
  ...LOCALES.flatMap((code) =>
    CONTENT_SLUGS.map((slug) => {
      const pagePath = code === 'en' ? `/${slug}/` : `/${code}/${slug}/`;
      return { path: pagePath, file: `${pagePath.slice(1)}index.html`, translated: true };
    }),
  ),
  // Guides are published in English only for now; they still need en + x-default.
  { path: '/guides/how-to-use-chatgram.html', file: 'guides/how-to-use-chatgram.html', translated: false },
  { path: '/guides/chatgram-android-download-install.html', file: 'guides/chatgram-android-download-install.html', translated: false },
  { path: '/guides/chatgram-windows-download-smartscreen.html', file: 'guides/chatgram-windows-download-smartscreen.html', translated: false },
  { path: '/guides/chatgram-ai-four-languages.html', file: 'guides/chatgram-ai-four-languages.html', translated: false },
];

/* ------------------------------------------------------------------ results */

/** @type {{name: string, status: string, detail: string}[]} */
const checks = [];

function record(status, name, detail = '') {
  checks.push({ name, status, detail });
}
const pass = (name, detail = '') => record('PASS', name, detail);
const fail = (name, detail = '') => record('FAIL', name, detail);
const warn = (name, detail = '') => record('WARN', name, detail);
const skip = (name, detail = '') => record('SKIP', name, detail);

function summarize() {
  const summary = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const check of checks) summary[check.status.toLowerCase()] += 1;
  return summary;
}

function summaryLine(summary) {
  return `seo-audit: ${summary.pass} passed, ${summary.fail} failed, ${summary.warn} warnings, ${summary.skip} skipped`;
}

/* --------------------------------------------------------------- CLI options */

function parseCli(argv) {
  const options = { origin: DEFAULT_ORIGIN, dist: null, json: false, quiet: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--dist' || arg.startsWith('--dist=')) {
      const value = arg === '--dist' ? argv[++index] : arg.slice('--dist='.length);
      if (!value) throw new Error('--dist needs a directory');
      options.dist = value;
    } else if (arg === '--origin' || arg.startsWith('--origin=')) {
      const value = arg === '--origin' ? argv[++index] : arg.slice('--origin='.length);
      if (!value) throw new Error('--origin needs an https origin');
      options.origin = normalizeOrigin(value);
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/seo-audit.mjs [--origin https://chatgram.qd.je] [--dist client/landing/dist] [--json] [--quiet]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  options.origin = normalizeOrigin(options.origin);
  return options;
}

function normalizeOrigin(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch {
    throw new Error(`invalid --origin URL: ${raw}`);
  }
  if (parsed.protocol !== 'https:') throw new Error('--origin must be an https:// URL');
  if (parsed.search || parsed.hash) throw new Error('--origin must not contain a query string or hash');
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || parsed.origin;
}

/* ---------------------------------------------------- concurrency + network */

let activeRequests = 0;
const pendingRequests = [];

/** Run a network task, never more than MAX_CONCURRENCY at a time. */
function schedule(task) {
  return new Promise((resolve, reject) => {
    pendingRequests.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (activeRequests < MAX_CONCURRENCY && pendingRequests.length > 0) {
    const next = pendingRequests.shift();
    activeRequests += 1;
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        activeRequests -= 1;
        pump();
      });
  }
}

function timeoutSignal() {
  return AbortSignal.timeout(TIMEOUT_MS);
}

async function rawFetch(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: { 'user-agent': USER_AGENT, ...(init.headers || {}) },
    signal: init.signal || timeoutSignal(),
  });
}

function errorText(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return `timeout after ${TIMEOUT_MS / 1000}s`;
  const cause = error?.cause?.code || error?.cause?.message;
  return cause ? `${error.message} (${cause})` : String(error?.message || error);
}

/** GET a URL and read the body (used for HTML, robots.txt and sitemap.xml). */
async function fetchText(url, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  const response = await rawFetch(url, { redirect: 'follow', headers: { accept } });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

async function drain(response) {
  try {
    await response.body?.cancel();
  } catch {
    /* body may already be consumed or absent */
  }
}

/**
 * Resolve a URL to its final status with HEAD, falling back to GET only when the
 * server rejects HEAD (405/501) or the HEAD request itself fails.
 */
async function probeStatus(url) {
  try {
    const head = await rawFetch(url, { method: 'HEAD', redirect: 'follow' });
    if (head.status !== 405 && head.status !== 501) {
      await drain(head);
      return { status: head.status };
    }
  } catch {
    /* fall through to GET */
  }
  try {
    const get = await rawFetch(url, { method: 'GET', redirect: 'follow', headers: { accept: '*/*' } });
    const status = get.status;
    await drain(get);
    return { status };
  } catch (error) {
    return { status: 0, error: errorText(error) };
  }
}

const probeCache = new Map();
/** Cached, concurrency-limited status probe shared by every site check. */
function probe(url) {
  if (!probeCache.has(url)) probeCache.set(url, schedule(() => probeStatus(url)));
  return probeCache.get(url);
}

/* ------------------------------------------------------------- HTML parsing */

function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      try {
        return String.fromCodePoint(parseInt(decimal, 10));
      } catch {
        return '';
      }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attrMap(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2]);
  }
  return attributes;
}

function hasToken(value, token) {
  return String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .includes(token);
}

function metaTags(html) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => attrMap(match[0]));
}

function linkTags(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => attrMap(match[0]));
}

function metaValue(meta, attribute, key) {
  const tag = meta.find((candidate) => String(candidate[attribute] || '').toLowerCase() === key);
  return tag ? String(tag.content || '').trim() : '';
}

function collectJsonLdTypes(value, types) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdTypes(item, types);
    return;
  }
  const type = value['@type'];
  if (typeof type === 'string' && !types.includes(type)) types.push(type);
  if (Array.isArray(type)) {
    for (const entry of type) if (typeof entry === 'string' && !types.includes(entry)) types.push(entry);
  }
  if (Array.isArray(value['@graph'])) {
    for (const node of value['@graph']) collectJsonLdTypes(node, types);
  }
}

function parsePage(html) {
  const meta = metaTags(html);
  const links = linkTags(html);

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  const description = metaValue(meta, 'name', 'description');

  const canonical = String(
    links.find((tag) => hasToken(tag.rel, 'canonical'))?.href || '',
  ).trim();

  const alternates = new Map();
  for (const tag of links) {
    if (!hasToken(tag.rel, 'alternate')) continue;
    const language = String(tag.hreflang || '').toLowerCase();
    if (language && tag.href) alternates.set(language, String(tag.href).trim());
  }

  const h1Elements = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => stripTags(match[1]));
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({
    level: Number(match[1]),
    text: stripTags(match[2]),
  }));

  const og = {
    title: metaValue(meta, 'property', 'og:title'),
    description: metaValue(meta, 'property', 'og:description'),
    image: metaValue(meta, 'property', 'og:image'),
    imageWidth: metaValue(meta, 'property', 'og:image:width'),
    imageHeight: metaValue(meta, 'property', 'og:image:height'),
  };
  const twitterCard = metaValue(meta, 'name', 'twitter:card');

  const jsonLdBlocks = [
    ...html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ].map((match) => match[1]);
  const jsonLd = { blocks: jsonLdBlocks.length, types: [], errors: [] };
  jsonLdBlocks.forEach((raw, index) => {
    try {
      collectJsonLdTypes(JSON.parse(raw), jsonLd.types);
    } catch (error) {
      jsonLd.errors.push({ index: index + 1, message: error.message });
    }
  });

  const internalLinks = [];
  for (const tag of [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => attrMap(match[0]))) {
    const href = String(tag.href || '').trim();
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const clean = href.split('#')[0];
    if (clean) internalLinks.push(clean);
  }

  return {
    title,
    description,
    canonical,
    alternates,
    h1Count: h1Elements.length,
    h1Text: h1Elements[0] || '',
    headings,
    og,
    twitterCard,
    jsonLd,
    internalLinks,
  };
}

/* ------------------------------------------------------------------ helpers */

function isOnOrigin(value, origin) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return false;
  }
  const base = new URL(origin);
  if (target.protocol !== 'https:') return false;
  if (target.origin !== base.origin) return false;
  const basePath = base.pathname.replace(/\/+$/, '');
  if (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) return false;
  return true;
}

function headingOrderIssue(headings) {
  if (headings.length === 0) return 'no headings found';
  if (headings[0].level !== 1) return `first heading is h${headings[0].level}, expected h1`;
  let previous = 1;
  for (let index = 1; index < headings.length; index += 1) {
    const level = headings[index].level;
    if (level > previous + 1) {
      return `h${previous} is followed by h${level} at heading ${index + 1} (skipped h${previous + 1})`;
    }
    previous = level;
  }
  return null;
}

function trimDetail(detail, max = 220) {
  const value = String(detail || '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* ------------------------------------------------------- per-page evaluation */

async function evaluatePage(page, source, mode, origin) {
  const label = page.path;

  if (mode === 'dist') {
    skip(`${label} status`, 'network-only (dist mode)');
  } else if (source.error) {
    fail(`${label} status`, `network error: ${source.error}`);
  } else {
    const contentType = String(source.headers?.get('content-type') || '').toLowerCase();
    if (source.status === 200 && contentType.includes('text/html')) {
      pass(`${label} status`, '200 text/html');
    } else {
      fail(
        `${label} status`,
        `expected 200 text/html, got ${source.status} ${contentType || 'no content-type'}`,
      );
    }
  }

  const available = Boolean(source.body) && (mode === 'dist' || source.status === 200);
  if (!available) {
    const reason = mode === 'dist' ? 'page file not readable' : 'page not fetched';
    for (const suffix of [
      'title',
      'meta description',
      'h1',
      'heading order',
      'canonical',
      'hreflang',
      'hreflang targets',
      'og tags',
      'json-ld',
    ]) {
      skip(`${label} ${suffix}`, reason);
    }
    return null;
  }

  const info = parsePage(source.body);

  if (info.title.length >= 10 && info.title.length <= 60) {
    pass(`${label} title`, `${info.title.length} chars`);
  } else {
    fail(`${label} title`, `${info.title.length} chars (expected 10-60): ${trimDetail(JSON.stringify(info.title), 120)}`);
  }

  if (info.description.length >= 70 && info.description.length <= 160) {
    pass(`${label} meta description`, `${info.description.length} chars`);
  } else {
    fail(`${label} meta description`, `${info.description.length} chars (expected 70-160)`);
  }

  if (info.h1Count === 1 && info.h1Text) {
    pass(`${label} h1`, 'one non-empty <h1>');
  } else if (info.h1Count === 0) {
    fail(`${label} h1`, 'no <h1> found');
  } else if (info.h1Count > 1) {
    fail(`${label} h1`, `${info.h1Count} <h1> elements found`);
  } else {
    fail(`${label} h1`, 'the <h1> is empty');
  }

  const orderIssue = headingOrderIssue(info.headings);
  if (orderIssue) {
    fail(`${label} heading order`, orderIssue);
  } else {
    pass(`${label} heading order`, `${info.headings.length} headings, no skipped levels`);
  }

  const expectedCanonical = `${origin}${page.path}`;
  if (!info.canonical) {
    fail(`${label} canonical`, `missing canonical (expected ${expectedCanonical})`);
  } else if (info.canonical !== expectedCanonical) {
    fail(`${label} canonical`, `expected ${expectedCanonical}, got ${info.canonical}`);
  } else {
    pass(`${label} canonical`, info.canonical);
  }

  const required = page.translated ? REQUIRED_HREFLANGS : ['en', 'x-default'];
  const missingHreflangs = required.filter((language) => !info.alternates.has(language));
  if (!page.translated) {
    const untranslated = LOCALES.filter((language) => !info.alternates.has(language));
    if (untranslated.length > 0) warn(`${label} hreflang translations`, `not translated yet: ${untranslated.join(', ')}`);
  }
  const offOriginHreflangs = [...info.alternates.entries()]
    .filter(([, href]) => !isOnOrigin(href, origin))
    .map(([language]) => language);
  if (missingHreflangs.length > 0) {
    fail(`${label} hreflang`, `missing ${missingHreflangs.join(', ')}`);
  } else if (offOriginHreflangs.length > 0) {
    fail(`${label} hreflang`, `off-origin target for ${offOriginHreflangs.join(', ')}`);
  } else {
    pass(`${label} hreflang`, 'en/rw/fr/sw/x-default present, all on-origin');
  }

  const hreflangTargets = [...new Set(info.alternates.values())];
  if (hreflangTargets.length === 0) {
    skip(`${label} hreflang targets`, 'no hreflang targets found');
  } else if (mode === 'dist') {
    skip(`${label} hreflang targets`, 'network-only (dist mode)');
  } else {
    const results = await Promise.all(
      hreflangTargets.map(async (href) => ({ href, result: await probe(href) })),
    );
    const broken = results.filter(({ result }) => result.status !== 200);
    if (broken.length > 0) {
      fail(
        `${label} hreflang targets`,
        trimDetail(broken.map(({ href, result }) => `${href} -> ${result.error || result.status}`).join('; ')),
      );
    } else {
      pass(`${label} hreflang targets`, `${hreflangTargets.length} target(s) return 200`);
    }
  }

  const ogFields = {
    'og:title': info.og.title,
    'og:description': info.og.description,
    'og:image': info.og.image,
    'og:image:width': info.og.imageWidth,
    'og:image:height': info.og.imageHeight,
    'twitter:card': info.twitterCard,
  };
  const missingOg = Object.entries(ogFields)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const badOg = [];
  if (info.og.imageWidth && info.og.imageWidth !== '1200') badOg.push(`og:image:width=${info.og.imageWidth}`);
  if (info.og.imageHeight && info.og.imageHeight !== '630') badOg.push(`og:image:height=${info.og.imageHeight}`);
  if (missingOg.length > 0) {
    fail(`${label} og tags`, `missing ${missingOg.join(', ')}`);
  } else if (badOg.length > 0) {
    fail(`${label} og tags`, `expected 1200x630 og:image, got ${badOg.join(', ')}`);
  } else {
    pass(`${label} og tags`, 'og:title/description/image 1200x630 + twitter:card');
  }

  if (info.jsonLd.errors.length > 0) {
    const firstError = info.jsonLd.errors[0];
    fail(
      `${label} json-ld`,
      `block ${firstError.index} does not parse: ${firstError.message}; @type values: ${info.jsonLd.types.join(', ') || 'none'}`,
    );
  } else if (info.jsonLd.blocks === 0) {
    fail(`${label} json-ld`, 'no application/ld+json blocks');
  } else {
    pass(
      `${label} json-ld`,
      `${info.jsonLd.blocks} block(s): ${info.jsonLd.types.join(', ') || 'no @type value'}`,
    );
  }

  return info;
}

/* --------------------------------------------------------------- site checks */

async function auditPages(mode, origin, distDir) {
  /** @type {Map<string, {body?: string, status?: number, headers?: Headers, error?: string}>} */
  const sources = new Map();

  if (mode === 'network') {
    await Promise.all(
      PAGES.map((page) =>
        schedule(async () => {
          try {
            sources.set(page.path, await fetchText(`${origin}${page.path}`));
          } catch (error) {
            sources.set(page.path, { error: errorText(error), status: 0 });
          }
        }),
      ),
    );
  } else {
    for (const page of PAGES) {
      try {
        sources.set(page.path, { body: await readFile(path.join(distDir, page.file), 'utf8') });
      } catch (error) {
        sources.set(page.path, { error: `could not read ${page.file}: ${error.code || error.message}` });
      }
    }
  }

  const pageInfos = new Map();
  for (const page of PAGES) {
    const info = await evaluatePage(page, sources.get(page.path) || {}, mode, origin);
    if (info) pageInfos.set(page.path, info);
  }
  return { sources, pageInfos };
}

function auditUniqueness(pageInfos) {
  const titles = new Map();
  const descriptions = new Map();
  for (const [pagePath, info] of pageInfos) {
    const title = info.title.trim().toLowerCase();
    const description = info.description.trim().toLowerCase();
    if (title) titles.set(title, [...(titles.get(title) || []), pagePath]);
    if (description) descriptions.set(description, [...(descriptions.get(description) || []), pagePath]);
  }

  const duplicateTitles = [...titles.entries()].filter(([, pages]) => pages.length > 1);
  if (duplicateTitles.length > 0) {
    fail(
      'titles unique',
      duplicateTitles.map(([, pages]) => `${pages.join(' and ')} share a <title>`).join('; '),
    );
  } else {
    pass('titles unique', `${titles.size} titles, all unique`);
  }

  const duplicateDescriptions = [...descriptions.entries()].filter(([, pages]) => pages.length > 1);
  if (duplicateDescriptions.length > 0) {
    fail(
      'descriptions unique',
      duplicateDescriptions.map(([, pages]) => `${pages.join(' and ')} share a meta description`).join('; '),
    );
  } else {
    pass('descriptions unique', `${descriptions.size} descriptions, all unique`);
  }
}

async function auditInternalLinks(pageInfos, mode, origin) {
  const uniqueLinks = [];
  const seen = new Set();
  for (const page of PAGES) {
    const info = pageInfos.get(page.path);
    if (!info) continue;
    for (const link of info.internalLinks) {
      if (seen.has(link)) continue;
      seen.add(link);
      uniqueLinks.push(link);
    }
  }

  const capNote = uniqueLinks.length > MAX_INTERNAL_LINKS
    ? ` (capped at ${MAX_INTERNAL_LINKS} of ${uniqueLinks.length})`
    : '';

  if (mode === 'dist') {
    skip('internal links', `network-only (dist mode); ${uniqueLinks.length} unique link(s) collected${capNote}`);
    return;
  }
  if (uniqueLinks.length === 0) {
    warn('internal links', 'no internal href="/..." links found');
    return;
  }

  const toCheck = uniqueLinks.slice(0, MAX_INTERNAL_LINKS);
  const results = await Promise.all(
    toCheck.map(async (href) => ({ href, result: await probe(`${origin}${href}`) })),
  );
  const broken = results.filter(({ result }) => result.status !== 200);
  if (broken.length > 0) {
    fail(
      'internal links',
      trimDetail(
        `${broken.map(({ href, result }) => `${href} -> ${result.error || result.status}`).join('; ')}${capNote}`,
      ),
    );
  } else {
    pass('internal links', `${uniqueLinks.length} unique link(s), all 200${capNote}`);
  }
}

async function auditRobots(mode, origin, distDir) {
  let body = null;

  if (mode === 'dist') {
    skip('robots.txt status', 'network-only (dist mode)');
    try {
      body = await readFile(path.join(distDir, 'robots.txt'), 'utf8');
    } catch (error) {
      fail('robots.txt status', `could not read dist robots.txt: ${error.code || error.message}`);
    }
  } else {
    try {
      const response = await fetchText(`${origin}/robots.txt`, 'text/plain,*/*;q=0.8');
      if (response.status === 200) pass('robots.txt status', '200');
      else fail('robots.txt status', `expected 200, got ${response.status}`);
      if (response.status === 200) body = response.body;
    } catch (error) {
      fail('robots.txt status', `network error: ${errorText(error)}`);
    }
  }

  if (body === null) {
    skip('robots.txt sitemap', 'robots.txt not available');
    skip('robots.txt disallow', 'robots.txt not available');
    return;
  }

  const sitemapLines = [...body.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)].map((match) => match[1]);
  const nonHttps = sitemapLines.filter((line) => !/^https:\/\//i.test(line));
  if (sitemapLines.length === 0) {
    fail('robots.txt sitemap', 'no Sitemap line found');
  } else if (nonHttps.length > 0) {
    fail('robots.txt sitemap', `Sitemap line must be absolute https, got ${nonHttps[0]}`);
  } else {
    pass('robots.txt sitemap', `Sitemap: ${sitemapLines[0]}`);
  }

  const missingDisallow = [];
  if (!/^\s*Disallow:\s*\/web\/\s*$/im.test(body)) missingDisallow.push('Disallow: /web/');
  if (!/^\s*Disallow:\s*\/api\/\s*$/im.test(body)) missingDisallow.push('Disallow: /api/');
  if (missingDisallow.length > 0) {
    fail('robots.txt disallow', `missing ${missingDisallow.join(', ')}`);
  } else {
    pass('robots.txt disallow', '/web/ and /api/ disallowed');
  }
}

async function auditSitemap(mode, origin, distDir) {
  let body = null;
  let sourceNote = '';

  if (mode === 'dist') {
    skip('sitemap.xml status', 'network-only (dist mode)');
    try {
      body = await readFile(path.join(distDir, 'sitemap.xml'), 'utf8');
    } catch (error) {
      sourceNote = `could not read dist sitemap.xml: ${error.code || error.message}`;
    }
  } else {
    try {
      const response = await fetchText(`${origin}/sitemap.xml`, 'application/xml,text/xml,*/*;q=0.8');
      if (response.status === 200) pass('sitemap.xml status', '200');
      else fail('sitemap.xml status', `expected 200, got ${response.status}`);
      if (response.status === 200) body = response.body;
    } catch (error) {
      fail('sitemap.xml status', `network error: ${errorText(error)}`);
    }
  }

  if (body === null) {
    for (const name of ['sitemap locs', 'sitemap lastmod', 'sitemap loc status', 'sitemap private paths']) {
      fail(name, sourceNote || 'sitemap.xml not available');
    }
    return;
  }

  const urlBlocks = [...body.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => match[1]);
  const locs = [...body.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  const invalidLocs = locs.filter((loc) => {
    try {
      const parsed = new URL(loc);
      return !(parsed.protocol === 'https:' && isOnOrigin(loc, origin));
    } catch {
      return true;
    }
  });
  if (locs.length === 0) {
    fail('sitemap locs', 'no <loc> entries found');
  } else if (invalidLocs.length > 0) {
    fail(
      'sitemap locs',
      `${invalidLocs.length} non-absolute/non-on-origin: ${invalidLocs.slice(0, 3).join(', ')}`,
    );
  } else {
    pass('sitemap locs', `${locs.length} <loc> URLs, all absolute https on-origin`);
  }

  const missingLastmod = urlBlocks.filter((block) => !/<lastmod>\s*[^<\s][^<]*<\/lastmod>/i.test(block));
  if (urlBlocks.length === 0) {
    fail('sitemap lastmod', 'no <url> entries found');
  } else if (missingLastmod.length > 0) {
    fail('sitemap lastmod', `${missingLastmod.length} of ${urlBlocks.length} <url> entries have no <lastmod>`);
  } else {
    pass('sitemap lastmod', `all ${urlBlocks.length} <url> entries have <lastmod>`);
  }

  if (mode === 'dist') {
    skip('sitemap loc status', 'network-only (dist mode)');
  } else {
    const uniqueLocs = [...new Set(locs)];
    const results = await Promise.all(
      uniqueLocs.map(async (loc) => ({ loc, result: await probe(loc) })),
    );
    const broken = results.filter(({ result }) => result.status !== 200);
    if (uniqueLocs.length === 0) {
      fail('sitemap loc status', 'no <loc> entries to check');
    } else if (broken.length > 0) {
      fail(
        'sitemap loc status',
        trimDetail(broken.map(({ loc, result }) => `${loc} -> ${result.error || result.status}`).join('; ')),
      );
    } else {
      pass('sitemap loc status', `all ${uniqueLocs.length} <loc> URLs return 200`);
    }
  }

  const privateLocs = locs.filter((loc) => {
    try {
      const parsed = new URL(loc);
      return parsed.pathname.startsWith('/web/') || parsed.pathname.startsWith('/api/');
    } catch {
      return false;
    }
  });
  if (privateLocs.length > 0) {
    fail('sitemap private paths', `private paths in sitemap: ${privateLocs.slice(0, 3).join(', ')}`);
  } else {
    pass('sitemap private paths', 'no /web/ or /api/ entries');
  }
}

async function audit404Page(mode, origin, distDir) {
  if (mode === 'dist') {
    try {
      const html = await readFile(path.join(distDir, '404.html'), 'utf8');
      if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) {
        pass('404 page', '404.html present and noindex');
      } else {
        fail('404 page', '404.html present but not noindex');
      }
    } catch (error) {
      fail('404 page', `404.html missing from dist: ${error.code || error.message}`);
    }
    return;
  }

  const result = await probe(`${origin}/__seo-audit-missing-${Date.now().toString(36)}`);
  if (result.error) fail('404 page', `network error: ${result.error}`);
  else if (result.status === 404) pass('404 page', 'unknown path returns 404');
  else fail('404 page', `unknown path returned ${result.status}, expected 404`);
}

async function auditWebApp(mode, origin) {
  if (mode === 'dist') {
    skip('web app noindex', 'network-only (dist mode)');
    return;
  }
  try {
    const response = await fetchText(`${origin}/web/`);
    const robotsHeader = String(response.headers?.get('x-robots-tag') || '').toLowerCase();
    const metaNoindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(response.body);
    if (response.status !== 200) {
      fail('web app noindex', `expected 200, got ${response.status}`);
    } else if (robotsHeader.includes('noindex') || metaNoindex) {
      pass('web app noindex', '200 with noindex');
    } else {
      fail('web app noindex', '200 but no X-Robots-Tag/meta noindex');
    }
  } catch (error) {
    fail('web app noindex', `network error: ${errorText(error)}`);
  }
}

async function auditSecurityHeaders(mode, homeSource) {
  if (mode === 'dist') {
    for (const name of ['strict-transport-security', 'x-content-type-options', 'permissions-policy']) {
      skip(`headers: ${name}`, 'network-only (dist mode)');
    }
    return;
  }
  const headers = homeSource?.headers;
  if (!headers) {
    for (const name of ['strict-transport-security', 'x-content-type-options', 'permissions-policy']) {
      skip(`headers: ${name}`, 'home page not fetched');
    }
    return;
  }

  const hsts = headers.get('strict-transport-security');
  if (hsts) pass('headers: strict-transport-security', hsts.slice(0, 100));
  else fail('headers: strict-transport-security', 'missing on /');

  const contentTypeOptions = headers.get('x-content-type-options');
  if (contentTypeOptions && contentTypeOptions.toLowerCase().includes('nosniff')) {
    pass('headers: x-content-type-options', contentTypeOptions);
  } else {
    fail(
      'headers: x-content-type-options',
      contentTypeOptions ? `value "${contentTypeOptions}" (expected nosniff)` : 'missing on /',
    );
  }

  const permissionsPolicy = headers.get('permissions-policy');
  if (permissionsPolicy) pass('headers: permissions-policy', permissionsPolicy.slice(0, 120));
  else warn('headers: permissions-policy', 'missing on /');
}

async function auditApiHealth(mode, origin) {
  if (mode === 'dist') {
    skip('api health', 'network-only (dist mode)');
    return;
  }
  try {
    const response = await fetchText(`${origin}/api/status/health`, 'application/json,*/*;q=0.8');
    if (response.status === 200) pass('api health', '200');
    else fail('api health', `expected 200, got ${response.status}`);
  } catch (error) {
    fail('api health', `network error: ${errorText(error)}`);
  }
}

async function auditVercelHost(mode) {
  if (mode === 'dist') {
    skip('vercel host', 'network-only (dist mode)');
    return;
  }
  try {
    const response = await rawFetch(VERCEL_HOST, { redirect: 'manual' });
    const status = response.status;
    await drain(response);
    if ([200, 301, 308].includes(status)) pass('vercel host', `status ${status}`);
    else fail('vercel host', `status ${status} (expected 200, 301 or 308)`);
  } catch (error) {
    fail('vercel host', `network error: ${errorText(error)}`);
  }
}

/* --------------------------------------------------------------------- main */

function formatCheck(check) {
  return `${check.status}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const mode = options.dist ? 'dist' : 'network';
  const distDir = options.dist ? path.resolve(process.cwd(), options.dist) : null;

  const { sources, pageInfos } = await auditPages(mode, options.origin, distDir);
  auditUniqueness(pageInfos);
  await auditInternalLinks(pageInfos, mode, options.origin);
  await auditRobots(mode, options.origin, distDir);
  await auditSitemap(mode, options.origin, distDir);
  await audit404Page(mode, options.origin, distDir);
  await auditWebApp(mode, options.origin);
  await auditSecurityHeaders(mode, sources.get('/'));
  await auditApiHealth(mode, options.origin);
  await auditVercelHost(mode);

  const summary = summarize();

  if (options.json) {
    console.log(JSON.stringify({ checks, summary }, null, 2));
  } else if (options.quiet) {
    console.log(summaryLine(summary));
  } else {
    for (const check of checks) console.log(formatCheck(check));
    console.log('');
    console.log(summaryLine(summary));
  }

  if (summary.fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`seo-audit: ${error?.stack || error?.message || error}`);
  process.exitCode = 2;
});
