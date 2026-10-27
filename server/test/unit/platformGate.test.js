/**
 * Unit test: maintenance / read-only gate decision.
 *
 *   cd server && node test/unit/platformGate.test.js
 *
 * No DB, no API process: gateDecision() is the pure function the HTTP
 * middleware uses, so these are the exact rules that decide whether a request
 * is answered or gets 503 MAINTENANCE / READ_ONLY.
 */
const platformSettings = require('../../src/utils/platformSettings');

const { gateDecision, isMaintenanceActive, DEFAULTS } = platformSettings;

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

function settings(overrides) {
  return {
    ...DEFAULTS,
    maintenanceMode: false,
    maintenanceMessage: 'Down for a short build (test).',
    maintenanceUntil: null,
    readOnlyMode: false,
    ...(overrides || {}),
  };
}

function main() {
  console.log('\nmaintenance / read-only gate unit test (no DB, no API)\n');

  const live = settings();

  /* --------------------------------------------------------------- off */
  check('nothing is blocked when everything is off', gateDecision(live, { path: '/users/me', method: 'GET' }) === null);
  check('writes are allowed when everything is off', gateDecision(live, { path: '/messages', method: 'POST' }) === null);
  check('maintenance is inactive by default', isMaintenanceActive(live) === false);

  /* ------------------------------------------------------- maintenance on */
  const down = settings({ maintenanceMode: true });
  const blocked = gateDecision(down, { path: '/users/me', method: 'GET' });
  check('an ordinary API call is refused during maintenance', Boolean(blocked), JSON.stringify(blocked));
  check('the refusal is 503', blocked && blocked.status === 503, blocked && blocked.status);
  check('the refusal carries code MAINTENANCE', blocked && blocked.code === 'MAINTENANCE', blocked && blocked.code);
  check('the admin message is returned', blocked && blocked.message === down.maintenanceMessage, blocked && blocked.message);

  const downWithUntil = settings({ maintenanceMode: true, maintenanceUntil: new Date(Date.now() + 60_000).toISOString() });
  const blockedUntil = gateDecision(downWithUntil, { path: '/messages', method: 'POST' });
  check(
    'a future auto-expiry is passed to the client',
    blockedUntil && typeof blockedUntil.maintenanceUntil === 'string',
    blockedUntil && blockedUntil.maintenanceUntil,
  );

  check('a failed maintenance read still returns a message', (() => {
    const decision = gateDecision(settings({ maintenanceMode: true, maintenanceMessage: '' }), { path: '/users/me' });
    return decision && decision.message === DEFAULTS.maintenanceMessage;
  })());

  /* --------------------------------------------- reachable during downtime */
  const alwaysOpen = ['/status/health', '/health', '/config', '/app/features', '/auth/login', '/auth/verification/send', '/auth/refresh'];
  for (const path of alwaysOpen) {
    check(`${path} stays reachable during maintenance`, gateDecision(settings({ maintenanceMode: true }), { path }) === null);
  }
  check(
    'admin endpoints stay reachable during maintenance',
    gateDecision(settings({ maintenanceMode: true }), { path: '/admin/platform-settings', method: 'PUT' }) === null,
  );

  /* ------------------------------------------------------- read-only mode */
  const readOnly = settings({ readOnlyMode: true });
  check('reads work in read-only mode', gateDecision(readOnly, { path: '/chats', method: 'GET' }) === null);
  check('HEAD works in read-only mode', gateDecision(readOnly, { path: '/chats', method: 'HEAD' }) === null);
  const write = gateDecision(readOnly, { path: '/messages', method: 'POST' });
  check('writes are refused in read-only mode', write && write.status === 503 && write.code === 'READ_ONLY', JSON.stringify(write));
  check('DELETE is refused in read-only mode', gateDecision(readOnly, { path: '/chats/1', method: 'DELETE' }) && gateDecision(readOnly, { path: '/chats/1', method: 'DELETE' }).code === 'READ_ONLY');
  check('sign-in still works in read-only mode', gateDecision(readOnly, { path: '/auth/login', method: 'POST' }) === null);
  check('admins can still write in read-only mode', gateDecision(readOnly, { path: '/admin/users/1/ban', method: 'POST' }) === null);

  /* ------------------------------------------- maintenance beats read-only */
  const both = settings({ maintenanceMode: true, readOnlyMode: true });
  const bothDecision = gateDecision(both, { path: '/messages', method: 'POST' });
  check('maintenance wins over read-only', bothDecision && bothDecision.code === 'MAINTENANCE', bothDecision && bothDecision.code);

  /* ----------------------------------------------------------- auto-expiry */
  const expiredWindow = settings({ maintenanceMode: true, maintenanceUntil: new Date(Date.now() - 1000).toISOString() });
  check('an expired auto-expiry means maintenance is over', isMaintenanceActive(expiredWindow) === false);
  check('an expired auto-expiry unblocks ordinary calls', gateDecision(expiredWindow, { path: '/users/me' }) === null);

  const futureWindow = settings({ maintenanceMode: true, maintenanceUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  check('a future auto-expiry keeps maintenance active', isMaintenanceActive(futureWindow) === true);

  check(
    'an unparseable maintenanceUntil does not silently switch maintenance off',
    isMaintenanceActive(settings({ maintenanceMode: true, maintenanceUntil: 'not-a-date' })) === true,
  );
  check(
    'an auto-expiry without maintenanceMode does nothing',
    isMaintenanceActive(settings({ maintenanceMode: false, maintenanceUntil: new Date(Date.now() + 60_000).toISOString() })) === false,
  );

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main();
