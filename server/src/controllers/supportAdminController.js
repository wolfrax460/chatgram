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

module.exports = { getAdminSettings, updateAdminSettings, getAdminStats, testAi, PROVIDER_PRESETS };