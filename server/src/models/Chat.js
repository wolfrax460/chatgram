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