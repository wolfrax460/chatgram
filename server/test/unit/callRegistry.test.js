/**
 * Unit test: live-call registry (participant limits, authorisation, cleanup).
 *
 *   cd server && node test/unit/callRegistry.test.js
 *
 * No DB or API process needed. Covers the rules that make group calling safe:
 * only invited people can join, the 20-person cap holds, and empty calls are
 * destroyed so a crashed client cannot leak a call forever.
 */
const registry = require('../../src/utils/callRegistry');

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

const user = (n) => ({ id: String(n), displayName: `User ${n}`, avatarUrl: null });

function main() {
  console.log('\ncall registry unit test (no DB, no API)\n');
  registry.reset();

  check(
    'participant caps are video 6 / audio 12',
    registry.MAX_PARTICIPANTS === 6 && registry.capacityFor(true) === 6 && registry.capacityFor(false) === 12,
    `MAX_PARTICIPANTS=${registry.MAX_PARTICIPANTS} video=${registry.capacityFor(true)} audio=${registry.capacityFor(false)}`,
  );

  // ---------------------------------------------------------------- creation
  const created = registry.create({
    callId: 'c1',
    chatId: 'chat1',
    video: true,
    isGroup: true,
    title: 'Weekend plans',
    initiator: user(1),
    invitees: ['2', '3'],
  });
  check('a call can be created', created.ok === true, JSON.stringify(created));
  check('call keeps its video flag', registry.get('c1')?.video === true);
  check('call keeps its group flag', registry.get('c1')?.isGroup === true);
  check('caller is the first participant', registry.participants('c1').length === 1);

  check(
    'the same call id cannot be created twice',
    registry.create({ callId: 'c1', chatId: 'chat1', initiator: user(9) }).code === 'CALL_DUPLICATE',
  );
  check(
    'a user already in a call cannot start another',
    registry.create({ callId: 'c2', chatId: 'chat1', initiator: user(1) }).code === 'CALL_BUSY',
  );
  check(
    'a call needs an id',
    registry.create({ callId: '', chatId: 'chat1', initiator: user(7) }).code === 'CALL_INVALID',
  );

  // ------------------------------------------------------------------- join
  const joined = registry.join('c1', user(2));
  check('an invitee can join', joined.ok === true, JSON.stringify(joined).slice(0, 120));
  check('joining reports the people already in the call', joined.existing?.length === 1);
  check('participants now two', registry.participants('c1').length === 2);

  check(
    'an outsider cannot join',
    registry.join('c1', user(99)).code === 'CALL_FORBIDDEN',
  );
  check('an unknown call cannot be joined', registry.join('nope', user(2)).code === 'CALL_GONE');
  check(
    'joining twice is idempotent',
    registry.join('c1', user(2)).ok === true && registry.participants('c1').length === 2,
  );

  // -------------------------------------------------------------------- cap
  const big = registry.create({
    callId: 'big',
    chatId: 'chat2',
    initiator: user(100),
    invitees: Array.from({ length: 40 }, (_, i) => String(100 + i)),
  });
  check('cap: call created with 40 invitees', big.ok === true);
  let admitted = 0;
  for (let n = 1; n < 40; n += 1) {
    const res = registry.join('big', user(100 + n));
    if (res.ok) admitted += 1;
    else {
      check('cap: the 13th participant of an audio call is rejected with CALL_FULL', res.code === 'CALL_FULL', res.code);
      break;
    }
  }
  check('cap: exactly 12 participants admitted to an audio call', registry.participants('big').length === 12, String(registry.participants('big').length));
  check('cap: admitted 11 joiners after the caller', admitted === 11, String(admitted));
  check('cap: an audio call cannot pass 12 (registry.capacity)', registry.capacity('big') === 12, String(registry.capacity('big')));

  // Video calls are capped much lower than audio (mesh bandwidth): 6 people.
  const videoCall = registry.create({
    callId: 'video1',
    chatId: 'chat4v',
    video: true,
    initiator: user(200),
    invitees: Array.from({ length: 10 }, (_, i) => String(200 + i)),
  });
  check('cap: video call created', videoCall.ok === true);
  let videoAdmitted = 0;
  for (let n = 1; n <= 10; n += 1) {
    if (registry.join('video1', user(200 + n)).ok) videoAdmitted += 1;
  }
  check(
    'cap: exactly 6 participants admitted to a video call',
    registry.participants('video1').length === 6 && videoAdmitted === 5,
    String(registry.participants('video1').length),
  );
  registry.destroy('video1');

  // ------------------------------------------------------------------ leave
  const left = registry.leave('c1', '2');
  check('leaving removes the participant', left.removed === true);
  check('leaving does not destroy a call that still has people', left.destroyed === false);
  check('isParticipant reflects removal', registry.isParticipant('c1', '2') === false);

  const destroyed = registry.leave('c1', '1');
  check('the last participant leaving destroys the call', destroyed.destroyed === true);
  check('destroyed call is gone', registry.get('c1') === null);

  // ------------------------------------------------------- cleanup helpers
  const second = registry.create({
    callId: 'c3',
    chatId: 'chat3',
    initiator: user(1),
    invitees: ['2'],
  });
  registry.join('c3', user(2));
  const affected = registry.removeUserFromAll('1');
  check('removeUserFromAll finds the calls', second.ok && affected.length === 1, String(affected.length));
  check('removeUserFromAll leaves the others connected', registry.participants('c3').length === 1);
  registry.removeUserFromAll('2');
  check('removeUserFromAll destroys empty calls', registry.get('c3') === null);

  check('findCallForUser finds an active call', (() => {
    registry.create({ callId: 'c4', chatId: 'chat4', initiator: user(5), invitees: ['6'] });
    return registry.findCallForUser('5')?.callId === 'c4';
  })());

  // ------------------------------------------------------------------ prune
  const stale = registry.create({ callId: 'old', chatId: 'chat9', initiator: user(8), invitees: ['9'] });
  registry.get('old').createdAt = Date.now() - registry.MAX_AGE_MS - 1000;
  registry.prune();
  check('abandoned calls are pruned', stale.ok === true && registry.get('old') === null);

  registry.reset();
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main();
