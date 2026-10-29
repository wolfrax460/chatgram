/**
 * Help tab: "Errors" — turn a user's error report into a debugging prompt or a
 * feature-request prompt.
 *
 * POST /api/help/error-report (auth required):
 *   { message: string, context?: { appVersion?, platform?, screen?, lastAction?, errorCode? } }
 *   -> { id, kind: 'bug'|'feature', prompt, summary }
 *
 * What happens:
 *  1. strict validation + sanitisation (length caps, control chars removed, HTML
 *     escaped for storage) — only the caller's own text, never another user's;
 *  2. one AdminInbox row of type `error_report` keyed by
 *     `error_report:<userId>:<hash>` (count++ on duplicates), user text stored in
 *     `userText`, the generated prompt in `fixPrompt`;
 *  3. the Help/Support assistant (NVIDIA NIM/Nemotron first, configured provider
 *     as fallback) classifies the report and writes the structured prompt;
 *  4. when AI is unavailable/fails, a deterministic template prompt built from the
 *     report is used instead, so the tab always works. No 500 for AI failures.
 *
 * Nothing here logs or stores API keys, prompts of other users or tokens.
 */
const crypto = require('crypto');
const { AdminInbox } = require('../ai/chatgram');

const MAX_MESSAGE = 2000;
const MAX_PROMPT = 6000;
const MAX_SUMMARY = 300;
const CONTEXT_LIMITS = {
  appVersion: 40,
  platform: 40,
  screen: 120,
  lastAction: 300,
  errorCode: 80,
};
const CONTEXT_KEYS = Object.keys(CONTEXT_LIMITS);

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 20;
const rateBuckets = new Map(); // userId -> { count, startedAt }

function rateLimitsDisabled() {
  return process.env.HELP_RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production';
}

function allowRate(userId) {
  if (rateLimitsDisabled()) return { ok: true };
  const now = Date.now();
  const key = String(userId);
  const entry = rateBuckets.get(key);
  if (!entry || now - entry.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, startedAt: now });
    if (rateBuckets.size > 5000) {
      for (const [bucketKey, bucket] of rateBuckets) {
        if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(bucketKey);
      }
    }
    return { ok: true };
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + RATE_WINDOW_MS - now) / 1000)),
    };
  }
  return { ok: true };
}

/** Strip control characters, normalise whitespace and cap the length. */
function cleanText(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Escape for storage/prompt text so a report can never inject markup. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate the body. Returns { ok:true, message, context } or { ok:false, code }.
 * Unknown context keys are rejected so the schema stays exactly typed.
 */
function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_REPORT' };
  }
  const rawMessage = body.message;
  if (typeof rawMessage !== 'string') return { ok: false, code: 'INVALID_REPORT' };
  const message = cleanText(rawMessage, MAX_MESSAGE + 1);
  if (!message || message.length > MAX_MESSAGE) return { ok: false, code: 'INVALID_REPORT' };

  let context = {};
  if (body.context !== undefined && body.context !== null) {
    if (typeof body.context !== 'object' || Array.isArray(body.context)) {
      return { ok: false, code: 'INVALID_CONTEXT' };
    }
    for (const key of Object.keys(body.context)) {
      if (!CONTEXT_KEYS.includes(key)) return { ok: false, code: 'INVALID_CONTEXT' };
      const value = body.context[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { ok: false, code: 'INVALID_CONTEXT' };
      }
      const cleaned = cleanText(value, CONTEXT_LIMITS[key]);
      if (cleaned) context[key] = cleaned;
    }
  }
  return { ok: true, message, context };
}

/** Stable duplicate key: same user + same report (text/context) -> same row. */
function reportHash(userId, message, context) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ message, context }))
    .digest('hex')
    .slice(0, 24);
  return `error_report:${String(userId)}:${digest}`;
}

const BUG_RE = /\b(error|errors|crash|crashed|crashes|crashing|broken|bug|bugs|fail|failed|fails|failing|failure|not working|doesn'?t work|does not work|wrong|freeze|frozen|stuck|slow|invalid|expired|cannot|can'?t|issue|problem|missing|disappear|logged out|logout|otp|verification code|verification)\b/i;
const FEATURE_RE = /\b(feature|request|please add|would like|wish|suggest|suggestion|improve|improvement|enhance|new option|new setting|allow|enable|dark mode|light mode|support for|add support)\b/i;

function classifyKind(message) {
  const text = String(message || '');
  if (BUG_RE.test(text)) return 'bug';
  if (FEATURE_RE.test(text)) return 'feature';
  return 'bug'; // an error report defaults to a bug
}

function classifySeverity(message) {
  const text = String(message || '');
  if (/data loss|lost (all|my)|security|payment|charged|everyone|all users|can'?t log ?in|locked out|account deleted/i.test(text)) {
    return 'critical';
  }
  if (/crash|freeze|otp|verification|login|sign ?up|cannot|can'?t|blocked/i.test(text)) return 'high';
  return 'medium';
}

function suspectedArea(message) {
  const text = String(message || '');
  const areas = [
    [/otp|verification code|sign ?up|sign ?in|log ?in|password|account|session|token/i, 'server/src/controllers/authController.js, server/src/controllers/verificationController.js, server/src/utils/verificationStore.js'],
    [/message|chat|send|reply|typing|unread|receipt/i, 'server/src/controllers/messageController.js, server/src/sockets/socketHandler.js'],
    [/call|audio|video|turn|microphone|camera|screen shar/i, 'server/src/utils/callRooms.js, server/src/controllers/callController.js, server/src/utils/callRegistry.js'],
    [/status|story|stories/i, 'server/src/controllers/statusController.js, server/src/utils/statusMedia.js'],
    [/upload|image|photo|video file|avatar|media|file/i, 'server/src/utils/storage.js, server/src/utils/upload.js'],
    [/group|admin|invite|member|join/i, 'server/src/controllers/chatController.js, server/src/utils/groupSystem.js'],
    [/ai|assistant|chatgram ai|nemotron|support|help/i, 'server/src/ai/**, server/src/support/aiProvider.js, server/src/help/**'],
  ];
  for (const [pattern, area] of areas) if (pattern.test(text)) return area;
  return 'Triage needed: match the screen/action to the corresponding server/src route and controller.';
}

function defaultSteps(message, context) {
  const steps = [];
  if (context.lastAction) steps.push(`User did: ${context.lastAction}`);
  steps.push('Open Chatgram and sign in' + (context.platform ? ` on ${context.platform}` : '') + '.');
  if (context.screen) steps.push(`Go to the "${context.screen}" screen.`);
  const firstLine = String(message || '').split('\n').map((line) => line.trim()).filter(Boolean)[0];
  if (firstLine) steps.push(`Perform: ${firstLine.slice(0, 180)}`);
  steps.push('Observe the behaviour described in "What happened".');
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

/** Deterministic prompt (also the fallback when the AI is unavailable). */
function buildTemplatePrompt({ message, context, kind, title, severity }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const steps = defaultSteps(message, context).map(escapeHtml).join('\n');
  const expected = kind === 'feature'
    ? 'The requested capability exists and behaves as described in the acceptance criteria.'
    : 'The action completes without the reported error; no crash, freeze or incorrect state.';
  const actual = escapeHtml(message);
  const acceptance = kind === 'feature'
    ? '- [ ] The new capability is available where described.\n- [ ] It is covered by an integration test.\n- [ ] Existing behaviour is unchanged.'
    : '- [ ] The reported flow no longer produces the described error.\n- [ ] A regression test reproduces the original failure and passes after the fix.\n- [ ] No new errors appear in the API/socket logs.';
  const agentPrompt = [
    `[Chatgram ${kind}] ${title}`,
    `Severity: ${severity}`,
    `Context: app ${context.appVersion || 'unknown'} on ${context.platform || 'unknown'}${context.screen ? `, screen "${context.screen}"` : ''}.`,
    `What happened: ${message}`,
    `Expected: ${expected}`,
    `Actual: ${actual}`,
    `Steps:\n${defaultSteps(message, context).join('\n')}`,
    `Suspected area: ${suspectedArea(message)}`,
    `Acceptance criteria:\n${acceptance}`,
  ].join('\n');

  const prompt = [
    `Title: ${safeTitle}`,
    `Kind: ${kind}`,
    `Severity: ${severity}`,
    '',
    'What happened:',
    safeMessage,
    '',
    'Steps to reproduce:',
    steps,
    '',
    'Expected:',
    escapeHtml(expected),
    '',
    'Actual:',
    actual,
    '',
    `Version: ${escapeHtml(context.appVersion || 'unknown')}`,
    `Platform: ${escapeHtml(context.platform || 'unknown')}`,
    `Screen: ${escapeHtml(context.screen || 'unknown')}`,
    `Error code: ${escapeHtml(context.errorCode || 'unknown')}`,
    `Suspected area: ${escapeHtml(suspectedArea(message))}`,
    '',
    'Acceptance criteria:',
    acceptance,
    '',
    'Ready-to-paste prompt:',
    '```',
    escapeHtml(agentPrompt),
    '```',
  ].join('\n');
  return prompt.slice(0, MAX_PROMPT);
}

/** Title: first sentence / first line, cleaned and capped. */
function titleFrom(message, kind) {
  const firstLine = String(message || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] || '';
  const short = firstLine.replace(/\s+/g, ' ').slice(0, 110).replace(/[.!,;:]$/, '');
  if (short) return short;
  return kind === 'feature' ? 'Feature request' : 'Reported bug';
}

function summaryFrom(message, kind) {
  const clean = String(message || '').replace(/\s+/g, ' ').trim();
  const prefix = kind === 'feature' ? 'Feature request: ' : 'Bug report: ';
  return (prefix + clean).slice(0, MAX_SUMMARY);
}

/* ------------------------------------------------------------- AI call */

const AI_SYSTEM = [
  'You are Chatgram\'s error-triage assistant. Turn the user\'s report into a prompt for a coding agent.',
  'Classify it as "bug" (something is broken) or "feature" (a capability is missing).',
  'Reply with ONE JSON object only, no markdown fences, no extra text, using exactly these keys:',
  '{',
  '  "kind": "bug" | "feature",',
  '  "title": "short title (max 120 chars)",',
  '  "severity": "low" | "medium" | "high" | "critical",',
  '  "whatHappened": "the user\'s report, cleaned",',
  '  "steps": ["ordered reproduction steps"],',
  '  "expected": "expected behaviour",',
  '  "actual": "actual behaviour",',
  '  "suspectedArea": "likely files/modules if inferable, otherwise a triage hint",',
  '  "acceptance": ["acceptance criteria"]',
  '}',
  'Never invent contact details, tokens or other users\' data. Keep it factual.',
].join('\n');

function parseAiResult(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const kind = parsed.kind === 'feature' ? 'feature' : parsed.kind === 'bug' ? 'bug' : null;
  if (!kind) return null;
  const list = (value, max) => (Array.isArray(value) ? value : [])
    .map((entry) => cleanText(entry, max))
    .filter(Boolean)
    .slice(0, 8);
  return {
    kind,
    title: cleanText(parsed.title, 120),
    severity: ['low', 'medium', 'high', 'critical'].includes(parsed.severity) ? parsed.severity : 'medium',
    whatHappened: cleanText(parsed.whatHappened, MAX_MESSAGE),
    steps: list(parsed.steps, 200),
    expected: cleanText(parsed.expected, 400),
    actual: cleanText(parsed.actual, 400),
    suspectedArea: cleanText(parsed.suspectedArea, 300),
    acceptance: list(parsed.acceptance, 240),
  };
}

/** Build the final prompt from validated AI fields (escaped before storage). */
function buildAiPrompt({ message, context, ai }) {
  const steps = ai.steps.length ? ai.steps : defaultSteps(message, context);
  const acceptance = ai.acceptance.length
    ? ai.acceptance.map((entry) => `- [ ] ${entry}`).join('\n')
    : '- [ ] The reported issue is fixed and covered by a test.';
  const agentPrompt = [
    `[Chatgram ${ai.kind}] ${ai.title || titleFrom(message, ai.kind)}`,
    `Severity: ${ai.severity}`,
    `Context: app ${context.appVersion || 'unknown'} on ${context.platform || 'unknown'}${context.screen ? `, screen "${context.screen}"` : ''}.`,
    `What happened: ${message}`,
    `Expected: ${ai.expected || 'The action succeeds without the reported error.'}`,
    `Actual: ${ai.actual || message}`,
    `Steps:\n${steps.join('\n')}`,
    `Suspected area: ${ai.suspectedArea || suspectedArea(message)}`,
    `Acceptance criteria:\n${acceptance}`,
  ].join('\n');
  const prompt = [
    `Title: ${escapeHtml(ai.title || titleFrom(message, ai.kind))}`,
    `Kind: ${ai.kind}`,
    `Severity: ${ai.severity}`,
    '',
    'What happened:',
    escapeHtml(ai.whatHappened || message),
    '',
    'Steps to reproduce:',
    steps.map(escapeHtml).join('\n'),
    '',
    'Expected:',
    escapeHtml(ai.expected || 'The action succeeds without the reported error.'),
    '',
    'Actual:',
    escapeHtml(ai.actual || message),
    '',
    `Version: ${escapeHtml(context.appVersion || 'unknown')}`,
    `Platform: ${escapeHtml(context.platform || 'unknown')}`,
    `Screen: ${escapeHtml(context.screen || 'unknown')}`,
    `Error code: ${escapeHtml(context.errorCode || 'unknown')}`,
    `Suspected area: ${escapeHtml(ai.suspectedArea || suspectedArea(message))}`,
    '',
    'Acceptance criteria:',
    acceptance,
    '',
    'Ready-to-paste prompt:',
    '```',
    escapeHtml(agentPrompt),
    '```',
  ].join('\n');
  return prompt.slice(0, MAX_PROMPT);
}

async function classifyWithAi({ message, context }) {
  try {
    const ai = require('../support/aiProvider');
    if (!ai.assistantInfo().enabled) return null;
    const input = [
      `User report: ${message}`,
      `App version: ${context.appVersion || 'unknown'}`,
      `Platform: ${context.platform || 'unknown'}`,
      `Screen: ${context.screen || 'unknown'}`,
      `Last action: ${context.lastAction || 'unknown'}`,
      `Error code: ${context.errorCode || 'unknown'}`,
    ].join('\n');
    const raw = await ai.askAssistant({
      system: AI_SYSTEM,
      messages: [{ role: 'user', text: input.slice(0, 2600) }],
      maxTokens: 900,
      feature: 'help',
    });
    if (!raw) return null;
    return parseAiResult(raw);
  } catch (error) {
    // AI is an enhancement: the template path below always answers.
    console.warn('Error report AI skipped:', String(error?.message || error).slice(0, 140));
    return null;
  }
}

/* -------------------------------------------------------------- controller */

async function createErrorReport(req, res) {
  const limited = allowRate(req.user._id);
  if (!limited.ok) {
    res.set('Retry-After', String(limited.retryAfterSeconds));
    return res.status(429).json({
      message: 'Too many error reports. Please wait before sending another.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: limited.retryAfterSeconds,
    });
  }

  const validated = validateBody(req.body);
  if (!validated.ok) {
    return res.status(400).json({
      message: validated.code === 'INVALID_CONTEXT'
        ? 'The report context is invalid (unknown field or wrong type).'
        : 'Describe the error in 5–2000 characters.',
      code: validated.code,
    });
  }

  const { message, context } = validated;
  const normalized = reportHash(req.user._id, message, context);

  try {
    // Duplicate reports (same user + same text/context) increment the same row.
    const existing = await AdminInbox.findOne({ normalized, status: { $ne: 'ignored' } }).lean();
    if (existing) {
      await AdminInbox.updateOne({ _id: existing._id }, { $inc: { count: 1 }, $set: { lastSeenAt: new Date() } });
      let storedKind = classifyKind(message);
      try {
        const meta = JSON.parse(existing.transcript || '{}');
        if (meta.kind === 'bug' || meta.kind === 'feature') storedKind = meta.kind;
      } catch {
        /* keep classified kind */
      }
      return res.json({
        id: String(existing._id),
        kind: storedKind,
        prompt: existing.fixPrompt || '',
        summary: existing.summary || summaryFrom(message, storedKind),
      });
    }

    const aiResult = await classifyWithAi({ message, context });
    const kind = aiResult ? aiResult.kind : classifyKind(message);
    const severity = aiResult?.severity || classifySeverity(message);
    const title = aiResult?.title || titleFrom(message, kind);
    const summary = summaryFrom(message, kind);
    const prompt = aiResult
      ? buildAiPrompt({ message, context, ai: aiResult })
      : buildTemplatePrompt({ message, context, kind, title, severity });

    const row = await AdminInbox.create({
      type: 'error_report',
      question: escapeHtml(title).slice(0, 180),
      normalized,
      title: escapeHtml(title).slice(0, 180),
      summary: escapeHtml(summary).slice(0, MAX_SUMMARY),
      userText: escapeHtml(message).slice(0, MAX_MESSAGE),
      source: 'error_report',
      askerId: req.user._id,
      askerName: String(req.user.displayName || '').slice(0, 80),
      fixPrompt: prompt,
      transcript: JSON.stringify({ kind, severity, context }).slice(0, 1200),
      status: 'new',
      count: 1,
      createdAt: new Date(),
      lastSeenAt: new Date(),
    });

    // Report automation (Options B+C): GitHub issue with the ready-to-use prompt
    // and the Telegram notification (with issue link + prompt). Both are
    // optional; failures are logged content-free, stored on the row (githubError)
    // and never fail the user request. Only NEW rows reach this point (duplicates
    // returned above), so a duplicate never creates a second issue.
    try {
      await require('../ai/reportAutomation').automateErrorReport(row, {
        prompt,
        kind,
        context,
        summary,
      });
    } catch (automationError) {
      console.warn('Error report automation skipped:', String(automationError?.message || automationError).slice(0, 140));
    }

    return res.json({ id: String(row._id), kind, prompt, summary });
  } catch (error) {
    console.error('Error report failed:', String(error?.message || error).slice(0, 200));
    return res.status(500).json({ message: 'Could not save the error report. Please try again.' });
  }
}

module.exports = {
  createErrorReport,
  // exported for tests/tooling
  validateBody,
  classifyKind,
  classifySeverity,
  buildTemplatePrompt,
  parseAiResult,
  escapeHtml,
  reportHash,
  MAX_MESSAGE,
};
