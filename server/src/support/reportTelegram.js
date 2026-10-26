/**
 * INTERFACE CONTRACT for AI-report notifications to the owner's Telegram.
 *
 * The Telegram workstream implements this module; the AI-reports workstream
 * only calls it. Keep these exported names and shapes stable.
 *
 *   isEnabled()            -> Promise<boolean>  (admin setting "Send reports to
 *                             Telegram", default ON; AI_REPORT_TELEGRAM=false
 *                             still disables it)
 *   sendReport(record)     -> Promise<{ ok, skipped?, error?, messageId? }>
 *                             Sends the short report message and records the
 *                             Telegram message id on the record (for two-way
 *                             replies). Never throws.
 *   sendTest()             -> Promise<{ ok, error? }>  (admin Test button)
 *   startPolling()         -> void (returns the loop promise), starts the
 *                             two-way reply poller once
 *   saveReplyFromUpdate(u) -> Promise<{ ok, reportId?, error? }>  (test seam)
 *
 * Rules this module keeps:
 *   - Tokens and chat ids are never printed or returned; logs and errors are
 *     scrubbed before they can leave the module.
 *   - The report message is SHORT: type emoji + type, reference, title, a 2-3
 *     line summary, where it happened, who asked and an Inbox link. The full fix
 *     prompt never goes to Telegram (it lives in the Inbox).
 *   - Nothing here may throw out of an exported function.
 *
 * The AdminInbox model is required lazily inside functions on purpose: chatgram.js
 * already requires ./reports, and a top-level require here would close the
 * reports <-> chatgram cycle.
 */
const platformSettings = require('../utils/platformSettings');

const TELEGRAM_API = 'https://api.telegram.org';
const TIMEOUT_MS = 12000;
const POLL_TIMEOUT_SECONDS = 15;
const POLL_ERROR_WAIT_MS = 15000;
const POLL_DISABLED_WAIT_MS = 60000;
const REPLY_MAX_LENGTH = 4000;
const DEFAULT_CLIENT_URL = 'https://chatgram-xi.vercel.app';

const TYPE_META = {
  bug_report: { emoji: '🐞', label: 'Bug report' },
  feature_request: { emoji: '✨', label: 'Feature request' },
  support_request: { emoji: '🛟', label: 'Support request' },
  complaint: { emoji: '😠', label: 'Complaint' },
  abuse_report: { emoji: '🚨', label: 'Abuse report' },
  unknown_question: { emoji: '❓', label: 'Unknown question' },
};

function botToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function chatId() {
  return String(process.env.TELEGRAM_CHAT_ID || '').trim();
}

function telegramConfigured() {
  return Boolean(botToken() && chatId());
}

/** Remove anything that must never be printed (token, chat id) from a string. */
function scrub(value) {
  let text = String(value || '');
  const token = botToken();
  const ownerChat = chatId();
  if (token) text = text.split(token).join('[redacted]');
  if (ownerChat) text = text.split(ownerChat).join('[redacted]');
  return text;
}

function logSafe(message) {
  console.warn(`reportTelegram: ${scrub(message).slice(0, 200)}`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
  });
}

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Cut at a sentence/clause/word boundary — never in the middle of a word. */
function shortenAtBoundary(value, max) {
  const text = collapse(value);
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const boundary = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('? '),
    window.lastIndexOf('! '),
    window.lastIndexOf('; '),
    window.lastIndexOf(', '),
  );
  const space = window.lastIndexOf(' ');
  const floor = Math.floor(max * 0.5);
  const end = boundary > floor ? boundary + 1 : space > floor ? space : window.length;
  return `${window.slice(0, end).trim()}…`;
}

function shorten(value, max) {
  return shortenAtBoundary(value, max);
}

/**
 * 2-3 short lines: whole sentences only. A single very long sentence/text
 * without punctuation is shortened at a word boundary with an ellipsis so the
 * Telegram message is never cut mid-sentence.
 */
function shortenSummary(value) {
  const text = collapse(value);
  if (!text) return '';
  const sentences = text.match(/[^.!?…]+[.!?…]+["')\]]?/g) || [];
  const picked = [];
  let total = 0;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (picked.length >= 3 || total + sentence.length > 320) break;
    picked.push(sentence);
    total += sentence.length + 1;
  }
  if (picked.length) return picked.join(' ');
  return shortenAtBoundary(text, 280);
}

function inboxUrl() {
  const base =
    String(process.env.CLIENT_URL || '')
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '') || DEFAULT_CLIENT_URL;
  return `${base}/web/admin/inbox`;
}

/** The short Telegram message for a report. No fix prompt, no transcript. */
function formatReportMessage(record = {}) {
  const type = String(record.type || 'support_request');
  const meta = TYPE_META[type] || TYPE_META.support_request;
  const reference = shorten(record.ref || '', 24) || 'no reference';
  const title = shorten(record.title || record.question || 'Chatgram report', 120) || 'Chatgram report';
  const summary = shortenSummary(record.summary || '');
  const lines = [
    `${meta.emoji} ${meta.label} · ${reference}`,
    `Title: ${title}`,
  ];
  if (summary) lines.push(summary);
  lines.push(`Where: ${shorten(record.source || 'Chatgram AI', 120)}`);
  lines.push(`Asked by: ${shorten(record.askerName || 'Chatgram user', 80)}`);
  const count = Number(record.count);
  if (Number.isFinite(count) && count > 1) lines.push(`Reported ${Math.round(count)} times`);
  lines.push(`Inbox: ${inboxUrl()}`);
  return lines.join('\n');
}

async function telegramCall(method, payload, { timeoutMs = TIMEOUT_MS } = {}) {
  const token = botToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const description = scrub(body?.description || raw || `HTTP ${response.status}`).slice(0, 160);
      const error = new Error(`Telegram ${method} rejected with HTTP ${response.status}: ${description}`);
      error.status = response.status;
      throw error;
    }
    if (!body || body.ok !== true) throw new Error(`Telegram ${method} returned an unexpected response.`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- isEnabled */

/**
 * Admin setting "Send reports to Telegram" (default ON), read from the cached
 * PlatformSettings singleton. AI_REPORT_TELEGRAM=false in the server
 * environment still forces it off. A settings read failure defaults to ON and
 * never throws (a report must not be lost because the DB hiccuped).
 */
async function isEnabled() {
  if (String(process.env.AI_REPORT_TELEGRAM ?? '').toLowerCase() === 'false') return false;
  try {
    const settings = await platformSettings.get();
    return settings?.reportTelegramEnabled !== false;
  } catch (error) {
    logSafe(`could not read the Telegram reports setting (defaulting to ON): ${error.message}`);
    return true;
  }
}

/* ----------------------------------------------------------------- sendReport */

async function storeMessageId(record, messageId) {
  try {
    record.telegramMessageId = messageId;
  } catch {
    /* a frozen/lean copy — the DB update below still records it */
  }
  if (!record || !record._id) return;
  try {
    const { AdminInbox } = require('../ai/chatgram'); // lazy: circular require
    await AdminInbox.updateOne({ _id: record._id }, { $set: { telegramMessageId: messageId } });
  } catch (error) {
    logSafe(`the report's Telegram message id was not stored: ${error.message}`);
  }
}

/**
 * Send the short report alert. Returns { ok, skipped?, error?, messageId? } and
 * never throws. On success the Telegram message id is stored on the AdminInbox
 * record so a reply in Telegram can find the report again.
 */
async function sendReport(record) {
  try {
    if (!record) return { ok: false, skipped: true, error: 'No report record was provided.' };
    if (!telegramConfigured()) return { ok: false, skipped: true };
    if (!(await isEnabled())) return { ok: false, skipped: true };
    const text = formatReportMessage(record);
    const body = await telegramCall('sendMessage', {
      chat_id: chatId(),
      text,
      disable_web_page_preview: true,
    });
    const messageId = Number(body?.result?.message_id);
    if (!Number.isFinite(messageId)) return { ok: false, error: 'Telegram did not return a message id.' };
    await storeMessageId(record, messageId);
    return { ok: true, messageId };
  } catch (error) {
    logSafe(`sendReport failed: ${error?.message || error}`);
    return { ok: false, error: scrub(error?.message || error).slice(0, 200) };
  }
}

/* ------------------------------------------------------------------- sendTest */

/** Admin Test button: one short "Chatgram test" message. Never throws. */
async function sendTest() {
  try {
    if (!telegramConfigured()) {
      return {
        ok: false,
        code: 'TELEGRAM_NOT_CONFIGURED',
        error:
          'Telegram is not configured on this server. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the server environment, then try again.',
      };
    }
    const enabled = await isEnabled();
    const text = [
      '✅ Chatgram test',
      'Reports to Telegram are working.',
      enabled
        ? 'Report alerts are ON.'
        : "Note: 'Send reports to Telegram' is currently switched off, so real reports stay in the Inbox only.",
    ].join('\n');
    const body = await telegramCall('sendMessage', {
      chat_id: chatId(),
      text,
      disable_web_page_preview: true,
    });
    const messageId = Number(body?.result?.message_id);
    return { ok: true, messageId: Number.isFinite(messageId) ? messageId : null };
  } catch (error) {
    logSafe(`sendTest failed: ${error?.message || error}`);
    return { ok: false, error: scrub(error?.message || error).slice(0, 200) };
  }
}

/* ---------------------------------------------------------------- two-way replies */

let pollingStarted = false;
let pollingStopped = false;
let pollOffset = 0;

/**
 * Testable seam: apply one Telegram update. Only a text reply from the owner's
 * chat to one of our report messages is accepted; everything else is ignored
 * silently. The reply is stored as record.telegramReply and the record stays
 * 'new' — it is a draft, not a delivered answer (the Inbox offers "Send to user").
 */
async function saveReplyFromUpdate(update) {
  try {
    const message = update && update.message;
    if (!message) return { ok: false, skipped: true };
    if (message.from && message.from.is_bot) return { ok: false, skipped: true };
    const replyToId = Number(message.reply_to_message && message.reply_to_message.message_id);
    if (!Number.isFinite(replyToId)) return { ok: false, skipped: true };
    const ownerChat = chatId();
    if (!ownerChat || String(message.chat?.id) !== ownerChat) return { ok: false, skipped: true };
    const text = String(message.text || '').trim();
    if (!text) return { ok: false, skipped: true };
    const { AdminInbox } = require('../ai/chatgram'); // lazy: circular require
    const record = await AdminInbox.findOne({ telegramMessageId: replyToId });
    if (!record) return { ok: false, skipped: true };
    record.telegramReply = {
      text: text.slice(0, REPLY_MAX_LENGTH),
      at: new Date(),
      sentToUser: false,
    };
    await record.save();
    return { ok: true, reportId: String(record._id), ref: record.ref || '' };
  } catch (error) {
    logSafe(`could not save a Telegram reply: ${error?.message || error}`);
    return { ok: false, error: 'Could not save the Telegram reply.' };
  }
}

async function pollLoop() {
  while (!pollingStopped) {
    try {
      if (!(await isEnabled())) {
        await sleep(POLL_DISABLED_WAIT_MS);
        continue;
      }
      const payload = { timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ['message'], limit: 50 };
      if (pollOffset > 0) payload.offset = pollOffset;
      const body = await telegramCall('getUpdates', payload, {
        timeoutMs: (POLL_TIMEOUT_SECONDS + 10) * 1000,
      });
      const updates = Array.isArray(body.result) ? body.result : [];
      for (const update of updates) {
        if (Number.isFinite(Number(update?.update_id))) pollOffset = Number(update.update_id) + 1;
        await saveReplyFromUpdate(update);
      }
    } catch (error) {
      if (error?.status === 409) {
        // A webhook (or a second poller) owns getUpdates on this bot; polling
        // cannot work until that is removed. One line, no secrets, then stop.
        pollingStopped = true;
        console.warn(
          'reportTelegram: two-way polling disabled — this bot has a Telegram webhook (or another getUpdates client) active.',
        );
        return;
      }
      logSafe(`polling error: ${error?.message || error}`);
      await sleep(POLL_ERROR_WAIT_MS);
    }
  }
}

/**
 * Start the long-poll reply loop exactly once. Only when the bot is configured;
 * the admin setting is re-checked on every cycle, so toggling it off pauses the
 * network calls without a restart. Returns the loop promise (ignored by the
 * server, awaited by tests).
 */
function startPolling() {
  if (pollingStarted || pollingStopped) return Promise.resolve();
  if (!telegramConfigured()) return Promise.resolve();
  pollingStarted = true;
  console.log('reportTelegram: two-way reply polling started.');
  return pollLoop().catch((error) => {
    logSafe(`polling stopped: ${error?.message || error}`);
  });
}

module.exports = {
  isEnabled,
  sendReport,
  sendTest,
  startPolling,
  saveReplyFromUpdate,
  formatReportMessage,
  telegramConfigured,
};
