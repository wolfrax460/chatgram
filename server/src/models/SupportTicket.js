// Support tickets raised from the public help widget.
// Additive model: nothing here is referenced by existing chat/auth code.
const mongoose = require('mongoose');

const transcriptEntry = new mongoose.Schema(
  {
    role: { type: String, enum: ['guest', 'assistant'], required: true },
    text: { type: String, required: true, maxlength: 4000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    guestId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    contact: { type: String, required: true, index: true },
    contactType: { type: String, enum: ['email', 'phone'], required: true },
    status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open', index: true },
    summary: { type: String, default: '', maxlength: 2000 },
    transcript: { type: [transcriptEntry], default: [] },
    replies: {
      type: [
        new mongoose.Schema(
          { text: { type: String, required: true }, at: { type: Date, default: Date.now } },
          { _id: false }
        ),
      ],
      default: [],
    },
    meta: {
      userAgent: { type: String, default: '' },
      page: { type: String, default: '' },
      appVersion: { type: String, default: '' },
      ipHash: { type: String, default: '' },
    },
    // Conversation in the Support account's chat list, created on submit.
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', default: null },
  },
  { timestamps: true }
);

// Transcripts are deleted 90 days after creation.
supportTicketSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

supportTicketSchema.statics.newTicketId = function newTicketId() {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let id = '';
  for (let i = 0; i < 5; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `CG-${id}`;
};

module.exports = mongoose.model('SupportTicket', supportTicketSchema);