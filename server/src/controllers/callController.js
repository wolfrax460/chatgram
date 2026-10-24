/** WebRTC ICE configuration for calls (TURN credentials stay server-side). */
const parseList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

// @desc    ICE servers for WebRTC calls
// @route   GET /api/calls/ice
// @access  Private
const getIceServers = async (req, res) => {
  try {
    const stunUrls = parseList(process.env.STUN_URLS || process.env.STUN_URL || 'stun:stun.l.google.com:19302');
    const turnUrls = parseList(process.env.TURN_URLS || process.env.TURN_URL);
    const username = process.env.TURN_USERNAME || '';
    const credential = process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || '';

    const iceServers = [{ urls: stunUrls }];
    if (turnUrls.length && username && credential) {
      // TURN relays media for users behind strict NATs/firewalls.
      iceServers.push({ urls: turnUrls, username, credential });
    }
    return res.json({
      iceServers,
      hasTurn: iceServers.length > 1,
      // Long-call friendly: the client refreshes nothing; the server controls expiry.
      ttlSeconds: 86_400,
    });
  } catch (error) {
    console.error('ICE config error:', error);
    return res.status(500).json({ message: 'Could not load call configuration' });
  }
};

module.exports = { getIceServers };
