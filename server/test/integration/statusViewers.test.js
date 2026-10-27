/**
 * Integration test: "Viewed by" — the owner-only status viewers list.
 *
 *   cd server
 *   node test/integration/statusViewers.test.js
 *
 * Requires the local staging API (scripts/start-staging.ps1, default
 * http://127.0.0.1:5000, database chatgram_staging). The optional direct-DB
 * block at the end creates the expired-status fixture and is skipped with a
 * note when MongoDB is not reachable; everything else is pure HTTP.
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';

const run = Date.now().toString(36);
const PASSWORD = 'StatusViewers1!';
const HOUR = 60 * 60 * 1000;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, pathname, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, {
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

/* ------------------------------------------------------------- fixtures */

let owner;
let viewerOne;
let viewerTwo;

async function registerUser(label) {
  const identifier = `status-viewers-${run}-${label}@chatgram.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Viewers ${label} ${run}`, identifier, password: PASSWORD },
  });
  if (res.status !== 201) {
    throw new Error(`register ${label} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken, id: res.body.user.id, identifier };
}

function isoStringOrNull(value) {
  return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

async function main() {
  console.log(`\nstatus viewers integration test against ${BASE}\n`);

  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.log('Start the local staging API first (docs/local-staging.md / scripts/start-staging.ps1).');
    process.exit(1);
  }

  owner = await registerUser('owner');
  viewerOne = await registerUser('viewer-one');
  viewerTwo = await registerUser('viewer-two');

  // One of the two viewers is in the owner's address book, the other is not.
  const added = await api('POST', '/api/contacts', { token: owner.token, body: { userId: viewerOne.id } });
  check('owner adds viewer one as a contact -> 201', added.status === 201, `got ${added.status} ${JSON.stringify(added.body)}`);

  // ------------------------------------------------------ empty + shape
  const created = await api('POST', '/api/status', { token: owner.token, body: { text: 'Viewers test status' } });
  check('owner creates a status -> 201', created.status === 201, `got ${created.status} ${JSON.stringify(created.body)}`);
  const statusId = created.body?._id;
  check('created status has an id', typeof statusId === 'string' && statusId.length === 24, String(statusId));

  const empty = await api('GET', `/api/status/${statusId}/viewers`, { token: owner.token });
  check('GET /api/status/:id/viewers -> 200 for the author', empty.status === 200, `got ${empty.status} ${JSON.stringify(empty.body)}`);
  check('empty list has count 0', empty.body?.count === 0, JSON.stringify(empty.body));
  check('empty list has no viewers', Array.isArray(empty.body?.viewers) && empty.body.viewers.length === 0, JSON.stringify(empty.body?.viewers));
  check('empty list is not truncated', empty.body?.truncated === false, JSON.stringify(empty.body));

  // ------------------------------------------------------- auth + 404/400
  const unauthenticated = await api('GET', `/api/status/${statusId}/viewers`);
  check('viewers require auth -> 401', unauthenticated.status === 401, `got ${unauthenticated.status}`);

  const invalidId = await api('GET', '/api/status/not-an-object-id/viewers', { token: owner.token });
  check('invalid status id -> 400', invalidId.status === 400, `got ${invalidId.status} ${JSON.stringify(invalidId.body)}`);

  const missing = await api('GET', '/api/status/0123456789abcdef01234567/viewers', { token: owner.token });
  check('unknown status id -> 404', missing.status === 404, `got ${missing.status} ${JSON.stringify(missing.body)}`);

  // ------------------------------------------- record + de-duplicate views
  const firstView = await api('POST', `/api/status/${statusId}/view`, { token: viewerOne.token });
  check('viewer one marks the status viewed -> 200', firstView.status === 200, `got ${firstView.status}`);
  await sleep(20);
  const secondView = await api('POST', `/api/status/${statusId}/view`, { token: viewerOne.token });
  check('viewer one views again -> 200', secondView.status === 200, `got ${secondView.status}`);
  await sleep(20);
  const thirdView = await api('POST', `/api/status/${statusId}/view`, { token: viewerTwo.token });
  check('viewer two marks the status viewed -> 200', thirdView.status === 200, `got ${thirdView.status}`);

  const list = await api('GET', `/api/status/${statusId}/viewers`, { token: owner.token });
  check('author reads the viewers -> 200', list.status === 200, `got ${list.status} ${JSON.stringify(list.body)}`);
  const viewers = Array.isArray(list.body?.viewers) ? list.body.viewers : [];
  check('two distinct people are counted', list.body?.count === 2, JSON.stringify(list.body?.count));
  check('a user who viewed twice appears once', viewers.filter((v) => v.id === viewerOne.id).length === 1, JSON.stringify(viewers));
  check('viewers are capped flag is false', list.body?.truncated === false, JSON.stringify(list.body?.truncated));

  // Newest first: viewer two viewed last.
  check('viewers are ordered newest first', viewers[0]?.id === viewerTwo.id && viewers[1]?.id === viewerOne.id, JSON.stringify(viewers.map((v) => v.id)));

  const [newest, older] = viewers;
  check('viewer rows expose id', typeof newest?.id === 'string' && newest.id === viewerTwo.id, JSON.stringify(newest));
  check('viewer rows expose displayName', typeof newest?.displayName === 'string' && newest.displayName.length > 0, JSON.stringify(newest));
  check('viewer rows expose avatarUrl as a string', typeof newest?.avatarUrl === 'string', JSON.stringify(newest));
  check('viewer rows expose an ISO viewedAt', isoStringOrNull(newest?.viewedAt) && typeof newest?.viewedAt === 'string', JSON.stringify(newest?.viewedAt));
  check('viewedAt is ordered newest first', Date.parse(newest?.viewedAt) >= Date.parse(older?.viewedAt), `${newest?.viewedAt} vs ${older?.viewedAt}`);
  check('isContact is true for an address-book contact', older?.isContact === true, JSON.stringify(older));
  check('isContact is false for a non-contact', newest?.isContact === false, JSON.stringify(newest));

  // ------------------------------------------------------- owner-only gate
  const otherRead = await api('GET', `/api/status/${statusId}/viewers`, { token: viewerOne.token });
  check('a non-author gets 403', otherRead.status === 403, `got ${otherRead.status} ${JSON.stringify(otherRead.body)}`);
  check('403 response has a stable code', otherRead.body?.code === 'NOT_STATUS_AUTHOR', JSON.stringify(otherRead.body));

  const strangerRead = await api('GET', `/api/status/${statusId}/viewers`, { token: viewerTwo.token });
  check('another non-author gets 403', strangerRead.status === 403, `got ${strangerRead.status}`);

  // The author opening their own status must not add themselves to the list.
  const selfView = await api('POST', `/api/status/${statusId}/view`, { token: owner.token });
  check('author can still mark their own status viewed', selfView.status === 200, `got ${selfView.status}`);
  const afterSelf = await api('GET', `/api/status/${statusId}/viewers`, { token: owner.token });
  check('the author never appears in their own viewers list', afterSelf.body?.count === 2 && !(afterSelf.body?.viewers || []).some((v) => v.id === owner.id), JSON.stringify(afterSelf.body));

  // The populated feed still works exactly as before (regression guard for the
  // mobile/web "seen" ring, which reads status.viewedBy as populated users).
  const feed = await api('GET', '/api/status', { token: owner.token });
  const feedStatus = (feed.body || []).find((s) => s._id === statusId);
  check('GET /api/status still returns the status', Boolean(feedStatus), JSON.stringify(feed.body?.length));
  check('feed viewedBy is still populated with user objects', feedStatus?.viewedBy?.some((v) => v && typeof v === 'object' && v.displayName), JSON.stringify(feedStatus?.viewedBy));
  check('feed does not expose per-view timestamps', feedStatus?.viewedAt === undefined, JSON.stringify(feedStatus?.viewedAt));

  // Privacy: where the author sees names, everybody else must see bare ids — a
  // contact must never learn who viewed someone else's status from the feed.
  const otherFeed = await api('GET', '/api/status', { token: viewerTwo.token });
  const otherView = (otherFeed.body || []).find((s) => s._id === statusId);
  check(
    'non-authors only get viewer ids from the feed',
    !otherView || (otherView.viewedBy || []).every((v) => v && typeof v === 'object' && !v.displayName),
    JSON.stringify(otherView?.viewedBy),
  );

  // -------------------------------------------------- deleted status is 404
  const doomed = await api('POST', '/api/status', { token: owner.token, body: { text: 'Deleted status' } });
  const doomedId = doomed.body?._id;
  await api('DELETE', `/api/status/${doomedId}`, { token: owner.token });
  const deletedRead = await api('GET', `/api/status/${doomedId}/viewers`, { token: owner.token });
  check('deleted status -> 404', deletedRead.status === 404, `got ${deletedRead.status} ${JSON.stringify(deletedRead.body)}`);

  // ------------------------------------------------- expired status is 404
  // Requires direct DB access only to create a 25-hour-old row; the API has no
  // way to backdate a status. Skipped (with a note) when Mongo is unreachable.
  let expiredId = null;
  let mongoose = null;
  let dbReady = false;
  try {
    mongoose = require('mongoose');
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
    dbReady = true;
    const Status = require('../../src/models/Status');
    const expired = await Status.create({
      userId: new mongoose.Types.ObjectId(owner.id),
      text: 'expired viewers fixture',
      createdAt: new Date(Date.now() - 25 * HOUR),
      expiresAt: new Date(Date.now() - HOUR),
    });
    expiredId = String(expired._id);
    const expiredRead = await api('GET', `/api/status/${expiredId}/viewers`, { token: owner.token });
    check('expired status -> 404', expiredRead.status === 404, `got ${expiredRead.status} ${JSON.stringify(expiredRead.body)}`);
  } catch (error) {
    console.log(`  SKIP  expired status check (database not reachable: ${error.message})`);
  }

  // --------------------------------------------------------------- tidy up
  for (const id of [statusId].filter(Boolean)) {
    await api('DELETE', `/api/status/${id}`, { token: owner.token });
  }
  try {
    if (!dbReady) {
      mongoose = require('mongoose');
      await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
      dbReady = true;
    }
    const Status = require('../../src/models/Status');
    const User = require('../../src/models/User');
    if (expiredId) await Status.deleteOne({ _id: expiredId });
    await Status.deleteMany({ userId: { $in: [owner.id, viewerOne.id, viewerTwo.id].map((id) => new mongoose.Types.ObjectId(id)) } });
    await User.deleteMany({ email: new RegExp(`^status-viewers-${run}-`) });
    await mongoose.disconnect();
  } catch (error) {
    console.log(`  (db cleanup skipped: ${error.message})`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
