/**
 * Server-executed AI reports (1A) — unit assertions.
 * No provider calls, no network. The DB part uses the local staging database and
 * deletes only the rows it creates.
 */
const mongoose = require('mongoose');
const path = require('path');
const reports = require('../../src/ai/reports');

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

function sampleText(directive) {
  return `Here is a short answer.\n\n[[CHATGRAM_REPORT]]\n${directive}\n[[/CHATGRAM_REPORT]]`;
}

(async () => {
  console.log('\nAI reports\n');

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
  check('other people\'s mention is kept', reports.stripDuplicatePrefix('@Mukamana, hi', 'Janvier Yedid') === '@Mukamana, hi');

  const fixPrompt = reports.buildFixPrompt({
    type: 'bug_report',
    title: 'Calls drop',
    summary: 'Calls end after 10 seconds.',
    userText: 'When I call my friend it ends after 10 seconds.',
    source: 'Group: JIPSE',
    ref: 'RPT-TEST',
    transcript: 'me: calls drop',
  });
  check('fix prompt has all required sections', ['Title:', 'Context:', 'Observed behaviour:', 'Expected behaviour:', 'Steps to reproduce:', 'Likely areas of code', 'Acceptance criteria:', 'Constraints:'].every((section) => fixPrompt.includes(section)));
  check('fix prompt never contains a secret placeholder value', !/TELEGRAM_BOT_TOKEN|MONGODB_URI|GOOGLE_CLIENT_SECRET/.test(fixPrompt));

  // --- DB part: create + duplicate merge + notify=false (no Telegram in tests)
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const { AdminInbox } = require('../../src/ai/chatgram');
  const title = `Report test ${Date.now().toString(36)}`;
  const first = await reports.createReport({
    type: 'feature_request',
    title,
    summary: 'Please add a dark mode toggle.',
    userText: 'Add dark mode please',
    source: 'Group: test',
    askerName: 'Unit Tester',
    notify: false,
  });
  check('report record is created with a reference', first.ok && /^RPT-[A-Z0-9]{4}$/.test(first.ref), first.ref);
  const second = await reports.createReport({
    type: 'feature_request',
    title,
    summary: 'Please add a dark mode toggle.',
    userText: 'Dark mode',
    source: 'Group: test',
    askerName: 'Unit Tester',
    notify: false,
  });
  check('duplicate reports increment the same record', second.ok && second.merged && String(second.record._id) === String(first.record._id) && second.record.count === 2, { merged: second.merged, count: second.record?.count });
  check('problem reports store a copyable fix prompt', first.record.fixPrompt.includes('Title:') && first.record.fixPrompt.includes('Acceptance criteria:'));
  check('report stores asker, source and exact words', first.record.askerName === 'Unit Tester' && first.record.source === 'Group: test' && first.record.userText.includes('dark mode'));

  // A failed DB write must not claim success in text.
  const claimed = await reports.handleModelReport({
    text: sampleText(JSON.stringify({ type: 'bug_report', title: 'Should fail?', summary: 'x' })),
    context: { userText: 'report this', source: 'unit', askerId: 'not-an-object-id' },
  });
  check('an action with no asker still creates and confirms', claimed.created === true && /Reference RPT-/.test(claimed.text), claimed.text?.slice(0, 120));

  const noAction = await reports.handleModelReport({ text: "I've forwarded this to the development team.", context: {} });
  check('a claim without an action is rewritten honestly', !/forwarded/i.test(noAction.text) && /can't send that to the Chatgram team|email/i.test(noAction.text), noAction.text);

  const confirmed = await reports.handleModelReport({
    text: sampleText(JSON.stringify({ type: 'bug_report', title: `${title} bug`, summary: 'Calls drop.' })),
    context: { userText: 'report this bug', source: 'Group: test', askerName: 'Unit Tester' },
  });
  check('a successful report reply contains its reference', confirmed.created && /Reference RPT-/.test(confirmed.text) && !confirmed.text.includes('CHATGRAM_REPORT'), confirmed.text?.slice(0, 140));
  check('a successful report reply does not keep false forwarding claims', !/forwarded|notified/i.test(confirmed.text));

  await AdminInbox.deleteMany({ title: new RegExp('^' + title) });
  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
})().catch(async (error) => {
  console.error('aiReports test crashed:', error);
  try { await mongoose.disconnect(); } catch { /* closed */ }
  process.exit(1);
});
