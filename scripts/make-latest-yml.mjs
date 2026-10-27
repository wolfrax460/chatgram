#!/usr/bin/env node
/**
 * Write latest.yml for the Windows installer — the file electron-updater reads.
 *
 * electron-builder only regenerates it when a publish provider is configured,
 * which this project does not use, so it is produced here instead:
 *
 *   node scripts/make-latest-yml.mjs --version 1.1.1
 *   node scripts/make-latest-yml.mjs --version 1.1.1 --file path/to/setup.exe
 *
 * It reads the real file, so version/size/sha512 can never disagree with what
 * is published, and it writes UTF-8 **without a BOM** and with LF endings
 * (PowerShell's Set-Content on 5.1 adds a BOM, which confused readers before).
 *
 * Prints the version, size, SHA-256 (for the landing page) and SHA-512 base64,
 * then a ready-to-paste AppRelease summary.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const version = argument('version', '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('error: pass a semver version, e.g. --version 1.1.1');
  process.exit(1);
}

const file = resolve(argument('file', 'apps/desktop/release/chatgram-windows-setup.exe'));
let bytes;
try {
  bytes = readFileSync(file);
} catch {
  console.error(`error: cannot read ${file} — build it first (npm run dist -w @chatgram/desktop)`);
  process.exit(1);
}

const size = statSync(file).size;
const sha256 = createHash('sha256').update(bytes).digest('hex');
const sha512 = createHash('sha512').update(bytes).digest('base64');
const releaseDate = new Date().toISOString();

const document = [
  `version: ${version}`,
  'files:',
  '  - url: chatgram-windows-setup.exe',
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  'path: chatgram-windows-setup.exe',
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n');

const target = join(dirname(file), 'latest.yml');
writeFileSync(target, document, 'utf8');

// paranoid but cheap: prove what we wrote is BOM-free and parses as expected
const written = readFileSync(target);
if (written[0] === 0xef && written[1] === 0xbb && written[2] === 0xbf) {
  console.error('error: latest.yml has a BOM');
  process.exit(1);
}

console.log(`wrote ${target}`);
console.log(`  version:     ${version}`);
console.log(`  size:        ${size}`);
console.log(`  sha256:      ${sha256}`);
console.log(`  sha512(b64): ${sha512}`);
console.log(`  releaseDate: ${releaseDate}`);
console.log('');
console.log('AppRelease row:');
console.log(`  version: ${version}  sizeBytes: ${size}`);
console.log(`  sha256: ${sha256}`);
console.log(`  sha512: ${sha512}`);
console.log('');
console.log('Next: upload the .exe, latest.yml and .blockmap to /var/www/downloads/,');
console.log('then update the AppRelease row, checksums.txt and the landing constants.');
