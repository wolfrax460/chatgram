/**
 * Support notification fan-out.
 *
 * When a guest files a ticket (or the assistant is used), the owner is told
 * through every channel that is configured. All channels are optional and
 * independent — a missing env var simply skips that channel.
 *
 * Channels:
 *   Telegram  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   Gmail/SMTP SUPPORT_NOTIFY_EMAIL + SMTP_HOST/SMTP_USER/SMTP_PASS
 *
 * Nothing here throws: a failing channel must never lose the ticket.
 */

const TIMEOUT_MS = 12000;

async function postJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- telegram */

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function sendTelegram(text) {
  if (!telegramConfigured()) return { channel: 'telegram', skipped: true };
  const token = process.env.TELEGRAM_BOT_TOKEN.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID.trim();
  try {
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {}, {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
    return { channel: 'telegram', ok: true };
  } catch (error) {
    console.warn('Telegram notify failed:', error.message);
    return { channel: 'telegram', ok: false, error: error.message };
  }
}

/* ------------------------------------------------------------------- email */

function emailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      (process.env.SUPPORT_NOTIFY_EMAIL || process.env.SMTP_FROM)
  );
}

async function sendEmail(subject, text) {
  if (!emailConfigured()) return { channel: 'email', skipped: true };
  try {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.SUPPORT_NOTIFY_EMAIL || process.env.SMTP_FROM,
      subject,
      text,
    });
    return { channel: 'email', ok: true };
  } catch (error) {
    console.warn('Email notify failed:', error.message);
    return { channel: 'email', ok: false, error: error.message };
  }
}

/* --------------------------------------------------------------- formatting */

function formatTicket(ticket) {
  const lines = [
    `🆘 New Chatgram support ticket ${ticket.ticketId}`,
    '',
    `Contact: ${ticket.contact} (${ticket.contactType})`,
    `Status: ${ticket.status}`,
  ];
  if (ticket.meta?.page) lines.push(`Page: ${ticket.meta.page}`);
  if (ticket.meta?.userAgent) lines.push(`Browser: ${String(ticket.meta.userAgent).slice(0, 140)}`);
  lines.push('', 'Problem:', ticket.summary || '(no summary)');
  if (Array.isArray(ticket.transcript) && ticket.transcript.length) {
    lines.push('', 'Conversation:');
    for (const entry of ticket.transcript.slice(-12)) {
      lines.push(`${entry.role === 'guest' ? 'User' : 'Assistant'}: ${entry.text}`);
    }
  }
  return lines.join('\n');
}

/** Fan out to every configured channel in parallel. */
async function notifyTicket(ticket) {
  const text = formatTicket(ticket);
  const subject = `[${ticket.ticketId}] ${String(ticket.summary || 'New support ticket').slice(0, 60)}`;
  const results = await Promise.all([sendTelegram(text), sendEmail(subject, text)]);
  const delivered = results.filter((r) => r.ok).map((r) => r.channel);
  if (delivered.length) console.log(`Support ticket ${ticket.ticketId} notified via: ${delivered.join(', ')}`);
  else console.log(`Support ticket ${ticket.ticketId} created (no notification channel configured)`);
  return results;
}

/** Short ping, e.g. a support reply went out. */
async function notifySupportReply(ticket, replyText) {
  const text = `💬 Reply sent on ${ticket.ticketId}\n\n${String(replyText).slice(0, 1500)}`;
  await Promise.all([sendTelegram(text)]);
}

/** Which channels are live right now — handy for diagnosing setup. */
function channelStatus() {
  return {
    telegram: telegramConfigured(),
    email: emailConfigured(),
  };
}

module.exports = { notifyTicket, notifySupportReply, channelStatus, formatTicket };
