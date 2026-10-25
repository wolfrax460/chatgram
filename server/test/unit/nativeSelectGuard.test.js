/**
 * Guard (Change 3): raw native <select> elements are only allowed in the three
 * legacy screens pinned below. Every new screen — and the whole admin dashboard
 * (pages/admin/**) — must use the shared dark dropdown component instead.
 *
 * The app-wide CSS fix (apps/web/src/index.css) still styles native selects dark,
 * so the legacy screens are readable; this check stops new ones appearing.
 *
 *   node server/test/unit/nativeSelectGuard.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'apps/web/src');
const CSS = path.join(SRC, 'index.css');

// file -> how many native <select> occurrences exist today. The list may only
// shrink: adding one more to an allowlisted file is a failure.
const LEGACY = new Map([
  ['pages/Admin.tsx', 2],
  ['pages/Auth.tsx', 3],
  ['pages/Settings.tsx', 1],
]);

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function countSelects(source) {
  return (source.match(/<select\b/g) || []).length;
}

console.log('\nnative <select> guard (Change 3)\n');

const files = walk(SRC);
check('scanned the web sources', files.length > 20, `${files.length} files`);

const found = new Map();
for (const file of files) {
  const count = countSelects(fs.readFileSync(file, 'utf8'));
  if (count > 0) found.set(path.relative(SRC, file).split(path.sep).join('/'), count);
}

check('the guard actually finds the legacy selects', found.size >= 3, [...found.keys()].join(', '));

const violations = [];
for (const [rel, count] of found) {
  if (rel.startsWith('pages/admin/')) {
    violations.push(`${rel}: ${count} native <select> — the admin dashboard must use the shared Select component`);
    continue;
  }
  if (!LEGACY.has(rel)) {
    violations.push(`${rel}: ${count} native <select> — use the shared dark Select component (or add this legacy file to the guard's allowlist with a reason)`);
    continue;
  }
  const allowed = LEGACY.get(rel);
  if (count > allowed) {
    violations.push(`${rel}: ${count} native <select>, allowlist permits ${allowed} — do not add another`);
  }
}
check('no new bare native <select> was added', violations.length === 0, violations.join(' | '));

// The global CSS fix must stay in place: it is what makes every legacy select
// readable in the dark theme.
const css = fs.readFileSync(CSS, 'utf8');
check('dark theme sets color-scheme: dark', /html\.dark\s*\{[^}]*color-scheme:\s*dark/.test(css));
check('native select options get a dark surface and light text', /html\.dark\s+select\s+option[\s\S]{0,120}background-color:\s*#202c33[\s\S]{0,120}color:\s*#e9edef/.test(css));
check('autofill cannot paint a white box', /-webkit-autofill[\s\S]{0,400}box-shadow:\s*0 0 0 1000px/.test(css));

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) process.exit(1);
