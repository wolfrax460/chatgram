// End-to-end socket test: two users authenticate and exchange a message.
const { io } = require('socket.io-client');

const BASE = 'http://127.0.0.1:5001';

async function register(displayName, email) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, identifier: email, password: 'password123' }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function createChat(token, participantId) {
  const res = await fetch(`${BASE}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'direct', participantId }),
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function connectClient(token, label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'] });
    socket.on('authenticated', (data) => {
      console.log(`${label}: authenticated as ${data.user.displayName}`);
      resolve(socket);
    });
    socket.on('auth_error', (err) => reject(new Error(`${label} auth_error: ${JSON.stringify(err)}`)));
    socket.on('connect', () => socket.emit('authenticate', token));
    socket.on('connect_error', (err) => reject(err));
  });
}

(async () => {
  const alice = await register('SocketAlice', `sa${Date.now()}@test.dev`);
  const bob = await register('SocketBob', `sb${Date.now()}@test.dev`);
  console.log('Registered both users');

  const [sockA, sockB] = await Promise.all([
    connectClient(alice.accessToken, 'Alice'),
    connectClient(bob.accessToken, 'Bob'),
  ]);

  const chat = await createChat(alice.accessToken, bob.user.id);
  console.log(`Chat created: ${chat._id}`);

  // Socket rooms are joined at authenticate time, which already happened before
  // the chat existed — so re-authenticate to join the new chat room.
  sockA.emit('authenticate', alice.accessToken);
  sockB.emit('authenticate', bob.accessToken);
  await new Promise((r) => setTimeout(r, 1500));

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message:new')), 5000);
    sockB.on('message:new', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });

  sockA.emit('message:send', { chatId: chat._id, type: 'text', content: 'Hello from Alice!' });
  const msg = await received;
  console.log(`Bob received: "${msg.content}" from ${msg.senderId.displayName}`);

  sockA.disconnect();
  sockB.disconnect();
  console.log('SOCKET E2E TEST PASSED');
  process.exit(0);
})().catch((e) => {
  console.error('SOCKET E2E TEST FAILED:', e.message);
  process.exit(1);
});
