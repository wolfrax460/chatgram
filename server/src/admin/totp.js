/**
 * Admin panel TOTP enrolment, verification and recovery codes.
 *
 * The panel password stays the first factor; TOTP is the optional second factor
 * (off by default, enabled from Admin security). Enrolment shows a QR code and a
 * one-time plaintext recovery-code list; the database only stores hashes.
 */
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const AdminSecurity = require('../models/AdminSecurity');
const admin = require('./auth');
const { encrypt, decrypt, verifyCode, newRecoveryCodes, hashCode } = require('../controllers/twoFactorController');

const ISSUER = 'Chatgram Admin';

async function getDoc() {
  let doc = await AdminSecurity.findOne({ singleton: 'admin' }).select('+totpSecret');
  if (!doc) doc = await AdminSecurity.create({ singleton: 'admin' });
  return doc;
}

async function status() {
  const doc = await getDoc();
  return {
    totpEnabled: doc.totpEnabled === true,
    recoveryCodesRemaining: (doc.recoveryCodes || []).length,
    updatedAt: doc.updatedAt,
  };
}

async function start() {
  const doc = await getDoc();
  if (doc.totpEnabled) {
    const error = new Error('Two-step verification is already on.');
    error.status = 400;
    throw error;
  }
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri('admin', ISSUER, secret);
  doc.totpSecret = encrypt(secret);
  doc.totpEnabled = false;
  await doc.save({ validateBeforeSave: false });
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 260 });
  return {
    secret,
    otpauth,
    qr,
    issuer: ISSUER,
    instructions: 'Scan the QR code with an authenticator app, then enter the 6-digit code to turn two-step on.',
  };
}

async function enable(code, req) {
  const doc = await getDoc();
  if (doc.totpEnabled) {
    const error = new Error('Two-step verification is already on.');
    error.status = 400;
    throw error;
  }
  const secret = decrypt(doc.totpSecret);
  if (!secret) {
    const error = new Error('Start the setup again — no pending secret was found.');
    error.status = 400;
    throw error;
  }
  if (!verifyCode(secret, code)) {
    const error = new Error('That code is not correct. Check your authenticator app.');
    error.status = 400;
    throw error;
  }
  const codes = newRecoveryCodes();
  doc.totpEnabled = true;
  doc.recoveryCodes = codes.map(hashCode);
  await doc.save({ validateBeforeSave: false });
  await admin.audit('admin_totp_enable', req, `${codes.length} recovery codes`);
  return {
    message: 'Two-step verification is on. Save these recovery codes — each works once.',
    totpEnabled: true,
    recoveryCodes: codes,
  };
}

async function disable({ password, code }, req) {
  if (!(await admin.checkPassword(String(password || '')))) {
    const error = new Error('The panel password is not correct.');
    error.status = 401;
    throw error;
  }
  const doc = await getDoc();
  if (!doc.totpEnabled) {
    const error = new Error('Two-step verification is already off.');
    error.status = 400;
    throw error;
  }
  const secret = decrypt(doc.totpSecret);
  const totpOk = verifyCode(secret, code);
  const recoveryOk = !totpOk && (await consumeRecoveryCode(doc, code));
  if (!totpOk && !recoveryOk) {
    const error = new Error('Enter a valid code from your authenticator app (or a recovery code).');
    error.status = 400;
    throw error;
  }
  doc.totpEnabled = false;
  doc.totpSecret = '';
  doc.recoveryCodes = [];
  await doc.save({ validateBeforeSave: false });
  await admin.audit('admin_totp_disable', req);
  return { message: 'Two-step verification is off.', totpEnabled: false };
}

async function regenerateCodes({ password }, req) {
  if (!(await admin.checkPassword(String(password || '')))) {
    const error = new Error('The panel password is not correct.');
    error.status = 401;
    throw error;
  }
  const doc = await getDoc();
  if (!doc.totpEnabled) {
    const error = new Error('Turn two-step verification on first.');
    error.status = 400;
    throw error;
  }
  const codes = newRecoveryCodes();
  doc.recoveryCodes = codes.map(hashCode);
  await doc.save({ validateBeforeSave: false });
  await admin.audit('admin_totp_codes_regenerate', req, `${codes.length} recovery codes`);
  return { message: 'New recovery codes generated — the old ones no longer work.', recoveryCodes: codes };
}

async function consumeRecoveryCode(doc, code) {
  const plain = String(code || '').trim().toUpperCase();
  if (!plain) return false;
  const hashed = hashCode(plain);
  const index = (doc.recoveryCodes || []).indexOf(hashed);
  if (index < 0) return false;
  doc.recoveryCodes.splice(index, 1);
  await doc.save({ validateBeforeSave: false });
  return true;
}

/** Login check: TOTP code or a single-use recovery code. */
async function verifyLogin(code, req) {
  const doc = await getDoc();
  if (!doc.totpEnabled) return { ok: true };
  const secret = decrypt(doc.totpSecret);
  if (verifyCode(secret, code)) return { ok: true, recovery: false };
  const recoveryUsed = await consumeRecoveryCode(doc, code);
  if (recoveryUsed) {
    await admin.audit('admin_totp_recovery_used', req);
    return { ok: true, recovery: true };
  }
  return { ok: false };
}

module.exports = { status, start, enable, disable, regenerateCodes, verifyLogin };
