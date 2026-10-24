/**
 * Idempotent seeding of the help centre from articles.seed.json.
 * Runs at boot after MongoDB connects; re-running is safe (upserts by slug).
 */
const fs = require('fs');
const path = require('path');
const { HelpCollection, HelpArticle } = require('./models');

const SEED_FILE = path.join(__dirname, 'articles.seed.json');

async function seedHelpCentre() {
  const raw = fs.readFileSync(SEED_FILE, 'utf8');
  const seed = JSON.parse(raw);

  const existing = await HelpArticle.estimatedDocumentCount();
  if (existing >= seed.articles.length) {
    return { seeded: false, articles: existing };
  }

  for (const collection of seed.collections) {
    await HelpCollection.updateOne(
      { slug: collection.slug },
      { $set: collection },
      { upsert: true },
    );
  }

  for (const article of seed.articles) {
    await HelpArticle.updateOne(
      { slug: article.slug },
      { $set: { ...article, published: true } },
      { upsert: true },
    );
  }

  const count = await HelpArticle.estimatedDocumentCount();
  console.log(`Help centre seeded: ${seed.collections.length} collections, ${count} articles`);
  return { seeded: true, articles: count, collections: seed.collections.length };
}

module.exports = { seedHelpCentre, SEED_FILE };
