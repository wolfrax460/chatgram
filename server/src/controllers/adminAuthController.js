/**
 * Admin panel authentication endpoints. One password, no user account involved.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const AdminSession = require('../models/AdminSession');
const AdminAudit = require('../models/AdminAudit');
const admin = require('../admin/auth');
const adminTotp = require('../admin/totp');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function genericError(res) {
  return res.status(401).json({ message: 'Invalid admin password.', code: 'ADMIN_INVALID' });
}

// @desc    Admin login with the panel password
// @route   POST /api/admin/auth/login
const login = async (req, res) => {
  const ip = req.ip || '';
  const retryAfter = admin.retryAfterSeconds(ip);
  if (retryAfter > 0) {
    await admin.audit('login_locked', req, `retry after ${retryAfter}s`);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      message: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      code: 'ADMIN_LOCKED',
      retryAfter,
    });
  }

  const password = String(req.body?.password || '');
  const ok = await admin.checkPassword(password);
  if (!ok) {
    const state = admin.registerFailure(ip);
    await admin.audit('login_failure', req, `attempt ${state.count}`);
    await sleep(350); // slow down guessing
    if (state.lockedUntil) {
      await admin.audit('lockout', req);
      const seconds = Math.max(1, Math.ceil((state.lockedUntil - Date.now()) / 1000));
      res.set('Retry-After', String(seconds));
      return res.status(429).json({ message: 'Too many failed attempts. Temporarily locked.', code: 'ADMIN_LOCKED', retryAfter: seconds });
    }
    return genericError(res);
  }

  // Optional second factor (9a): a TOTP or single-use recovery code.
  const security = await adminTotp.status();
  if (security.totpEnabled) {
    const code = String(req.body?.code || req.body?.totp || '').trim();
    if (!code) {
      return res.status(401).json({
        message: 'Enter the 6-digit code from your authenticator app.',
        code: 'ADMIN_TOTP_REQUIRED',
      });
    }
    const verified = await adminTotp.verifyLogin(code, req);
    if (!verified.ok) {
      const state = admin.registerFailure(ip);
      await admin.audit('admin_totp_failure', req, `attempt ${state.count}`);
      if (state.lockedUntil) {
        await admin.audit('lockout', req);
        const seconds = Math.max(1, Math.ceil((state.lockedUntil - Date.now()) / 1000));
        res.set('Retry-After', String(seconds));
        return res.status(429).json({ message: 'Too many failed attempts. Temporarily locked.', code: 'ADMIN_LOCKED', retryAfter: seconds });
      }
      return res.status(401).json({ message: 'That code is not correct.', code: 'ADMIN_TOTP_INVALID' });
    }
  }

  admin.clearFailures(ip);
  const { csrfToken, session } = await admin.createSession(req, res);
  await admin.audit('login_success', req, `session ${session._id}`);
  return res.json({
    message: 'Admin signed in.',
    csrfToken,
    session: {
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    },
  });
};

// @desc    Current admin session (also hands back the CSRF token)
// @route   GET /api/admin/auth/session
const sessionInfo = async (req, res) => {
  const session = req.adminSession;
  const active = await AdminSession.countDocuments({
    revokedAt: null,
    expiresAt: { $gt: new Date() },
    lastSeenAt: { $gt: new Date(Date.now() - 30 * 60 * 1000) },
  });
  return res.json({
    authenticated: true,
    csrfToken: session.csrfToken,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    activeSessions: active,
    totpEnabled: Boolean(process.env.ADMIN_TOTP_SECRET),
  });
};

// @desc    Sign out this admin session
// @route   POST /api/admin/auth/logout
const logout = async (req, res) => {
  await admin.revokeSession(req.adminSession);
  admin.clearSessionCookie(res);
  await admin.audit('logout', req);
  return res.json({ message: 'Admin signed out.' });
};

// @desc    List admin sessions (no tokens or CSRF secrets)
// @route   GET /api/admin/auth/sessions
const listSessions = async (req, res) => {
  const rows = await AdminSession.find({ revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .limit(50);
  const me = String(req.adminSession._id);
  return res.json({
    sessions: rows.map((row) => ({
      id: String(row._id),
      current: String(row._id) === me,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      ip: row.ip,
      userAgent: row.userAgent,
    })),
  });
};

// @desc    Log out every admin session
// @route   POST /api/admin/auth/logout-all
const logoutAll = async (req, res) => {
  await AdminSession.updateMany({ revokedAt: null }, { $set: { revokedAt: new Date() } });
  admin.clearSessionCookie(res);
  await admin.audit('logout_all', req);
  return res.json({ message: 'All admin sessions have been signed out.' });
};

// @desc    Change the admin password (requires the current one)
// @route   POST /api/admin/auth/change-password
const changePassword = async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const nextPassword = String(req.body?.newPassword || '');
  if (!(await admin.checkPassword(currentPassword))) {
    await admin.audit('password_change_failure', req);
    await sleep(350);
    return genericError(res);
  }
  if (nextPassword.length < 14) {
    return res.status(400).json({ message: 'Use at least 14 characters.', code: 'WEAK_PASSWORD' });
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(nextPassword)).length;
  if (classes < 3) {
    return res.status(400).json({ message: 'Mix upper case, lower case, numbers and symbols.', code: 'WEAK_PASSWORD' });
  }
  const hash = await bcrypt.hash(nextPassword, 12);
  process.env.ADMIN_PANEL_PASSWORD_HASH = hash;
  try {
    const envPath = process.env.ADMIN_PANEL_ENV_FILE || path.join(__dirname, '../../../.env');
    const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const line = `ADMIN_PANEL_PASSWORD_HASH='${hash}'`;
    const next = /^ADMIN_PANEL_PASSWORD_HASH=.*$/m.test(current)
      ? current.replace(/^ADMIN_PANEL_PASSWORD_HASH=.*$/m, line)
      : `${current.replace(/\s*$/, '')}\n${line}\n`;
    const tmp = `${envPath}.tmp`;
    fs.writeFileSync(tmp, next, { mode: 0o600 });
    fs.renameSync(tmp, envPath);
  } catch (error) {
    console.warn('Could not persist the admin password hash:', error.message);
  }
  await admin.audit('password_change', req);
  return res.json({ message: 'Admin password changed. Other sessions were signed out.' });
};

// @desc    Recent admin audit entries
// @route   GET /api/admin/auth/audit
const listAudit = async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const rows = await AdminAudit.find({}).sort({ at: -1 }).limit(limit);
  return res.json({
    entries: rows.map((row) => ({
      action: row.action,
      detail: row.detail,
      ip: row.ip,
      at: row.at,
    })),
  });
};

module.exports = { login, sessionInfo, logout, listSessions, logoutAll, changePassword, listAudit };
