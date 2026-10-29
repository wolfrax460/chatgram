// Owner Telegram webhook for report automation commands (Option B).
const express = require('express');
const router = express.Router();
const commands = require('../support/telegramCommands');

// POST /api/telegram/webhook — Telegram sends the secret in a header.
// Missing/wrong secret is rejected with 401; a foreign chat id is ignored with 200.
// The per-chat command rate limit (10/min) lives in telegramCommands.handleUpdate.
router.post('/webhook', async (req, res) => {
  const provided = req.get('x-telegram-bot-api-secret-token');
  if (!commands.validSecret(provided)) {
    return res.status(401).json({ ok: false });
  }
  try {
    const result = await commands.handleUpdate(req.body || {});
    return res.json({ ok: true, ...(result.ignored ? { ignored: true } : {}) });
  } catch (error) {
    console.warn('[telegram] webhook failed:', String(error?.message || error).slice(0, 120));
    return res.json({ ok: true });
  }
});

module.exports = router;
