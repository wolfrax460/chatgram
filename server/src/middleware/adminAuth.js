/** Admin gate middleware: session cookie + CSRF. */
const crypto = require('crypto');
const admin = require('../admin/auth');
const ipAllowlist = require('../admin/ipAllowlist');

// Do not write an audit row on every blocked request from the same IP.
const lastIpAudit = new Map();

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
    // Optional IP allowlist (9a): blocks other networks even with a valid cookie.
    const blocked = await ipAllowlist.isBlocked(req.ip);
    if (blocked) {
      const now = Date.now();
      if (!lastIpAudit.has(req.ip) || now - lastIpAudit.get(req.ip) > 60_000) {
        lastIpAudit.set(req.ip, now);
        void admin.audit('admin_ip_blocked', req, String(req.method || '') + ' ' + String(req.originalUrl || '').slice(0, 120));
      }
      return res.status(403).json({
        message: 'This network is not allowed to use the admin panel.',
        code: 'ADMIN_IP_BLOCKED',
      });
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
