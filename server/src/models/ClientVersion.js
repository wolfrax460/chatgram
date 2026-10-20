// Tracks which app versions are actually in use.
//
// Each install reports itself once per launch with a stable device id, so the
// server can answer "who is still on 1.0.0?" and tell clients when a newer
// release exists — no rebuild required to change the answer.
const mongoose = require('mongoose');

const clientVersionSchema = new mongoose.Schema({
  platform: { type: String, required: true }, // android | windows | web | ios | linux | macos
  version: { type: String, required: true },
  deviceId: { type: String, required: true },
  // Set when the client is signed in, so you can see which accounts lag behind.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
});

// One row per (platform, version, device).
clientVersionSchema.index({ platform: 1, version: 1, deviceId: 1 }, { unique: true });

// Rows are refreshed by heartbeats; stale devices fall out of the numbers
// automatically after 60 days so the collection stays small.
clientVersionSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

module.exports = mongoose.model('ClientVersion', clientVersionSchema);
