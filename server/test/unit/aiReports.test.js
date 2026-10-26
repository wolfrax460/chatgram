/**
 * Server-executed AI reports (1A) + the fix-prompt generator + Telegram format —
 * unit assertions.
 *
 * No network: the second AI call is stubbed, and the Telegram module is stubbed
 * through its exported functions. The DB part uses the local staging database and
 * deletes only the rows it creates.
 */
const mongoose = require('mongoose');
const reports = require('../../src/ai/reports');
const fixPrompt = require('../../src/ai/fixPrompt');
const reportTelegram = require('../../src/support/reportTelegram');

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${String(detail).slice(0, 240)}` : ''}`);
  }
}

function sampleText(directive) {
  return `Here is a short answer.\n\n[[CHATGRAM_REPORT]]\n${directive}\n[[/CHATGRAM_REPORT]]`;
}

function occurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  const text = String(haystack || '');
  while (true) {
    const found = text.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

const SECTION_NAMES = [
  'Goal:',
  'Context:',
  'Observed behaviour',
  'Expected behaviour:',
  'Steps to reproduce:',
  'Likely files or modules',
  'Acceptance criteria:',
  'Constraints:',
];

const USER_WORDS = 'When I call my friend in the group it ends after 10 seconds.';

const CALL_REPORT = {
  type: 'bug_report',
  title: 'Calls drop after 10 seconds',
  summary: 'A group call ends by itself after about 10 seconds.',
  userText: USER_WORDS,
  source: 'Group: JIPSE',
  ref: 'RPT-TEST',
  askerName: 'Unit Tester',
};

const STATUS_REPORT = {
  type: 'bug_report',
  title: 'Status photo is cropped on the sides',
  summary: 'A photo status is cropped instead of fitted.',
  userText: 'my photo status is cropped on the sides when i post it',
  source: 'AI chat',
  ref: 'RPT-STAT',
  askerName: 'Unit Tester',
};

const AI_ANSWER = JSON.stringify({
  goal: 'Make group calls stay connected for their full duration',
  featureArea: 'Calls',
  observed: 'The call disconnects by itself a few seconds after it connects.',
  expected: 'A group call stays connected until a participant hangs up or declines.',
  steps: [
    'Sign in on two browsers with two test accounts that share a group.',
    'Start a group call from the group chat and wait 15 seconds.',
    'Watch both call overlays and the server log; they must still show connected.',
  ],
  likelyFiles: ['apps/web/src/components/CallOverlay.tsx', 'server/src/controllers/callController.js'],
  acceptanceCriteria: [
    'A group call stays connected past the 15-second mark and both sides still hear each other.',
    'The existing call test is extended with this case and passes.',
  ],
  needsClarification: [],
  confidence: 0.82,
});

async function main() {
  console.log('\nAI reports\n');

  /* --------------------------------------------------------------- parsing */
  const directive = reports.parseReportDirective(
    sampleText(JSON.stringify({ type: 'bug_report', title: 'Calls drop', summary: 'Calls end after 10 seconds.', includeConversation: false })),
  );
  check('report directive parses', directive && directive.type === 'bug_report' && directive.title === 'Calls drop', directive);
  check('hidden block is removed from visible text', !reports.stripReportDirective(sampleText('{}')).includes('CHATGRAM_REPORT'));
  check('invalid json is ignored', reports.parseReportDirective('[[CHATGRAM_REPORT]]not json[[/CHATGRAM_REPORT]]') === null);
  check('unknown type falls back to support_request', reports.parseReportDirective('[[CHATGRAM_REPORT]]{"type":"nonsense","title":"x","summary":"y"}[[/CHATGRAM_REPORT]]').type === 'support_request');
  check('action claims are detected', reports.claimsAction("I've forwarded your request to the development team."));
  check('action claims are stripped', !/forwarded|sent|notified/i.test(reports.stripActionClaims("Okay. I've forwarded your request to the development team. Anything else?")));
  check('multiple duplicate mentions are collapsed', reports.stripDuplicatePrefix('@Mugisha, @Mugisha, hello', 'Mugisha Ishaq') === 'hello');
  check('single own mention is removed', reports.stripDuplicatePrefix('@Janvier, here is the answer', 'Janvier Yedid') === 'here is the answer');
  check("other people's mention is kept", reports.stripDuplicatePrefix('@Mukamana, hi', 'Janvier Yedid') === '@Mukamana, hi');

  /* --------------------------------------- fix-prompt generator (AI second call) */
  let aiCalls = 0;
  const aiCallOptions = [];
  const aiStub = async (options) => {
    aiCalls += 1;
    aiCallOptions.push(options);
    return { text: `\`\`\`json\n${AI_ANSWER}\n\`\`\`` };
  };
  const aiGenerated = await fixPrompt.generateFixPrompt(CALL_REPORT, { chat: aiStub });
  check('the generator makes exactly one admin-side AI call', aiCalls === 1, aiCalls);
  check(
    'the admin call uses the configured chatgramAI route and the internal toggle override only',
    aiCallOptions[0]?.feature === 'chatgramAI' && aiCallOptions[0]?.ignoreLegacyToggle === true,
    { feature: aiCallOptions[0]?.feature, ignoreLegacyToggle: aiCallOptions[0]?.ignoreLegacyToggle },
  );
  check('AI-generated prompt is marked fixPromptSource=ai', aiGenerated.source === 'ai', aiGenerated.source);
  check(
    'the generated prompt has every required section',
    SECTION_NAMES.every((section) => aiGenerated.text.includes(section)),
    SECTION_NAMES.filter((section) => !aiGenerated.text.includes(section)),
  );
  check('the generated prompt keeps the AI feature area', aiGenerated.text.includes('Part of Chatgram: Calls'));
  check(
    'the generated prompt quotes the reporter once',
    occurrences(aiGenerated.text, USER_WORDS) === 1,
    occurrences(aiGenerated.text, USER_WORDS),
  );
  check('the generated prompt has checkable acceptance criteria', /- \[ \] .+/.test(aiGenerated.text));
  check(
    'likely modules are real repo paths and cite the docs',
    /apps\/web\/src\/components\/CallOverlay\.tsx/.test(aiGenerated.text) &&
      /From docs\/progress\.md|From docs\/decisions\.md|docs\/progress\.md and docs\/decisions\.md/.test(aiGenerated.text),
  );
  check(
    'constraints cover token rules, tests, secrets and the deploy procedure',
    /Token budget/.test(aiGenerated.text) &&
      /No new Playwright suites/.test(aiGenerated.text) &&
      /secret/i.test(aiGenerated.text) &&
      /docs\/deploy\.md/.test(aiGenerated.text) &&
      /backup/i.test(aiGenerated.text) &&
      /health gate/i.test(aiGenerated.text) &&
      /rollback/i.test(aiGenerated.text),
  );
  check(
    'the old generic filler is gone',
    !/Open Chatgram and reproduce the reported flow/i.test(aiGenerated.text) &&
      !/The reported behaviour no longer occurs/i.test(aiGenerated.text),
  );
  check('the generated prompt never contains secret env names', !/TELEGRAM_BOT_TOKEN|MONGODB_URI|GOOGLE_CLIENT_SECRET/.test(aiGenerated.text));

  // An AI answer that copies the reporter's words must be scrubbed everywhere
  // except the single quote in Observed.
  const echoingAnswer = JSON.stringify({
    goal: `Fix: ${USER_WORDS}`,
    featureArea: 'Calls',
    observed: USER_WORDS,
    expected: `After the fix: ${USER_WORDS}`,
    steps: [`Reproduce: ${USER_WORDS}`, 'Check the call overlay stays connected.'],
    likelyFiles: ['apps/web/src/components/CallOverlay.tsx'],
    acceptanceCriteria: [`${USER_WORDS} no longer happens.`],
    needsClarification: [],
    confidence: 0.5,
  });
  const echoed = await fixPrompt.generateFixPrompt(CALL_REPORT, { chat: async () => ({ text: echoingAnswer }) });
  check(
    'the reporter’s exact words appear only once even when the AI echoes them',
    occurrences(echoed.text, USER_WORDS) === 1,
    occurrences(echoed.text, USER_WORDS),
  );
  check('echoed copies are replaced by a reference to the quote', echoed.text.includes('the reporter’s words above'));

  /* ---------------------------------- fallback: invalid JSON / provider failure */
  const invalidJson = await fixPrompt.generateFixPrompt(CALL_REPORT, { chat: async () => ({ text: 'Sorry, I cannot do that right now.' }) });
  check('invalid provider JSON falls back to the deterministic template', invalidJson.source === 'template', invalidJson.source);
  check(
    'the template fallback still has all required sections',
    SECTION_NAMES.every((section) => invalidJson.text.includes(section)),
    SECTION_NAMES.filter((section) => !invalidJson.text.includes(section)),
  );
  check('the template fallback quotes the reporter once', occurrences(invalidJson.text, USER_WORDS) === 1);

  let threw = false;
  let afterThrow = null;
  try {
    afterThrow = await fixPrompt.generateFixPrompt(CALL_REPORT, {
      chat: async () => {
        throw new Error('429 primary provider rate limited');
      },
    });
  } catch {
    threw = true;
  }
  check('a throwing provider never throws out of the generator', threw === false);
  check('a throwing provider falls back to the template', afterThrow && afterThrow.source === 'template' && /Goal:/.test(afterThrow.text));

  // A provider that never answers must time out and fall back, not hang the report.
  const previousTimeout = process.env.AI_FIX_PROMPT_TIMEOUT_MS;
  process.env.AI_FIX_PROMPT_TIMEOUT_MS = '300';
  const timedOut = await fixPrompt.generateFixPrompt(CALL_REPORT, { chat: () => new Promise(() => {}) });
  if (previousTimeout === undefined) delete process.env.AI_FIX_PROMPT_TIMEOUT_MS;
  else process.env.AI_FIX_PROMPT_TIMEOUT_MS = previousTimeout;
  check('a provider timeout falls back to the template instead of hanging', timedOut.source === 'template' && /Goal:/.test(timedOut.text));

  // Provider JSON without any usable core fields is invalid, not invented.
  const emptyAi = await fixPrompt.generateFixPrompt(CALL_REPORT, { chat: async () => ({ text: '{"foo":"bar"}' }) });
  check('provider JSON with no usable fields is rejected', emptyAi.source === 'template');

  /* ------------------------------------------------------- vague vs specific */
  const vagueReport = { type: 'bug_report', title: 'broken', summary: "it's broken", userText: "it's broken", source: 'AI chat', ref: 'RPT-VAG' };
  check('a vague report is detected as vague', fixPrompt.isVagueReport(vagueReport) === true);
  check('a concrete report is not vague', fixPrompt.isVagueReport(CALL_REPORT) === false);
  const vaguePrompt = await fixPrompt.generateFixPrompt(vagueReport, { forceTemplate: true });
  check('a vague report gets a Needs clarification section', /Needs clarification/.test(vaguePrompt.text));
  check('the clarification asks for the missing details', /screen or feature|tap, type|expect to see/i.test(vaguePrompt.text));
  check('a vague report does not invent steps or behaviour', !/previously worked|after the update|version \d/i.test(vaguePrompt.text));

  /* ------------------------------- template fallback is report-specific, not generic */
  const callTemplate = fixPrompt.buildTemplatePrompt(CALL_REPORT);
  const statusTemplate = fixPrompt.buildTemplatePrompt(STATUS_REPORT);
  check('the calls template names the calls area and a calls module', /Calls and screen sharing/.test(callTemplate) && /CallOverlay\.tsx/.test(callTemplate));
  check('the status template names the status area and a status module', /Status \(photo, video and voice statuses\)/.test(statusTemplate) && /Status\.tsx|StatusComposer/.test(statusTemplate));
  check('two different reports get different templates', callTemplate !== statusTemplate);
  check(
    'the template fillers are report-specific, not the old generic text',
    !/Open Chatgram and reproduce the reported flow/i.test(callTemplate) &&
      !/The reported behaviour no longer occurs/i.test(callTemplate),
  );
  check(
    'the template steps are numbered and feature-specific',
    /Steps to reproduce:\n1\. Sign in on two browsers/.test(callTemplate) && /group call/i.test(callTemplate),
  );
  check('the template ends with the deploy/rollback constraints', /docs\/deploy\.md/.test(callTemplate) && /rollback/i.test(callTemplate));

  /* ------------------------------------------------------ generator never throws */
  const garbageInputs = [null, undefined, {}, { type: 'bug_report' }, { title: null, userText: null, summary: null }, { userText: 12345, transcript: { weird: true } }];
  let garbageThrew = false;
  for (const input of garbageInputs) {
    try {
      const result = await fixPrompt.generateFixPrompt(input);
      if (!result || typeof result.text !== 'string' || !result.text.trim()) garbageThrew = true;
    } catch {
      garbageThrew = true;
    }
  }
  check('the generator never throws and always returns a prompt', garbageThrew === false);
  check('the synchronous buildFixPrompt never throws either', typeof reports.buildFixPrompt({}) === 'string' && /Goal:/.test(reports.buildFixPrompt({})));
  check('the template fallback never leaks the previous filler', !/Open Chatgram and reproduce/i.test(reports.buildFixPrompt(CALL_REPORT)));

  /* ------------------------------------------------- Telegram message shape (short, no prompt) */
  const promptMarker = 'FIXPROMPT_MARKER_SHOULD_NEVER_BE_IN_TELEGRAM';
  const telegramRecord = {
    type: 'bug_report',
    ref: 'RPT-TELE',
    title: 'Calls drop after 10 seconds',
    summary: 'The group call ends by itself. The other person disappears from the call. We tried twice.',
    source: 'Group: JIPSE',
    askerName: 'Unit Tester',
    count: 2,
    fixPrompt: promptMarker.repeat(100),
    transcript: 'TRANSCRIPT_MARKER_SHOULD_NEVER_BE_IN_TELEGRAM',
  };
  const telegramText = reportTelegram.formatReportMessage(telegramRecord);
  check('the Telegram message is short (under 700 chars)', telegramText.length <= 700, telegramText.length);
  check(
    'the Telegram message has type emoji, reference, title, where, asker and the Inbox link',
    /🐞 Bug report/.test(telegramText) &&
      telegramText.includes('RPT-TELE') &&
      /Title: Calls drop after 10 seconds/.test(telegramText) &&
      /Where: Group: JIPSE/.test(telegramText) &&
      /Asked by: Unit Tester/.test(telegramText) &&
      /Inbox: https?:\/\//.test(telegramText),
  );
  check('the Telegram message never carries the fix prompt', !telegramText.includes(promptMarker));
  check('the Telegram message never carries the transcript', !telegramText.includes('TRANSCRIPT_MARKER'));
  check('the Telegram summary is 2-3 whole sentences, not a mid-sentence cut', /The group call ends by itself\. The other person disappears from the call\./.test(telegramText));
  const longSummaryText = reportTelegram.formatReportMessage({
    type: 'feature_request',
    ref: 'RPT-LONG',
    title: 'Long summary',
    summary: 'word '.repeat(400),
    source: 'AI chat',
    askerName: 'Tester',
  });
  check(
    'a long unpunctuated summary is shortened at a word boundary (never mid-word)',
    longSummaryText.length <= 700 && !/\bwor$/.test(longSummaryText) && /(?:…|\bword\b)/.test(longSummaryText),
    longSummaryText.length,
  );
  let formatThrew = false;
  try {
    reportTelegram.formatReportMessage({});
    reportTelegram.formatReportMessage();
  } catch {
    formatThrew = true;
  }
  check('the Telegram formatter never throws on an empty record', formatThrew === false);

  // notifyReport: exactly one call, boolean return, honest on failure/skip.
  const originalSendReport = reportTelegram.sendReport;
  const originalIsEnabled = reportTelegram.isEnabled;
  let sendCalls = 0;
  let sentRecord = null;
  reportTelegram.isEnabled = async () => true;
  reportTelegram.sendReport = async (record) => {
    sendCalls += 1;
    sentRecord = record;
    return { ok: true, messageId: 4321 };
  };
  const notifiedOk = await reports.notifyReport({ ...telegramRecord, _id: new mongoose.Types.ObjectId() });
  check('notifyReport calls the Telegram module exactly once and returns true', sendCalls === 1 && notifiedOk === true, { sendCalls, notifiedOk });
  check('the record handed to Telegram is the full report (the prompt stays in the Inbox)', sentRecord && sentRecord.fixPrompt.includes(promptMarker));

  reportTelegram.sendReport = async () => ({ ok: false, skipped: false, error: 'network down' });
  const notifiedFailed = await reports.notifyReport({ ...telegramRecord, _id: new mongoose.Types.ObjectId() });
  check('notifyReport returns false when the channel fails (never throws)', notifiedFailed === false);
  reportTelegram.sendReport = async () => ({ ok: false, skipped: true });
  check('notifyReport returns false when the channel is intentionally off', (await reports.notifyReport({ ...telegramRecord, _id: new mongoose.Types.ObjectId() })) === false);
  reportTelegram.sendReport = async () => {
    throw new Error('unexpected');
  };
  check('a throwing notifier module is still contained', (await reports.notifyReport({ ...telegramRecord })) === false);
  reportTelegram.sendReport = originalSendReport;
  reportTelegram.isEnabled = originalIsEnabled;

  /* ---------------------------------------------------------------- DB part */
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const { AdminInbox } = require('../../src/ai/chatgram');
  const createdIds = [];
  const title = `Report test ${Date.now().toString(36)}`;
  const first = await reports.createReport({
    type: 'feature_request',
    title,
    summary: 'Please add a dark mode toggle.',
    userText: 'Add dark mode please',
    source: 'Group: test',
    askerName: 'Unit Tester',
    notify: false,
    fixPromptChat: async () => ({ text: AI_ANSWER }),
  });
  if (first.ok) createdIds.push(first.record._id);
  check('report record is created with a reference', first.ok && /^RPT-[A-Z0-9]{4}$/.test(first.ref), first.ref);
  check('the record stores that the prompt came from the AI call', first.record.fixPromptSource === 'ai', first.record.fixPromptSource);
  const dbFirst = await AdminInbox.collection.findOne({ _id: first.record._id });
  check('fixPromptSource is persisted so the admin API can read it', dbFirst && dbFirst.fixPromptSource === 'ai', dbFirst && dbFirst.fixPromptSource);
  check('a problem report stores a copyable fix prompt', first.record.fixPrompt.includes('Goal:') && first.record.fixPrompt.includes('Acceptance criteria:'));
  check('report stores asker, source and exact words', first.record.askerName === 'Unit Tester' && first.record.source === 'Group: test' && first.record.userText.includes('dark mode'));

  const second = await reports.createReport({
    type: 'feature_request',
    title,
    summary: 'Please add a dark mode toggle.',
    userText: 'Dark mode',
    source: 'Group: test',
    askerName: 'Unit Tester',
    notify: false,
    fixPromptChat: async () => ({ text: AI_ANSWER }),
  });
  check(
    'duplicate reports increment the same record',
    second.ok && second.merged && String(second.record._id) === String(first.record._id) && second.record.count === 2,
    { merged: second.merged, count: second.record?.count },
  );

  // Template fallback persists too: the AI call fails, the record must survive.
  const fallbackTitle = `${title} fallback`;
  const fallback = await reports.createReport({
    type: 'bug_report',
    title: fallbackTitle,
    summary: 'Calls end by themselves.',
    userText: USER_WORDS,
    source: 'Group: test',
    askerName: 'Unit Tester',
    notify: false,
    fixPromptChat: async () => {
      throw new Error('provider down');
    },
  });
  if (fallback.ok) createdIds.push(fallback.record._id);
  check('a failed fix-prompt AI call still creates the report', fallback.ok === true && Boolean(fallback.record.ref));
  check('the fallback prompt is marked template and is report-specific', fallback.record.fixPromptSource === 'template' && /Calls and screen sharing/.test(fallback.record.fixPrompt));

  // Unknown question: the asker's thread is stored, redacted.
  const threadTitle = `${title} unknown`;
  const unknown = await reports.createReport({
    type: 'unknown_question',
    title: threadTitle,
    summary: 'Unknown Chatgram question',
    userText: 'how do i move my chat history to a new phone?',
    source: 'Group: test',
    askerName: 'Unit Tester',
    includeConversation: true,
    transcript: 'User: how do i move my chat history to a new phone? Contact me on 0788123456 or me@example.com\nAI: I could not confirm that from the Chatgram knowledge.',
    notify: false,
  });
  if (unknown.ok) createdIds.push(unknown.record._id);
  check('an unknown question stores the asker thread', unknown.ok && /chat history to a new phone/.test(unknown.record.transcript), unknown.record?.transcript?.slice(0, 80));
  check(
    'the stored transcript is redacted (phone and email)',
    !/0788123456|me@example\.com/.test(unknown.record.transcript) && /redacted-phone|redacted-email/.test(unknown.record.transcript),
    unknown.record?.transcript?.slice(0, 120),
  );
  check('an unknown question does not get a fix prompt', !unknown.record.fixPrompt);

  // Notification failure: the record is kept, the reply must not claim success.
  let failureNotifyCalls = 0;
  reportTelegram.sendReport = async () => {
    failureNotifyCalls += 1;
    return { ok: false, skipped: false, error: 'telegram unreachable' };
  };
  reportTelegram.isEnabled = async () => true;
  const failedNotifyTitle = `${title} notify-fail`;
  const failedNotify = await reports.handleModelReport({
    text: sampleText(JSON.stringify({ type: 'bug_report', title: failedNotifyTitle, summary: 'Calls drop.' })),
    context: {
      userText: 'report this bug',
      source: 'Group: test',
      askerName: 'Unit Tester',
      fixPromptChat: async () => ({ text: AI_ANSWER }),
    },
  });
  reportTelegram.sendReport = originalSendReport;
  reportTelegram.isEnabled = originalIsEnabled;
  if (failedNotify.report?._id) createdIds.push(failedNotify.report._id);
  check('a failed notification still creates the record', failedNotify.created === true && Boolean(failedNotify.ref), failedNotify.ref);
  check(
    'a failed notification is not claimed as sent',
    /RPT-[A-Z0-9]{4}/.test(failedNotify.text) && !/I've sent this to the Chatgram team/i.test(failedNotify.text),
    failedNotify.text,
  );
  check('a failed notification offers the support email fallback', /couldn’t send the alert|email/i.test(failedNotify.text), failedNotify.text);
  check('the notifier was attempted exactly once', failureNotifyCalls === 1, failureNotifyCalls);

  // Successful notification: the honest "sent" wording is used.
  let okNotifyCalls = 0;
  reportTelegram.sendReport = async () => {
    okNotifyCalls += 1;
    return { ok: true, messageId: 99 };
  };
  reportTelegram.isEnabled = async () => true;
  const sentTitle = `${title} notify-ok`;
  const sentReport = await reports.handleModelReport({
    text: sampleText(JSON.stringify({ type: 'bug_report', title: sentTitle, summary: 'Calls drop.' })),
    context: { userText: 'report this bug', source: 'Group: test', askerName: 'Unit Tester', fixPromptChat: async () => ({ text: AI_ANSWER }) },
  });
  reportTelegram.sendReport = originalSendReport;
  reportTelegram.isEnabled = originalIsEnabled;
  if (sentReport.report?._id) createdIds.push(sentReport.report._id);
  check('a delivered notification gets the "sent" confirmation', sentReport.created && /I've sent this to the Chatgram team/i.test(sentReport.text) && okNotifyCalls === 1, { okNotifyCalls });

  // An intentionally-off channel says "recorded", not "sent".
  reportTelegram.sendReport = async () => ({ ok: false, skipped: true });
  reportTelegram.isEnabled = async () => false;
  const offTitle = `${title} notify-off`;
  const offReport = await reports.handleModelReport({
    text: sampleText(JSON.stringify({ type: 'bug_report', title: offTitle, summary: 'Calls drop.' })),
    context: { userText: 'report this bug', source: 'Group: test', askerName: 'Unit Tester', fixPromptChat: async () => ({ text: AI_ANSWER }) },
  });
  reportTelegram.sendReport = originalSendReport;
  reportTelegram.isEnabled = originalIsEnabled;
  if (offReport.report?._id) createdIds.push(offReport.report._id);
  check(
    'an intentionally disabled channel says recorded, never sent',
    offReport.created && /recorded this for the Chatgram team inbox/i.test(offReport.text) && !/I've sent this/i.test(offReport.text),
    offReport.text,
  );

  // An action with no asker still creates and confirms with its reference.
  const noAsker = await reports.handleModelReport({
    text: sampleText(JSON.stringify({ type: 'bug_report', title: `${title} no-asker`, summary: 'x' })),
    context: { userText: 'report this', source: 'unit', askerId: 'not-an-object-id', fixPromptChat: async () => ({ text: AI_ANSWER }) },
  });
  if (noAsker.report?._id) createdIds.push(noAsker.report._id);
  check('an action with no valid asker still creates and confirms', noAsker.created === true && /Reference RPT-/.test(noAsker.text), noAsker.text?.slice(0, 120));

  const noAction = await reports.handleModelReport({ text: "I've forwarded this to the development team.", context: {} });
  check('a claim without an action is rewritten honestly', !/forwarded/i.test(noAction.text) && /can't send that to the Chatgram team|email/i.test(noAction.text), noAction.text);

  const confirmed = await reports.handleModelReport({
    text: sampleText(JSON.stringify({ type: 'bug_report', title: `${title} bug`, summary: 'Calls drop.' })),
    context: { userText: 'report this bug', source: 'Group: test', askerName: 'Unit Tester', fixPromptChat: async () => ({ text: AI_ANSWER }) },
  });
  if (confirmed.report?._id) createdIds.push(confirmed.report._id);
  check('a successful report reply contains its reference', confirmed.created && /Reference RPT-/.test(confirmed.text) && !confirmed.text.includes('CHATGRAM_REPORT'), confirmed.text?.slice(0, 140));
  check('a successful report reply does not keep false forwarding claims', !/forwarded|notified/i.test(confirmed.text));

  if (createdIds.length) await AdminInbox.deleteMany({ _id: { $in: createdIds } });
  await AdminInbox.deleteMany({ title: new RegExp('^' + title) });
  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error('aiReports test crashed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    /* closed */
  }
  process.exit(1);
});
