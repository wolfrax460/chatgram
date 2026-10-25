/**
 * 9b Safety & abuse admin API: blocked words/links/email domains, IP bans,
 * rate-limit settings and spam signals (mass messaging, signup bursts).
 * Settings are stored in PlatformSettings (cached); IP bans are edited here and
 * the cache is reset immediately so a ban takes effect on the next request.
 */
const PlatformSettings = require('../models/PlatformSettings');
const Message = require('../models/Message');
const User = require('../models/User');
const platformSettings = require('../utils/platformSettings');
const safety = require('../middleware/safety');
const admin = require('../admin/auth');

function cleanIp(value) {
  return String(value || '')
    .trim()
    .replace(/^::ffff:/i, '');
}

function validIp(value) {
  const ip = cleanIp(value);
  if (!ip || ip.length > 64) return false;
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-f:]+$/i;
  return ipv4.test(ip) || (ip.includes(':') && ipv6.test(ip));
}

/** GET /safety — current settings + spam signals. */
async function state(req, res) {
  try {
    const settings = await platformSettings.get();
    return res.json({
      settings: {
        blockedWords: settings.blockedWords,
        blockedLinkDomains: settings.blockedLinkDomains,
        blockedEmailDomains: settings.blockedEmailDomains,
        messagesPerMinute: settings.messagesPerMinute,
        signupsPerHourPerIp: settings.signupsPerHourPerIp,
        massMessageHourly: settings.massMessageHourly,
        signupThrottleEnabled: settings.signupThrottleEnabled,
        ipBans: settings.ipBans || [],
      },
      signals: await buildSignals(settings),
    });
  } catch (error) {
    console.error('Safety state failed:', error.message);
    return res.status(500).json({ message: 'Could not load the safety settings.' });
  }
}

async function buildSignals(settings) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const threshold = Math.max(10, Number(settings.massMessageHourly) || 200);
  const mass = await Message.aggregate([
    { $match: { sentAt: { $gte: since }, isDeleted: false } },
    { $group: { _id: '$senderId', count: { $sum: 1 } } },
    { $match: { count: { $gte: threshold } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).catch(() => []);
  const names = new Map(
    (await User.find({ _id: { $in: mass.map((row) => row._id) } })
      .select('displayName username email')
      .lean()).map((user) => [String(user._id), user.displayName || user.username || user.email || 'Chatgram user']),
  );
  return {
    massMessaging: mass.map((row) => ({
      userId: String(row._id),
      displayName: names.get(String(row._id)) || 'Chatgram user',
      messagesLastHour: row.count,
      threshold,
    })),
    signupBursts: safety.signupStats().filter((row) => row.count >= Math.max(2, Math.ceil((Number(settings.signupsPerHourPerIp) || 20) * 0.5))),
    blockedEmailDomainsCount: (settings.blockedEmailDomains || []).length,
    bannedIpCount: (settings.ipBans || []).length,
    generatedAt: new Date().toISOString(),
  };
}

/** PUT /safety — save the lists and limits. */
async function save(req, res) {
  try {
    const patch = {};
    for (const key of ['blockedWords', 'blockedLinkDomains', 'blockedEmailDomains', 'messagesPerMinute', 'signupsPerHourPerIp', 'massMessageHourly', 'signupThrottleEnabled']) {
      if (req.body && key in req.body) patch[key] = req.body[key];
    }
    const next = await platformSettings.update(patch, req);
    safety.resetCounters();
    await admin.audit('safety_settings_update', req, Object.keys(patch).join(',').slice(0, 300));
    return res.json({ settings: next, message: 'Safety settings saved.' });
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message || 'Could not save the safety settings.' });
  }
}

/** POST /safety/ip-bans — ban an IP. */
async function addIpBan(req, res) {
  try {
    const ip = cleanIp(req.body?.ip);
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (!validIp(ip)) return res.status(400).json({ message: 'Enter a valid IPv4 or IPv6 address.' });
    if (!reason) return res.status(400).json({ message: 'A reason is required for an IP ban.' });
    const current = await platformSettings.get();
    const bans = (current.ipBans || []).filter((entry) => cleanIp(entry.ip) !== ip);
    if (bans.length >= 500) return res.status(400).json({ message: 'The IP ban list is full (500).' });
    bans.push({ ip, reason, createdAt: new Date() });
    await PlatformSettings.updateOne({ singleton: 'platform' }, { $set: { ipBans: bans } }, { upsert: true });
    platformSettings.resetCache();
    await admin.audit('ip_ban_add', req, `ip=${ip} reason="${reason.slice(0, 120)}"`);
    return res.json({ settings: await platformSettings.get(), message: `${ip} is blocked.` });
  } catch (error) {
    console.error('IP ban failed:', error.message);
    return res.status(500).json({ message: 'Could not add the IP ban.' });
  }
}

/** DELETE /safety/ip-bans/:ip — unban an IP. */
async function removeIpBan(req, res) {
  try {
    const ip = cleanIp(req.params?.ip);
    if (!validIp(ip)) return res.status(400).json({ message: 'Enter a valid IPv4 or IPv6 address.' });
    const current = await platformSettings.get();
    const bans = (current.ipBans || []).filter((entry) => cleanIp(entry.ip) !== ip);
    await PlatformSettings.updateOne({ singleton: 'platform' }, { $set: { ipBans: bans } }, { upsert: true });
    platformSettings.resetCache();
    await admin.audit('ip_ban_remove', req, `ip=${ip}`);
    return res.json({ settings: await platformSettings.get(), message: `${ip} is unblocked.` });
  } catch (error) {
    console.error('IP unban failed:', error.message);
    return res.status(500).json({ message: 'Could not remove the IP ban.' });
  }
}

/** GET /safety/signals — spam signals only (used by the Overview attention panel). */
async function signals(req, res) {
  try {
    const settings = await platformSettings.get();
    return res.json(await buildSignals(settings));
  } catch (error) {
    return res.status(500).json({ message: 'Could not compute spam signals.' });
  }
}

module.exports = { state, save, addIpBan, removeIpBan, signals };
