// Admin Inbox for unanswered/silent AI questions (item 3 + 9e foundation).
const express = require('express');
const router = express.Router();
const { requireAdminSession, requireAdminCsrf } = require('../middleware/adminAuth');
const admin = require('../admin/auth');
const ai = require('../ai/chatgram');
const aiPolicy = require('../ai/policy');
const insights = require('../controllers/adminAiInsightsController');

router.use(requireAdminSession);

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
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the inbox.' });
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
