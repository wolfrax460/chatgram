// Status model (for Stories/Status feature)
const mongoose = require('mongoose');

const statusSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    default: null
  },
  mediaUrl: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '24h' // Automatically delete after 24 hours
  },
  viewedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: false // We'll use createdAt with TTL index instead
});

// Indexes for faster queries.
// NOTE: `createdAt` already carries `expires: '24h'`, which creates the TTL
// index. Re-declaring `{ createdAt: 1 }` here produced a Mongoose duplicate
// index warning on every boot.
statusSchema.index({ userId: 1 });
statusSchema.index({ 'viewedBy': 1 });

// Hide internal fields when converting to JSON
statusSchema.methods.toJSON = function() {
  const status = this.toObject();
  // Remove internal Mongoose properties if needed
  return status;
};

module.exports = mongoose.model('Status', statusSchema);