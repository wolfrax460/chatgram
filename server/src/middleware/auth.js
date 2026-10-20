// Auth middleware
const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
    req.user = user;
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ message: 'Server error during authentication' });
  }
};

module.exports = { protect };
