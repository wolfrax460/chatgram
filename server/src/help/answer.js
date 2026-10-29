/**
 * Answering help questions from the seeded help-centre articles.
 *
 * Grounding rule (same spirit as the support agent): the assistant may only use
 * the articles. If nothing matches it says so and offers a person instead of
 * inventing an answer.
 */
const ai = require('../support/aiProvider');
const { HelpArticle } = require('./models');

const CITATION = /\[article:([a-z0-9-]+)\]/i;

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

/** Score every published article against the question. */
async function scoreArticles(question, limit = 4) {
  const articles = await HelpArticle.find({ published: true })
    .select('slug title summary body keywords collectionSlug')
    .lean();
  const words = tokens(question);
  const scored = articles.map((article) => {
    const haystack = `${article.title} ${article.summary} ${article.keywords.join(' ')} ${article.body}`
      .toLowerCase();
    let score = 0;
    for (const word of words) {
      if (haystack.includes(word)) score += 1;
      const keywordHit = (article.keywords || []).some((keyword) =>
        word.includes(String(keyword).toLowerCase()) || String(keyword).toLowerCase().includes(word),
      );
      if (keywordHit) score += 3;
      if (article.title.toLowerCase().includes(word)) score += 2;
    }
    return { article, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function firstParagraph(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)[0] || '';
}

/** Deterministic answer built from the best-matching article (used when AI is off). */
async function kbAnswer(question) {
  const ranked = await scoreArticles(question, 3);
  if (ranked.length === 0) {
    return {
      answer:
        "I don't have an article for that yet. I don't want to guess — you can send this to the team below and a person will reply.",
      articleSlug: null,
      source: 'kb',
      matched: [],
    };
  }
  const best = ranked[0].article;
  const others = ranked.slice(1).map((entry) => entry.article);
  const parts = [];
  const summary = firstParagraph(best.body) || best.summary;
  parts.push(`${best.title}: ${summary}`);
  if (others.length > 0) {
    parts.push(`Related: ${others.map((article) => article.title).join(' · ')}`);
  }
  return {
    answer: parts.join('\n\n'),
    articleSlug: best.slug,
    source: 'kb',
    matched: [best, ...others].map((article) => ({ slug: article.slug, title: article.title })),
  };
}

/**
 * Ask the assistant. Uses the configured AI provider when available, grounded on
 * the best-matching articles; otherwise falls back to the article text.
 */
async function answerQuestion(question, history = []) {
  const ranked = await scoreArticles(question, 4);
  const kbBlock = ranked
    .map(
      ({ article }) =>
        `### ${article.title} [article:${article.slug}]\n${article.summary}\n${article.body.slice(0, 1200)}`,
    )
    .join('\n\n');

  const projectContextText = await require('./projectContext').getProjectContextText();
  const system = require('./projectContext').withProjectContext([
    'You are the Chatgram Assistant inside the help widget.',
    'Use ONLY the knowledge base below or the PROJECT CONTEXT above. If neither contains the answer, say you do not know and offer to hand the conversation to a person.',
    'For questions about versions, changelog, features or known requests, quote the PROJECT CONTEXT facts exactly; if a fact is missing there, say you do not have it and offer to log a report.',
    'Never ask for passwords, verification codes or card numbers. Never claim to be human.',
    'Answer in the language the user writes in. Keep answers short (max 120 words), plain text, no HTML.',
    'When you use an article, end your answer with its citation tag on its own, e.g. [article:change-password].',
    '',
    'KNOWLEDGE BASE:',
    kbBlock || '(no matching articles)',
  ].join('\n'), projectContextText);

  if (ai.assistantInfo().enabled) {
    const messages = [
      ...history.slice(-6).map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        text: String(message.text || '').slice(0, 1200),
      })),
      { role: 'user', text: String(question).slice(0, 1200) },
    ];
    const raw = await ai.askAssistant({ system, messages, maxTokens: 400 });
    if (raw) {
      const match = raw.match(CITATION);
      const articleSlug = match ? match[1] : ranked[0]?.article.slug ?? null;
      const answer = raw.replace(CITATION, '').trim().slice(0, 4000);
      return {
        answer,
        articleSlug,
        source: 'ai',
        matched: ranked.map(({ article }) => ({ slug: article.slug, title: article.title })),
      };
    }
  }

  return kbAnswer(question);
}

module.exports = { answerQuestion, kbAnswer, scoreArticles };
