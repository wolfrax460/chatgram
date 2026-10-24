/**
 * 9e alert delivery (behind the admin settings toggle): at most one digest per hour
 * and one instant alert when AI becomes degraded. Silent by default; never includes
 * user identity or secrets — only counts and provider-independent reasons.
 */
const policy = require('./policy');

const HOUR_MS = 60 * 60 * 1000;
const INSTANT_WINDOW_MS = 10 * 60 * 1000;

const state = {
  lastInstantAt: 0,
  lastDigestAt: Date.now(),
  pendingFailures: 0,
};

function shouldSendInstant(degraded, now = Date.now(), lastInstantAt = state.lastInstantAt) {
  return Boolean(degraded) && now - lastInstantAt >= INSTANT_WINDOW_MS;
}

function shouldSendDigest(now = Date.now(), lastDigestAt = state.lastDigestAt, pending = state.pendingFailures) {
  return pending > 0 && now - lastDigestAt >= HOUR_MS;
}

async function onProviderFailure({ degraded, reason } = {}) {
  state.pendingFailures += 1;
  let effective;
  try {
    effective = await policy.getPolicy();
  } catch {
    return { notified: false, alertsDisabled: true };
  }
  if (!effective.alertsEnabled) return { notified: false, alertsDisabled: true };

  // Lazy require so tests can stub the notifier.
  const notifier = require('../support/notifier');
  const now = Date.now();
  const sent = [];
  const safeReason = String(reason || 'all providers failed').slice(0, 180);
  try {
    if (shouldSendInstant(degraded)) {
      await notifier.notifyAlert(
        `Chatgram AI degraded: 5+ provider failures in 10 minutes. Last reason: ${safeReason}. Users get the polite unavailable message; check Model providers and API keys.`,
      );
      state.lastInstantAt = now;
      sent.push('instant');
    }
    if (shouldSendDigest(now)) {
      await notifier.notifyAlert(
        `Chatgram AI digest: ${state.pendingFailures} unanswered/failed AI request(s) since the last digest (last reason: ${safeReason}). Open /web/admin -> Chatgram AI for details.`,
      );
      state.lastDigestAt = now;
      state.pendingFailures = 0;
      sent.push('digest');
    }
  } catch {
    return { notified: false, error: 'notify_failed' };
  }
  return { notified: sent.length > 0, channels: sent };
}

module.exports = { onProviderFailure, shouldSendInstant, shouldSendDigest, state };
