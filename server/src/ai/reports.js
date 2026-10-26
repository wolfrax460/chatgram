/**
 * Real, server-executed reports for Chatgram AI.
 *
 * The model may emit a hidden [[CHATGRAM_REPORT]] JSON block. The server (never
 * the model) creates the AdminInbox record, sends the Telegram alert and builds
 * the confirmation; any sentence in the model text that claims an action was
 * performed is stripped unless the action really succeeded.
 */
const mongoose = require('mongoose');
function AdminInbox() {
  return require('./chatgram').AdminInbox;
}
const notifier = require('../support/notifier');

const REPORT_TYPES = new Set([
  'bug_report',
  'feature_request',
  'support_request',
  'complaint',
  'abuse_report',
  'unknown_question',
]);
const PROBLEM_TYPES = new Set(['bug_report', 'feature_request', 'complaint']);
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@chatgram.local';

const BLOCK_RE = /\[\[CHATGRAM_REPORT\]\]([\s\S]*?)\[\[\/CHATGRAM_REPORT\]\]/i;
const CLAIM_RE =
  /\b(?:i(?:'ve| have)?\s+(?:forwarded|sent|notified|reported|escalated|passed|shared|raised)|(?:forwarded|sent|notified|reported|escalated|passed|raised)\s+(?:this|it|your|that))\b[^.!?\n]*[.!?]?/gi;

function clean(value, max = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Parse the hidden action block. Returns null when absent or invalid. */
function parseReportDirective(rawText) {
  const match = String(rawText || '').match(BLOCK_RE);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const type = REPORT_TYPES.has(parsed.type) ? parsed.type : 'support_request';
  const title = clean(parsed.title, 160);
  const summary = clean(parsed.summary, 1200);
  if (!title && !summary) return null;
  return {
    type,
    title: title || summary.slice(0, 120),
    summary: summary || title,
    includeConversation: parsed.includeConversation === true,
  };
}

/** Remove the hidden block from the user-visible text. */
function stripReportDirective(rawText) {
  return String(rawText || '').replace(BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Remove sentences that claim an action we did not execute. */
function stripActionClaims(text) {
  return String(text || '')
    .replace(CLAIM_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!?])/g, '$1')
    .trim();
}

/** True when the model text promises something an action would have done. */
function claimsAction(text) {
  CLAIM_RE.lastIndex = 0;
  const found = CLAIM_RE.test(String(text || ''));
  CLAIM_RE.lastIndex = 0;
  return found;
}

/** Remove a duplicated "@Name, @Name," prefix the model may have added. */
function stripDuplicatePrefix(text, displayName) {
  const first = String(displayName || '').replace(/^@+/, '').trim().split(/\s+/)[0];
  if (!first) return text;
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(?:@${escaped}\\s*[,;:]?\\s*)+`, 'i');
  return String(text || '').replace(pattern, '').trim();
}

/** Ready-to-use prompt for the coding assistant. */
function buildFixPrompt(report) {
  const type = report.type;
  const transcript = report.transcript ? String(report.transcript).slice(0, 8000) : '';
  const lines = [
    `Title: ${report.title}`,
    '',
    'Context: Chatgram (React web app at apps/web, Electron desktop shell, Capacitor Android, Express/Mongo backend).',
    `Report type: ${type} · reference ${report.ref || '(pending)'}`,
    `Reported from: ${report.source || 'Chatgram AI'}`,
    '',
    'Observed behaviour:',
    clean(report.userText || report.summary, 2000),
    '',
    'Expected behaviour:',
    type === 'feature_request'
      ? 'The requested capability works as described above, without regressions.'
      : 'The reported behaviour no longer occurs and the described problem is resolved.',
    '',
    'Steps to reproduce:',
    '- Open Chatgram and reproduce the reported flow.',
    transcript ? `- Transcript / context:\n${transcript}` : '- Use the summary above; the reporter did not include a transcript.',
    '',
    'Likely areas of code (verify before editing):',
    type === 'bug_report'
      ? '- apps/web/src (UI), server/src (API), server/src/ai or server/src/support for assistant issues; check docs/progress.md for the area history.'
      : '- apps/web/src/pages, apps/web/src/components, server/src/controllers, docs/progress.md.',
    '',
    'Acceptance criteria:',
    '- The reported problem is fixed / the requested feature is usable end to end.',
    '- No secrets printed, no full pre-deploy gate required by token rules; tsc + production build green.',
    '- Deploy per docs/deploy.md (backup first for backend changes, web-only needs no DB backup) with a rollback row.',
    '',
    'Constraints: token budget is limited; no new Playwright suites; extend existing tests; never print secrets.',
  ];
  return lines.join('\n');
}

function referenceCode() {
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RPT-${random}`;
}

function normalizedTitle(type, title) {
  return `${type}:${clean(title, 160).toLowerCase()}`;
}

/**
 * Create (or merge into) an AdminInbox report. Never throws to the caller;
 * returns {ok, record, ref, merged} or {ok:false, error}.
 */
async function createReport({
  type = 'support_request',
  title,
  summary,
  userText = '',
  source = 'Chatgram AI',
  askerId = null,
  askerName = '',
  transcript = '',
  includeConversation = false,
  status = 'new',
  notify = true,
} = {}) {
  try {
    const cleanType = REPORT_TYPES.has(type) ? type : 'support_request';
    const cleanTitle = clean(title || summary, 160) || 'Chatgram AI report';
    const cleanSummary = clean(summary || title, 1200);
    const normalized = normalizedTitle(cleanType, cleanTitle);
    const now = new Date();
    let record = await AdminInbox().findOne({ normalized, status: { $ne: 'ignored' } });
    let merged = false;
    if (record) {
      record.count = (record.count || 1) + 1;
      record.lastSeenAt = now;
      if (cleanSummary && cleanSummary.length > String(record.summary || '').length) record.summary = cleanSummary;
      if (userText) record.userText = clean(userText, 6000);
      await record.save();
      merged = true;
    } else {
      record = await AdminInbox().create({
        type: cleanType,
        question: clean(userText || cleanTitle, 6000),
        normalized,
        title: cleanTitle,
        summary: cleanSummary,
        userText: clean(userText, 6000),
        source: clean(source, 200),
        askerId: askerId && mongoose.Types.ObjectId.isValid(String(askerId)) ? askerId : null,
        askerName: clean(askerName, 120),
        ref: referenceCode(),
        fixPrompt: '',
        transcript: includeConversation ? String(transcript || '').slice(0, 12000) : '',
        status: status === 'in_progress' || status === 'answered' || status === 'fixed' || status === 'ignored' ? status : 'new',
        count: 1,
        lastSeenAt: now,
      });
    }
    if (PROBLEM_TYPES.has(cleanType) || cleanType === 'support_request') {
      record.fixPrompt = buildFixPrompt({
        ...record.toObject(),
        type: cleanType,
        title: cleanTitle,
        summary: cleanSummary,
        userText,
        source,
        transcript,
      });
      await record.save();
    }
    let notified = false;
    if (notify) notified = await notifyReport(record);
    return { ok: true, record, ref: record.ref, merged, notified };
  } catch (error) {
    console.warn('AI report creation failed:', String(error?.message || error).slice(0, 200));
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }
}

function emojiFor(type) {
  return {
    bug_report: '🐞',
    feature_request: '✨',
    support_request: '🛟',
    complaint: '😠',
    abuse_report: '🚨',
    unknown_question: '❓',
  }[type] || '📩';
}

async function notifyReport(record) {
  if (String(process.env.AI_REPORT_TELEGRAM || 'true').toLowerCase() === 'false') return false;
  const firstLines = String(record.summary || record.title || '').slice(0, 600);
  const inboxUrl = `${process.env.CLIENT_URL || 'https://chatgram-xi.vercel.app'}/web/admin/inbox`;
  const text = [
    `${emojiFor(record.type)} ${record.type} · ${record.ref}`,
    `Title: ${record.title}`,
    firstLines,
    `Where: ${record.source || 'Chatgram AI'}`,
    `Asked by: ${record.askerName || 'Chatgram user'}`,
    `Inbox: ${inboxUrl}`,
    record.fixPrompt ? `\nFix prompt (first 600 chars):\n${record.fixPrompt.slice(0, 600)}` : null,
  ].filter(Boolean).join('\n');
  try {
    const results = await notifier.notifyAlert(text);
    return Array.isArray(results) ? results.some((result) => result.ok) : false;
  } catch (error) {
    console.warn('AI report Telegram notify failed:', String(error?.message || error).slice(0, 160));
    return false;
  }
}

/**
 * Apply the hidden action from a model answer.
 * Returns { text, report, created, confirmation }.
 */
async function handleModelReport({ text, context = {} } = {}) {
  const directive = parseReportDirective(text);
  let visible = stripReportDirective(text);
  if (!directive) {
    // No action, but the model claimed one: never lie to the user.
    if (claimsAction(visible)) {
      visible = `${stripActionClaims(visible)}\n\nI can't send that to the Chatgram team from here right now. Please email ${SUPPORT_EMAIL} if it's urgent.`.trim();
    }
    return { text: visible, report: null, created: false };
  }
  const result = await createReport({
    ...directive,
    userText: context.userText || '',
    source: context.source || 'Chatgram AI',
    askerId: context.askerId || null,
    askerName: context.askerName || '',
    transcript: context.transcript || '',
    includeConversation: directive.includeConversation || false,
  });
  if (!result.ok) {
    return {
      text: `${stripActionClaims(visible)}\n\nI couldn't send that to the Chatgram team right now. Please email ${SUPPORT_EMAIL} and we'll pick it up.`.trim(),
      report: null,
      created: false,
      failed: true,
    };
  }
  const confirmation = result.merged
    ? `Done. I've added this to the existing Chatgram team report (reference ${result.ref}).`
    : `Done. I've sent this to the Chatgram team. Reference ${result.ref}.`;
  const body = stripActionClaims(visible).trim();
  return {
    text: [body, confirmation].filter(Boolean).join('\n\n').trim(),
    report: result.record,
    ref: result.ref,
    created: true,
    merged: result.merged,
    notified: result.notified,
    confirmation,
  };
}

module.exports = {
  REPORT_TYPES,
  PROBLEM_TYPES,
  SUPPORT_EMAIL,
  parseReportDirective,
  stripReportDirective,
  stripActionClaims,
  claimsAction,
  stripDuplicatePrefix,
  buildFixPrompt,
  createReport,
  notifyReport,
  handleModelReport,
};
