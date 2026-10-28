/**
 * Content-free AI provider failure records for the admin Inbox.
 *
 * When a provider in the fallback chain fails, the admin needs to see which
 * provider is broken and how it failed — never the request text, prompt, user
 * identity or API key. One row per provider (upsert by `normalized`), count++
 * so repeated failures do not flood the Inbox.
 *
 * Example row text: `AI provider failure: nvidia (HTTP 429)`.
 */
function safeLabel(value, max = 40) {
  return (
    String(value || 'unknown')
      .replace(/[^A-Za-z0-9_.:/ -]/g, '')
      .slice(0, max) || 'unknown'
  );
}

/**
 * Record one failed provider. Never throws and never includes secrets.
 * @param {{provider?: string, status?: number|string, code?: string}} failure
 */
async function recordProviderFailure({ provider, status, code } = {}) {
  try {
    const { AdminInbox } = require('./chatgram');
    const label = safeLabel(provider, 40) || 'unknown';
    const httpStatus = Number(status);
    const detail = Number.isFinite(httpStatus) && httpStatus > 0
      ? `HTTP ${httpStatus}`
      : safeLabel(code || 'error', 40);
    const text = `AI provider failure: ${label} (${detail})`;
    const normalized = `ai_provider:${label}`;
    const now = new Date();
    await AdminInbox.findOneAndUpdate(
      { normalized, status: { $ne: 'ignored' } },
      {
        $set: {
          type: 'ai_provider_failure',
          question: text,
          title: 'AI provider failure',
          summary: text,
          source: 'ai',
          lastSeenAt: now,
        },
        $setOnInsert: {
          status: 'new',
          createdAt: now,
          // No identity and no prompt/answer text: provider + status only.
          askerId: null,
          askerHash: '',
          askerName: '',
          redactedContext: '',
        },
        $inc: { count: 1 },
      },
      { upsert: true },
    );
    return true;
  } catch (error) {
    console.warn('AI failure inbox record skipped:', String(error?.message || error).slice(0, 120));
    return false;
  }
}

module.exports = { recordProviderFailure, safeLabel };
