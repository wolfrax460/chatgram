/**
 * Production smoke: send a message to Chatgram Support and require a reply.
 * Creates one clearly-named test account and deletes it (and its chat) after.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

const BASE = 'http://127.0.0.1:5000';
const STAMP = Date.now().toString(36);
const EMAIL = `support-smoke-${STAMP}@chatgram.test`;
const PASSWORD = 'SupportSmoke1!';

async function api(method, route, { token, body } = {}) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, body: json };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./src/models/User');
  const Chat = require('./src/models/Chat');
  const Message = require('./src/models/Message');
  const SupportTicket = require('./src/models/SupportTicket');

  const user = await User.create({
    displayName: `Support Smoke ${STAMP}`,
    email: EMAIL,
    password: PASSWORD,
  });
  let chatId = null;
  let reply = null;
  try {
    const login = await api('POST', '/api/auth/login', { body: { identifier: EMAIL, password: PASSWORD } });
    if (!login.body?.accessToken) throw new Error(`login failed: ${login.status}`);
    const token = login.body.accessToken;

    const chat = await api('POST', '/api/support/chat', { token });
    chatId = chat.body?._id || chat.body?.id || chat.body?.chat?._id;
    if (!chatId) throw new Error(`support chat failed: ${chat.status} ${JSON.stringify(chat.body).slice(0, 160)}`);

    const question = 'Hello, I cannot log in after changing my password. What should I do?';
    const sent = await api('POST', '/api/messages', { token, body: { chatId, type: 'text', content: question } });
    console.log('question sent:', sent.status);

    const started = Date.now();
    while (Date.now() - started < 75_000) {
      const history = await api('GET', `/api/messages?chatId=${chatId}`, { token });
      const messages = history.body?.messages || [];
      reply = messages.find((m) => String(m.senderId?._id || m.senderId) !== String(user._id) && m.content);
      if (reply) break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!reply) {
      console.log(`SUPPORT SMOKE FAILED: no reply within ${seconds}s`);
    } else {
      const who = reply.senderId?.displayName || 'support';
      console.log(`SUPPORT SMOKE PASSED: reply from ${who} after ${seconds}s -> ${String(reply.content).slice(0, 110).replace(/\n/g, ' ')}`);
    }
  } finally {
    if (chatId) {
      await Message.deleteMany({ chatId });
      await SupportTicket.deleteMany({ chatId });
      await Chat.deleteMany({ _id: chatId });
    }
    await User.deleteMany({ _id: user._id });
    await mongoose.disconnect();
    const leftover = chatId ? 'cleaned' : 'no chat created';
    console.log('cleanup:', leftover, '| test user deleted');
  }
  if (!reply) process.exit(1);
}

main().catch((error) => {
  console.error('smoke crashed:', error.message);
  process.exit(1);
});
