// Chat model
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['direct', 'group'],
    required: true
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  groupName: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return this.type === 'direct' ? !v : v && v.length > 0;
      },
      message: 'Group name is required for group chats'
    }
  },
  groupAvatar: {
    type: String,
    default: ''
  },
  // Read-only group (9b moderation): when true, nobody can post until an admin
  // unfreezes it. Enforced in the REST + socket message paths.
  groupFrozen: {
    type: Boolean,
    default: false
  },
  // Group description shown in the info panel (additive).
  groupDescription: {
    type: String,
    default: '',
    maxlength: 1024
  },
  // Who created the group, shown as "Created by X".
  groupCreatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Admin-configurable permissions. Defaults preserve the behaviour that
  // existed before these switches: anyone can edit info, anyone can post,
  // but only admins can add members.
  groupSettings: {
    whoCanEditInfo: { type: String, enum: ['all', 'admins'], default: 'all' },
    whoCanSendMessages: { type: String, enum: ['all', 'admins'], default: 'all' },
    whoCanAddMembers: { type: String, enum: ['all', 'admins'], default: 'admins' },
    // When true, join requests (and invite links) need an admin's approval.
    requireApproval: { type: Boolean, default: false },
    // Off by default: when enabled an admin lets members ask the AI by writing
    // "@Chatgram AI ..." in the group. Only those messages reach the provider.
    aiMentions: { type: Boolean, default: false }
  },
  // Pending join requests; approved by an admin, then the user becomes a member.
  joinRequests: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedAt: { type: Date, default: Date.now },
    note: { type: String, default: '' }
  }],
  // Invite link (admin-managed). Disabled by default: an admin must create it.
  inviteToken: { type: String, default: null, index: true },
  inviteEnabled: { type: Boolean, default: false },
  // One pinned message per group (additive).
  pinnedMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  groupAdmins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }
}, {
  timestamps: true
});

// Indexes for faster queries
chatSchema.index({ participants: 1 });
chatSchema.index({ type: 1 });
chatSchema.index({ 'groupAdmins': 1 });
chatSchema.index({ updatedAt: -1 });

// Validate participant counts.
// (Mongoose 8+: synchronous hooks, no next() callback)
//
// A group may legitimately shrink to a single member (everyone else left, or
// an admin was removed); requiring >= 2 here previously made `removeParticipant`
// throw a ValidationError -> HTTP 500. Direct chats stay at exactly 2.
chatSchema.pre('validate', function() {
  if (this.type === 'direct' && this.participants.length !== 2) {
    this.invalidate('participants', 'Direct chats must have exactly 2 participants');
  }
  if (this.type === 'group' && this.participants.length < 1) {
    this.invalidate('participants', 'Group chats must have at least 1 participant');
  }
});

// Hide internal fields when converting to JSON
chatSchema.methods.toJSON = function() {
  const chat = this.toObject();
  // Remove internal Mongoose properties if needed
  return chat;
};

module.exports = mongoose.model('Chat', chatSchema);