// "Sign in with Google"
const User = require('../models/User');
const google = require('../utils/googleOAuth');
const {
  generateToken,
  generateRefreshToken,
  userPayload,
  tokenVersionOf,
} = require('./authController');

/**
 * Find the account for a Google profile, or create one.
 *
 * Three cases, in order:
 *   1. this Google account is already linked  -> sign in
 *   2. a local account exists with that email -> link Google to it
 *   3. nothing matches                        -> create a new account
 */
async function findOrCreateGoogleUser(profile) {
  let user = await User.findOne({ googleId: profile.googleId });
  if (user) return { user, created: false, linked: false };

  if (profile.email) {
    user = await User.findOne({ email: profile.email });
    if (user) {
      // Same person, previously registered with a password.
      user.googleId = profile.googleId;
      if (!user.avatarUrl && profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
      await user.save({ validateBeforeSave: false });
      return { user, created: false, linked: true };
    }
  }

  user = await User.create({
    googleId: profile.googleId,
    authProvider: 'google',
    email: profile.email || undefined,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl || '',
    lastSeen: new Date(),
  });
  return { user, created: true, linked: false };
}

// @desc    Is Google sign-in available, and what URL should the app open?
// @route   GET /api/auth/google/url
// @access  Public
const googleAuthUrl = (req, res) => {
  if (!google.isConfigured()) {
    return res.status(503).json({
      message:
        'Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      code: 'GOOGLE_NOT_CONFIGURED',
      enabled: false,
    });
  }

  const state = google.createState();
  return res.json({
    enabled: true,
    state,
    url: google.buildAuthUrl(state),
    redirectUri: google.redirectUri(),
  });
};

// @desc    Google redirects here after the user consents
// @route   GET /api/auth/google/callback
// @access  Public
const googleCallback = async (req, res) => {
  const { code, state, error } = req.query;

  const page = (title, body, ok) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
 body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      background:#0b141a;color:#e9edef;text-align:center;padding:24px}
 .card{max-width:420px}
 .dot{width:64px;height:64px;border-radius:50%;margin:0 auto 20px;display:flex;
      align-items:center;justify-content:center;font-size:32px;
      background:${ok ? '#25d366' : '#f15c6d'}}
 h1{font-size:22px;margin:0 0 10px}
 p{color:#8696a0;line-height:1.5;margin:0}
</style></head>
<body><div class="card">
 <div class="dot">${ok ? '&#10003;' : '!'}</div>
 <h1>${title}</h1><p>${body}</p>
</div></body></html>`;

  if (error) {
    if (state) google.failState(state, String(error));
    return res.status(400).send(
      page('Sign-in cancelled', 'You can close this tab and return to Chatgram.', false)
    );
  }

  const entry = state ? google.getState(state) : null;
  if (!entry) {
    return res.status(400).send(
      page('Link expired', 'This sign-in link is no longer valid. Please try again.', false)
    );
  }

  if (!code) {
    google.failState(state, 'Google did not return an authorization code.');
    return res.status(400).send(
      page('Sign-in failed', 'Google did not return an authorization code.', false)
    );
  }

  try {
    const tokens = await google.exchangeCode(code);
    const profile = await google.fetchProfile(tokens.access_token);

    if (!profile.emailVerified) {
      google.failState(state, 'Your Google email address is not verified.');
      return res.status(400).send(
        page('Email not verified', 'Verify your Google email address and try again.', false)
      );
    }

    const { user, created, linked } = await findOrCreateGoogleUser(profile);

    // Presence is owned by the socket layer, not by an OAuth callback.
    user.lastSeen = new Date();
    await user.save({ validateBeforeSave: false });

    google.completeState(state, {
      accessToken: generateToken(user._id, tokenVersionOf(user)),
      refreshToken: generateRefreshToken(user._id, tokenVersionOf(user)),
      user: userPayload(user, null, null).user,
      created,
      linked,
    });

    return res.send(
      page(
        created ? 'Account created' : 'Signed in',
        'You can close this tab and return to Chatgram — it will finish signing you in automatically.',
        true
      )
    );
  } catch (err) {
    console.error('Google callback error:', err);
    google.failState(state, 'Could not complete sign-in with Google.');
    return res.status(500).send(
      page('Sign-in failed', 'Something went wrong completing sign-in. Please try again.', false)
    );
  }
};

// @desc    Has the browser sign-in finished? Returns our tokens when it has.
// @route   GET /api/auth/google/poll?state=...
// @access  Public
const googlePoll = (req, res) => {
  const { state } = req.query;
  if (!state) {
    return res.status(400).json({ message: 'state is required' });
  }

  const result = google.takeResult(state);

  switch (result.status) {
    case 'ready':
      return res.json({
        status: 'ready',
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
        created: result.created === true,
        linked: result.linked === true,
      });
    case 'error':
      return res.json({ status: 'error', message: result.message || 'Sign-in failed' });
    case 'pending':
      return res.json({ status: 'pending' });
    default:
      return res.json({ status: 'unknown' });
  }
};

module.exports = { googleAuthUrl, googleCallback, googlePoll };
