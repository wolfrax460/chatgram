// Public AI assistant endpoint used by the help widget.
// The API key never leaves the server; callers only see the answer.
const knowledgeBase = require('../support/knowledge-base.json');
const ai = require('../support/aiProvider');
const { stripHtml, rateLimit } = require('./supportTicketController');

const MAX_MESSAGES = 12;
const MAX_INPUT = 1200;

/** Compact knowledge-base dump included in the system prompt. */
function kbForPrompt() {
  return knowledgeBase.entries
    .map((entry) => `### ${entry.title}\n${entry.answer}`)
    .join('\n\n');
}

/** Keyword match used when AI is off or fails. */
function kbFallback(text) {
  const lower = String(text || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const entry of knowledgeBase.entries) {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (lower.includes(String(keyword).toLowerCase())) score += keyword.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best ? best.answer : knowledgeBase.fallback;
}

// @desc    Ask the Chatgram help assistant
// @route   POST /api/support/assistant
// @access  Public
const askSupportAssistant = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ip = req.ip || req.connection?.remoteAddress;
    const guestId = stripHtml(body.guestId).slice(0, 64);

    // Caps: per guest per hour and per IP per day.
    const guestLimit = rateLimit(`ai:guest:${guestId || ip}`, 30, 60 * 60 * 1000);
    if (!guestLimit.ok) {
      return res.status(429).json({ message: `Too many messages. Try again in ${guestLimit.retryAfter}s.` });
    }
    const ipLimit = rateLimit(`ai:ip:${ip}`, 200, 24 * 60 * 60 * 1000);
    if (!ipLimit.ok) {
      return res.status(429).json({ message: 'Daily limit reached. Please send a report to support.' });
    }

    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages = raw
      .slice(-MAX_MESSAGES)
      .map((m) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'guest',
        text: stripHtml(m?.text).slice(0, MAX_INPUT),
      }))
      .filter((m) => m.text.length > 0);

    const lastGuest = [...messages].reverse().find((m) => m.role === 'guest');
    if (!lastGuest) return res.status(400).json({ message: 'A message is required' });

    const system = [
      knowledgeBase.systemPrompt,
      '',
      'KNOWLEDGE BASE — you may only use this:',
      kbForPrompt(),
    ].join('\n');

    const answer = await ai.askAssistant({
      system,
      messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: m.text })),
    });

    const info = ai.assistantInfo();

    if (!answer) {
      // AI disabled or unavailable: still helpful, via keyword matching.
      return res.json({
        answer: kbFallback(lastGuest.text),
        source: 'kb',
        aiEnabled: info.enabled,
      });
    }

    return res.json({ answer, source: 'ai', provider: info.provider, model: info.model });
  } catch (error) {
    console.error('Support assistant error:', error.message);
    const lastGuest = Array.isArray(req.body?.messages)
      ? [...req.body.messages].reverse().find((m) => m?.role !== 'assistant')
      : null;
    // Never fail the widget — degrade to the knowledge base.
    return res.json({
      answer: kbFallback(lastGuest?.text ?? ''),
      source: 'kb',
      aiEnabled: false,
    });
  }
};

module.exports = { askSupportAssistant };
