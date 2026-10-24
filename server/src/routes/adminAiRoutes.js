// Admin Inbox for unanswered/silent AI questions (item 3 + 9e foundation).
const express = require('express');
const router = express.Router();
const { requireAdminSession, requireAdminCsrf } = require('../middleware/adminAuth');
const admin = require('../admin/auth');
const ai = require('../ai/chatgram');
const aiPolicy = require('../ai/policy');

router.use(requireAdminSession);

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
      }).slice(0, 300),
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
    await admin.audit('ai_inbox_answer', req, req.params.id);
    return res.json({ message: 'Answer saved and added to the knowledge base.', item: { id: req.params.id, status: 'answered' } });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Could not save the answer.' });
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
