/**
 * Optional GitHub issue automation for AI error reports (Option C).
 *
 * Env (all optional; the API boots and behaves exactly as before without them):
 *   GITHUB_TOKEN          fine-grained/classic token with issues:write
 *   GITHUB_REPO           owner/repo
 *   GITHUB_LABEL          label to add (default chatgram-report)
 *   GITHUB_ISSUES_ENABLED explicit on/off; default ON only when token+repo exist
 *   GITHUB_API_BASE       override for tests / GitHub Enterprise (https://api.github.com)
 *
 * A created issue is stored on the AdminInbox row (`githubIssueNumber`,
 * `githubIssueUrl`). Failures never throw to callers: they are logged without
 * content (status only) and stored as `githubError` so the owner can retry.
 *
 * Nothing here puts a token, email, phone number or secret in an issue body or
 * log line.
 */
const TAG = '[github]';
const DEFAULT_API = 'https://api.github.com';
const DEFAULT_LABEL = 'chatgram-report';
const TIMEOUT_MS = 8000;

function envValue(name) {
  return String(process.env[name] || '').trim();
}

function config() {
  const token = envValue('GITHUB_TOKEN');
  const repo = envValue('GITHUB_REPO');
  const explicit = String(process.env.GITHUB_ISSUES_ENABLED || '').trim().toLowerCase();
  const enabledFlag = explicit === '' ? Boolean(token && repo) : explicit !== 'false' && explicit !== '0';
  return {
    token,
    repo,
    label: envValue('GITHUB_LABEL') || DEFAULT_LABEL,
    apiBase: (envValue('GITHUB_API_BASE') || DEFAULT_API).replace(/\/+$/, ''),
    enabled: enabledFlag && Boolean(token) && /^[^/\s]+\/[^/\s]+$/.test(repo),
  };
}

function isConfigured() {
  return config().enabled;
}

/** Redact emails, phone numbers and token-like strings from anything we publish. */
function redactPII(value) {
  let text = String(value === undefined || value === null ? '' : value);
  const secrets = [envValue('GITHUB_TOKEN'), envValue('TELEGRAM_BOT_TOKEN')].filter((entry) => entry && entry.length >= 12);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  text = text
    // JWT / GitHub / OpenAI / AWS / Telegram bot tokens.
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted-token]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted-token]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted-token]')
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[redacted-token]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-token]')
    .replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '[redacted-token]')
    // Email addresses.
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
    // Phone numbers: international (+…) or plain 10-13 digit numbers. Deliberately
    // does not match ISO timestamps/dates with separators.
    .replace(/(?<![\w])\+\d[\d\s().-]{6,18}\d(?![\w])/g, '[redacted-phone]')
    .replace(/(?<![\w])(?:0\d{9}|\d{10,13})(?![\w])/g, '[redacted-phone]');
  return text;
}

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unescapeBasic(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function shortSummary(record, summary) {
  const raw = collapse(summary || record.summary || record.title || record.question || 'Error report');
  const safe = redactPII(unescapeBasic(raw));
  return safe.length > 90 ? `${safe.slice(0, 87).trimEnd()}…` : safe;
}

function issueTitle(record, summary) {
  return `[report] ${shortSummary(record, summary)}`.slice(0, 90);
}

function issueLabels(record, kind) {
  const { label } = config();
  const labels = new Set([label, kind === 'feature' ? 'enhancement' : 'bug']);
  return [...labels].filter(Boolean);
}

function parseContext(record, context) {
  let ctx = context || {};
  if (!context && record?.transcript) {
    try {
      const meta = JSON.parse(record.transcript);
      ctx = meta.context || {};
    } catch {
      ctx = {};
    }
  }
  return ctx;
}

function metadataFooter(record, kind, context) {
  const ctx = parseContext(record, context);
  const rows = [
    `Inbox: ${record._id || '(unknown)'}`,
    `Kind: ${kind === 'feature' ? 'feature' : 'bug'}`,
    `Source: error-report`,
    `App: ${collapse(ctx.appVersion) || 'unknown'} · Platform: ${collapse(ctx.platform) || 'unknown'} · Screen: ${collapse(ctx.screen) || 'unknown'}`,
    `Created: ${record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString()}`,
  ];
  return rows.map((row) => redactPII(row)).join('\n');
}

/** Fenced prompt + metadata footer. Never includes tokens/emails/phones. */
function buildIssueBody({ record, prompt, kind, context }) {
  const safePrompt = redactPII(prompt || record?.fixPrompt || '');
  const bodyPrompt = safePrompt.length > 12000 ? `${safePrompt.slice(0, 12000)}\n…(truncated)` : safePrompt;
  const fence = bodyPrompt.includes('```') ? '~~~~' : '```';
  const footer = metadataFooter(record || {}, kind, context);
  return [
    'Automated report from the Chatgram Help "Errors" tab.',
    '',
    `${fence}text`,
    bodyPrompt || '(no prompt stored)',
    fence,
    '',
    '---',
    footer,
  ].join('\n');
}

function buildIssuePayload({ record, prompt, kind, context, summary }) {
  return {
    title: issueTitle(record || {}, summary),
    body: buildIssueBody({ record, prompt, kind: kind === 'feature' ? 'feature' : 'bug', context }),
    labels: issueLabels(record || {}, kind),
  };
}

async function gitHubFetch(path, { body, token, apiBase, method = 'POST' }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'chatgram-api-report-automation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (!response.ok) {
      const error = new Error(`GitHub ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload || {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('GitHub timeout');
      timeout.code = 'timeout';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A fresh repo usually does not have our labels yet; GitHub rejects an issue
 * with unknown labels (422). Create the missing labels once, then retry.
 */
async function ensureLabels(cfg, labels) {
  for (const name of labels) {
    try {
      await gitHubFetch(`/repos/${cfg.repo}/labels`, {
        method: 'POST',
        body: { name, color: 'ededed' },
        token: cfg.token,
        apiBase: cfg.apiBase,
      });
    } catch {
      /* already exists / not permitted: the issue retry decides */
    }
  }
}

function failureStatus(error) {
  const status = Number(error?.status);
  if (Number.isFinite(status) && status > 0) return String(status);
  return error?.code === 'timeout' ? 'timeout' : 'network';
}

async function storeResult(record, patch) {
  if (record && typeof record.set === 'function') {
    for (const [key, value] of Object.entries(patch)) record[key] = value;
  }
  if (!record?._id) return;
  try {
    const { AdminInbox } = require('../ai/chatgram'); // lazy: circular require
    await AdminInbox.updateOne({ _id: record._id }, { $set: patch });
  } catch (error) {
    console.warn(`${TAG} could not store the issue fields:`, String(error?.message || error).slice(0, 120));
  }
}

/**
 * Create the GitHub issue for one NEW inbox row. Idempotent (an existing issue
 * is returned). Never throws.
 * @returns {Promise<{ok:boolean, created?:boolean, skipped?:boolean, issueNumber?:number, url?:string, error?:string}>}
 */
async function createIssueForRecord(record, { prompt, kind, context, summary } = {}) {
  try {
    if (!record || !record._id) return { ok: false, skipped: true, error: 'no record' };
    if (record.githubIssueNumber && record.githubIssueUrl) {
      return { ok: true, created: false, issueNumber: record.githubIssueNumber, url: record.githubIssueUrl };
    }
    const cfg = config();
    if (!cfg.enabled) return { ok: false, skipped: true, error: 'not configured' };

    const payload = buildIssuePayload({ record, prompt, kind, context, summary });
    let result;
    try {
      result = await gitHubFetch(`/repos/${cfg.repo}/issues`, {
        body: payload,
        token: cfg.token,
        apiBase: cfg.apiBase,
      });
    } catch (error) {
      // 422 usually means our labels do not exist in a fresh repo yet.
      if (error?.status === 422 && payload.labels.length) {
        await ensureLabels(cfg, payload.labels);
        result = await gitHubFetch(`/repos/${cfg.repo}/issues`, {
          body: payload,
          token: cfg.token,
          apiBase: cfg.apiBase,
        });
      } else {
        throw error;
      }
    }
    const issueNumber = Number(result.number);
    const url = String(result.html_url || '');
    if (!Number.isFinite(issueNumber) || !url) {
      await storeResult(record, { githubError: 'unexpected_response' });
      return { ok: false, error: 'unexpected_response' };
    }
    await storeResult(record, {
      githubIssueNumber: issueNumber,
      githubIssueUrl: url,
      githubError: '',
      githubIssueAt: new Date(),
    });
    return { ok: true, created: true, issueNumber, url };
  } catch (error) {
    const status = failureStatus(error);
    await storeResult(record, { githubError: status });
    // Content-free: status only, never the token, body, title or prompt.
    console.warn(`${TAG} issue creation failed: ${status}`);
    return { ok: false, error: status };
  }
}

/** Admin/Telegram retry for one inbox id (idempotent). Never throws. */
async function retryForInbox(inboxId) {
  try {
    const { AdminInbox } = require('../ai/chatgram');
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(String(inboxId))) return { ok: false, error: 'not_found' };
    const record = await AdminInbox.findById(inboxId);
    if (!record) return { ok: false, error: 'not_found' };
    if (record.githubIssueNumber && record.githubIssueUrl) {
      return { ok: true, created: false, issueNumber: record.githubIssueNumber, url: record.githubIssueUrl };
    }
    if (!config().enabled) return { ok: false, skipped: true, error: 'not_configured' };
    if (!record.fixPrompt) return { ok: false, error: 'no_prompt' };
    let kind = 'bug';
    try {
      const meta = JSON.parse(record.transcript || '{}');
      if (meta.kind === 'feature') kind = 'feature';
    } catch {
      /* default to bug */
    }
    return await createIssueForRecord(record, {
      prompt: record.fixPrompt,
      kind,
      context: null,
      summary: record.summary,
    });
  } catch (error) {
    console.warn(`${TAG} retry failed:`, String(error?.message || error).slice(0, 120));
    return { ok: false, error: 'failed' };
  }
}

module.exports = {
  config,
  isConfigured,
  redactPII,
  buildIssuePayload,
  buildIssueBody,
  issueTitle,
  createIssueForRecord,
  retryForInbox,
};
