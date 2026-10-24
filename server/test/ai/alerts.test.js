/** 9e alert gating: instant once per window, hourly digest, off by default. */
const mongoose = require('mongoose');
let passed = 0; const failures = [];
function check(n, c, d) { if (c) { passed++; console.log('  PASS  ' + n); } else { failures.push(n); console.log('  FAIL  ' + n + (d ? ' -> ' + d : '')); } }

(async () => {
  console.log('\nAI alert tests\n');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  const { AiSettings } = require('../../src/ai/settings');
  const policy = require('../../src/ai/policy');
  const alerts = require('../../src/ai/alerts');
  const notifier = require('../../src/support/notifier');
  const snapshot = await AiSettings.findOne({ key: 'global' }).lean();
  const calls = [];
  notifier.notifyAlert = async (text) => { calls.push(String(text)); return ['test']; };
  try {
    await policy.updatePolicy({ alertsEnabled: false });
    alerts.state.pendingFailures = 0;
    let result = await alerts.onProviderFailure({ degraded: true, reason: 'boom' });
    check('alerts are silent while the toggle is off', result.notified === false && calls.length === 0, JSON.stringify(result));

    await policy.updatePolicy({ alertsEnabled: true });
    alerts.state.lastInstantAt = 0;
    alert0 = null;
    result = await alerts.onProviderFailure({ degraded: true, reason: 'all providers returned 401' });
    check('degraded AI sends one instant alert', result.notified === true && result.channels.includes('instant') && calls.length === 1, JSON.stringify(result));
    check('instant alert mentions degraded', /degraded/i.test(calls[0] || ''), calls[0]);
    result = await alerts.onProviderFailure({ degraded: true, reason: 'still down' });
    check('instant alert is rate limited to once per window', !result.channels.includes('instant'), JSON.stringify(result));

    alerts.state.lastDigestAt = Date.now() - 61 * 60 * 1000;
    alerts.state.pendingFailures = 3;
    result = await alerts.onProviderFailure({ degraded: false, reason: 'single failure' });
    check('hourly digest is sent when due', result.channels.includes('digest') && /digest/i.test(calls[calls.length - 1] || ''), JSON.stringify(result));
    check('digest resets the pending counter', alerts.state.pendingFailures === 0, String(alerts.state.pendingFailures));
    result = await alerts.onProviderFailure({ degraded: false, reason: 'single failure' });
    check('digest is not sent twice within the hour', !result.channels.includes('digest'), JSON.stringify(result));
  } finally {
    if (snapshot) { const { _id, ...rest } = snapshot; await AiSettings.updateOne({ key: 'global' }, { $set: rest }, { upsert: true }); }
    else await AiSettings.deleteOne({ key: 'global' });
    await mongoose.disconnect();
  }
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed\n');
  if (failures.length) process.exit(1);
})().catch((error) => { console.error('Test crashed:', error.message); process.exit(1); });
