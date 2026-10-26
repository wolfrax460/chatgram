// Admin Inbox for unanswered/silent AI questions (item 3 + 9e foundation).
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { requireAdminSession, requireAdminCsrf } = require('../middleware/adminAuth');
const admin = require('../admin/auth');
const ai = require('../ai/chatgram');
const aiPolicy = require('../ai/policy');
const insights = require('../controllers/adminAiInsightsController');

router.use(requireAdminSession);

// Combined prompts: 2-25 reports at a time so the result stays usable.
const COMBINE_MIN = 2;
const COMBINE_MAX = 25;

/* --------------------------------------------- feature area + dedupe helpers */

// Ordered: the first matching area wins. More specific areas come first so
// "private AI answers in groups" stays in Chatgram AI instead of Groups.
const FEATURE_AREA_RULES = [
  { area: 'Calls', pattern: /\b(call|calls|ringing|ringtone|screen shar\w*|camera|webcam|microphone|mute|unmute|speaker|dial)\b/i },
  { area: 'Chatgram AI', pattern: /chatgram ai|assistant|smart repl|suggested repl|auto.?repl|\bai\b|persona|prompt|knowledge base/i },
  { area: 'Groups', pattern: /\b(group|groups|member|members|invite|join request|owner|admin role)\b/i },
  { area: 'Accounts & sign-in', pattern: /log ?in|sign ?in|sign ?up|password|google|verification|two.?step|\b2fa\b|\botp\b|account/i },
  { area: 'Notifications', pattern: /\b(notification|notifications|badge|alert|sound)\b/i },
  { area: 'Media & profile', pattern: /\b(avatar|profile|photo|image|picture|voice note|upload|media|cloudinary)\b/i },
  { area: 'Settings & privacy', pattern: /\b(setting|settings|privacy|theme|dark mode|language|block|blocked)\b/i },
  { area: 'Apps & updates', pattern: /\b(android|apk|windows|desktop|electron|installer|install|update|version|capacitor|download)\b/i },
  { area: 'Admin & support', pattern: /\b(admin|dashboard|inbox|telegram|support|report|reports)\b/i },
  { area: 'Messaging', pattern: /\b(message|messages|chat|composer|typing|receipt|unread|disappearing|status)\b/i },
];

function featureArea(record) {
  const haystack = `${record.title || ''} ${record.summary || ''} ${record.userText || ''} ${record.question || ''}`;
  for (const rule of FEATURE_AREA_RULES) {
    if (rule.pattern.test(haystack)) return rule.area;
  }
  return 'General';
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function reportLabel(record) {
  const ref = String(record?.ref || '').trim();
  if (ref) return ref;
  const id = String(record?._id || record?.id || '');
  return id ? `RPT-${id.slice(-4).toUpperCase()}` : 'RPT-UNKNOWN';
}

function recordTitle(record) {
  return String(record.title || record.summary || record.question || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled report';
}

function expectedForType(type) {
  switch (type) {
    case 'feature_request':
      return 'The requested capability works end to end as described, without changing unrelated behaviour.';
    case 'complaint':
      return 'The complaint is addressed and the described failure no longer happens.';
    case 'support_request':
      return 'The user gets a correct, documented answer or workaround and the Chatgram knowledge base is updated.';
    case 'abuse_report':
      return 'The unsafe or abusive behaviour is no longer possible and the report is documented for moderation.';
    case 'unknown_question':
      return 'The question has a confirmed, truthful answer stored in the Chatgram AI knowledge base.';
    case 'bug_report':
    default:
      return 'The reported behaviour no longer occurs and the described flow works as expected.';
  }
}

/**
 * Group records by feature area and merge duplicates (same title, summary or
 * exact user text inside the same area) so the same user text is written once.
 */
function clusterReports(records) {
  const ordered = [...records].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const clusters = [];
  for (const record of ordered) {
    const area = featureArea(record);
    const titleKey = normalizeMatchText(record.title || '').slice(0, 160);
    const summaryKey = normalizeMatchText(record.summary || '').slice(0, 240);
    const textKey = normalizeMatchText(record.userText || record.question || '').slice(0, 400);
    const duplicate = clusters.find((cluster) => {
      if (cluster.area !== area) return false;
      if (titleKey && cluster.titleKeys.has(titleKey)) return true;
      if (summaryKey && cluster.summaryKeys.has(summaryKey)) return true;
      if (textKey && cluster.textKeys.has(textKey)) return true;
      return false;
    });
    if (duplicate) {
      duplicate.records.push(record);
      duplicate.count += Math.max(1, Number(record.count) || 1);
      if (titleKey) duplicate.titleKeys.add(titleKey);
      if (summaryKey) duplicate.summaryKeys.add(summaryKey);
      if (textKey) duplicate.textKeys.add(textKey);
      continue;
    }
    clusters.push({
      area,
      records: [record],
      titleKeys: new Set(titleKey ? [titleKey] : []),
      summaryKeys: new Set(summaryKey ? [summaryKey] : []),
      textKeys: new Set(textKey ? [textKey] : []),
      count: Math.max(1, Number(record.count) || 1),
    });
  }
  return clusters;
}

function blockText(value, max = 3000) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max).trimEnd(), truncated: true };
}

function observedForCluster(cluster) {
  // Longest available text once: user's exact words first, never duplicated.
  const candidates = cluster.records
    .map((record) => String(record.userText || record.question || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const source = candidates[0] || cluster.records.map(recordTitle).join(' / ');
  return blockText(source);
}

function indentBlock(text, prefix = '  ') {
  return String(text || '')
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n');
}

/** Build one coding-assistant prompt in the fix-prompt layout, grouped by area. */
function buildCombinedPrompt(clusters) {
  const reports = clusters.flatMap((cluster) => cluster.records);
  const labels = reports.map(reportLabel);
  // Group clusters into distinct areas for the heading/summary (two clusters can
  // share an area when their titles differ but are not duplicates).
  const areas = [];
  for (const cluster of clusters) {
    const refs = cluster.records.map(reportLabel);
    const existing = areas.find((entry) => entry.area === cluster.area);
    if (existing) existing.refs.push(...refs);
    else areas.push({ area: cluster.area, refs });
  }
  const heading = areas.length === 1 ? areas[0]?.area || 'General' : `${areas.length} feature areas`;
  const lines = [
    `Title: Combined fix prompt · ${heading} · ${labels.length} report${labels.length === 1 ? '' : 's'}`,
    '',
    'Goal: Fix every report below in one focused change, grouped by feature area, without regressing the rest of Chatgram.',
    '',
    `Context: Chatgram is a React web app (apps/web) with an Electron desktop shell, a Capacitor Android wrapper and an Express/MongoDB backend. Each report below was submitted through Chatgram AI or the admin Inbox. Duplicate reports with the same title, summary or user text inside one feature area are merged so the same user text never appears twice.`,
    '',
    `Reports included (${labels.length}): ${areas.map((entry) => `${entry.area}: ${entry.refs.join(', ')}`).join(' · ')}`,
    '',
    'Observed vs expected:',
  ];
  for (const cluster of clusters) {
    const refs = cluster.records.map(reportLabel);
    const mergedNote =
      cluster.records.length > 1
        ? ` (merged duplicates: ${refs.slice(1).join(', ')})`
        : '';
    lines.push('');
    lines.push(`[${refs[0]}] ${recordTitle(cluster.records[0])}${mergedNote}`);
    lines.push(`  - Feature area: ${cluster.area}`);
    lines.push(`  - References: ${refs.join(', ')}${cluster.count > refs.length ? ` · ${cluster.count} occurrences` : ''}`);
    const observed = observedForCluster(cluster);
    lines.push('  - Observed:');
    lines.push(indentBlock(observed.text));
    if (observed.truncated) {
      lines.push(`  - Observed text continues in ${refs.join(', ')} (truncated here to keep the combined prompt readable).`);
    }
    const types = Array.from(new Set(cluster.records.map((record) => record.type || 'bug_report')));
    lines.push(`  - Expected: ${types.map(expectedForType).join(' ')}`);
  }
  lines.push('');
  lines.push('Steps to reproduce:');
  clusters.forEach((cluster, index) => {
    const refs = cluster.records.map(reportLabel);
    lines.push(
      `${index + 1}. [${refs[0]}] Reproduce the flow described under "Observed" for ${refs.join(', ')} (the report text is the reproduction script) and confirm the observed result.`,
    );
  });
  lines.push('');
  lines.push('Acceptance criteria:');
  for (const cluster of clusters) {
    const refs = cluster.records.map(reportLabel);
    lines.push(`- [${refs[0]}] Expected behaviour above is confirmed manually for ${cluster.area}.`);
    lines.push(`- [${refs[0]}] The observed problem for ${refs.join(', ')} no longer occurs and unrelated features still work.`);
  }
  lines.push('- Typecheck (`npm run typecheck`) and production build (`npm run build -w @chatgram/web`) are green for web changes.');
  lines.push('- Existing automated tests for the touched area pass; backend changes pass `node --check` on the edited files.');
  lines.push('');
  lines.push('Constraints:');
  lines.push('- Token budget is limited: no new Playwright suites and no full pre-deploy gate; extend existing tests only.');
  lines.push('- Never print, commit or paste secrets, API keys, tokens or personal data.');
  lines.push('- Deploy per docs/deploy.md: verified DB + source backup for backend changes, backend before web, health gate, temporary smoke accounts deleted afterwards, rollback row recorded.');
  lines.push('- Keep the existing dark admin design system, sentence case and accessible labels; do not change Google sign-in.');
  return lines.join('\n');
}

/* --------------------------------------------- list payload (report fields) */

function normalizeTelegramReply(value) {
  if (!value || typeof value !== 'object') return null;
  const text = String(value.text || '').trim();
  if (!text) return null;
  return {
    text,
    at: value.at || value.receivedAt || value.createdAt || null,
    sentToUser: value.sentToUser === true || value.deliveredToUser === true,
  };
}

/**
 * The legacy listInbox() payload only carries the old fields. Reports written
 * by server/src/ai/reports.js also store title/summary/userText/source/asker/
 * ref/fixPrompt/transcript and (Chunk 1, two-way replies) telegramReply, so
 * enrich the page rows from the model in one extra query.
 */
async function enrichInboxPayload(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  // Current chatgram.js listInbox() already returns every report field (including
  // telegramReply), so the fallback query only runs against an older payload.
  if (
    !items.length ||
    items.every(
      (item) =>
        'ref' in item && 'fixPrompt' in item && 'transcript' in item && 'telegramReply' in item && 'askerId' in item,
    )
  ) {
    return result;
  }
  const ids = items.map((item) => String(item.id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return result;
  const rows = await ai.AdminInbox.find({ _id: { $in: ids } }).lean();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const enriched = items.map((item) => {
    const row = byId.get(String(item.id)) || {};
    return {
      ...item,
      type: item.type || row.type || 'chatgram_unknown',
      status: item.status || row.status || 'new',
      count: Number(item.count) || Number(row.count) || 1,
      title: row.title || '',
      summary: row.summary || '',
      userText: row.userText || '',
      source: row.source || '',
      askerName: row.askerName || '',
      askerId: row.askerId ? String(row.askerId) : null,
      ref: row.ref || '',
      fixPrompt: row.fixPrompt || '',
      transcript: row.transcript || '',
      telegramReply: normalizeTelegramReply(row.telegramReply),
      canAnswerUser: item.canAnswerUser ?? Boolean(row.askerId),
    };
  });
  return { ...result, items: enriched };
}

// AI usage analytics + knowledge base editor (9b, Chatgram AI section).
router.get('/usage', insights.usage);
router.get('/knowledge', insights.knowledgeList);
router.post('/knowledge', requireAdminCsrf, insights.knowledgeSave);
router.put('/knowledge/:id', requireAdminCsrf, insights.knowledgeSave);
router.delete('/knowledge/:id', requireAdminCsrf, insights.knowledgeDelete);

router.get('/health', async (req, res) => {
  return res.json({ ai: ai.aiHealth(), blockedTopicsConfigured: Boolean(process.env.AI_BLOCKED_TOPICS) });
});

// Admin-editable AI policy: blocked topics, per-user caps, max input, alerts.
// (The panel existed before but the HTTP routes were never mounted — found while
// rebuilding the dashboard; see docs/decisions.md D33.)
router.get('/policy', async (req, res) => {
  try {
    return res.json({ policy: await aiPolicy.getPolicy() });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the AI policy.' });
  }
});

router.put('/policy', requireAdminCsrf, async (req, res) => {
  try {
    const policy = await aiPolicy.updatePolicy(req.body || {});
    await admin.audit(
      'ai_policy_update',
      req,
      JSON.stringify({
        hourlyLimit: policy.hourlyLimit,
        dailyLimit: policy.dailyLimit,
        maxInputChars: policy.maxInputChars,
        blockedTopics: policy.blockedTopics.length,
        alertsEnabled: policy.alertsEnabled,
        groupUserHourlyLimit: policy.groupUserHourlyLimit,
        groupChatHourlyLimit: policy.groupChatHourlyLimit,
        groupQueueLimit: policy.groupQueueLimit,
        groupMaxInputChars: policy.groupMaxInputChars,
        groupMaxOutputTokens: policy.groupMaxOutputTokens,
      }).slice(0, 400),
    );
    return res.json({ policy });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Could not save the AI policy.' });
  }
});

// Live badge counters for the dashboard (polled every 15 s by the admin UI).
router.get('/inbox/unread', async (req, res) => {
  try {
    return res.json(await ai.inboxUnreadCount());
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the inbox counters.' });
  }
});

router.get('/inbox', async (req, res) => {
  try {
    const result = await ai.listInbox({
      status: String(req.query.status || 'new'),
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 25,
    });
    return res.json(await enrichInboxPayload(result));
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the inbox.' });
  }
});

// Combine 2-25 selected Inbox reports into one coding-assistant prompt,
// grouped by feature area with duplicates merged. Never executes anything.
router.post('/inbox/combine', requireAdminCsrf, async (req, res) => {
  try {
    const requested = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = Array.from(new Set(requested.map((id) => String(id || '').trim()).filter(Boolean)));
    if (ids.length < COMBINE_MIN) {
      return res.status(400).json({ message: 'Select at least 2 reports to combine into one prompt.', code: 'COMBINE_TOO_FEW' });
    }
    if (ids.length > COMBINE_MAX) {
      return res.status(400).json({ message: `Select at most ${COMBINE_MAX} reports at a time.`, code: 'COMBINE_TOO_MANY' });
    }
    if (!ids.every((id) => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ message: 'One or more selected reports have an invalid id.', code: 'COMBINE_INVALID_ID' });
    }
    const records = await ai.AdminInbox.find({ _id: { $in: ids } }).lean();
    if (records.length !== ids.length) {
      return res.status(400).json({
        message: 'Some of the selected reports no longer exist. Refresh the inbox and try again.',
        code: 'COMBINE_MISSING',
      });
    }
    const clusters = clusterReports(records);
    const prompt = buildCombinedPrompt(clusters);
    await admin.audit(
      'ai_inbox_combine',
      req,
      `${records.length} report${records.length === 1 ? '' : 's'} combined into one prompt (${clusters.length} area${clusters.length === 1 ? '' : 's'})`,
    );
    return res.json({
      prompt,
      records: clusters.flatMap((cluster) =>
        cluster.records.map((record) => ({ id: String(record._id), ref: reportLabel(record), title: recordTitle(record) })),
      ),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not combine the selected reports.' });
  }
});

router.post('/inbox/:id/answer', requireAdminCsrf, async (req, res) => {
  try {
    const result = await ai.answerInboxItem(req.params.id, req.body?.answer);
    if (!result) return res.status(404).json({ message: 'Inbox item not found.' });
    await admin.audit('ai_inbox_answer', req, `${req.params.id} delivered=${result.delivered?.delivered ? 'yes' : result.delivered?.alreadyDelivered ? 'already' : 'no'}`);
    return res.json({
      message: result.delivered?.alreadyDelivered
        ? 'This answer was already delivered (idempotent, no duplicate was sent).'
        : 'Answer saved, added to the knowledge base and sent from the Chatgram Support account.',
      item: { id: req.params.id, status: 'answered' },
      delivered: result.delivered || null,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message || 'Could not save the answer.', code: error.code || 'ANSWER_INVALID' });
  }
});

router.post('/inbox/:id/merge', requireAdminCsrf, async (req, res) => {
  try {
    const result = await ai.mergeInboxDuplicates(req.params.id);
    if (!result) return res.status(404).json({ message: 'Inbox item not found.' });
    await admin.audit('ai_inbox_merge', req, `${req.params.id} merged=${result.duplicates} count+=${result.mergedCount}`);
    return res.json({
      message: result.duplicates
        ? `Merged ${result.duplicates} duplicate record${result.duplicates === 1 ? '' : 's'} (${result.mergedCount} occurrences).`
        : 'No duplicates to merge.',
      mergedCount: result.mergedCount,
      totalCount: result.item.count,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Could not merge the duplicates.' });
  }
});

router.post('/inbox/:id/ignore', requireAdminCsrf, async (req, res) => {
  try {
    const item = await ai.ignoreInboxItem(req.params.id);
    if (!item) return res.status(404).json({ message: 'Inbox item not found.' });
    await admin.audit('ai_inbox_ignore', req, req.params.id);
    return res.json({ message: 'Inbox item ignored.' });
  } catch (error) {
    return res.status(400).json({ message: 'Could not update the item.' });
  }
});

module.exports = router;
