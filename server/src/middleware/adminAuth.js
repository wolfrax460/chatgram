/** Admin gate middleware: session cookie + CSRF. */
const crypto = require('crypto');
const admin = require('../admin/auth');

async function requireAdminSession(req, res, next) {
  if (!admin.configured()) {
    return res.status(503).json({
      message: 'Admin access is not configured on this server. Run scripts/set-admin-password.js on the server.',
      code: 'ADMIN_NOT_CONFIGURED',
    });
  }
  try {
    const session = await admin.loadSession(req);
    if (!session) {
      return res.status(401).json({ message: 'Admin sign-in required.', code: 'ADMIN_AUTH_REQUIRED' });
    }
    req.adminSession = session;
    return next();
  } catch (error) {
    console.error('Admin session check failed:', error.message);
    return res.status(500).json({ message: 'Could not check the admin session.' });
  }
}

/** State-changing admin requests must carry the per-session CSRF token. */
function requireAdminCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = String(req.headers['x-admin-csrf'] || '');
  const expected = String(req.adminSession?.csrfToken || '');
  let ok = false;
  try {
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    ok = false;
  }
  if (!ok) {
    void admin.audit('csrf_failure', req, `${req.method} ${req.originalUrl}`);
    return res.status(403).json({ message: 'Missing or invalid CSRF token.', code: 'CSRF_REQUIRED' });
  }
  return next();
}

module.exports = { requireAdminSession, requireAdminCsrf };
