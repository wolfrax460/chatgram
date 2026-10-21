/**
 * Delivery of verification codes by email and SMS.
 *
 * Plug in a real provider with environment variables; until then everything
 * runs in "console" mode, which logs the code and (in development) returns it
 * to the client so the flow is testable end to end without paid services.
 *
 *   EMAIL_PROVIDER=console | smtp | resend
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM
 *   RESEND_API_KEY / MAIL_FROM
 *
 *   SMS_PROVIDER=console | twilio
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
 *
 * `DEV_SHOW_CODES` (default: true when NODE_ENV !== 'production') controls
 * whether the generated code is included in the API response. Turn it off in
 * production or anyone could read a code straight from the HTTP response.
 */
// Loaded lazily: the console provider needs no dependencies at all, so a
// fresh checkout works without installing anything extra.
let nodemailer = null;
try {
  // eslint-disable-next-line global-require
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

const isProd = process.env.NODE_ENV === 'production';
const emailProvider = process.env.EMAIL_PROVIDER || 'console';
const smsProvider = process.env.SMS_PROVIDER || 'console';
const showCodes =
  process.env.DEV_SHOW_CODES !== undefined
    ? process.env.DEV_SHOW_CODES === 'true'
    : !isProd;

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (emailProvider !== 'smtp') return null;
  if (!nodemailer) {
    throw new Error(
      'EMAIL_PROVIDER=smtp requires the "nodemailer" package. Install it with: cd server && npm install nodemailer'
    );
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

async function sendEmailCode(to, code) {
  const subject = 'Your Chatgram verification code';
  const text = `Your Chatgram verification code is ${code}. It expires in 10 minutes.`;
  const html = `<p>Your Chatgram verification code is <strong style="font-size:20px">${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`;

  if (emailProvider === 'smtp') {
    const tx = getTransporter();
    await tx.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    return { delivered: true, provider: 'smtp' };
  }

  if (emailProvider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Chatgram <onboarding@resend.dev>',
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    return { delivered: true, provider: 'resend' };
  }

  // Console mode — no provider configured.
  console.log(`\n[verification] EMAIL to ${to}: ${code}\n`);
  return { delivered: false, provider: 'console' };
}

async function sendSmsCode(to, code) {
  const body = `Your Chatgram verification code is ${code}. It expires in 10 minutes.`;

  if (smsProvider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`Twilio error ${res.status}: ${await res.text()}`);
    return { delivered: true, provider: 'twilio' };
  }

  console.log(`\n[verification] SMS to ${to}: ${code}\n`);
  return { delivered: false, provider: 'console' };
}

const labels = {
  email: 'email',
  phone: 'phone',
};

/** EMAIL_ENABLED=false is an explicit kill switch (used in production today). */
function emailEnabled() {
  return String(process.env.EMAIL_ENABLED ?? 'true') !== 'false';
}

/**
 * Generic transactional email. Unlike sendEmailCode this is not a code, so it
 * uses its own subject/body. Returns { delivered, provider } and never throws
 * for console mode.
 */
async function sendMail({ to, subject, text, html }) {
  if (!to || !emailEnabled()) return { delivered: false, provider: 'disabled' };

  if (emailProvider === 'smtp') {
    const tx = getTransporter();
    if (!tx) return { delivered: false, provider: 'console' };
    await tx.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    return { delivered: true, provider: 'smtp' };
  }

  if (emailProvider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Chatgram <onboarding@resend.dev>',
        to,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    return { delivered: true, provider: 'resend' };
  }

  console.log(`\n[email] to ${to}: ${subject}\n`);
  return { delivered: false, provider: 'console' };
}

/**
 * Security notice sent after a password change. Deliberately does NOT contain
 * the password, the old password, tokens, or any other secret.
 */
async function notifyPasswordChanged(user) {
  const when = new Date().toUTCString();
  const name = (user && user.displayName) || 'there';
  const subject = 'Your Chatgram password was changed';
  const text =
    `Hi ${name},\n\n` +
    `The password for your Chatgram account${user && user.email ? ` (${user.email})` : ''} ` +
    `was changed on ${when}.\n\n` +
    `If this was you, no action is needed. All other devices have been signed out.\n\n` +
    `If you did not change it, reset your password immediately from the sign-in ` +
    `screen ("Forgot password") and contact Chatgram support.\n`;

  const target = user && user.email;
  if (!target) return { email: false, channel: null };

  try {
    const result = await sendMail({ to: target, subject, text });
    return { email: result.delivered, channel: result.provider };
  } catch (error) {
    console.error('Password-changed email failed:', error.message);
    return { email: false, channel: null, error: true };
  }
}

const reasonMessages = {
  missing: 'No code was requested for this address, or it already expired. Request a new one.',
  expired: 'That code has expired. Request a new one.',
  invalid: 'That code is not correct.',
  too_many_attempts: 'Too many incorrect attempts. Request a new code.',
};

module.exports = {
  sendEmailCode,
  sendSmsCode,
  sendMail,
  notifyPasswordChanged,
  emailEnabled,
  showCodes,
  labels,
  reasonMessages,
  activeProviders: { email: emailProvider, sms: smsProvider },
};
