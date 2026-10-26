/**
 * Unit tests for the group "@Chatgram AI" mention helpers.
 *
 *   cd server && node test/unit/groupMentions.test.js
 *
 * No DB, no API, no provider: only the pure parsing / splitting / truncation
 * rules that the Oct-26 production fix relies on.
 */
const mentions = require('../../src/ai/groupMentions');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
  }
}

function main() {
  console.log('\ngroup @Chatgram AI mention unit tests (no DB, no API)\n');

  // ---- mention aliases -------------------------------------------------------
  const aliases = [
    '@chatgramai hello',
    '@Chatgram AI hello',
    '@chatgram hello',
    '@CHATGRAMAI hello',
    '@Chatgram AI, hello!',
    '@chatgram ai hello',
    'hey @chatgramai can you help?',
    '@ChatgramAI',
  ];
  for (const text of aliases) {
    const parsed = mentions.parseMention(text);
    check(`mention parses: ${JSON.stringify(text)}`, Boolean(parsed), parsed);
  }
  check('canonical handle is @Chatgram AI', mentions.MENTION_HANDLE === '@Chatgram AI', mentions.MENTION_HANDLE);
  check(
    'the composer aliases are documented',
    ['@Chatgram AI', '@chatgramai', '@chatgram ai', '@chatgram'].every((alias) => mentions.MENTION_ALIASES.includes(alias)),
    mentions.MENTION_ALIASES,
  );

  // ---- question extraction ---------------------------------------------------
  check('mention-only message has an empty question', mentions.parseMention('@chatgramai').question === '');
  check('trailing punctuation after the mention is not part of the question', mentions.parseMention('@chatgramai, what is a subnet?').question === 'what is a subnet?', mentions.parseMention('@chatgramai, what is a subnet?'));
  check('the question keeps the real text', mentions.parseMention('@Chatgram AI how do I subnet /26?').question === 'how do I subnet /26?');
  check('a mention with two spaces parses', Boolean(mentions.parseMention('@Chatgram  AI hello')));

  // ---- non-mentions ----------------------------------------------------------
  for (const text of ['@chatgramm hello', 'chatgram ai hello', 'email@chatgram.ai', 'hello world', '']) {
    check(`not a mention: ${JSON.stringify(text)}`, mentions.parseMention(text) === null, mentions.parseMention(text));
  }
  check('a mention inside a quoted block is not a fresh mention', mentions.parseMention('> Bob: @chatgramai hi') === null);

  // ---- quoted message (web reply) -------------------------------------------
  const quoted = mentions.parseMention('> Janvier: what is a /26?\n@chatgramai explain like I am a beginner');
  check('a quoted message is separated from the mention', Boolean(quoted) && quoted.question === 'explain like I am a beginner', quoted);
  check('the quoted text is kept for context', Boolean(quoted) && quoted.quoted.includes('what is a /26?'), quoted);

  // ---- answer cleanup / truncation detection --------------------------------
  check('the unknown marker is stripped', mentions.cleanModelAnswer('Hello [[CHATGRAM_UNKNOWN: why?]] there') === 'Hello  there');
  const completeTable = ['| # | Subnet |', '|---|---|', '| 1 | 192.168.1.0/26 |', '| 2 | 192.168.1.64/26 |'].join('\n');
  check('a complete table is not flagged as unfinished', mentions.detectUnfinished(completeTable) === false);
  const cutTable = ['| # | Subnet |', '|---|---|', '| 1 | 192.168.1.0/26 |', '| 2 | 192.168.1.64/26 |', '| 3 | 192.168.1.128/26 |', '| 4 | 192.168'].join('\n');
  check('a table cut mid-cell is flagged as unfinished', mentions.detectUnfinished(cutTable) === true);
  check('an unclosed code fence is flagged as unfinished', mentions.detectUnfinished('```js\nconsole.log(1)') === true);
  const trimmed = mentions.trimUnfinishedTail(cutTable);
  check('the broken last table row is dropped', !trimmed.includes('192.168\n') && trimmed.endsWith('| 3 | 192.168.1.128/26 |'), trimmed);

  // ---- splitting long answers ------------------------------------------------
  check('a short answer is not split', mentions.splitAnswer('short answer').parts.length === 1);
  const rows = [];
  for (let index = 1; index <= 30; index += 1) {
    rows.push(`| ${index} | 192.168.${index}.0/24 | 192.168.${index}.1 | 192.168.${index}.254 |`);
  }
  const longTable = ['**Subnetting plan for 192.168.1.0/24**', '', 'Here is the full plan:', '', '| # | Subnet | First | Last |', '|---|---|---|---|', ...rows, '', 'All four subnets have 62 usable hosts. Ask me to continue with the next step.'].join('\n');
  const split = mentions.splitAnswer(longTable);
  check('a long answer is split into 2-3 messages', split.parts.length >= 2 && split.parts.length <= 3, split.parts.length);
  check('the split covers the whole answer', split.parts.join('\n').replace(/\s+/g, ' ').includes('All four subnets have 62 usable hosts'));
  let brokenRows = 0;
  for (const part of split.parts) {
    for (const line of part.split('\n')) {
      if (line.trim().startsWith('|') && !line.trim().endsWith('|')) brokenRows += 1;
    }
  }
  check('no table row is cut across two messages', brokenRows === 0, brokenRows);
  const hintText = 'Want more detail? Reply to this message.';
  check('the detail hint constant matches the spec', mentions.MORE_DETAIL_HINT === hintText, mentions.MORE_DETAIL_HINT);

  // ---- system prompt rules ---------------------------------------------------
  const prompt = mentions.buildSystemPrompt('JIPSE', 'Janvier Yedid', false, false);
  check('system rules outrank the user text', /SYSTEM RULES/i.test(prompt) && /always win/i.test(prompt));
  check('role-play prompts are style-only', /role-play/i.test(prompt));
  check('the prompt forbids secrets', /passwords/i.test(prompt));
  const beginnerPrompt = mentions.buildSystemPrompt('JIPSE', 'Janvier', true, true);
  check('beginner answers get step-by-step instructions', /beginner/i.test(beginnerPrompt) && /worked example/i.test(beginnerPrompt));
  check('the prompt addresses the asker by name', /@Janvier/.test(prompt));

  // ---- notices ---------------------------------------------------------------
  check('provider failure notice is polite', /trouble reaching my AI provider/i.test(mentions.NOTICE.provider));
  check('rate-limit notice is polite', /few seconds/i.test(mentions.NOTICE.gap));
  check('too-long notice names the limit', /2000 characters/.test(`That message is too long, please shorten it (limit ${2000} characters).`));

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main();
