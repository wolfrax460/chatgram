/**
 * The silent-learning marker must never reach a user, in any position.
 *
 * Production bug: Groq's gpt-oss emitted `[[CHATGRAM_UNKNOWN: …]]` followed by a
 * closing sentence, and the old regex only stripped the marker at the very end,
 * so the raw marker (and the internal question) was shown in the chat bubble.
 *
 * No database and no provider needed.
 *
 *   node server/test/ai/marker.test.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const { stripMarker } = require('../../src/ai/chatgram');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`);
  }
}

console.log('\nmarker stripping tests\n');

const atEnd = stripMarker("I don't have a confirmed answer on that yet.\n[[CHATGRAM_UNKNOWN: how much is premium]]");
check('marker at the end is stripped', !atEnd.text.includes('CHATGRAM_UNKNOWN'), atEnd.text);
check('marker at the end keeps the visible answer', atEnd.text.startsWith("I don't have a confirmed answer"), atEnd.text);
check('marker at the end records the question', atEnd.unknownQuestion === 'how much is premium', atEnd.unknownQuestion);

const mid = stripMarker("I don't have a confirmed answer on that yet. [[CHATGRAM_UNKNOWN: how much is premium]] Please ask the team.");
check('mid-answer marker is stripped (production bug)', !mid.text.includes('CHATGRAM_UNKNOWN'), mid.text);
check('mid-answer text around the marker survives', mid.text.includes('Please ask the team'), mid.text);
check('mid-answer marker records the question', mid.unknownQuestion === 'how much is premium', mid.unknownQuestion);

const multi = stripMarker('One [[CHATGRAM_UNKNOWN: first question]] two [[Chatgram_Unknown: second question]] three');
check('every marker is stripped', !/\[\[chatgram_unknown/i.test(multi.text), multi.text);
check('the last question is kept', multi.unknownQuestion === 'second question', multi.unknownQuestion);

const plain = stripMarker('Just a normal answer.');
check('plain answers are untouched', plain.text === 'Just a normal answer.' && plain.unknownQuestion === null, plain);

const malformed = stripMarker('An answer with [[CHATGRAM_UNKNOWN: no closing bracket');
check('a malformed marker is not eaten', malformed.text.includes('no closing bracket'), malformed.text);

const onlyMarker = stripMarker('[[CHATGRAM_UNKNOWN: a question]]');
check('a marker-only answer leaves empty text for the fallback', onlyMarker.text === '', onlyMarker.text);

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) process.exit(1);
