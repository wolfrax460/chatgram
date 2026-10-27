/**
 * Lazy Firebase Admin singleton (FCM / push notifications).
 *
 * Deliberately lazy and failure-tolerant: the API must boot and keep working
 * when Firebase is not configured (local dev, CI, or a VM that lost the key).
 * The first sender call initialises the SDK once; if the service-account path is
 * missing, unreadable or invalid, we log one clear line and report "disabled"
 * so callers skip pushes instead of throwing into message/call paths.
 *
 * The service-account JSON is never logged and never returned: only the file
 * path comes from `FIREBASE_SERVICE_ACCOUNT`, and errors are reduced to a code.
 */
const fs = require('node:fs');

let state = { attempted: false, messaging: null, reason: null };

function disable(reason) {
  state.messaging = null;
  state.reason = String(reason || 'unknown reason').slice(0, 200);
  console.warn(`[push] Firebase disabled: ${state.reason}. Push notifications will be skipped.`);
  return null;
}

/**
 * @returns {import('firebase-admin/messaging').Messaging | null} the messaging
 *   client, or null when push is not configured/available.
 */
function getMessaging() {
  if (state.attempted) return state.messaging;
  state.attempted = true;

  const accountPath = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!accountPath) return disable('FIREBASE_SERVICE_ACCOUNT is not set');

  let admin;
  let getFcmMessaging;
  try {
    // Required lazily so the dependency (and its install state) can never stop
    // the API from booting.
    admin = require('firebase-admin');
    ({ getMessaging: getFcmMessaging } = require('firebase-admin/messaging'));
  } catch (error) {
    return disable(`firebase-admin is unavailable (${error.code || 'module error'})`);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
  } catch (error) {
    return disable(`the service-account file could not be read (${error.code || 'read error'})`);
  }

  try {
    const app = admin.getApps().length > 0
      ? admin.getApp()
      : admin.initializeApp({ credential: admin.cert(serviceAccount) });
    state.messaging = getFcmMessaging(app);
    state.reason = null;
    console.log('[push] Firebase Admin initialised (FCM ready)');
    return state.messaging;
  } catch (error) {
    return disable(`Firebase initialisation failed (${error.code || 'init error'})`);
  }
}

function isPushEnabled() {
  return Boolean(getMessaging());
}

/** Safe status for logs/admin output — never includes key material. */
function pushStatus() {
  const messaging = getMessaging();
  return { enabled: Boolean(messaging), reason: state.reason };
}

/** Test seam: forget the singleton so a test can re-evaluate the env. */
function resetForTests() {
  state = { attempted: false, messaging: null, reason: null };
}

module.exports = { getMessaging, isPushEnabled, pushStatus, resetForTests };
