/**
 * Integration test: a sent message must still be there when the conversation is
 * refetched, and the socket + REST paths must agree on its id.
 *
 *   cd server
 *   node test/integration/messageSendPersistence.test.js
 *
 * Requires the local staging API (scripts/start-staging.ps1, default
 * http://127.0.0.1:5000) — or another isolated instance, e.g.
 *   BASE_URL=http://127.0.0.1:5004 node test/integration/messageSendPersistence.test.js
 *
 * Regression background ("my messages disappear"): the report was that a sent
 * message appears, then vanishes, while the sidebar keeps showing an older,
 * already-read preview. The server path was healthy but not covered by a test
 * that asserts the SAME id travels from `message:new` to `GET /api/messages`,
 * so a silent delete/store-mismatch could go unnoticed. This test pins that
 * contract for
 *   - a plain group message,
 *   - an asker-only "@Chatgram AI" mention (stored with visibleTo = [asker]),
 * and also checks the read path (unreadCount back to 0 after marking the chat
 * read).
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const run = Date.now().toString(36);
const PASSWORD = 'MessagePersist1!';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, pathname, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text };
}

async function register(label) {
  const identifier = `msg-persist-${label}-${run}@chatgram.test`;
  const result = await api('POST', '/api/auth/register', {
    body: { displayName: `Persist ${label} ${run}`, identifier, password: PASSWORD },
  });
  if (result.status !== 201) {
    throw new Error(`register ${label}: ${result.status} ${JSON.stringify(result.body).slice(0, 300)}`);
  }
  return { identifier, password: PASSWORD, token: result.body.accessToken, id: String(result.body.user.id || result.body.user._id) };
}

async function messagesOf(token, chatId) {
  const result = await api('GET', `/api/messages?chatId=${chatId}&limit=200`, { token });
  if (result.status !== 200) throw new Error(`GET messages: ${result.status} ${result.text.slice(0, 200)}`);
  return Array.isArray(result.body) ? result.body : result.body.messages || [];
}

async function chatRow(token, chatId) {
  const result = await api('GET', '/api/chats', { token });
  if (result.status !== 200) throw new Error(`GET chats: ${result.status} ${result.text.slice(0, 200)}`);
  return (result.body || []).find((row) => String(row._id || row.id) === String(chatId));
}

async function connectSocket(token) {
  const socket = io(BASE, { auth: { token }, reconnection: false, timeout: 8000 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket did not authenticate within 10s')), 10000);
    socket.once('authenticated', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

async function waitFor(predicate, { timeoutMs = 8000, interval = 100 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - started >= timeoutMs) return value;
    await sleep(interval);
  }
}

async function main() {
  console.log(`\nsent-message persistence test against ${BASE}\n`);

  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.log('Start the local staging API first (docs/local-staging.md / scripts/start-staging.ps1).');
    process.exit(1);
  }

  const owner = await register('owner');
  const alice = await register('alice');
  const bob = await register('bob');

  const created = await api('POST', '/api/chats', {
    token: owner.token,
    body: { type: 'group', groupName: `Persist ${run}`, participantIds: [alice.id, bob.id] },
  });
  check('group created', created.status === 201, created.status);
  const chatId = String(created.body._id || created.body.id);
  const settings = await api('PATCH', `/api/chats/${chatId}`, {
    token: owner.token,
    body: { groupSettings: { aiMentions: true, aiReplyVisibility: 'asker' } },
  });
  check(
    'group AI mentions enabled, asker-only visibility',
    settings.status === 200 && settings.body?.groupSettings?.aiReplyVisibility === 'asker',
    settings.body?.groupSettings,
  );

  /* ------------------------------------------------- REST send + refetch */
  const restSend = await api('POST', '/api/messages', {
    token: owner.token,
    body: { chatId, type: 'text', content: `rest-${run}` },
  });
  check('REST send returns 201', restSend.status === 201, restSend.status);

  let list = await messagesOf(owner.token, chatId);
  const restRow = list.find((row) => String(row._id) === String(restSend.body?._id));
  check('REST-sent message is in the refetched list', Boolean(restRow), list.map((row) => String(row._id)));
  check('REST-sent message keeps its id', Boolean(restRow) && String(restRow._id) === String(restSend.body?._id));

  /* --------------------------------------- socket send + refetch agreement */
  const socket = await connectSocket(owner.token);
  const events = [];
  socket.on('message:new', (message) => events.push(message));
  try {
    const clientId = `tmp-${run}-socket`;
    socket.emit('message:send', { chatId, type: 'text', content: `socket-${run}`, clientId });

    const event = await waitFor(() => events.find((message) => message.clientId === clientId));
    check('socket send produced exactly one message:new for its clientId', events.filter((m) => m.clientId === clientId).length === 1);
    check('message:new carries a server id', Boolean(event && event._id), event && Object.keys(event).slice(0, 5));

    list = await messagesOf(owner.token, chatId);
    const socketRow = event ? list.find((row) => String(row._id) === String(event._id)) : null;
    check('socket-sent message is still in the list after a refetch', Boolean(socketRow));
    check('message:new id equals the id stored in the list', Boolean(socketRow && String(socketRow._id) === String(event._id)));
    check('refetched content matches', Boolean(socketRow) && socketRow.content === `socket-${run}`);

    /* ----------------------------- asker-only AI mention survives refetch */
    const mentionClientId = `tmp-${run}-mention`;
    socket.emit('message:send', { chatId, type: 'text', content: '@chatgram ai hello persistence', clientId: mentionClientId });
    const mentionEvent = await waitFor(() =>
      events.find((message) => message.clientId === mentionClientId && message.private === true),
    );
    check('asker-only mention is broadcast privately', Boolean(mentionEvent && mentionEvent.private === true), mentionEvent?.private);

    list = await messagesOf(owner.token, chatId);
    const mentionRow = mentionEvent ? list.find((row) => String(row._id) === String(mentionEvent._id)) : null;
    check('asker-only mention is still in the ASKER list after a refetch', Boolean(mentionRow), list.map((row) => String(row._id)));
    check('asker-only mention row is flagged private', Boolean(mentionRow && mentionRow.private === true));
    check(
      'asker-only mention visibleTo is exactly the asker',
      Boolean(mentionRow && Array.isArray(mentionRow.visibleTo) && mentionRow.visibleTo.length === 1 && String(mentionRow.visibleTo[0]) === owner.id),
      mentionRow?.visibleTo,
    );

    const aliceList = await messagesOf(alice.token, chatId);
    check('another member does NOT receive the private mention', !aliceList.some((row) => mentionRow && String(row._id) === String(mentionRow._id)));
  } finally {
    socket.close();
  }

  /* ------------------------------------------------ read path clears unread */
  const aliceSend = await api('POST', '/api/messages', {
    token: alice.token,
    body: { chatId, type: 'text', content: `from-alice-${run}` },
  });
  check('member can send to the group', aliceSend.status === 201, aliceSend.status);

  const beforeRead = await chatRow(owner.token, chatId);
  check('owner has unread before reading', Number(beforeRead?.unreadCount) > 0, beforeRead?.unreadCount);
  const markRead = await api('POST', `/api/messages/chat/${chatId}/read`, { token: owner.token });
  check('mark-chat-as-read answers 200', markRead.status === 200, markRead.status);
  const afterRead = await chatRow(owner.token, chatId);
  check('unread goes back to 0 after reading', Number(afterRead?.unreadCount) === 0, afterRead?.unreadCount);
  check(
    'the chat preview is still a message the owner can read',
    Boolean(afterRead?.lastMessage && typeof afterRead.lastMessage.content === 'string'),
    afterRead?.lastMessage?.content,
  );

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    console.log('failures:', JSON.stringify(failures, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nTEST CRASHED:', error);
  process.exit(1);
});
