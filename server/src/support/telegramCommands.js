/**
 * Owner Telegram commands for report automation (Option B).
 *
 * Webhook: POST /api/telegram/webhook (secret header from Telegram).
 *
 *   /inbox            newest 5 open error_report/call_quality/push_failure rows
 *   /prompt <id>      the stored AI debugging prompt for an inbox row
 *   /issue <id>       create (or return) the GitHub issue for a row
 *   /help             command list
 *
 * Plain text only, no tokens/emails/phones, per-chat rate limit (10/min),
 * owner-chat only. Unknown commands answer a one-line help.
 */
const crypto = require('crypto');

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;
const PROMPT_MAX = 3500;
const buckets = new Map(); // chatId -> timestamps

const HELP = [
  'Chatgram report commands:',
  '/inbox — newest open reports',
  '/prompt <inboxId> — the AI debugging prompt',
  '/issue <inboxId> — create/return the GitHub issue',
  '/help — this list',
].join('\n');

const HELP_LINE = 'Unknown command. Try /inbox, /prompt <id>, /issue <id> or /help.';

function token() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}
function ownerChatId() {
  return String(process.env.TELEGRAM_CHAT_ID || '').trim();
}
function webhookSecret() {
  return String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
}
function apiBase() {
  return (String(process.env.TELEGRAM_API_BASE || '').trim() || 'https://api.telegram.org').replace(/\/+$/, '');
}

/** Constant-time secret comparison; a missing configured secret rejects. */
function validSecret(provided) {
  const expected = webhookSecret();
  const value = String(provided || '');
  if (!expected || !value) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(value);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function redact(value) {
  const { redactPII } = require('../utils/githubIssues');
  return redactPII(value);
}

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function allowChat(chat) {
  const now = Date.now();
  const list = (buckets.get(chat) || []).filter((at) => now - at < RATE_WINDOW_MS);
  list.push(now);
  buckets.set(chat, list);
  if (buckets.size > 1000) {
    for (const [key, stamps] of buckets) {
      if (!stamps.some((at) => now - at < RATE_WINDOW_MS)) buckets.delete(key);
    }
  }
  return list.length <= RATE_LIMIT;
}

async function sendMessage(text) {
  const bot = token();
  const chat = ownerChatId();
  if (!bot || !chat) return { ok: false, error: 'not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${apiBase()}/bot${bot}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: String(text).slice(0, 4000),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `telegram ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function kindOf(row) {
  try {
    const meta = JSON.parse(row.transcript || '{}');
    return meta.kind === 'feature' ? 'feature' : meta.kind === 'bug' ? 'bug' : null;
  } catch {
    return null;
  }
}

function ageOf(value) {
  const then = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(then)) return 'unknown';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

async function inboxReply() {
  const { AdminInbox } = require('../ai/chatgram');
  const rows = await AdminInbox.find({
    type: { $in: ['error_report', 'call_quality', 'push_failure'] },
    status: 'new',
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  if (!rows.length) return 'No open reports.';
  const lines = ['Newest open reports:'];
  for (const row of rows) {
    const kind = kindOf(row);
    const issue = row.githubIssueUrl
      ? `GitHub #${row.githubIssueNumber || '?'} ${row.githubIssueUrl}`
      : 'no issue';
    const summary = collapse(redact(row.summary || row.title || row.question || '')).slice(0, 90);
    lines.push(
      `${String(row._id).slice(-8)} · ${row.type}${kind ? ` · ${kind}` : ''} · ${ageOf(row.createdAt)} · ${summary} · ${issue}`,
    );
  }
  return lines.join('\n');
}

async function promptReply(inboxId) {
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(String(inboxId || ''))) return 'Usage: /prompt <inboxId>';
  const { AdminInbox } = require('../ai/chatgram');
  const row = await AdminInbox.findById(inboxId).lean();
  if (!row) return 'No report with that id.';
  if (!row.fixPrompt) return 'No AI prompt is stored for that report yet.';
  let text = redact(row.fixPrompt);
  let note = '';
  if (text.length > PROMPT_MAX) {
    text = text.slice(0, PROMPT_MAX);
    note = '\n\n…truncated — fetch the full prompt from the admin Inbox.';
  }
  const fence = text.includes('```') ? '~~~~' : '```';
  return `${fence}text\n${text}${note}\n${fence}`;
}

async function issueReply(inboxId) {
  const mongoose = require('mongoose');
  if (!mongoose.Types.ObjectId.isValid(String(inboxId || ''))) return 'Usage: /issue <inboxId>';
  const github = require('../utils/githubIssues');
  if (!github.isConfigured()) return 'GitHub is not configured.';
  const result = await github.retryForInbox(inboxId);
  if (result.ok) {
    return result.created ? `Created GitHub issue #${result.issueNumber}: ${result.url}` : `GitHub issue already exists: #${result.issueNumber} ${result.url}`;
  }
  if (result.error === 'not_found') return 'No report with that id.';
  if (result.error === 'no_prompt') return 'No AI prompt is stored for that report yet.';
  if (result.error === 'not_configured') return 'GitHub is not configured.';
  return `Could not create the GitHub issue (${result.error || 'error'}).`;
}

async function handleCommand(text) {
  const trimmed = String(text || '').trim();
  const [rawCmd, ...rest] = trimmed.split(/\s+/);
  const cmd = (rawCmd || '').toLowerCase().replace(/@\w+$/, '');
  const arg = rest.join(' ').trim();
  try {
    if (cmd === '/help' || cmd === '/start') return HELP;
    if (cmd === '/inbox') return await inboxReply();
    if (cmd === '/prompt') return await promptReply(arg);
    if (cmd === '/issue') return await issueReply(arg);
    return HELP_LINE;
  } catch (error) {
    console.warn('[telegram] command failed:', String(error?.message || error).slice(0, 120));
    return 'Something went wrong handling that command.';
  }
}

/**
 * Apply one Telegram update. Returns {ok, ignored?, reply?}. Sends the reply
 * through the Bot API unless the chat id is not the owner's.
 */
async function handleUpdate(update) {
  const message = update?.message || update?.edited_message || null;
  if (!message || !message.text) return { ok: true, ignored: true };
  const chat = String(message.chat?.id ?? '');
  if (!chat || chat !== ownerChatId()) return { ok: true, ignored: true };
  if (message.from?.is_bot) return { ok: true, ignored: true };
  if (!allowChat(chat)) {
    await sendMessage('Slow down — too many commands. Try again in a minute.');
    return { ok: true, rateLimited: true };
  }
  const reply = await handleCommand(message.text);
  if (reply) await sendMessage(reply);
  return { ok: true, reply, sent: true };
}

module.exports = {
  HELP,
  HELP_LINE,
  validSecret,
  handleCommand,
  handleUpdate,
  sendMessage,
  inboxReply,
  promptReply,
  issueReply,
  webhookSecret,
};
