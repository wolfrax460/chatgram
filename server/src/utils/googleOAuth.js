/**
 * Google Sign-In using the OAuth 2.0 authorization-code flow.
 *
 * Why this flow rather than the native SDKs: the client only has to open a URL
 * in the system browser and poll for the result. That is the *same* code on
 * web, Android and Windows — no per-platform plugin, and no `google-services.json`
 * or SHA-1 fingerprint to configure.
 *
 *   app  →  GET /api/auth/google/url?state=XYZ        (gets the consent URL)
 *   app  →  opens the browser
 *   user →  signs in with Google
 *   Google → GET /api/auth/google/callback?code=...&state=XYZ
 *   server → exchanges the code, finds/creates the user, stashes our JWT
 *   app  →  GET /api/auth/google/poll?state=XYZ       (collects the JWT)
 *
 * No extra dependency is needed: the token exchange and the userinfo lookup are
 * plain HTTPS calls.
 *
 * Configuration (server/.env):
 *   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
 *   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
 *   GOOGLE_REDIRECT_URI=http://localhost:5001/api/auth/google/callback
 */
const crypto = require('crypto');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

const SCOPES = ['openid', 'email', 'profile'];

/** Pending sign-ins, keyed by the OAuth `state`. In-memory by design: a
 *  handshake lasts seconds. Move to Redis if you run several API instances. */
const pending = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';

/** Is Google sign-in usable on this server? */
function isConfigured() {
  return Boolean(clientId() && clientSecret());
}

function redirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 5001}/api/auth/google/callback`
  );
}

function purgeExpired() {
  const now = Date.now();
  for (const [state, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(state);
  }
}

/** Create a signed-in-flight record and return its `state` value. */
function createState() {
  purgeExpired();
  const state = crypto.randomBytes(24).toString('hex');
  pending.set(state, { status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + PENDING_TTL_MS });
  return state;
}

function getState(state) {
  purgeExpired();
  return pending.get(state) || null;
}

function completeState(state, payload) {
  const entry = pending.get(state);
  if (!entry) return false;
  // Keep the result briefly so the app can collect it, then it is consumed.
  pending.set(state, { ...entry, status: 'ready', ...payload, expiresAt: Date.now() + 60_000 });
  return true;
}

function failState(state, message) {
  const entry = pending.get(state);
  if (!entry) return false;
  pending.set(state, { ...entry, status: 'error', message, expiresAt: Date.now() + 60_000 });
  return true;
}

/** Consume a completed sign-in exactly once. */
function takeResult(state) {
  const entry = getState(state);
  if (!entry) return { status: 'unknown' };
  if (entry.status !== 'ready') return entry;
  pending.delete(state);
  return entry;
}

/** The URL the app should open in the browser. */
function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    access_type: 'online',
    // Always let the user choose which account to use.
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange the one-time `code` for Google tokens. */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${detail}`);
  }
  return res.json();
}

/** Fetch the signed-in user's profile from Google. */
async function fetchProfile(accessToken) {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google userinfo failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  return {
    googleId: data.sub,
    email: (data.email || '').toLowerCase(),
    emailVerified: data.email_verified === true,
    displayName: data.name || (data.email || '').split('@')[0],
    avatarUrl: data.picture || '',
  };
}

module.exports = {
  isConfigured,
  redirectUri,
  createState,
  getState,
  completeState,
  failState,
  takeResult,
  buildAuthUrl,
  exchangeCode,
  fetchProfile,
};
