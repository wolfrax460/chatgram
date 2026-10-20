// User model
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phone: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true
  },
  // Set when the account is linked to Google. `sparse` keeps normal
  // email/password accounts working (they simply have no value here).
  googleId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  // 'admin' is reserved for the built-in support account that receives user
  // feedback and bug reports. Normal accounts are always 'user'.
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  // Marks the single account users are routed to for help & feedback.
  // TOTP two-factor auth. The secret is AES-256-GCM encrypted at rest and
  // hidden from normal queries.
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },
  // Hashed single-use backup codes for 2FA lockout recovery.
  recoveryCodes: { type: [String], select: false, default: [] },

  isSupportAccount: {
    type: Boolean,
    default: false
  },
  // Google accounts have no local password until the user sets one.
  password: {
    type: String,
    required: function () {
      return this.authProvider !== 'google';
    },
    // Never returned by default; login explicitly selects it back with
    // `.select('+password')`.
    select: false
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  avatarUrl: {
    type: String,
    default: ''
  },
  about: {
    type: String,
    default: ''
  },
  // This user's own address book. Deliberately per-user: you only see people
  // you added, not every account in the application.
  contacts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Privacy: whether other people may see "online" and "last seen" at all.
  showOnlineStatus: {
    type: Boolean,
    default: true
  },
  // ...and people who must never see it, even when the switch above is on.
  onlineStatusExceptions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isOnline: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for faster queries.
// NOTE: `phone` and `email` already declare `unique: true`, which creates
// their indexes. Re-declaring them here produced Mongoose "Duplicate schema
// index" warnings on every boot.
userSchema.index({ isOnline: 1, lastSeen: -1 });

// Keep the public JSON shape stable for the Flutter client: it reads `id`
// from the auth payload but `_id` from every other endpoint.
userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

// Hash password before saving. Google-only accounts have no password, so the
// hook must not choke on one.
userSchema.pre('save', async function() {
  if (!this.password || !this.isModified('password')) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  // A Google-only account cannot be signed into with a password.
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);