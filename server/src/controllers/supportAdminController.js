// Admin dashboard API for the Chatgram Support account.
// Every route here is mounted behind `protect` and a support-account check.
const SupportSettings = require('../models/SupportSettings');
const settings = require('../support/settings');
const SupportTicket = require('../models/SupportTicket');
const ai = require('../support/aiProvider');
const notifier = require('../support/notifier');

const PROVIDER_PRESETS = [
  { id: 'groq', label: 'Groq', provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' },
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'nvidia', label: 'NVIDIA NIM', provider: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-70b-instruct' },
  { id: 'ollama', label: 'Ollama Cloud', provider: 'openai-compatible', baseUrl: 'https://ollama.com/v1', model: 'llama3.1' },
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  { id: 'gemini', label: 'Google Gemini', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
];

// @desc    Current settings + live status
// @route   GET /api/support/admin/settings
// @access  Private (support account)
const getAdminSettings = async (req, res) => {
  try {
    const doc = await settings.raw();
    return res.json({
      settings: settings.publicView(doc),
      status: {
        ai: ai.assistantInfo(),
        channels: notifier.channelStatus(),
      },
      presets: PROVIDER_PRESETS,
    });
  } catch (error) {
    console.error('Admin settings read error:', error.message);
    return res.status(500).json({ message: 'Could not load settings.' });
  }
};

// @desc    Update settings (applies immediately, persists in Mongo)
// @route   PUT /api/support/admin/settings
// @access  Private (support account)
const updateAdminSettings = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const allowed = [
      'aiEnabled', 'aiProvider', 'aiBaseUrl', 'aiModel', 'aiApiKey', 'aiMaxTokens',
      'agentEnabled', 'agentShowTicketRef',
      'telegramEnabled', 'telegramChatId', 'emailEnabled', 'notifyEmail',
      'welcomeMessage', 'escalationMessage',
    ];
    const patch = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        patch[key] = typeof body[key] === 'string' ? body[key].slice(0, 400) : body[key];
      }
    }
    const doc = await settings.save(patch, req.user?.email || 'admin');
    return res.json({
      settings: settings.publicView(doc),
      status: { ai: ai.assistantInfo(), channels: notifier.channelStatus() },
      message: 'Settings saved and applied.',
    });
  } catch (error) {
    console.error('Admin settings update error:', error.message);
    return res.status(500).json({ message: 'Could not save settings.' });
  }
};

// @desc    Dashboard counters
// @route   GET /api/support/admin/stats
// @access  Private (support account)
const getAdminStats = async (req, res) => {
  try {
    const [open, answered, closed, total] = await Promise.all([
      SupportTicket.countDocuments({ status: 'open' }),
      SupportTicket.countDocuments({ status: 'answered' }),
      SupportTicket.countDocuments({ status: 'closed' }),
      SupportTicket.countDocuments({}),
    ]);
    const recent = await SupportTicket.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('ticketId status contact summary createdAt');
    return res.json({
      counts: { open, answered, closed, total },
      recent: recent.map((t) => ({
        ticketId: t.ticketId,
        status: t.status,
        contact: t.contact,
        summary: String(t.summary || '').slice(0, 120),
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('Admin stats error:', error.message);
    return res.status(500).json({ message: 'Could not load stats.' });
  }
};

// @desc    Ping the configured AI so the dashboard can prove it works
// @route   POST /api/support/admin/test-ai
// @access  Private (support account)
const testAi = async (req, res) => {
  try {
    const answer = await ai.askAssistant({
      system: 'Reply with exactly: OK',
      messages: [{ role: 'user', text: 'ping' }],
      maxTokens: 20,
    });
    return res.json({
      ok: Boolean(answer),
      answer: answer || '',
      info: ai.assistantInfo(),
    });
  } catch (error) {
    return res.json({ ok: false, error: error.message });
  }
};


/* -------------------------------------------------------- knowledge base */

const kbStore = require('../support/kbStore');

// @desc    Read the knowledge base
// @route   GET /api/support/admin/kb
const getKb = async (req, res) => {
  try {
    const entries = await kbStore.load();
    return res.json({ entries, fallback: kbStore.fallbackText(), systemPrompt: kbStore.systemPrompt() });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the knowledge base.' });
  }
};

// @desc    Replace the knowledge base
// @route   PUT /api/support/admin/kb
const updateKb = async (req, res) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    if (!entries) return res.status(400).json({ message: 'entries[] is required' });
    if (entries.length > 80) return res.status(400).json({ message: 'Too many entries (max 80).' });
    for (const e of entries) {
      if (!String(e.title || '').trim() || !String(e.answer || '').trim()) {
        return res.status(400).json({ message: 'Every entry needs a title and an answer.' });
      }
    }
    const saved = await kbStore.save(entries, req.user?.email || 'admin');
    return res.json({ entries: saved, message: `Knowledge base saved (${saved.length} entries).` });
  } catch (error) {
    console.error('KB update error:', error.message);
    return res.status(500).json({ message: 'Could not save the knowledge base.' });
  }
};

// @desc    Restore the bundled knowledge base
// @route   POST /api/support/admin/kb/reset
const resetKb = async (req, res) => {
  try {
    const entries = await kbStore.resetToSeed(req.user?.email || 'admin');
    return res.json({ entries, message: 'Restored the bundled knowledge base.' });
  } catch (error) {
    return res.status(500).json({ message: 'Could not reset the knowledge base.' });
  }
};

/* ----------------------------------------------------------- ticket inbox */

// @desc    Ticket list with optional status filter
// @route   GET /api/support/admin/tickets?status=open&q=text
const listTickets = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status && ['open', 'answered', 'closed'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ ticketId: rx }, { contact: rx }, { summary: rx }];
    }
    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .select('ticketId status contact contactType summary createdAt replies chatId');
    return res.json({
      tickets: tickets.map((t) => ({
        ticketId: t.ticketId,
        status: t.status,
        contact: t.contact,
        contactType: t.contactType,
        summary: String(t.summary || '').slice(0, 200),
        createdAt: t.createdAt,
        replyCount: t.replies?.length ?? 0,
        lastReply: t.replies?.length ? t.replies[t.replies.length - 1].text : '',
        hasChat: Boolean(t.chatId),
      })),
    });
  } catch (error) {
    console.error('Ticket list error:', error.message);
    return res.status(500).json({ message: 'Could not load tickets.' });
  }
};

// @desc    One ticket with its transcript and replies
// @route   GET /api/support/admin/tickets/:ticketId
const getTicketDetail = async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({ ticketId: req.params.ticketId.toUpperCase() });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    return res.json({
      ticket: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        contact: ticket.contact,
        contactType: ticket.contactType,
        summary: ticket.summary,
        createdAt: ticket.createdAt,
        hasChat: Boolean(ticket.chatId),
        transcript: (ticket.transcript || []).map((x) => ({ role: x.role, text: x.text, at: x.at })),
        replies: (ticket.replies || []).map((r) => ({ text: r.text, at: r.at })),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the ticket.' });
  }
};

// @desc    Reply to a ticket from the dashboard
// @route   POST /api/support/admin/tickets/:ticketId/reply
const replyToTicketAdmin = async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ message: 'A reply is required.' });

    const ticket = await SupportTicket.findOne({ ticketId: req.params.ticketId.toUpperCase() });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    if (!ticket.chatId) {
      return res.status(400).json({ message: 'This ticket has no conversation attached (contact only).' });
    }

    const Message = require('../models/Message');
    const User = require('../models/User');
    const supportUser = await User.findOne({ isSupportAccount: true }).select('_id');
    if (!supportUser) return res.status(500).json({ message: 'No support account found.' });

    const created = await Message.create({
      chatId: ticket.chatId,
      senderId: supportUser._id,
      type: 'text',
      content: text.slice(0, 4000),
      sentAt: new Date(),
      deliveredTo: [],
      readBy: [],
    });

    const populated = await Message.findById(created._id).populate('senderId', '_id displayName avatarUrl');
    const realtime = require('../utils/realtime');
    realtime.getIo()?.to(realtime.roomForChat(ticket.chatId)).emit('message:new', populated);

    // Mirrors to the ticket, pushes to the guest socket and emails the user.
    await require('../support/replyHook').propagateSupportReply(created, realtime.getIo());

    return res.json({ message: 'Reply sent.', ticketId: ticket.ticketId });
  } catch (error) {
    console.error('Admin ticket reply error:', error.message);
    return res.status(500).json({ message: 'Could not send the reply.' });
  }
};

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  getAdminStats,
  testAi,
  getKb,
  updateKb,
  resetKb,
  listTickets,
  getTicketDetail,
  replyToTicketAdmin,
  PROVIDER_PRESETS,
  getAiLayerSettings,
  updateAiLayerSettings,
  testAiLayer,
};

/* ------------------------------------------------- provider-agnostic AI layer */

/** GET /api/support/admin/ai — provider, model, masked key, fallbacks, env names. */
async function getAiLayerSettings(req, res) {
  try {
    const masked = await require('../ai/settings').maskedSettings();
    const { diagnostics } = require('../ai/service');
    return res.json({ ...masked, diagnostics: diagnostics() });
  } catch (error) {
    console.error('Get AI layer settings error:', error);
    return res.status(500).json({ message: 'Could not load the AI settings.' });
  }
}

/** PUT /api/support/admin/ai — save provider/model/base URL/key/limits/fallbacks. */
async function updateAiLayerSettings(req, res) {
  try {
    const updated = await require('../ai/settings').updateSettings(req.body || {});
    return res.json({ message: 'AI settings saved.', settings: updated });
  } catch (error) {
    if (error && error.code) {
      return res.status(400).json({ message: error.message, code: error.code });
    }
    console.error('Update AI layer settings error:', error);
    return res.status(500).json({ message: 'Could not save the AI settings.' });
  }
}

/** POST /api/support/admin/ai/test — tiny prompt; reports success, latency, error. */
async function testAiLayer(req, res) {
  try {
    const body = req.body || {};
    // An endpoint typed into this form must pass the same SSRF check as a saved one.
    if (body.baseUrl) {
      const checked = await require('../ai/ssrf').validateBaseUrl(body.baseUrl);
      if (!checked.ok) return res.status(400).json({ ok: false, code: 'invalid_base_url', message: checked.message });
    }
    const result = await require('../ai/service').testConnection(body);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    console.error('Test AI layer error:', error);
    return res.status(500).json({ ok: false, message: 'Could not test the provider.' });
  }
}