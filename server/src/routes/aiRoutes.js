// Chatgram AI user API (item 3 MVP). Requires a signed-in user.
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ai = require('../ai/chatgram');

// Admin feature flag: Chatgram AI can be disabled platform-wide.
router.use(require('../utils/platformSettings').featureGate('aiEnabled', 'AI_DISABLED', 'Chatgram AI is temporarily disabled.'));

router.use(protect);

function fail(res, error) {
  const status = error.code === 'RATE_LIMITED' ? 429 : error.code === 'TOO_LONG' || error.code === 'EMPTY' ? 400 : 500;
  if (status === 500) console.error('Chatgram AI error:', error.message);
  return res.status(status).json({ message: status === 500 ? 'Chatgram AI is unavailable right now.' : error.message, code: error.code || 'AI_ERROR' });
}

router.get('/conversations', async (req, res) => {
  try {
    const conversations = await ai.listConversations(req.user._id);
    return res.json({ conversations });
  } catch (error) {
    return fail(res, error);
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await ai.getMessages(req.user._id, req.params.id);
    if (!messages) return res.status(404).json({ message: 'Conversation not found.' });
    return res.json({ messages });
  } catch (error) {
    return fail(res, error);
  }
});

router.delete('/conversations/:id', async (req, res) => {
  try {
    const deleted = await ai.deleteConversation(req.user._id, req.params.id);
    return deleted ? res.json({ message: 'Conversation deleted.' }) : res.status(404).json({ message: 'Conversation not found.' });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/messages/:id/feedback', async (req, res) => {
  try {
    const result = await ai.recordMessageFeedback(req.user._id, req.params.id, String(req.body?.value || ''));
    if (!result) return res.status(404).json({ message: 'Message not found.' });
    return res.json({ message: result.recorded ? 'Thanks — this has been noted for the team.' : 'Thanks for the feedback.' });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/messages', async (req, res) => {
  try {
    const result = await ai.sendMessage({
      userId: req.user._id,
      conversationId: req.body?.conversationId,
      text: req.body?.text ?? req.body?.message,
    });
    return res.json({
      message: 'Reply ready.',
      conversationId: result.conversationId,
      reply: result.reply,
      providerKey: result.providerKey,
      unknown: result.unknown === true,
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/messages/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  try {
    const result = await ai.streamMessage({
      userId: req.user._id,
      conversationId: req.body?.conversationId,
      text: req.body?.text ?? req.body?.message,
      onDelta: async (delta) => send({ delta }),
    });
    send({ done: true, conversationId: result.conversationId, reply: result.reply, providerKey: result.providerKey, unknown: result.unknown === true, messageId: result.messageId });
  } catch (error) {
    send({ error: error.message || 'Chatgram AI failed.', code: error.code || 'AI_ERROR' });
  } finally {
    res.end();
  }
});

module.exports = router;
