/**
 * Admin security endpoints: TOTP status, enrolment, enable/disable and recovery
 * codes. Session + CSRF are enforced by the router; every mutation is audited
 * inside the TOTP module.
 */
const adminTotp = require('../admin/totp');

function fail(res, error) {
  const status = error.status || 500;
  if (status >= 500) console.error('Admin security error:', error.message);
  return res.status(status).json({ message: error.message || 'Could not complete the request.' });
}

async function state(req, res) {
  try {
    const status = await adminTotp.status();
    return res.json({
      ...status,
      currentIp: req.ip || '',
      note: 'Two-step verification is optional. When it is on, signing in also needs a 6-digit code from your authenticator app.',
    });
  } catch (error) {
    return fail(res, error);
  }
}

async function start(req, res) {
  try {
    return res.json(await adminTotp.start());
  } catch (error) {
    return fail(res, error);
  }
}

async function enable(req, res) {
  try {
    return res.json(await adminTotp.enable(req.body?.code, req));
  } catch (error) {
    return fail(res, error);
  }
}

async function disable(req, res) {
  try {
    return res.json(await adminTotp.disable(req.body || {}, req));
  } catch (error) {
    return fail(res, error);
  }
}

async function regenerateCodes(req, res) {
  try {
    return res.json(await adminTotp.regenerateCodes(req.body || {}, req));
  } catch (error) {
    return fail(res, error);
  }
}

module.exports = { state, start, enable, disable, regenerateCodes };
