/**
 * Live-editable support settings.
 *
 * One document holds everything the admin dashboard can change, so the code no
 * longer has to be edited and redeployed for model changes, channel toggles or
 * agent behaviour. Environment variables remain the fallback: a field left
 * blank in the database defers to the matching env var.
 */
const mongoose = require('mongoose');

const supportSettingsSchema = new mongoose.Schema(
  {
    // Singleton key so there is exactly one row.
    key: { type: String, default: 'global', unique: true },

    // AI
    aiEnabled: { type: Boolean, default: null },
    aiProvider: { type: String, default: null }, // anthropic|openai|gemini|openai-compatible|none
    aiBaseUrl: { type: String, default: null },
    aiModel: { type: String, default: null },
    aiApiKey: { type: String, default: null }, // write-only; never returned
    aiMaxTokens: { type: Number, default: null },

    // Agent behaviour
    agentEnabled: { type: Boolean, default: null },
    agentShowTicketRef: { type: Boolean, default: null },

    // Channels
    telegramEnabled: { type: Boolean, default: null },
    telegramChatId: { type: String, default: null },
    emailEnabled: { type: Boolean, default: null },
    notifyEmail: { type: String, default: null },

    // Copy shown in the widget
    welcomeMessage: { type: String, default: null },
    escalationMessage: { type: String, default: null },

    // Editable knowledge base. Empty array = fall back to knowledge-base.json.
    kb: {
      type: [
        new mongoose.Schema(
          {
            id: { type: String, required: true },
            title: { type: String, required: true },
            keywords: { type: [String], default: [] },
            answer: { type: String, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    updatedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupportSettings', supportSettingsSchema);
