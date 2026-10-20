/**
 * Short-lived tokens that let an anonymous guest listen for replies to one
 * specific support ticket.
 *
 * Deliberately NOT a JWT: no user identity is involved, the token only grants
 * read access to a single ticket room, and it is verified with an HMAC so it
 * cannot be forged or reused for another ticket.
 *
 * Format: <base64url(payload)>.<base64url(hmac)>
 * Payload: { t: ticketId, g: guestId, e: expiryEpochSeconds }
 */
const crypto = require('node:crypto');

const TTL_SECONDS = 30 * 60; // 30 minutes

function secret() {
  // Reuse the app secret; fall back to a dedicated var so this can be rotated
  // independently later without touching user sessions.
  return process.env.GUEST_TOKEN_SECRET || process.env.JWT_SECRET || 'chatgram-dev-secret';
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payloadB64) {
  return b64url(crypto.createHmac('sha256', secret()).update(payloadB64).digest());
}

/**
 * @param {{ ticketId: string, guestId: string }} input
 * @returns {{ token: string, expiresAt: string }}
 */
function issueGuestToken(input) {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = JSON.stringify({ t: input.ticketId, g: input.guestId || '', e: expires });
  const payloadB64 = b64url(payload);
  return {
    token: `${payloadB64}.${sign(payloadB64)}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

/**
 * @param {string} token
 * @returns {{ ok: true, ticketId: string, guestId: string } | { ok: false, reason: string }}
 */
function verifyGuestToken(token) {
  try {
    if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return { ok: false, reason: 'malformed' };

    const expected = sign(payloadB64);
    // Constant-time compare to avoid timing leaks.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad-signature' };
    }

    const payload = JSON.parse(fromB64url(payloadB64));
    if (!payload?.t) return { ok: false, reason: 'bad-payload' };
    if (typeof payload.e !== 'number' || payload.e * 1000 < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, ticketId: String(payload.t), guestId: String(payload.g || '') };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

module.exports = { issueGuestToken, verifyGuestToken, TTL_SECONDS };
