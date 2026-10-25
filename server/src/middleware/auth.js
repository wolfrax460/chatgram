// Auth middleware
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { assertAccountActive } = require('../utils/accountStatus');

const JWT_SECRET = () => process.env.JWT_SECRET || 'your-secret-key';

const protect = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  const token = header.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET());
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      message: expired ? 'Token expired' : 'Not authorized, token failed',
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }

  try {
    const user = await User.findById(decoded.userId);
    if (!user) {
      // A valid signature for a deleted user must not leave req.user null,
      // otherwise downstream controllers crash on `req.user._id`.
      return res.status(401).json({ message: 'Not authorized, user no longer exists' });
    }

    // Session generation check: a password change / reset / "log out other
    // devices" bumps user.tokenVersion, which invalidates every older token.
    // Tokens minted before this feature have no `tv` and are version 0.
    const tokenVersion = Number(decoded.tv) || 0;
    const currentVersion = Number(user.tokenVersion) || 0;
    if (tokenVersion !== currentVersion) {
      return res.status(401).json({
        message: 'This session was signed out. Please sign in again.',
        code: 'SESSION_REVOKED',
      });
    }

    // Moderation gate: suspended/banned accounts cannot use the API even with a
    // valid token (a suspension may have started after the token was issued).
    const blocked = await assertAccountActive(user);
    if (blocked) {
      return res.status(403).json({ message: blocked.message, code: blocked.code });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ message: 'Server error during authentication' });
  }
};

module.exports = { protect, tokenVersionOf: (user) => Number(user && user.tokenVersion) || 0 };
