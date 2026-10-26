/**
 * Unit test for server/src/support/reportTelegram.js (Chunk 1A Telegram reports).
 *
 * No network and no database: global.fetch is stubbed, the PlatformSettings
 * singleton read is stubbed and the AdminInbox model methods are stubbed. The
 * fake bot token/chat id below are test values only and are never printed.
 *
 *   node server/test/unit/reportTelegram.test.js
 */
const platformSettings = require('../../src/utils/platformSettings');
const chatgram = require('../../src/ai/chatgram');
const telegramBot = require('../../src/support/telegramBot');
const reportTelegram = require('../../src/support/reportTelegram');

const FAKE_TOKEN = 'unit-test-bot-token-not-real';
const FAKE_CHAT_ID = '999000111';
const INBOX_HINT = 'Inbox: ';

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${String(detail).slice(0, 200)}` : ''}`);
  }
}

function jsonResponse(status, payload) {
  const text = JSON.stringify(payload);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

// ------------------------------------------------------------------- stubs

const originalFetch = global.fetch;
const originalGet = platformSettings.get;
const originalFindOne = chatgram.AdminInbox.findOne;
const originalUpdateOne = chatgram.AdminInbox.updateOne;
const originalEnv = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  aiReportTelegram: process.env.AI_REPORT_TELEGRAM,
  clientUrl: process.env.CLIENT_URL,
};

let responder = async () => jsonResponse(200, { ok: true, result: { message_id: 1 } });
const calls = [];
global.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ url: String(url), body, method: options.method });
  return responder(String(url), body);
};
process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
process.env.TELEGRAM_CHAT_ID = FAKE_CHAT_ID;
process.env.CLIENT_URL = 'https://chatgram.test';

let findOneResult = null;
let findOneQuery = null;
let findOneThrows = false;
let savedCount = 0;
const updateOneCalls = [];
chatgram.AdminInbox.findOne = async (query) => {
  findOneQuery = query;
  if (findOneThrows) throw new Error('db down');
  return findOneResult;
};
chatgram.AdminInbox.updateOne = async (filter, update) => {
  updateOneCalls.push({ filter, update });
  return { acknowledged: true };
};

function sampleRecord(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    type: 'bug_report',
    ref: 'RPT-UNIT',
    title: 'Calls drop after ten seconds',
    summary:
      'When I call my friend the call ends after ten seconds. It happens every time on Wi-Fi. This blocks my work calls. Please fix it soon.',
    source: 'Group: JIPSE',
    askerName: 'Mugisha',
    count: 1,
    fixPrompt: 'SECRET_FIX_PROMPT_SLICE_MUST_NOT_BE_SENT',
    userText: 'SECRET_USER_WORDS_MUST_NOT_BE_SENT',
    ...overrides,
  };
}

(async () => {
  console.log('\nreportTelegram\n');

  /* ------------------------------------------------------------ isEnabled */

  platformSettings.get = async () => ({ reportTelegramEnabled: true });
  process.env.AI_REPORT_TELEGRAM = 'false';
  check('AI_REPORT_TELEGRAM=false forces reports off even when the setting is ON', (await reportTelegram.isEnabled()) === false);

  delete process.env.AI_REPORT_TELEGRAM;
  check('admin setting ON (default) enables reports', (await reportTelegram.isEnabled()) === true);

  platformSettings.get = async () => ({ reportTelegramEnabled: false });
  check('admin setting OFF disables reports', (await reportTelegram.isEnabled()) === false);

  platformSettings.get = async () => {
    throw new Error('database unavailable');
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  const fallback = await reportTelegram.isEnabled();
  console.warn = originalWarn;
  check('a settings read failure defaults to ON and never throws', fallback === true);
  check('the settings read failure log carries no bot token or chat id', !warnings.join(' ').includes(FAKE_TOKEN) && !warnings.join(' ').includes(FAKE_CHAT_ID));

  /* ----------------------------------------------------------- sendReport */

  platformSettings.get = async () => ({ reportTelegramEnabled: true });
  calls.length = 0;
  updateOneCalls.length = 0;
  responder = async () => jsonResponse(200, { ok: true, result: { message_id: 4242 } });
  const record = sampleRecord();
  const sent = await reportTelegram.sendReport(record);
  const sentText = calls[0]?.body?.text || '';
  check('sendReport succeeds with the Telegram message id', sent.ok === true && sent.messageId === 4242, sent);
  check('sendReport calls sendMessage once with the configured chat', calls.length === 1 && /\/sendMessage$/.test(calls[0].url), calls.length);
  check('the report message has the type emoji, type and reference', sentText.includes('🐞') && sentText.includes('Bug report') && sentText.includes('RPT-UNIT'), null);
  check('the report message has the title, short summary and where/asker', sentText.includes('Title: Calls drop after ten seconds') && sentText.includes('Where: Group: JIPSE') && sentText.includes('Asked by: Mugisha'), null);
  check('the report message links to the admin Inbox', sentText.includes(`${INBOX_HINT}https://chatgram.test/web/admin/inbox`), null);
  check('the report message NEVER slices the fix prompt or user words into Telegram', !sentText.includes('SECRET_FIX_PROMPT') && !sentText.includes('SECRET_USER_WORDS'), null);
  check('the summary is 2-3 whole sentences, not the full text', sentText.includes('It happens every time on Wi-Fi.') && !sentText.includes('Please fix it soon.'), null);
  check('the Telegram message id is stored on the AdminInbox record', record.telegramMessageId === 4242 && updateOneCalls.some((row) => row.update?.$set?.telegramMessageId === 4242), updateOneCalls);
  check('the stored message id points at the right record', updateOneCalls[0]?.filter?._id === record._id, updateOneCalls[0]?.filter);

  // A long single paragraph must not be cut in the middle of a word/sentence.
  calls.length = 0;
  responder = async () => jsonResponse(200, { ok: true, result: { message_id: 4243 } });
  const longRecord = sampleRecord({
    summary:
      'The app freezes whenever I open the group call screen and then the whole phone becomes unresponsive for several minutes before it recovers by itself without any error message shown to me at all, which means I lose the call and have to restart the application from scratch every single time this happens on my phone today',
  });
  const longSent = await reportTelegram.sendReport(longRecord);
  const longText = calls[0]?.body?.text || '';
  const summaryLine = longText.split('\n').find((line) => line.startsWith('The app freezes')) || '';
  check('a long single-sentence summary is shortened at a boundary with an ellipsis', longSent.ok === true && summaryLine.endsWith('…'), summaryLine.slice(0, 80));
  check('a shortened summary never ends in the middle of a word', !/ [a-z]{1,3}…$/.test(summaryLine), summaryLine.slice(-40));

  platformSettings.get = async () => ({ reportTelegramEnabled: false });
  calls.length = 0;
  const disabled = await reportTelegram.sendReport(sampleRecord());
  check('sendReport is skipped (not failed) when the admin setting is OFF', disabled.ok === false && disabled.skipped === true && calls.length === 0, disabled);

  platformSettings.get = async () => ({ reportTelegramEnabled: true });
  calls.length = 0;
  responder = async () => jsonResponse(500, { ok: false, description: 'Bad Request: chat not found' });
  const failed = await reportTelegram.sendReport(sampleRecord());
  check('a rejected send returns ok:false and never throws', failed.ok === false && Boolean(failed.error), failed);
  check('the failure text carries no bot token', !String(failed.error).includes(FAKE_TOKEN), null);

  /* --------------------------------------------------------------- sendTest */

  const savedToken = process.env.TELEGRAM_BOT_TOKEN;
  const savedChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  calls.length = 0;
  const unconfigured = await reportTelegram.sendTest();
  check('sendTest without env returns a clear TELEGRAM_NOT_CONFIGURED error and no network call', unconfigured.ok === false && unconfigured.code === 'TELEGRAM_NOT_CONFIGURED' && /not configured/i.test(unconfigured.error) && calls.length === 0, unconfigured);
  check('the unconfigured error carries no secrets', !String(unconfigured.error).includes(FAKE_TOKEN), null);

  process.env.TELEGRAM_BOT_TOKEN = savedToken;
  process.env.TELEGRAM_CHAT_ID = savedChat;
  calls.length = 0;
  responder = async () => jsonResponse(200, { ok: true, result: { message_id: 77 } });
  const tested = await reportTelegram.sendTest();
  check('sendTest sends a short Chatgram test message', tested.ok === true && /Chatgram test/.test(calls[0]?.body?.text || '') && calls[0]?.body?.text?.length < 400, tested);
  check('the test message mentions the bot is working', /working/i.test(calls[0]?.body?.text || ''), null);

  /* --------------------------------------------------- saveReplyFromUpdate */

  const reportDoc = {
    _id: '507f1f77bcf86cd799439012',
    ref: 'RPT-UNIT',
    status: 'new',
    telegramReply: null,
    save: async () => {
      savedCount += 1;
    },
  };
  findOneResult = reportDoc;
  findOneQuery = null;
  findOneThrows = false;
  savedCount = 0;
  const update = {
    update_id: 10,
    message: {
      message_id: 501,
      chat: { id: Number(FAKE_CHAT_ID) },
      text: 'We are on it, thanks.',
      reply_to_message: { message_id: 4242 },
    },
  };
  const reply = await reportTelegram.saveReplyFromUpdate(update);
  check('a Telegram reply is matched by reply_to_message.message_id', reply.ok === true && findOneQuery?.telegramMessageId === 4242 && reply.reportId === reportDoc._id, { reply, findOneQuery });
  check('the reply is stored on the report as telegramReply {text, at, sentToUser:false}', reportDoc.telegramReply?.text === 'We are on it, thanks.' && reportDoc.telegramReply?.at instanceof Date && reportDoc.telegramReply?.sentToUser === false, reportDoc.telegramReply);
  check('the report status stays new (a draft, not a fake answer)', reportDoc.status === 'new' && savedCount === 1, { status: reportDoc.status, savedCount });

  findOneQuery = null;
  const otherChat = await reportTelegram.saveReplyFromUpdate({
    update_id: 11,
    message: { message_id: 502, chat: { id: 123 }, text: 'not the owner', reply_to_message: { message_id: 4242 } },
  });
  check('a reply from another chat is ignored', otherChat.skipped === true && findOneQuery === null, otherChat);

  const nonReply = await reportTelegram.saveReplyFromUpdate({ update_id: 12, message: { message_id: 503, chat: { id: Number(FAKE_CHAT_ID) }, text: 'hello' } });
  check('a message that is not a reply is ignored', nonReply.skipped === true, nonReply);

  findOneResult = null;
  const unknown = await reportTelegram.saveReplyFromUpdate({
    update_id: 13,
    message: { message_id: 504, chat: { id: Number(FAKE_CHAT_ID) }, text: 'reply to something unknown', reply_to_message: { message_id: 999 } },
  });
  check('a reply to an unknown/unrelated message is ignored silently', unknown.skipped === true && !unknown.error, unknown);

  findOneThrows = true;
  const thrown = await reportTelegram.saveReplyFromUpdate(update);
  check('a database error while saving the reply never throws', thrown.ok === false && Boolean(thrown.error), thrown);
  findOneThrows = false;

  /* ------------------------------------------ startPolling (409 webhook) */

  platformSettings.get = async () => ({ reportTelegramEnabled: true });
  calls.length = 0;
  responder = async () => jsonResponse(409, { ok: false, description: "Conflict: can't use getUpdates method while webhook is active" });
  const pollWarnings = [];
  const warnBeforePoll = console.warn;
  console.warn = (...args) => pollWarnings.push(args.join(' '));
  await reportTelegram.startPolling();
  console.warn = warnBeforePoll;
  check('a 409 webhook conflict disables polling with exactly one getUpdates call', calls.length === 1 && /getUpdates$/.test(calls[0].url), calls.length);
  const pollWarningsSeen = pollWarnings.join(' | ');
  check('the 409 log is one short line and mentions the webhook', pollWarnings.length === 1 && /webhook/i.test(pollWarningsSeen), pollWarnings);
  check('the 409 log carries no bot token or chat id', !pollWarningsSeen.includes(FAKE_TOKEN) && !pollWarningsSeen.includes(FAKE_CHAT_ID), null);
  await reportTelegram.startPolling();
  check('polling never starts twice', calls.length === 1, calls.length);

  /* ------------------- webhook forwarding (production two-way path) */

  // When the bot is webhook-driven, getUpdates returns 409 (see above), so the
  // support webhook must forward report replies to the same report mapper.
  const originalSaveReply = reportTelegram.saveReplyFromUpdate;
  const forwarded = [];
  reportTelegram.saveReplyFromUpdate = async (incoming) => {
    forwarded.push(incoming);
    return { ok: true };
  };
  const fakeRes = {
    statusCode: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  await telegramBot.webhookHandler(
    {
      body: {
        update_id: 20,
        message: {
          message_id: 601,
          chat: { id: Number(FAKE_CHAT_ID) },
          text: 'We fixed this in the next update.',
          reply_to_message: { message_id: 4242 },
        },
      },
      params: {},
      headers: {},
      ip: '127.0.0.1',
    },
    fakeRes,
  );
  reportTelegram.saveReplyFromUpdate = originalSaveReply;
  check('the Telegram webhook answers with 200 before processing', fakeRes.statusCode === 200, fakeRes.statusCode);
  check(
    'the Telegram webhook forwards a report reply to the report mapper',
    forwarded.length === 1 && forwarded[0]?.message?.reply_to_message?.message_id === 4242,
    forwarded.length,
  );

  // A normal (non-report) update must still run the existing support command path.
  const commandSeen = [];
  reportTelegram.saveReplyFromUpdate = async (incoming) => {
    commandSeen.push(incoming);
    return { ok: false, skipped: true };
  };
  calls.length = 0;
  responder = async () => jsonResponse(200, { ok: true, result: { message_id: 9002 } });
  const commandRes = {
    statusCode: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };
  await telegramBot.webhookHandler(
    {
      body: { update_id: 21, message: { message_id: 602, chat: { id: Number(FAKE_CHAT_ID) }, text: '/help' } },
      params: {},
      headers: {},
      ip: '127.0.0.1',
    },
    commandRes,
  );
  reportTelegram.saveReplyFromUpdate = originalSaveReply;
  check(
    'the support command path still works when the update is not a report reply',
    commandRes.statusCode === 200 && commandSeen.length === 1 && calls.length === 1 && /Chatgram Support commands/.test(calls[0]?.body?.text || ''),
    { forwarded: commandSeen.length, sends: calls.length },
  );

  /* ---------------------------------------------------------------- finish */

  global.fetch = originalFetch;
  platformSettings.get = originalGet;
  chatgram.AdminInbox.findOne = originalFindOne;
  chatgram.AdminInbox.updateOne = originalUpdateOne;
  if (originalEnv.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalEnv.token;
  if (originalEnv.chatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = originalEnv.chatId;
  if (originalEnv.aiReportTelegram === undefined) delete process.env.AI_REPORT_TELEGRAM;
  else process.env.AI_REPORT_TELEGRAM = originalEnv.aiReportTelegram;
  if (originalEnv.clientUrl === undefined) delete process.env.CLIENT_URL;
  else process.env.CLIENT_URL = originalEnv.clientUrl;

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
})().catch((error) => {
  console.error('reportTelegram test crashed:', error);
  process.exit(1);
});
