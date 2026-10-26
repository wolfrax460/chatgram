/**
 * Chunk 7A/7D unit tests (no browser, no real network, no database):
 *
 *  - version/build comparison ordering (never recommend a downgrade);
 *  - GET /api/app/version endpoint cases: latest, up to date, newer installed,
 *    force update, below minimum, withdrawn, unknown platform, env fallback;
 *  - own-HTTPS-domain enforcement for download URLs;
 *  - ETag + 304, and the public rate limiter (real Express app on a random port);
 *  - anonymous install recording and the admin "Versions in use" aggregate;
 *  - the web side: /web/version.json is emitted at build time, the banner polls
 *    it on focus + every 10 minutes, keeps a draft in localStorage and never
 *    shows while a call is active.
 *
 *   node server/test/unit/appVersion.test.js
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const repo = path.join(__dirname, '..', '..', '..');
let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${String(detail).slice(0, 240)}` : ''}`);
  }
}

function read(relative) {
  return fs.readFileSync(path.join(repo, relative), 'utf8');
}

/* --------------------------------------------------------------- env setup */
const envBackup = {
  CLIENT_URL: process.env.CLIENT_URL,
  APP_PUBLIC_BASE_URL: process.env.APP_PUBLIC_BASE_URL,
  APP_DOWNLOAD_HOSTS: process.env.APP_DOWNLOAD_HOSTS,
  APP_LATEST_VERSION: process.env.APP_LATEST_VERSION,
  APP_MIN_VERSION: process.env.APP_MIN_VERSION,
  APP_UPDATE_URL: process.env.APP_UPDATE_URL,
  APP_RELEASE_NOTES: process.env.APP_RELEASE_NOTES,
  NODE_ENV: process.env.NODE_ENV,
};
function restoreEnv() {
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
process.env.CLIENT_URL = 'https://chatgram.test';
process.env.APP_PUBLIC_BASE_URL = 'https://chatgram.test';
process.env.APP_DOWNLOAD_HOSTS = 'chatgram.duckdns.org';
process.env.NODE_ENV = 'test';
delete process.env.APP_LATEST_VERSION;
delete process.env.APP_MIN_VERSION;
delete process.env.APP_UPDATE_URL;
delete process.env.APP_RELEASE_NOTES;

const appUpdate = require('../../src/utils/appUpdate');
const appController = require('../../src/controllers/appController');
const appReleases = require('../../src/controllers/appReleasesController');
const AppRelease = require('../../src/models/AppRelease');
const ClientVersion = require('../../src/models/ClientVersion');
const admin = require('../../src/admin/auth');

const SHA256 = 'a'.repeat(64);
const SHA512 = 'b'.repeat(128);

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res;
}
function fakeReq({ query = {}, headers = {} } = {}) {
  return {
    query,
    headers,
    protocol: 'https',
    ip: '127.0.0.1',
    get(name) {
      return this.headers[String(name).toLowerCase()] || '';
    },
  };
}

/* --------------------------------------------------------------- stubs */
let releaseRow = null;
let releaseLookupError = null;
const findOneQueries = [];
AppRelease.findOne = (query) => {
  findOneQueries.push(query);
  return {
    lean: async () => {
      if (releaseLookupError) throw releaseLookupError;
      return releaseRow;
    },
  };
};
const installWrites = [];
ClientVersion.updateOne = async (filter, update, options) => {
  installWrites.push({ filter, update, options });
  return {};
};
let aggregateRows = [];
ClientVersion.aggregate = async () => aggregateRows;
let releaseRows = [];
AppRelease.find = () => ({ lean: async () => releaseRows });
const auditCalls = [];
admin.audit = async (action, req, detail) => {
  auditCalls.push({ action, detail });
};

function sampleRelease(overrides = {}) {
  return {
    platform: 'windows',
    version: '1.4.0',
    versionCode: 7,
    fileName: 'chatgram-windows-setup.exe',
    fileUrl: '/downloads/chatgram-windows-setup.exe',
    sha256: SHA256,
    sha512: SHA512,
    sizeBytes: 84_500_000,
    releaseNotes: 'Chatgram AI improvements.',
    minSupportedVersion: '1.2.0',
    forceUpdate: false,
    published: true,
    withdrawn: false,
    withdrawnAt: null,
    releasedAt: new Date('2026-10-20T10:00:00.000Z'),
    ...overrides,
  };
}

async function callUpdateCheck(query, headers = {}) {
  const res = fakeRes();
  await appController.updateCheck(fakeReq({ query, headers }), res);
  return res;
}

async function main() {
  console.log('\napp version tracker + update checks (chunk 7A/7D)\n');

  /* ---------------------------------------------------- pure helper cases */
  check('compareVersions orders 1.10.0 above 1.9.9', appUpdate.compareVersions('1.10.0', '1.9.9') === 1);
  check('compareVersions treats 1.2 and 1.2.0 as equal', appUpdate.compareVersions('1.2', '1.2.0') === 0);
  check('compareVersions ignores build metadata', appUpdate.compareVersions('1.2.3+7', '1.2.3') === 0);
  check('compareVersions handles a newer patch', appUpdate.compareVersions('1.2.4', '1.2.3') === 1);
  check('compareBuilds orders versionCode 12 above 9', appUpdate.compareBuilds(12, 9) === 1);
  check('compareBuilds treats missing codes as 0', appUpdate.compareBuilds('', 0) === 0);
  check('compareBuilds tolerates junk', appUpdate.compareBuilds('abc', 1) === -1);
  check('cleanVersion rejects junk and markup', appUpdate.cleanVersion('1.2.3') === '1.2.3' && appUpdate.cleanVersion('<script>') === '');
  check('cleanInstallId accepts a UUID-shaped id', appUpdate.cleanInstallId('1186f5a0-2d31-4cbd-9e40-6a7a2f5b0c11') !== '');
  check('cleanInstallId rejects a short or unsafe id', appUpdate.cleanInstallId('x') === '' && appUpdate.cleanInstallId('ab cd ef gh') === '');

  /* ------------------------------------------------------ domain enforcement */
  check('our own https host is allowed', appUpdate.resolveDownloadUrl('https://chatgram.test/downloads/app.exe').allowed === true);
  check('a second configured host is allowed', appUpdate.resolveDownloadUrl('https://chatgram.duckdns.org/downloads/app.exe').allowed === true);
  check(
    'a foreign host is withheld with a reason',
    (() => {
      const info = appUpdate.resolveDownloadUrl('https://evil.example/app.exe');
      return info.allowed === false && info.url === null && info.reason === 'foreign-host';
    })(),
  );
  check(
    'plain http on a public host is withheld',
    (() => {
      const info = appUpdate.resolveDownloadUrl('http://chatgram.test/app.exe');
      return info.allowed === false && info.reason === 'not-https';
    })(),
  );
  check(
    'a non-http scheme is withheld',
    (() => {
      const info = appUpdate.resolveDownloadUrl('ftp://chatgram.test/app.exe');
      return info.allowed === false;
    })(),
  );
  check(
    'a site-relative path is expanded to our public base',
    appUpdate.resolveDownloadUrl('/downloads/app.exe')?.url === 'https://chatgram.test/downloads/app.exe',
  );
  check('a missing file URL is reported, not guessed', appUpdate.resolveDownloadUrl('').reason === 'missing-url');

  /* ------------------------------------------------------------ ETag helper */
  const etagOne = appUpdate.buildEtag({ a: 1, b: 'x' });
  check('the ETag helper is stable for the same body', etagOne === appUpdate.buildEtag({ a: 1, b: 'x' }));
  check('the ETag helper changes with the body', etagOne !== appUpdate.buildEtag({ a: 2, b: 'x' }));
  check('If-None-Match matches weakly', appUpdate.etagMatches(etagOne, etagOne) && appUpdate.etagMatches(`"other", ${etagOne}`, etagOne));
  check('If-None-Match does not match another tag', !appUpdate.etagMatches('W/"deadbeef"', etagOne));

  /* ------------------------------------------------------- endpoint cases */
  releaseRow = sampleRelease();
  let res = await callUpdateCheck({ platform: 'windows', current: '1.3.0', build: '1', id: 'install-abc-123' });
  check('a published release is returned with the update fields', res.statusCode === 200 && res.body.platform === 'windows', res.statusCode);
  check('the payload carries latestVersion + versionCode', res.body.latestVersion === '1.4.0' && res.body.versionCode === 7, res.body);
  check('the download URL is expanded to our https domain', res.body.url === 'https://chatgram.test/downloads/chatgram-windows-setup.exe', res.body.url);
  check('sha256, sha512, size and notes are exposed', res.body.sha256 === SHA256 && res.body.sha512 === SHA512 && res.body.size === 84_500_000 && res.body.notes === 'Chatgram AI improvements.', res.body);
  check('releasedAt + minSupportedVersion are exposed', res.body.releasedAt instanceof Date && res.body.minSupportedVersion === '1.2.0', res.body);
  check('an older client is told an update is available', res.body.updateAvailable === true && res.body.updateRequired === false && res.body.forceUpdate === false, res.body);
  check('the endpoint reports the release as its source', res.body.source === 'release', res.body.source);
  check('the anonymous install is recorded with platform/version/time', (() => {
    const write = installWrites[0];
    return Boolean(write) && write.filter.platform === 'windows' && write.filter.version === '1.3.0' && write.filter.deviceId === 'install-abc-123' && write.update.$set.lastSeen instanceof Date;
  })(), installWrites[0]);
  await callUpdateCheck({ platform: 'windows', current: '1.3.0', id: '<script>' });
  check('an unsafe install id is ignored instead of stored', installWrites.length === 1, installWrites.length);
  const firstEtag = res.headers.ETag;
  check('the response carries a weak ETag and a short cache', typeof firstEtag === 'string' && /^W\//.test(firstEtag) && /max-age=60/.test(res.headers['Cache-Control']), res.headers);

  res = await callUpdateCheck({ platform: 'windows', current: '1.3.0', build: '1', id: 'install-abc-123' }, { 'if-none-match': firstEtag });
  check('a matching If-None-Match answers 304 with no body', res.statusCode === 304 && res.ended === true && res.body === undefined, res.statusCode);

  res = await callUpdateCheck({ platform: 'windows', current: '1.4.0', build: '7' });
  check('an up-to-date client is not told to update', res.body.updateAvailable === false && res.body.updateRequired === false && res.body.forceUpdate === false, res.body);

  res = await callUpdateCheck({ platform: 'windows', current: '2.0.0', build: '9' });
  check('a newer installed version is never told to downgrade', res.statusCode === 200 && res.body.updateAvailable === false && res.body.forceUpdate === false, res.body);

  releaseRow = sampleRelease({ forceUpdate: true, current: '1.3.0' });
  res = await callUpdateCheck({ platform: 'windows', current: '1.3.0', build: '1' });
  check('the force-update flag is returned when an update is needed', res.body.forceUpdate === true && res.body.updateAvailable === true, res.body);
  res = await callUpdateCheck({ platform: 'windows', current: '1.4.0', build: '7' });
  check('a force flag cannot force an up-to-date client', res.body.forceUpdate === false, res.body);

  releaseRow = sampleRelease();
  res = await callUpdateCheck({ platform: 'windows', current: '1.1.0', build: '1' });
  check('a client below the minimum must update', res.body.updateRequired === true && res.body.forceUpdate === true && res.body.updateAvailable === true, res.body);

  releaseRow = sampleRelease({ withdrawn: true, withdrawnAt: new Date() });
  res = await callUpdateCheck({ platform: 'windows', current: '1.0.0', build: '1' });
  check('a withdrawn release is never offered', res.body.withdrawn === true && res.body.url === null && res.body.updateAvailable === false && res.body.forceUpdate === false, res.body);

  releaseRow = sampleRelease({ fileUrl: 'https://evil.example/setup.exe' });
  res = await callUpdateCheck({ platform: 'windows', current: '1.0.0', build: '1' });
  check('a foreign download host is withheld from the response', res.body.url === null && res.body.urlAllowed === false && res.body.urlWithheldReason === 'foreign-host', res.body);

  releaseRow = sampleRelease({ fileUrl: 'http://chatgram.test/setup.exe' });
  res = await callUpdateCheck({ platform: 'windows', current: '1.0.0', build: '1' });
  check('a plain-http download URL is withheld', res.body.url === null && res.body.urlWithheldReason === 'not-https', res.body);

  res = await callUpdateCheck({ platform: 'ios', current: '1.0.0' });
  check('an unknown platform is rejected with 400', res.statusCode === 400 && /windows|android/i.test(String(res.body?.message)), res.statusCode);
  res = await callUpdateCheck({});
  check('a missing platform is rejected with 400', res.statusCode === 400, res.statusCode);

  /* ------------------------------------------------ env-policy fallback */
  releaseRow = sampleRelease({ published: false });
  process.env.APP_LATEST_VERSION = '1.9.9';
  process.env.APP_MIN_VERSION = '1.5.0';
  process.env.APP_UPDATE_URL = '/downloads/chatgram-windows-setup.exe';
  res = await callUpdateCheck({ platform: 'windows', current: '1.0.0', build: '1' });
  check('an unpublished release falls back to the env policy', res.statusCode === 200 && res.body.source === 'env' && res.body.latestVersion === '1.9.9', res.body);
  check('the env-policy URL stays on our own domain', res.body.url === 'https://chatgram.test/downloads/chatgram-windows-setup.exe', res.body.url);
  check('the env minimum still forces an update', res.body.updateRequired === true && res.body.forceUpdate === true, res.body);
  delete process.env.APP_LATEST_VERSION;
  delete process.env.APP_MIN_VERSION;
  delete process.env.APP_UPDATE_URL;

  releaseLookupError = new Error('db down');
  res = await callUpdateCheck({ platform: 'windows', current: '1.0.0' });
  check('a database failure still answers (never breaks the app)', res.statusCode === 200, res.statusCode);
  releaseLookupError = null;

  /* ------------------------------------------- admin versions-in-use */
  aggregateRows = [
    { _id: { platform: 'windows', version: '1.0.0' }, devices: 2, lastSeen: new Date('2026-10-25T10:00:00.000Z') },
    { _id: { platform: 'android', version: '1.1.1' }, devices: 5, lastSeen: new Date('2026-10-26T10:00:00.000Z') },
  ];
  releaseRows = [sampleRelease(), sampleRelease({ platform: 'android', version: '1.1.1', versionCode: 2 })];
  auditCalls.length = 0;
  res = fakeRes();
  await appReleases.versionsInUse(fakeReq(), res);
  check('the admin versions endpoint answers with aggregates', res.statusCode === 200 && res.body.totalDevices === 7, res.body?.totalDevices);
  check('the aggregate sorts by platform/version rows', Array.isArray(res.body.versions) && res.body.versions.length === 2, res.body.versions);
  check('an old Windows install is marked outdated', res.body.versions.find((row) => row.platform === 'windows')?.outdated === true, res.body.versions);
  check('the Android 1.1.1 install is up to date', res.body.versions.find((row) => row.platform === 'android')?.outdated === false, res.body.versions);
  check('per-platform totals include the last check time', res.body.platforms.find((row) => row.platform === 'android')?.devices === 5 && Boolean(res.body.lastCheckAt), res.body.platforms);
  check('the versions view is audited', auditCalls.some((entry) => entry.action === 'admin_versions_view'), auditCalls);
  check('the versions view exposes no identity or device ids', !/(deviceId|userId|email|installId)"/i.test(JSON.stringify(res.body)), Object.keys(res.body));
  aggregateRows = [];

  /* ------------------------------------------- release normalize validation */
  check('a valid SHA-512 is accepted and lowercased', appReleases.normalize({ platform: 'windows', sha512: SHA512.toUpperCase() }).sha512 === SHA512);
  check('an invalid SHA-512 is rejected', (() => {
    try {
      appReleases.normalize({ platform: 'windows', sha512: 'abc' });
      return false;
    } catch (error) {
      return error.status === 400 && /SHA-512/.test(error.message);
    }
  })());
  check('a versionCode is stored', appReleases.normalize({ platform: 'android', version: '1.1.1', versionCode: 3 }).versionCode === 3);
  check('a non-integer versionCode is rejected', (() => {
    try {
      appReleases.normalize({ platform: 'android', versionCode: 1.5 });
      return false;
    } catch (error) {
      return error.status === 400;
    }
  })());
  check('a withdrawn release gets a withdrawnAt timestamp', appReleases.normalize({ platform: 'windows', version: '1.0.0', withdrawn: true }).withdrawnAt instanceof Date);
  check('serialize exposes the new release fields', (() => {
    const row = appReleases.serialize({ platform: 'windows', version: '1.0.0', withdrawn: true, sha512: SHA512, versionCode: 4 });
    return row.withdrawn === true && row.sha512 === SHA512 && row.versionCode === 4;
  })());

  /* ------------------------------------------------------- rate limiter */
  const { createVersionLimiter } = appUpdate;
  delete process.env.APP_VERSION_RATE_LIMIT_DISABLED;
  const rateApp = express();
  rateApp.get('/check', createVersionLimiter({ limit: 3, windowMs: 60_000 }), (req, res2) => res2.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const instance = rateApp.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/check`;
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await fetch(base)).status);
  check('the public update check is rate limited', statuses.slice(0, 3).every((code) => code === 200) && statuses[3] === 429, statuses);
  const limited = await fetch(base);
  const limitedBody = await limited.json().catch(() => null);
  check('the rate limit returns a JSON message', limited.status === 429 && /Too many update checks/.test(String(limitedBody?.message || '')), limitedBody);
  process.env.APP_VERSION_RATE_LIMIT_DISABLED = 'true';
  const skipped = await fetch(base);
  check('the limiter can be disabled for local staging', skipped.status === 200, skipped.status);
  delete process.env.APP_VERSION_RATE_LIMIT_DISABLED;
  await new Promise((resolve) => server.close(resolve));

  /* ------------------------------------------------------- route wiring */
  const appRoutesSource = read('server/src/routes/appRoutes.js');
  check('GET /api/app/version is rate limited', /router\.get\('\/version', versionLimiter, updateCheck\)/.test(appRoutesSource));
  const adminRoutesSource = read('server/src/routes/adminRoutes.js');
  check('the versions panel route needs the admin session', /router\.get\('\/releases\/versions', requireAdminSession, releases\.versionsInUse\)/.test(adminRoutesSource));
  check('the releases save route still requires CSRF', /router\.put\('\/releases', requireAdminSession, requireAdminCsrf/.test(adminRoutesSource));
  check('the update response never returns secrets', !/(password|token|secret)/i.test(appRoutesSource));

  /* ------------------------------------------------------------ docs copy */
  const docs = read('client/landing/public/docs/index.html');
  check('the privacy policy discloses the update check', /For update checks, the Windows and Android apps send only a random install id, the platform, the installed version and the time of the check/.test(docs));
  check('the privacy policy still says chats are not end-to-end encrypted', /not end-to-end encrypted/.test(docs));

  /* -------------------------------------------------------------- web 7D */
  const viteConfig = read('apps/web/vite.config.ts');
  check('the web build emits /web/version.json', /fileName: 'version\.json'/.test(viteConfig) && /buildId/.test(viteConfig));
  const appUpdateSource = read('apps/web/src/lib/appUpdate.ts');
  check('the app polls version.json every 10 minutes', /10 \* 60 \* 1000/.test(appUpdateSource) && /version\.json/.test(appUpdateSource));
  check('the app also checks on tab focus/visibility', /addEventListener\('focus'/.test(appUpdateSource) && /visibilitychange/.test(appUpdateSource));
  check('the app never reloads by itself', !/location\.reload/.test(appUpdateSource));
  check('a typed draft is saved in localStorage with try/catch', /chatgram\.versionRefreshDraft/.test(appUpdateSource) && /try \{/.test(appUpdateSource));
  check('the draft is restored for the same chat', /takeRefreshDraft\(chatId/.test(appUpdateSource) && /pendingChat/.test(appUpdateSource));
  check('App restores the draft on open', /takeRefreshDraft\(chat\.id\)/.test(read('apps/web/src/App.tsx')));
  const updateBanner = read('apps/web/src/components/UpdateBanner.tsx');
  check('the banner shows the required sentence', updateBanner.includes('A new version of Chatgram is available.'));
  check('the banner has a Refresh button that reloads once', /window\.location\.reload\(\)/.test(updateBanner) && /Refresh/.test(updateBanner));
  check('the banner is hidden while a call is active', /ACTIVE_CALL_STATUSES/.test(updateBanner) && /subscribeCalls/.test(updateBanner) && /'active'/.test(updateBanner));
  const composer = read('apps/web/src/components/Composer.tsx');
  check('the composer exposes its draft + chat id for the refresh', /data-chatgram-composer/.test(composer) && /data-chat-id=\{chatId\}/.test(composer));
  const releasesPage = read('apps/web/src/pages/admin/ReleasesPage.tsx');
  check('the admin releases page has a Versions in use panel', /Versions in use/.test(releasesPage) && /\/api\/admin\/releases\/versions/.test(releasesPage));
  check('the admin releases page edits withdrawn/sha512/versionCode', /Withdrawn/.test(releasesPage) && /SHA-512/.test(releasesPage) && /versionCode/.test(releasesPage));

  restoreEnv();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((error) => {
  restoreEnv();
  console.error('Test crashed:', String((error && error.stack) || error).slice(0, 1200));
  process.exit(1);
});
