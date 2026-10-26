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
const fixPrompt = require('./fixPrompt');
const { redact } = require('./redact');

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

/**
 * Ready-to-use prompt for the coding assistant (deterministic fallback form).
 * The AI-enriched version is generated asynchronously by fixPrompt.js; this
 * synchronous export is kept for callers/tests that only need the template.
 */
function buildFixPrompt(report) {
  try {
    return fixPrompt.buildTemplatePrompt(report || {});
  } catch {
    return `Goal: Investigate the Chatgram report ${clean(report && report.ref, 40) || '(reference pending)'}.\n\nObserved behaviour (the reporter’s exact words — quoted once, not repeated below):\n> ${clean(report && (report.userText || report.summary || report.title), 1600) || '(no text captured)'}`;
  }
}

function referenceCode() {
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RPT-${random}`;
}

function normalizedTitle(type, title) {
  return `${type}:${clean(title, 160).toLowerCase()}`;
}

/**
 * Persist the generated prompt fields. The normal path is `record.save()`; the
 * raw-collection write is a safety net for a deployed AdminInbox schema that
 * predates fixPromptSource/fixPromptQuestions, so the source is never lost.
 */
async function persistFixPromptFields(record) {
  let saveError = null;
  try {
    await record.save();
  } catch (error) {
    saveError = error;
    console.warn('AI report fix prompt save failed:', String(error?.message || error).slice(0, 160));
  }
  try {
    const Model = AdminInbox();
    const hasSchemaFields = Boolean(Model.schema.path('fixPromptSource') && Model.schema.path('fixPromptQuestions'));
    if (saveError && record._id && !hasSchemaFields) {
      await Model.collection.updateOne(
        { _id: record._id },
        {
          $set: {
            fixPrompt: record.fixPrompt,
            fixPromptSource: record.fixPromptSource,
            fixPromptQuestions: record.fixPromptQuestions || [],
          },
        },
      );
    }
  } catch {
    /* the prompt already lives on the in-memory record; a DB hiccup must not lose the report */
  }
}

/**
 * Create (or merge into) an AdminInbox report. Never throws to the caller;
 * returns {ok, record, ref, merged, notified, alert, promptSource} or {ok:false, error}.
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
  fixPromptChat = null,
} = {}) {
  try {
    const cleanType = REPORT_TYPES.has(type) ? type : 'support_request';
    const cleanTitle = clean(title || summary, 160) || 'Chatgram AI report';
    const cleanSummary = clean(summary || title, 1200);
    const normalized = normalizedTitle(cleanType, cleanTitle);
    const now = new Date();
    // Conversation context is stored redacted (emails, phones, codes, tokens,
    // card numbers) for every report type.
    const safeTranscript = transcript ? redact(String(transcript), { allowContact: false }).slice(0, 12000) : '';
    let record = await AdminInbox().findOne({ normalized, status: { $ne: 'ignored' } });
    let merged = false;
    if (record) {
      record.count = (record.count || 1) + 1;
      record.lastSeenAt = now;
      if (cleanSummary && cleanSummary.length > String(record.summary || '').length) record.summary = cleanSummary;
      if (userText) record.userText = clean(userText, 6000);
      if (includeConversation && safeTranscript) record.transcript = safeTranscript;
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
        fixPromptSource: 'template',
        fixPromptQuestions: [],
        transcript: includeConversation ? safeTranscript : '',
        status: status === 'in_progress' || status === 'answered' || status === 'fixed' || status === 'ignored' ? status : 'new',
        count: 1,
        lastSeenAt: now,
      });
    }
    let promptSource = record.fixPromptSource || 'template';
    if ((PROBLEM_TYPES.has(cleanType) || cleanType === 'support_request') && (merged ? !record.fixPrompt : true)) {
      const generated = await fixPrompt.generateFixPrompt(
        {
          ...record.toObject(),
          type: cleanType,
          title: cleanTitle,
          summary: cleanSummary,
          userText: clean(userText, 6000) || record.userText,
          source,
          askerName,
          transcript: safeTranscript,
        },
        fixPromptChat ? { chat: fixPromptChat } : {},
      );
      record.fixPrompt = generated.text;
      record.fixPromptSource = generated.source;
      record.fixPromptQuestions = generated.questions || [];
      promptSource = generated.source;
      await persistFixPromptFields(record);
    }
    let alert = { ok: false, skipped: false, error: null };
    if (notify) alert = await sendReportAlert(record);
    return {
      ok: true,
      record,
      ref: record.ref,
      merged,
      notified: Boolean(alert.ok),
      alert,
      promptSource,
    };
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

/**
 * Send the SHORT report alert through the Telegram reports module
 * (server/src/support/reportTelegram.js). That module owns the message layout:
 * emoji + type, reference, title, 2-3 line summary, where, asker, Inbox link —
 * the fix prompt never goes to Telegram, and the summary is shortened at a
 * sentence/word boundary, never mid-sentence.
 *
 * Returns {ok, skipped, error, messageId}. `skipped` means the channel is
 * intentionally off/unconfigured (not a failure); `ok:false` means it tried and
 * failed. Never throws.
 */
async function sendReportAlert(record) {
  let telegram = null;
  try {
    telegram = require('../support/reportTelegram');
  } catch (error) {
    console.warn('AI report notifier unavailable:', String(error?.message || error).slice(0, 160));
    return { ok: false, skipped: true, error: 'notifier unavailable' };
  }
  try {
    if (typeof telegram.sendReport !== 'function') {
      return { ok: false, skipped: true, error: 'notifier unavailable' };
    }
    if (typeof telegram.isEnabled === 'function') {
      const enabled = await telegram.isEnabled();
      if (enabled === false) return { ok: false, skipped: true };
    }
    const result = await telegram.sendReport(record);
    if (result && typeof result === 'object') {
      return {
        ok: result.ok === true,
        skipped: result.skipped === true,
        error: result.error ? String(result.error).slice(0, 200) : null,
        messageId: result.messageId === undefined ? null : result.messageId,
      };
    }
    return { ok: Boolean(result), skipped: false, error: null, messageId: null };
  } catch (error) {
    console.warn('AI report notification failed:', String(error?.message || error).slice(0, 160));
    return { ok: false, skipped: false, error: String(error?.message || error).slice(0, 200) };
  }
}

/** Boolean compatibility wrapper (true only when a channel really delivered). */
async function notifyReport(record) {
  const alert = await sendReportAlert(record);
  return Boolean(alert.ok);
}

/**
 * The honest confirmation sentence. "sent" is only used when Telegram really
 * delivered; a record saved but un-alerted says "recorded"; a failed alert says
 * so and offers the support email.
 */
function confirmationFor(result) {
  const ref = result.ref;
  if (result.merged) {
    return `Done. I've added this to the existing Chatgram team report (reference ${ref}).`;
  }
  if (result.alert?.ok) {
    return `Done. I've sent this to the Chatgram team. Reference ${ref}.`;
  }
  if (result.alert?.skipped) {
    return `Done. I've recorded this for the Chatgram team inbox. Reference ${ref}.`;
  }
  return `I've recorded this for the Chatgram team inbox (reference ${ref}), but I couldn't send the alert right now. Please email ${SUPPORT_EMAIL} if it's urgent.`;
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
    fixPromptChat: context.fixPromptChat || null,
  });
  if (!result.ok) {
    return {
      text: `${stripActionClaims(visible)}\n\nI couldn't send that to the Chatgram team right now. Please email ${SUPPORT_EMAIL} and we'll pick it up.`.trim(),
      report: null,
      created: false,
      failed: true,
    };
  }
  const confirmation = confirmationFor(result);
  const body = stripActionClaims(visible).trim();
  return {
    text: [body, confirmation].filter(Boolean).join('\n\n').trim(),
    report: result.record,
    ref: result.ref,
    created: true,
    merged: result.merged,
    notified: result.notified,
    alert: result.alert,
    promptSource: result.promptSource,
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
  generateFixPrompt: fixPrompt.generateFixPrompt,
  createReport,
  sendReportAlert,
  notifyReport,
  confirmationFor,
  handleModelReport,
};
