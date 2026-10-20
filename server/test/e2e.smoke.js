/**
 * Chatgram end-to-end smoke test.
 *
 * Exercises the real HTTP API and the real Socket.IO layer against a running
 * server + MongoDB. Run with:  node test/e2e.smoke.js
 *
 * Exits non-zero if any check fails.
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5001';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
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
  return { status: res.status, body: json };
}

const uniq = Date.now();

async function main() {
  console.log(`\nChatgram E2E smoke test against ${BASE}\n`);

  // ---------------------------------------------------------------- health
  console.log('[health]');
  const root = await api('GET', '/');
  check('GET / returns 200', root.status === 200, `got ${root.status}`);

  const health = await api('GET', '/api/health');
  check('GET /api/health -> 200', health.status === 200, `got ${health.status}`);
  check('health reports database connected', health.body?.database === 'connected', JSON.stringify(health.body));

  // ------------------------------------------------------------------ auth
  console.log('\n[auth]');

  // Does this server insist on a verified email/phone before registering?
  const configRes = await api('GET', '/api/config');
  const verificationRequired = configRes.body?.verificationRequired === true;
  const codesExposed = configRes.body?.showCodesInResponse === true;

  if (verificationRequired) {
    console.log(
      `  (verification required; codes ${codesExposed ? 'exposed' : 'NOT exposed'} by this server)`
    );
  }

  /**
   * Register through the real flow. When the server requires verification we
   * send and check a code first, exactly like the app does.
   */
  async function registerVerified(displayName, identifier, password = 'password123') {
    let verificationToken;
    if (verificationRequired) {
      const sent = await api('POST', '/api/auth/verification/send', {
        body: { target: identifier },
      });
      if (!sent.body?.devCode) {
        return {
          status: 0,
          body: { message: 'server requires verification and does not expose codes' },
          verificationUnavailable: true,
        };
      }
      const checked = await api('POST', '/api/auth/verification/check', {
        body: { target: identifier, code: sent.body.devCode },
      });
      verificationToken = checked.body?.verificationToken;
      if (!verificationToken) {
        return { status: 0, body: { message: 'code check failed' }, verificationUnavailable: true };
      }
    }
    return api('POST', '/api/auth/register', {
      body: {
        displayName,
        identifier,
        password,
        ...(verificationToken ? { verificationToken } : {}),
      },
    });
  }

  const emailA = `alice.${uniq}@example.com`;
  const emailB = `bob.${uniq}@example.com`;

  const regA = await registerVerified('Alice', emailA);

  // The suite creates its own accounts. If this server enforces verification
  // but deliberately withholds the codes (the production-safe setting), a test
  // has no legitimate way to register - say so clearly rather than failing
  // with a wall of 403s.
  if (regA.verificationUnavailable) {
    console.log(
      '\n  This server requires email/phone verification but does not expose the\n' +
        '  codes (DEV_SHOW_CODES=false), so the suite cannot create its own users.\n\n' +
        '  That is the correct setting for a real deployment. To run the full\n' +
        '  suite, start a second API with test settings:\n\n' +
        '    $env:PORT="5002"; $env:DEV_SHOW_CODES="true"; $env:EMAIL_PROVIDER="console"; npm start\n' +
        '    $env:BASE_URL="http://127.0.0.1:5002"; npm test\n'
    );
    console.log(`${'='.repeat(60)}`);
    console.log('RESULT: skipped - needs DEV_SHOW_CODES=true or REQUIRE_VERIFICATION=false');
    console.log('');
    process.exit(0);
  }

  check('register user A -> 201', regA.status === 201, `got ${regA.status} ${JSON.stringify(regA.body)}`);
  check('register A returns accessToken', !!regA.body?.accessToken);
  check('register A returns refreshToken', !!regA.body?.refreshToken);
  check('register A returns user.id', !!regA.body?.user?.id, JSON.stringify(regA.body?.user));

  const regB = await registerVerified('Bob', emailB);
  check('register user B -> 201', regB.status === 201, `got ${regB.status}`);

  const tokenA = regA.body?.accessToken;
  const tokenB = regB.body?.accessToken;
  const idA = regA.body?.user?.id;
  const idB = regB.body?.user?.id;

  const dup = await registerVerified('Alice2', emailA);
  check('duplicate register -> 400', dup.status === 400, `got ${dup.status}`);

  const badLogin = await api('POST', '/api/auth/login', {
    body: { identifier: emailA, password: 'wrong-password' },
  });
  check('login wrong password -> 401', badLogin.status === 401, `got ${badLogin.status}`);

  const login = await api('POST', '/api/auth/login', {
    body: { identifier: emailA, password: 'password123' },
  });
  check('login correct -> 200', login.status === 200, `got ${login.status} ${JSON.stringify(login.body)}`);

  const me = await api('GET', '/api/auth/me', { token: tokenA });
  check('GET /api/auth/me -> 200', me.status === 200, `got ${me.status}`);
  check('/api/auth/me never leaks password hash', me.body?.password === undefined);

  const noToken = await api('GET', '/api/auth/me');
  check('GET /api/auth/me without token -> 401', noToken.status === 401, `got ${noToken.status}`);

  const refreshTok = regA.body?.refreshToken;
  const refreshed = await api('POST', '/api/auth/refresh', { body: { token: refreshTok } });
  check('POST /api/auth/refresh -> 200', refreshed.status === 200, `got ${refreshed.status}`);
  check('refresh returns accessToken', !!refreshed.body?.accessToken);

  // ---------------------------------------------------------------- users
  console.log('\n[users]');
  const users = await api('GET', '/api/users', { token: tokenA });
  check('GET /api/users -> 200', users.status === 200, `got ${users.status}`);
  check('GET /api/users lists other user B', Array.isArray(users.body) && users.body.some((u) => u._id === idB));
  check('GET /api/users excludes self', Array.isArray(users.body) && !users.body.some((u) => u._id === idA));

  const search = await api('GET', '/api/users/search?query=Bob', { token: tokenA });
  check('GET /api/users/search -> 200', search.status === 200, `got ${search.status}`);
  check('search finds Bob', Array.isArray(search.body) && search.body.some((u) => u._id === idB));

  // ---------------------------------------------------------------- chats
  console.log('\n[chats]');
  const chat1 = await api('POST', '/api/chats', { token: tokenA, body: { type: 'direct', participantId: idB } });
  check('create direct chat -> 201', chat1.status === 201, `got ${chat1.status} ${JSON.stringify(chat1.body)}`);
  const chatId = chat1.body?._id;
  check('created chat has populated participants', Array.isArray(chat1.body?.participants) && typeof chat1.body.participants[0] === 'object');

  const chat2 = await api('POST', '/api/chats', { token: tokenA, body: { type: 'direct', participantId: idB } });
  check('re-creating direct chat reuses it -> 200', chat2.status === 200, `got ${chat2.status}`);
  check('re-created chat has same id', chat2.body?._id === chatId);

  const chatsA = await api('GET', '/api/chats', { token: tokenA });
  check('GET /api/chats -> 200', chatsA.status === 200, `got ${chatsA.status}`);
  check('GET /api/chats includes the chat', Array.isArray(chatsA.body) && chatsA.body.some((c) => c._id === chatId));
  const listedChat = chatsA.body?.find((c) => c._id === chatId);
  check('chat participants populated with displayName', listedChat?.participants?.every((p) => !!p.displayName));

  const chatById = await api('GET', `/api/chats/${chatId}`, { token: tokenA });
  check('GET /api/chats/:id -> 200', chatById.status === 200, `got ${chatById.status}`);

  const chatForbidden = await api('GET', `/api/chats/${chatId}`, { token: 'invalid.token.here' });
  check('GET /api/chats/:id with bad token -> 401', chatForbidden.status === 401, `got ${chatForbidden.status}`);

  // ------------------------------------------------------------- messages
  console.log('\n[messages]');
  const sent = await api('POST', '/api/messages', {
    token: tokenA,
    body: { chatId, type: 'text', content: 'Hello from the smoke test' },
  });
  check('POST /api/messages (text) -> 201', sent.status === 201, `got ${sent.status} ${JSON.stringify(sent.body)}`);
  check('message senderId is populated object', typeof sent.body?.senderId === 'object' && !!sent.body?.senderId?.displayName);
  const messageId = sent.body?._id;

  const emptyText = await api('POST', '/api/messages', { token: tokenA, body: { chatId, type: 'text', content: '   ' } });
  check('empty text message rejected -> 400', emptyText.status === 400, `got ${emptyText.status}`);

  for (let i = 1; i <= 5; i++) {
    await api('POST', '/api/messages', { token: tokenA, body: { chatId, type: 'text', content: `Message number ${i}` } });
  }

  const msgs = await api('GET', `/api/messages?chatId=${chatId}&limit=3`, { token: tokenA });
  check('GET /api/messages -> 200', msgs.status === 200, `got ${msgs.status}`);
  const msgList = msgs.body?.messages;
  check('GET /api/messages returns { messages, hasMore, nextCursor }',
    Array.isArray(msgList) && 'hasMore' in (msgs.body || {}) && 'nextCursor' in (msgs.body || {}),
    JSON.stringify(msgs.body)?.slice(0, 160));
  check('limit=3 returns exactly 3', Array.isArray(msgList) && msgList.length === 3, `got ${msgList?.length}`);
  // Ordering contract: oldest-first (ascending) so the UI can render top-to-bottom.
  const idsAsc = Array.isArray(msgList) && msgList.every((m, i, a) => i === 0 || a[i - 1]._id < m._id);
  check('messages returned oldest-first', idsAsc, JSON.stringify(msgList?.map((m) => m.content)));
  // The 3 newest, not the 3 oldest.
  const contents = (msgList || []).map((m) => m.content);
  check('limit returns the NEWEST messages (not oldest)', !contents.includes('Hello from the smoke test'), JSON.stringify(contents));

  // Paginating with `before` must walk backwards through history.
  const older = await api('GET', `/api/messages?chatId=${chatId}&limit=3&before=${msgList?.[0]?._id}`, { token: tokenA });
  check('`before` cursor returns older messages', older.body?.messages?.every((m) => m._id < msgList[0]._id), JSON.stringify(older.body?.messages?.map((m) => m.content)));

  const readRes = await api('POST', `/api/messages/${messageId}/read`, { token: tokenB });
  check('POST /api/messages/:id/read -> 200', readRes.status === 200, `got ${readRes.status}`);
  const deliveredRes = await api('POST', `/api/messages/${messageId}/delivered`, { token: tokenB });
  check('POST /api/messages/:id/delivered -> 200', deliveredRes.status === 200, `got ${deliveredRes.status}`);

  const msgsAfter = await api('GET', `/api/messages?chatId=${chatId}&limit=50`, { token: tokenA });
  const target = msgsAfter.body?.messages?.find((m) => m._id === messageId);
  check('read receipt persisted (readBy)', target?.readBy?.includes(idB), JSON.stringify(target?.readBy));
  check('delivered receipt persisted (deliveredTo)', target?.deliveredTo?.includes(idB), JSON.stringify(target?.deliveredTo));

  const chatRead = await api('POST', `/api/messages/chat/${chatId}/read`, { token: tokenB });
  check('POST /api/messages/chat/:id/read -> 200', chatRead.status === 200, `got ${chatRead.status}`);

  const chatsAfter = await api('GET', '/api/chats', { token: tokenA });
  const chatWithLast = chatsAfter.body?.find((c) => c._id === chatId);
  check('chat.lastMessage populated after send', !!chatWithLast?.lastMessage?.content, JSON.stringify(chatWithLast?.lastMessage));
  check('GET /api/chats sorted most-recent-first', chatsAfter.body?.[0]?._id === chatId);
  check('GET /api/chats exposes unreadCount', typeof chatWithLast?.unreadCount === 'number', JSON.stringify(chatWithLast?.unreadCount));

  // ----------------------------------------------------------- group chats
  console.log('\n[group chats]');
  const group = await api('POST', '/api/chats', {
    token: tokenA,
    body: { type: 'group', groupName: 'Smoke Group', participantIds: [idB] },
  });
  check('create group chat -> 201', group.status === 201, `got ${group.status} ${JSON.stringify(group.body)}`);
  check('group has 2 participants', group.body?.participants?.length === 2, JSON.stringify(group.body?.participants?.length));
  check('group name persisted', group.body?.groupName === 'Smoke Group');
  check('creator is group admin', group.body?.groupAdmins?.includes(idA), JSON.stringify(group.body?.groupAdmins));
  const groupId = group.body?._id;

  const groupNoName = await api('POST', '/api/chats', { token: tokenA, body: { type: 'group', participantIds: [idB] } });
  check('group without name -> 400', groupNoName.status === 400, `got ${groupNoName.status}`);

  const groupNoMembers = await api('POST', '/api/chats', { token: tokenA, body: { type: 'group', groupName: 'Empty' } });
  check('group without members -> 400', groupNoMembers.status === 400, `got ${groupNoMembers.status}`);

  const groupMsg = await api('POST', '/api/messages', { token: tokenA, body: { chatId: groupId, type: 'text', content: 'hello group' } });
  check('send message to group -> 201', groupMsg.status === 201, `got ${groupMsg.status}`);

  const addSelf = await api('POST', `/api/chats/${groupId}/participants`, { token: tokenA, body: { participantIds: [idB] } });
  check('adding an existing member -> 400', addSelf.status === 400, `got ${addSelf.status}`);

  const removeOther = await api('DELETE', `/api/chats/${groupId}/participants/${idB}`, { token: tokenA });
  check('admin removes member -> 200', removeOther.status === 200, `got ${removeOther.status}`);
  check('group now has 1 participant', removeOther.body?.participants?.length === 1, JSON.stringify(removeOther.body?.participants?.length));

  // -------------------------------------------------------------- sockets
  console.log('\n[sockets]');
  const socketResult = await new Promise((resolve) => {
    const sockA = io(BASE, { transports: ['websocket'], forceNew: true });
    const sockB = io(BASE, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => {
      sockA.close();
      sockB.close();
      resolve({ ok: false, reason: 'timeout waiting for message:new' });
    }, 12000);

    let authedA = false;
    let authedB = false;

    sockA.on('authenticated', () => {
      authedA = true;
      if (authedB) sendIt();
    });
    sockB.on('authenticated', () => {
      authedB = true;
      if (authedA) sendIt();
    });
    sockA.on('auth_error', (e) => {
      clearTimeout(timer);
      sockA.close();
      sockB.close();
      resolve({ ok: false, reason: `A auth_error: ${JSON.stringify(e)}` });
    });

    let sent = false;
    function sendIt() {
      if (sent) return;
      sent = true;
      sockB.emit('message:send', { chatId, type: 'text', content: 'socket hello' });
    }

    sockA.on('message:new', (msg) => {
      clearTimeout(timer);
      sockA.close();
      sockB.close();
      resolve({ ok: true, msg });
    });
    sockA.on('message:error', (e) => {
      clearTimeout(timer);
      sockA.close();
      sockB.close();
      resolve({ ok: false, reason: `message:error ${JSON.stringify(e)}` });
    });

    sockA.emit('authenticate', tokenA);
    sockB.emit('authenticate', tokenB);
  });

  check('socket: A receives message:new sent by B over the socket', socketResult.ok, socketResult.reason);
  check('socket message persisted with chatId', socketResult.ok && socketResult.msg?.chatId === chatId);

  // Broadcast must reach the sender too, otherwise the optimistic UI replacement fails.
  const senderEcho = await new Promise((resolve) => {
    const sock = io(BASE, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => {
      sock.close();
      resolve(false);
    }, 8000);
    sock.on('authenticated', () => {
      sock.emit('message:send', { chatId, type: 'text', content: 'echo check' });
    });
    sock.on('message:new', (m) => {
      if (m.content === 'echo check') {
        clearTimeout(timer);
        sock.close();
        resolve(true);
      }
    });
    sock.emit('authenticate', tokenA);
  });
  check('socket: sender receives own message broadcast', senderEcho);

  // Unauthenticated socket must NOT be able to send.
  const unauthSend = await new Promise((resolve) => {
    const sock = io(BASE, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => {
      sock.close();
      resolve('no-response');
    }, 6000);
    sock.on('connect', () => {
      sock.emit('message:send', { chatId, type: 'text', content: 'i am not authed' });
    });
    sock.on('message:error', (e) => {
      clearTimeout(timer);
      sock.close();
      resolve(e.message);
    });
    sock.on('message:new', () => {
      clearTimeout(timer);
      sock.close();
      resolve('LEAKED: got message:new');
    });
  });
  check('unauthenticated socket cannot send messages', unauthSend !== 'no-response' && !String(unauthSend).startsWith('LEAKED'), String(unauthSend));

  // --------------------------------------------------------------- status
  console.log('\n[status]');
  const st = await api('POST', '/api/status', { token: tokenA, body: { text: 'My first status' } });
  check('POST /api/status -> 201', st.status === 201, `got ${st.status} ${JSON.stringify(st.body)}`);
  check('status userId populated', typeof st.body?.userId === 'object' && !!st.body?.userId?.displayName, JSON.stringify(st.body?.userId));
  const statusId = st.body?._id;

  const shortStatus = await api('POST', '/api/status', { token: tokenA, body: { text: 'a' } });
  check('POST /api/status with 1-char text -> 201', shortStatus.status === 201, `got ${shortStatus.status}`);

  const emptyStatus = await api('POST', '/api/status', { token: tokenA, body: {} });
  check('POST /api/status with no text/media -> 400', emptyStatus.status === 400, `got ${emptyStatus.status}`);

  const statuses = await api('GET', '/api/status', { token: tokenB });
  check('GET /api/status -> 200', statuses.status === 200, `got ${statuses.status}`);
  check('GET /api/status returns a list', Array.isArray(statuses.body), JSON.stringify(statuses.body));

  const view = await api('POST', `/api/status/${statusId}/view`, { token: tokenB });
  check('POST /api/status/:id/view -> 200', view.status === 200, `got ${view.status}`);

  // The owner must be able to see WHO viewed their status, not just a count.
  const statusesForA = await api('GET', '/api/status', { token: tokenA });
  const viewedStatus = (statusesForA.body || []).find((s) => s._id === statusId);
  const viewerEntry = (viewedStatus?.viewedBy || [])[0];
  check('status viewedBy is populated with the viewer object',
    viewerEntry && typeof viewerEntry === 'object' && !!viewerEntry.displayName,
    JSON.stringify(viewedStatus?.viewedBy));
  check('status viewer is the right user', viewerEntry && viewerEntry._id === idB, JSON.stringify(viewerEntry));

  const delOther = await api('DELETE', `/api/status/${statusId}`, { token: tokenB });
  check('delete someone else\'s status -> 403', delOther.status === 403, `got ${delOther.status}`);

  const delOwn = await api('DELETE', `/api/status/${statusId}`, { token: tokenA });
  check('delete own status -> 200', delOwn.status === 200, `got ${delOwn.status}`);

  // -------------------------------------------------------- verification
  console.log('\n[verification]');
  const vEmail = `verify.${uniq}@example.com`;

  const badTarget = await api('POST', '/api/auth/verification/send', { body: { target: 'not-an-email' } });
  check('verification send with invalid target -> 400', badTarget.status === 400, `got ${badTarget.status}`);

  const emailSend = await api('POST', '/api/auth/verification/send', { body: { target: vEmail } });
  check('verification send -> 200', emailSend.status === 200, `got ${emailSend.status} ${JSON.stringify(emailSend.body)}`);
  check('verification send reports the email channel', emailSend.body?.channel === 'email', JSON.stringify(emailSend.body?.channel));
  check('verification send returns a 6-digit devCode when no provider is configured',
    /^[0-9]{6}$/.test(String(emailSend.body?.devCode || '')), JSON.stringify(emailSend.body?.devCode));

  const resend = await api('POST', '/api/auth/verification/send', { body: { target: vEmail } });
  check('resending immediately is rate limited -> 429', resend.status === 429, `got ${resend.status}`);

  const wrongCode = await api('POST', '/api/auth/verification/check', { body: { target: vEmail, code: '000000' } });
  check('wrong code -> 400', wrongCode.status === 400, `got ${wrongCode.status}`);
  check('wrong code reports reason=invalid', wrongCode.body?.reason === 'invalid', JSON.stringify(wrongCode.body));

  const shortCode = await api('POST', '/api/auth/verification/check', { body: { target: vEmail, code: '12' } });
  check('malformed code -> 400', shortCode.status === 400, `got ${shortCode.status}`);

  const goodCode = await api('POST', '/api/auth/verification/check', { body: { target: vEmail, code: emailSend.body.devCode } });
  check('correct code -> 200 verified', goodCode.status === 200 && goodCode.body?.verified === true, `got ${goodCode.status}`);
  check('correct code returns a verificationToken', !!goodCode.body?.verificationToken);
  const verificationToken = goodCode.body?.verificationToken;

  const reused = await api('POST', '/api/auth/verification/check', { body: { target: vEmail, code: emailSend.body.devCode } });
  check('a code cannot be used twice -> 400', reused.status === 400, `got ${reused.status}`);

  // Phone OTP with messy formatting should hit the same record.
  const phoneTarget = `+2507${String(uniq).slice(-7)}`;
  const phoneSent = await api('POST', '/api/auth/verification/send', { body: { target: phoneTarget } });
  check('phone OTP send -> 200', phoneSent.status === 200 && phoneSent.body?.channel === 'phone', `got ${phoneSent.status}`);
  const messy = `${phoneTarget.slice(0, 4)} ${phoneTarget.slice(4, 7)} ${phoneTarget.slice(7)}`;
  const phoneCheck = await api('POST', '/api/auth/verification/check', { body: { target: messy, code: phoneSent.body.devCode } });
  check('phone OTP verifies with spaces/dashes in the number', phoneCheck.status === 200, `got ${phoneCheck.status}`);

  const available = await api('POST', '/api/auth/check-identifier', { body: { target: vEmail } });
  check('check-identifier -> 200 available', available.status === 200 && available.body?.available === true, JSON.stringify(available.body));

  const takenIdentifier = await api('POST', '/api/auth/check-identifier', { body: { target: emailA } });
  check('check-identifier detects an existing account', takenIdentifier.body?.available === false, JSON.stringify(takenIdentifier.body));

  const badRegister = await api('POST', '/api/auth/register', {
    body: { displayName: 'Valid Name', identifier: 'definitely-not-valid', password: 'password123' },
  });
  check('register with an invalid identifier -> 400', badRegister.status === 400, `got ${badRegister.status}`);

  const shortName = await api('POST', '/api/auth/register', {
    body: { displayName: 'X', identifier: `short.${uniq}@example.com`, password: 'password123' },
  });
  check('register with a 1-char display name -> 400', shortName.status === 400, `got ${shortName.status}`);

  // ---------------------------------------------------------------- media
  console.log('\n[media]');
  const badUpload = await api('POST', '/api/messages/media', { token: tokenA, body: {} });
  check('POST /api/messages/media with no file -> 400', badUpload.status === 400, `got ${badUpload.status}`);

  // A 1x1 transparent PNG.
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  async function uploadFile(path, field, filename, mime, extraFields = {}) {
    const form = new FormData();
    form.append(field, new Blob([pngBytes], { type: mime }), filename);
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: form,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }

  const media = await uploadFile('/api/messages/media', 'file', 'pixel.png', 'image/png', { type: 'media' });
  check('upload media -> 201', media.status === 201, `got ${media.status} ${JSON.stringify(media.body)}`);
  const mediaUrl = media.body?.file?.url;
  check('upload returns a /uploads/ URL', typeof mediaUrl === 'string' && mediaUrl.startsWith('/uploads/'), String(mediaUrl));

  // Regression: files were written to src/uploads while the static route served
  // server/uploads, so every media URL 404'd.
  const fetched = await fetch(`${BASE}${mediaUrl}`);
  check('uploaded media is actually downloadable', fetched.status === 200, `GET ${mediaUrl} -> ${fetched.status}`);
  await fetched.arrayBuffer();

  const rejected = await uploadFile('/api/messages/media', 'file', 'evil.exe', 'application/x-msdownload');
  check('rejects a disallowed file type -> 400', rejected.status === 400, `got ${rejected.status}`);

  const avatar = await uploadFile(`/api/users/${idA}/avatar`, 'avatar', 'me.png', 'image/png', { type: 'avatar' });
  check('upload avatar -> 200', avatar.status === 200, `got ${avatar.status} ${JSON.stringify(avatar.body)}`);
  check('avatar URL persisted on the user', typeof avatar.body?.user?.avatarUrl === 'string' && avatar.body.user.avatarUrl.startsWith('/uploads/avatars/'), JSON.stringify(avatar.body?.user?.avatarUrl));

  const avatarFetch = await fetch(`${BASE}${avatar.body?.user?.avatarUrl}`);
  check('uploaded avatar is downloadable', avatarFetch.status === 200, `-> ${avatarFetch.status}`);
  await avatarFetch.arrayBuffer();

  const avatarOther = await uploadFile(`/api/users/${idB}/avatar`, 'avatar', 'me.png', 'image/png');
  check('cannot set someone else\'s avatar -> 403', avatarOther.status === 403, `got ${avatarOther.status}`);

  // ------------------------------------------------------------------ end
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  console.log('');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E harness crashed:', err);
  process.exit(2);
});
