/**
 * Knowledge-base store for the support assistant.
 *
 * Entries live in the SupportSettings document so the admin dashboard can edit
 * them without a redeploy. The bundled knowledge-base.json is the seed and the
 * fallback: if the database has no entries yet, the JSON is used unchanged.
 */
const path = require('node:path');
const settings = require('./settings');

const seed = require('./knowledge-base.json');

let cache = null;
let cachedAt = 0;
const TTL_MS = 30 * 1000;

function seedEntries() {
  return seed.entries.map((e) => ({
    id: e.id,
    title: e.title,
    keywords: e.keywords,
    answer: e.answer,
  }));
}

/** Entries currently in force (database overrides the seed). */
async function load() {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;
  try {
    const doc = await settings.raw();
    cache = Array.isArray(doc?.kb) && doc.kb.length ? doc.kb : seedEntries();
  } catch {
    cache = seedEntries();
  }
  cachedAt = now;
  return cache;
}

/** Synchronous view for hot paths; falls back to the seed before first load. */
function entries() {
  return cache || seedEntries();
}

function systemPrompt() {
  return seed.systemPrompt;
}

function fallbackText() {
  return seed.fallback;
}

/** Replace the whole knowledge base (validated by the caller). */
async function save(nextEntries, updatedBy) {
  const clean = nextEntries.map((e, index) => ({
    id: String(e.id || `entry-${index + 1}`).slice(0, 60),
    title: String(e.title || '').slice(0, 200),
    keywords: Array.isArray(e.keywords)
      ? e.keywords.map((k) => String(k).slice(0, 60)).filter(Boolean).slice(0, 30)
      : String(e.keywords || '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 30),
    answer: String(e.answer || '').slice(0, 4000),
  }));
  await settings.save({ kb: clean }, updatedBy);
  cache = clean;
  cachedAt = Date.now();
  return clean;
}

async function resetToSeed(updatedBy) {
  await settings.save({ kb: [] }, updatedBy);
  cache = seedEntries();
  cachedAt = Date.now();
  return cache;
}

/** Compact dump for the model's system prompt. */
function promptBlock() {
  return entries()
    .map((e) => `### ${e.title}\n${e.answer}`)
    .join('\n\n');
}

/** Keyword match used when AI is off or fails. */
function keywordAnswer(text) {
  const lower = String(text || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const entry of entries()) {
    let score = 0;
    for (const keyword of entry.keywords || []) {
      if (lower.includes(String(keyword).toLowerCase())) score += String(keyword).length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best ? best.answer : fallbackText();
}

module.exports = {
  load,
  entries,
  save,
  resetToSeed,
  systemPrompt,
  fallbackText,
  promptBlock,
  keywordAnswer,
  seedEntries,
  jsonPath: path.join(__dirname, 'knowledge-base.json'),
};
