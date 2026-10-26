#!/usr/bin/env node
/**
 * Tiny static file server for local checks (Lighthouse, manual browsing).
 *
 *   node scripts/serve.mjs [port]   (defaults to 4173, serves dist/)
 *
 * Mirrors the production routing we rely on: real files win, directory requests
 * serve their index.html, and everything else returns 404.html with status 404.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
};

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safe = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const base = path.join(ROOT, safe);

  const tries = [];
  if (decoded.endsWith('/')) tries.push(path.join(base, 'index.html'));
  else tries.push(base, `${base}.html`, path.join(base, 'index.html'));

  for (const candidate of tries) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];

  // Local preview only: the production host proxies this path to the API. Return
  // an empty feed here so the pre-rendered download cards are what you see and
  // the browser does not log a 404 while checking the page locally.
  if (pathname === '/api/app/releases') {
    const body = JSON.stringify({ releases: [], generatedAt: new Date().toISOString() });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }

  const file = await resolveFile(req.url || '/');
  const notFound = path.join(ROOT, '404.html');
  const target = file || notFound;
  const type = TYPES[path.extname(target)] || 'application/octet-stream';
  const headers = { 'Content-Type': type };
  if (target.startsWith(path.join(ROOT, 'static'))) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  const compressible = /^(text\/|application\/(json|xml|manifest\+json))/.test(type);
  if (compressible && String(req.headers['accept-encoding'] || '').includes('gzip')) {
    const body = gzipSync(await readFile(target));
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    res.writeHead(file ? 200 : 404, headers);
    res.end(body);
    return;
  }
  headers['Content-Length'] = (await stat(target)).size;
  res.writeHead(file ? 200 : 404, headers);
  createReadStream(target).pipe(res);
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}/`);
});
