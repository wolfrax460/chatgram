/**
 * Integration test: message edit / star / forward / report (section 9 basics).
 *
 *   cd server && node test/integration/messageFeatures.test.js
 */
const mongoose = require('mongoose');

const BASE = process.env.BASE_URL || process.env.E2E_API_URL || 'http://127.0.0.1:5000';
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
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

const run = Date.now().toString(36);

async function createUser(label) {
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Msg ${label}`, identifier: `msg-${label}-${run}@chatgram.test`, password: 'MessagePass1!' },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, id: res.body.user.id, displayName: `Msg ${label}` };
}

async function main() {
  console.log(`\nmessage features integration test against ${BASE}\n`);
  // Some chunk-1C assertions create a linked AI reply directly (no provider
  // call, no flakiness); the same connection is reused by the cleanup below.
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
    serverSelectionTimeoutMS: 4000,
  });
  const a = await createUser('alice');
  const b = await createUser('bob');
  const c = await createUser('carol');

  const direct = await api('POST', '/api/chats', { token: a.token, body: { type: 'direct', participantId: b.id } });
  const chatId = direct.body._id;
  const group = await api('POST', '/api/chats', {
    token: a.token,
    body: { type: 'group', groupName: `Forward target ${run}`, participantIds: [c.id] },
  });
  const groupId = group.body._id;
  check('setup: direct chat + group', Boolean(chatId && groupId));

  const sent = await api('POST', '/api/messages', { token: a.token, body: { chatId, type: 'text', content: 'Original text' } });
  check('send message -> 201', sent.status === 201, `got ${sent.status}`);
  const messageId = sent.body._id;

  // ------------------------------------------------------------------ edit
  const edit = await api('PATCH', `/api/messages/${messageId}`, { token: a.token, body: { content: 'Edited text' } });
  check('sender edits own message -> 200', edit.status === 200, `got ${edit.status} ${JSON.stringify(edit.body)}`);
  check('edit returns the new content', edit.body?.content === 'Edited text', JSON.stringify(edit.body));
  check('edit sets editedAt', Boolean(edit.body?.editedAt), JSON.stringify(edit.body?.editedAt));

  const seenByB = await api('GET', `/api/messages?chatId=${chatId}`, { token: b.token });
  const editedRow = (seenByB.body?.messages || []).find((row) => row._id === messageId);
  check('the other participant sees the edited content', editedRow?.content === 'Edited text', editedRow?.content);
  check('the editedAt flag reaches the other participant', Boolean(editedRow?.editedAt));

  const editByB = await api('PATCH', `/api/messages/${messageId}`, { token: b.token, body: { content: 'hijack' } });
  check('somebody else cannot edit -> 403', editByB.status === 403, `got ${editByB.status}`);
  check('edit denial code is NOT_SENDER', editByB.body?.code === 'NOT_SENDER', JSON.stringify(editByB.body));
  const editEmpty = await api('PATCH', `/api/messages/${messageId}`, { token: a.token, body: { content: '   ' } });
  check('editing to empty text -> 400', editEmpty.status === 400, `got ${editEmpty.status}`);
  const outsiderEdit = await api('PATCH', `/api/messages/${messageId}`, { token: c.token, body: { content: 'nope' } });
  check('non-participant cannot edit -> 403', outsiderEdit.status === 403, `got ${outsiderEdit.status}`);

  // ------------------------------------------------------------------ star
  const star = await api('POST', `/api/messages/${messageId}/star`, { token: b.token });
  check('star a message -> 200', star.status === 200 && star.body?.starred === true, JSON.stringify(star.body));
  const listForB = await api('GET', `/api/messages?chatId=${chatId}`, { token: b.token });
  const starRowB = (listForB.body?.messages || []).find((row) => row._id === messageId);
  check('star convenience flag is true for Bob', starRowB?.starred === true, String(starRowB?.starred));
  const listForA = await api('GET', `/api/messages?chatId=${chatId}`, { token: a.token });
  const starRowA = (listForA.body?.messages || []).find((row) => row._id === messageId);
  check('the star is per-user (Alice not starred)', starRowA?.starred === false, String(starRowA?.starred));
  const unstar = await api('DELETE', `/api/messages/${messageId}/star`, { token: b.token });
  check('unstar -> 200', unstar.status === 200 && unstar.body?.starred === false, JSON.stringify(unstar.body));
  const outsiderStar = await api('POST', `/api/messages/${messageId}/star`, { token: c.token });
  check('non-participant cannot star -> 403', outsiderStar.status === 403, `got ${outsiderStar.status}`);

  // --------------------------------------------------------------- forward
  const forward = await api('POST', `/api/messages/${messageId}/forward`, { token: a.token, body: { chatId: groupId } });
  check('forward to my group -> 201', forward.status === 201, `got ${forward.status} ${JSON.stringify(forward.body)}`);
  check('forwarded copy has the text', forward.body?.content === 'Edited text', forward.body?.content);
  check('forwarded copy is a new message', forward.body?._id !== messageId);
  const groupHistory = await api('GET', `/api/messages?chatId=${groupId}`, { token: c.token });
  check('group members see the forwarded message', (groupHistory.body?.messages || []).some((row) => row.content === 'Edited text'));
  const forwardOut = await api('POST', `/api/messages/${messageId}/forward`, {
    token: a.token,
    body: { chatId: new mongoose.Types.ObjectId().toString() },
  });
  check('forwarding to a chat I am not in -> 403/404', [403, 404].includes(forwardOut.status), `got ${forwardOut.status}`);

  // ---------------------------------------------------------------- report
  const report = await api('POST', `/api/messages/${messageId}/report`, { token: b.token, body: { reason: 'spam', details: 'test report' } });
  check('report a message -> 201', report.status === 201, `got ${report.status} ${JSON.stringify(report.body)}`);
  check('report returns an id', typeof report.body?.reportId === 'string');
  const badReasonReport = await api('POST', `/api/messages/${messageId}/report`, { token: b.token, body: { reason: 'nope' } });
  check('unknown reason coerced to other', badReasonReport.body?.reason === 'other', JSON.stringify(badReasonReport.body));
  const selfReport = await api('POST', `/api/messages/${messageId}/report`, { token: a.token, body: { reason: 'spam' } });
  check('cannot report my own message -> 400', selfReport.status === 400, `got ${selfReport.status}`);
  const outsiderReport = await api('POST', `/api/messages/${messageId}/report`, { token: c.token, body: { reason: 'spam' } });
  check('non-participant cannot report -> 403', outsiderReport.status === 403, `got ${outsiderReport.status}`);

  // ------------------------------------------------ chunk 1C: private AI replies
  // A group whose AI answers are "only the person who asked" (the default):
  // the question and every AI reply/notice must be invisible to other members,
  // the asker can share the thread with the group, and 'everyone' mode is
  // unchanged. To stay fast and deterministic the AI reply is inserted directly
  // (no provider call); the question goes through the real REST path, and the
  // "too long" notice is produced by the real mention queue without a provider.
  const privateGroup = await api('POST', '/api/chats', {
    token: a.token,
    body: { type: 'group', groupName: `Private AI ${run}`, participantIds: [b.id, c.id] },
  });
  const privateGroupId = privateGroup.body?._id;
  check('setup: private-AI group', Boolean(privateGroupId));

  const defaultMembers = await api('GET', `/api/chats/${privateGroupId}/participants`, { token: b.token });
  check(
    'default aiReplyVisibility is asker',
    defaultMembers.body?.group?.settings?.aiReplyVisibility === 'asker',
    JSON.stringify(defaultMembers.body?.group?.settings),
  );

  const enablePrivate = await api('PATCH', `/api/chats/${privateGroupId}`, {
    token: a.token,
    body: { groupSettings: { aiMentions: true, aiReplyVisibility: 'asker' } },
  });
  check(
    'admin enables AI mentions + asker-only replies',
    enablePrivate.status === 200 && enablePrivate.body?.groupSettings?.aiReplyVisibility === 'asker',
    `got ${enablePrivate.status} ${JSON.stringify(enablePrivate.body?.groupSettings)}`,
  );

  const persistedMembers = await api('GET', `/api/chats/${privateGroupId}/participants`, { token: b.token });
  check(
    'AI settings persist for members',
    persistedMembers.body?.group?.settings?.aiMentions === true
      && persistedMembers.body?.group?.settings?.aiReplyVisibility === 'asker',
    JSON.stringify(persistedMembers.body?.group?.settings),
  );

  const nonAdminChange = await api('PATCH', `/api/chats/${privateGroupId}`, {
    token: b.token,
    body: { groupSettings: { aiReplyVisibility: 'everyone' } },
  });
  check(
    'non-admin cannot change AI reply visibility -> 403',
    nonAdminChange.status === 403,
    `got ${nonAdminChange.status} ${JSON.stringify(nonAdminChange.body)}`,
  );

  // A too-long mention yields an immediate private notice (never silence, no
  // provider call). Both the question and the notice must stay with the asker.
  const longQuestion = `@chatgramai ${'x'.repeat(2100)}`;
  const privateQuestion = await api('POST', '/api/messages', {
    token: a.token,
    body: { chatId: privateGroupId, type: 'text', content: longQuestion },
  });
  const questionId = privateQuestion.body?._id;
  check(
    'private mention is stored with visibleTo = [asker]',
    privateQuestion.status === 201
      && (privateQuestion.body?.visibleTo || []).some((id) => String(id) === a.id),
    JSON.stringify(privateQuestion.body?.visibleTo),
  );
  check('private mention carries the private flag', privateQuestion.body?.private === true);
  await new Promise((resolve) => setTimeout(resolve, 700)); // async notice

  const hiddenForB = await api('GET', `/api/messages?chatId=${privateGroupId}`, { token: b.token });
  const hiddenMessagesForB = hiddenForB.body?.messages || [];
  check(
    'other member does not get the private question',
    !hiddenMessagesForB.some((row) => row._id === questionId),
    JSON.stringify(hiddenMessagesForB.map((row) => row._id)),
  );
  check(
    'other member does not get the private notice',
    !hiddenMessagesForB.some((row) => /too long, please shorten/i.test(row.content || '')),
    JSON.stringify(hiddenMessagesForB.map((row) => row.content)),
  );
  const visibleForA = await api('GET', `/api/messages?chatId=${privateGroupId}`, { token: a.token });
  check(
    'asker sees the private question',
    (visibleForA.body?.messages || []).some((row) => row._id === questionId),
  );
  check(
    'asker gets a private notice as a reply to the question',
    (visibleForA.body?.messages || []).some(
      (row) => /too long, please shorten/i.test(row.content || '') && row.private === true,
    ),
  );

  // Insert the linked AI reply directly (same DB) so share-with-group can be
  // tested without calling a provider.
  let aiReplyId = null;
  const aiUserId = await require('../../src/utils/aiAccount').ensureAiUser();
  if (aiUserId) {
    const Message = require('../../src/models/Message');
    const Chat = require('../../src/models/Chat');
    const reply = await Message.create({
      chatId: privateGroupId,
      senderId: aiUserId,
      type: 'text',
      content: 'Private answer: 42',
      sentAt: new Date(),
      deliveredTo: [aiUserId],
      readBy: [aiUserId],
      visibleTo: [a.id],
      aiReplyTo: questionId,
    });
    aiReplyId = String(reply._id);
    await Chat.findByIdAndUpdate(privateGroupId, { lastMessage: reply._id, updatedAt: new Date() });

    const replyForB = await api('GET', `/api/messages?chatId=${privateGroupId}`, { token: b.token });
    check(
      'other member does not get the private AI reply',
      !(replyForB.body?.messages || []).some((row) => row._id === aiReplyId),
    );
    const replyForA = await api('GET', `/api/messages?chatId=${privateGroupId}`, { token: a.token });
    const replyRowA = (replyForA.body?.messages || []).find((row) => row._id === aiReplyId);
    check(
      'asker sees the AI reply with the private flag and its question link',
      replyRowA?.private === true && String(replyRowA?.aiReplyTo) === String(questionId),
      JSON.stringify(replyRowA && { private: replyRowA.private, aiReplyTo: replyRowA.aiReplyTo }),
    );

    const chatsForB = await api('GET', '/api/chats', { token: b.token });
    const groupForB = (chatsForB.body || []).find((chat) => chat._id === privateGroupId);
    const previewForB = String(groupForB?.lastMessage?.content || '');
    check(
      'chat-list preview does not leak the hidden question or answer',
      !previewForB.includes('Private answer') && !previewForB.includes('xxxx'),
      previewForB,
    );
    check(
      'private AI messages do not count as unread for other members',
      (groupForB?.unreadCount ?? 0) === 0,
      String(groupForB?.unreadCount),
    );

    const chatByIdForB = await api('GET', `/api/chats/${privateGroupId}`, { token: b.token });
    check(
      'GET chat by id does not leak the hidden last message',
      String(chatByIdForB.body?.lastMessage?.content || '') !== 'Private answer: 42',
      chatByIdForB.body?.lastMessage?.content,
    );
    const chatByIdForA = await api('GET', `/api/chats/${privateGroupId}`, { token: a.token });
    check(
      'the asker keeps the private answer as their last message',
      String(chatByIdForA.body?.lastMessage?.content || '') === 'Private answer: 42',
      chatByIdForA.body?.lastMessage?.content,
    );

    const shareByB = await api('POST', `/api/messages/${aiReplyId}/share-with-group`, { token: b.token });
    check(
      'non-asker cannot share a private AI answer -> 403',
      shareByB.status === 403,
      `got ${shareByB.status} ${JSON.stringify(shareByB.body)}`,
    );

    const shareByA = await api('POST', `/api/messages/${aiReplyId}/share-with-group`, { token: a.token });
    check(
      'asker shares the private thread -> 200 with question + reply',
      shareByA.status === 200
        && Array.isArray(shareByA.body?.sharedIds)
        && shareByA.body.sharedIds.includes(String(questionId))
        && shareByA.body.sharedIds.includes(aiReplyId),
      `got ${shareByA.status} ${JSON.stringify(shareByA.body)}`,
    );

    const afterShareForB = await api('GET', `/api/messages?chatId=${privateGroupId}`, { token: b.token });
    const afterShareRows = afterShareForB.body?.messages || [];
    const sharedQuestion = afterShareRows.find((row) => row._id === questionId);
    const sharedReply = afterShareRows.find((row) => row._id === aiReplyId);
    check(
      'shared question is now visible to the other member',
      Boolean(sharedQuestion) && (sharedQuestion.visibleTo || []).length === 0,
      JSON.stringify(sharedQuestion?.visibleTo),
    );
    check(
      'shared AI reply is now visible to the other member',
      Boolean(sharedReply) && (sharedReply.visibleTo || []).length === 0,
      JSON.stringify(sharedReply?.visibleTo),
    );

    const chatsAfterShare = await api('GET', '/api/chats', { token: b.token });
    const groupAfterShare = (chatsAfterShare.body || []).find((chat) => chat._id === privateGroupId);
    check(
      'share posts a visible system note as the new preview',
      /shared the ai answer with the group/i.test(String(groupAfterShare?.lastMessage?.content || '')),
      groupAfterShare?.lastMessage?.content,
    );

    const shareAgain = await api('POST', `/api/messages/${aiReplyId}/share-with-group`, { token: a.token });
    check('sharing an already public message -> 400', shareAgain.status === 400, `got ${shareAgain.status}`);
  } else {
    check('Chatgram AI account exists for the linked-reply test', false, 'ensureAiUser returned null');
  }

  // ---- 'everyone' mode is unchanged: the question + notice are public ----
  const everyoneMode = await api('PATCH', `/api/chats/${privateGroupId}`, {
    token: a.token,
    body: { groupSettings: { aiReplyVisibility: 'everyone' } },
  });
  check(
    'admin switches to everyone mode',
    everyoneMode.status === 200 && everyoneMode.body?.groupSettings?.aiReplyVisibility === 'everyone',
    `got ${everyoneMode.status} ${JSON.stringify(everyoneMode.body?.groupSettings)}`,
  );

  // A different asker avoids the "one notice per user per minute" cooldown.
  const publicQuestion = await api('POST', '/api/messages', {
    token: b.token,
    body: { chatId: privateGroupId, type: 'text', content: `@chatgramai ${'y'.repeat(2100)}` },
  });
  check(
    'everyone mode: mention has no private allow-list',
    publicQuestion.status === 201 && (publicQuestion.body?.visibleTo || []).length === 0,
    JSON.stringify(publicQuestion.body?.visibleTo),
  );
  await new Promise((resolve) => setTimeout(resolve, 700));
  const publicForA = await api('GET', `/api/messages?chatId=${privateGroupId}`, { token: a.token });
  const publicRows = publicForA.body?.messages || [];
  check(
    'everyone mode: other member sees the question',
    publicRows.some((row) => row._id === publicQuestion.body?._id && (row.visibleTo || []).length === 0),
  );
  check(
    'everyone mode: other member sees the notice',
    publicRows.some((row) => /too long, please shorten/i.test(row.content || '') && (row.visibleTo || []).length === 0),
  );

  // ---------------------------------------------------------------- cleanup
  try {
    const User = require('../../src/models/User');
    const Chat = require('../../src/models/Chat');
    const Message = require('../../src/models/Message');
    const Report = require('../../src/models/Report');
    const GroupAiEvent = require('../../src/models/GroupAiEvent');
    const ids = [a.id, b.id, c.id].map((id) => new mongoose.Types.ObjectId(id));
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    const chatIds = chats.map((chat) => chat._id);
    await Message.deleteMany({ chatId: { $in: chatIds } });
    await GroupAiEvent.deleteMany({ chatId: { $in: chatIds } });
    await Chat.deleteMany({ _id: { $in: chatIds } });
    await Report.deleteMany({ reporterId: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  } catch (error) {
    console.log(`  (cleanup skipped: ${error.message})`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
