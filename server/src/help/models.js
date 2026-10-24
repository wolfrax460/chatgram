/**
 * Help-centre models: collections, articles and the in-widget conversations.
 *
 * These are additive to the existing SupportTicket / SupportSettings / KB
 * machinery — the ticket flow and the admin dashboard keep working unchanged.
 */
const mongoose = require('mongoose');

const RETENTION_SECONDS = 90 * 24 * 60 * 60; // 90 days

const helpCollectionSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', maxlength: 400 },
    icon: { type: String, default: 'book' },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const helpArticleSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true },
    collectionSlug: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, default: '', maxlength: 400 },
    // Plain text with simple markdown-ish paragraphs; rendered as text by the
    // client (no HTML is ever injected).
    body: { type: String, required: true, maxlength: 12000 },
    keywords: { type: [String], default: [] },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

helpArticleSchema.index({ title: 'text', summary: 'text', body: 'text', keywords: 'text' });

const helpConversationSchema = new mongoose.Schema(
  {
    // Exactly one of userId / guestId is set, mirroring the auth state.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    guestId: { type: String, default: null, index: true },
    displayName: { type: String, default: 'Guest' },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open',
      index: true,
    },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ticketId: { type: String, default: null, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    unreadForUser: { type: Number, default: 0 },
    unreadForAgent: { type: Number, default: 0 },
    // Retention: conversations are removed after 90 days (messages too).
    createdAt: { type: Date, default: Date.now, expires: RETENTION_SECONDS },
  },
  { timestamps: false },
);

const helpMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HelpConversation',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant', 'agent', 'system'],
      required: true,
    },
    text: { type: String, default: '', maxlength: 4000 },
    authorName: { type: String, default: null },
    // Article cited by the assistant (the widget renders an in-widget link).
    articleSlug: { type: String, default: null },
    attachments: [
      {
        url: { type: String, required: true },
        type: { type: String, enum: ['image', 'file', 'audio', 'video'], default: 'file' },
        name: { type: String, default: '' },
        size: { type: Number, default: 0 },
      },
    ],
    feedback: { type: String, enum: ['up', 'down', null], default: null },
    createdAt: { type: Date, default: Date.now, expires: RETENTION_SECONDS },
  },
  { timestamps: false },
);

helpMessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = {
  HelpCollection: mongoose.model('HelpCollection', helpCollectionSchema),
  HelpArticle: mongoose.model('HelpArticle', helpArticleSchema),
  HelpConversation: mongoose.model('HelpConversation', helpConversationSchema),
  HelpMessage: mongoose.model('HelpMessage', helpMessageSchema),
  RETENTION_SECONDS,
};
