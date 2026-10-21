/**
 * Integration test: status media (photo / video / audio).
 *
 *   cd server && node test/integration/statusMedia.test.js
 *
 * Requires the local API (docs/local-staging.md). Uses only the local disk
 * storage backend (Cloudinary env empty), so it can also assert that the stored
 * file is really deleted when a status is deleted.
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '..', '..', 'uploads');

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

async function upload(token, bytes, mimetype, filename, extraFields = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimetype }), filename);
  for (const [key, value] of Object.entries(extraFields)) form.append(key, String(value));
  const res = await fetch(`${BASE}/api/status/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
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

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A real, valid WAV file (0.25 s of silence, 8 kHz mono 8-bit) — playable. */
function makeWav(seconds = 0.25, sampleRate = 8000) {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples, 128); // 128 = silence for unsigned 8-bit
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28); // byte rate
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * NOTE: no encoder (ffmpeg) exists in this environment, so the "video" fixture
 * is a byte sequence labelled video/mp4. The server validates mimetype, size and
 * duration metadata — it does not decode the container — so this exercises the
 * real API path. A genuinely playable video is produced in the browser suite
 * with MediaRecorder (Playwright), where playback can also be checked.
 */
const FAKE_MP4 = Buffer.alloc(1024 * 1024, 7);

const run = Date.now().toString(36);
const PASSWORD = 'StatusPass1!';
let token = '';
let userId = '';

async function registerUser() {
  const identifier = `status-${run}@chatgram.test`;
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Status Tester ${run}`, identifier, password: PASSWORD },
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  token = res.body.accessToken;
  userId = res.body.user.id;
  return identifier;
}

function localPath(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  return path.join(UPLOAD_ROOT, url.replace(/^\/uploads\/+/, ''));
}

async function main() {
  console.log(`\nstatus media integration test against ${BASE}\n`);

  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.log('Start the local API first (docs/local-staging.md).');
    process.exit(1);
  }

  await registerUser();

  // ------------------------------------------------------------ limits API
  const limits = await api('GET', '/api/status/limits', { token });
  check('GET /api/status/limits -> 200', limits.status === 200, `got ${limits.status}`);
  check('image limit is 10 MB', limits.body?.limits?.image?.maxBytes === 10 * 1024 * 1024, JSON.stringify(limits.body?.limits?.image));
  check('video limit is 50 MB', limits.body?.limits?.video?.maxBytes === 50 * 1024 * 1024);
  check('video duration limit is 60 s', limits.body?.limits?.video?.maxDurationSeconds === 60);
  check('audio limit is 20 MB', limits.body?.limits?.audio?.maxBytes === 20 * 1024 * 1024);
  const unauthenticated = await api('GET', '/api/status/limits');
  check('limits require auth', unauthenticated.status === 401, `got ${unauthenticated.status}`);

  // ---------------------------------------------------------- image upload
  const image = await upload(token, PNG, 'image/png', 'pixel.png');
  check('image upload -> 201', image.status === 201, `got ${image.status} ${JSON.stringify(image.body)}`);
  check('image upload returns a url', typeof image.body?.file?.url === 'string', JSON.stringify(image.body));
  check('image upload reports mediaType image', image.body?.file?.mediaType === 'image');
  const imagePath = localPath(image.body?.file?.url);
  check('image upload wrote a file to the local storage root', Boolean(imagePath && fs.existsSync(imagePath)), imagePath);

  // ---------------------------------------------------------- audio upload
  const wav = makeWav();
  const audio = await upload(token, wav, 'audio/wav', 'voice.wav');
  check('audio upload -> 201', audio.status === 201, `got ${audio.status} ${JSON.stringify(audio.body)}`);
  check('audio upload reports mediaType audio', audio.body?.file?.mediaType === 'audio');
  const audioPath = localPath(audio.body?.file?.url);
  check('audio file exists on disk', Boolean(audioPath && fs.existsSync(audioPath)), audioPath);

  // ---------------------------------------------------------- video upload
  const video = await upload(token, FAKE_MP4, 'video/mp4', 'clip.mp4', { durationSeconds: 12 });
  check('video upload -> 201', video.status === 201, `got ${video.status} ${JSON.stringify(video.body)}`);
  check('video upload reports mediaType video', video.body?.file?.mediaType === 'video');
  const videoPath = localPath(video.body?.file?.url);
  check('video file exists on disk', Boolean(videoPath && fs.existsSync(videoPath)), videoPath);

  // -------------------------------------------------------- validation gate
  const tooLong = await upload(token, FAKE_MP4, 'video/mp4', 'long.mp4', { durationSeconds: 95 });
  check('video longer than 60 s -> 400', tooLong.status === 400, `got ${tooLong.status}`);
  check('too-long code is MEDIA_TOO_LONG', tooLong.body?.code === 'MEDIA_TOO_LONG', JSON.stringify(tooLong.body));
  check('too-long error states the limit', /60 seconds/.test(tooLong.body?.message || ''), tooLong.body?.message);

  const noDuration = await upload(token, FAKE_MP4, 'video/mp4', 'nodur.mp4');
  check('video without duration -> 400 DURATION_REQUIRED', noDuration.body?.code === 'DURATION_REQUIRED', JSON.stringify(noDuration.body));

  const bigImage = await upload(token, Buffer.alloc(10 * 1024 * 1024 + 2048, 1), 'image/png', 'big.png');
  check('image over 10 MB -> 413', bigImage.status === 413, `got ${bigImage.status}`);
  check('too-large code is MEDIA_TOO_LARGE', bigImage.body?.code === 'MEDIA_TOO_LARGE', JSON.stringify(bigImage.body));

  const pdf = await upload(token, Buffer.from('%PDF-1.4 test'), 'application/pdf', 'doc.pdf');
  check('disallowed type -> 415', pdf.status === 415, `got ${pdf.status}`);
  check('disallowed type code is UNSUPPORTED_MEDIA_TYPE', pdf.body?.code === 'UNSUPPORTED_MEDIA_TYPE', JSON.stringify(pdf.body));

  // -------------------------------------------------------- create statuses
  const created = await api('POST', '/api/status', {
    token,
    body: {
      text: 'Photo caption',
      mediaUrl: image.body.file.url,
      mediaType: 'image',
      mimetype: 'image/png',
      mediaSize: image.body.file.size,
      mediaProvider: image.body.file.provider,
      mediaPublicId: image.body.file.publicId,
    },
  });
  check('create image status with caption -> 201', created.status === 201, `got ${created.status} ${JSON.stringify(created.body)}`);
  check('status keeps its caption', created.body?.text === 'Photo caption');
  check('status keeps mediaType image', created.body?.mediaType === 'image');

  const videoStatus = await api('POST', '/api/status', {
    token,
    body: {
      text: 'Video caption',
      mediaUrl: video.body.file.url,
      mediaType: 'video',
      mimetype: 'video/mp4',
      mediaSize: video.body.file.size,
      durationSeconds: 12,
    },
  });
  check('create video status -> 201', videoStatus.status === 201, `got ${videoStatus.status} ${JSON.stringify(videoStatus.body)}`);
  check('video status keeps duration', videoStatus.body?.durationSeconds === 12);

  const audioStatus = await api('POST', '/api/status', {
    token,
    body: {
      mediaUrl: audio.body.file.url,
      mediaType: 'audio',
      mimetype: 'audio/wav',
      mediaSize: audio.body.file.size,
      durationSeconds: 0.25,
    },
  });
  check('create audio status without caption -> 201', audioStatus.status === 201, JSON.stringify(audioStatus.body));

  const textOnly = await api('POST', '/api/status', { token, body: { text: 'Just text' } });
  check('text-only status -> 201', textOnly.status === 201, `got ${textOnly.status}`);

  const empty = await api('POST', '/api/status', { token, body: {} });
  check('empty status -> 400 EMPTY_STATUS', empty.body?.code === 'EMPTY_STATUS', JSON.stringify(empty.body));

  const badUrl = await api('POST', '/api/status', { token, body: { mediaUrl: 'javascript:alert(1)', mediaType: 'image' } });
  check('non-http media URL -> 400', badUrl.status === 400, `got ${badUrl.status}`);

  const bogusVideo = await api('POST', '/api/status', {
    token,
    body: { mediaType: 'video', mimetype: 'video/mp4', mediaSize: 1000, durationSeconds: 5 },
  });
  check('video status without a file -> 400 MEDIA_REQUIRED', bogusVideo.body?.code === 'MEDIA_REQUIRED', JSON.stringify(bogusVideo.body));

  const tooLongCreate = await api('POST', '/api/status', {
    token,
    body: {
      mediaUrl: video.body.file.url,
      mediaType: 'video',
      mimetype: 'video/mp4',
      mediaSize: video.body.file.size,
      durationSeconds: 120,
    },
  });
  check('creating a >60 s video status -> 400', tooLongCreate.status === 400, `got ${tooLongCreate.status}`);

  // ------------------------------------------------- feed shape + viewing
  const feed = await api('GET', '/api/status', { token });
  check('GET /api/status -> 200', feed.status === 200, `got ${feed.status}`);
  const mine = (feed.body || []).filter((s) => s.userId && (s.userId._id === userId || s.userId === userId));
  check('own statuses are in the feed', mine.length >= 4, `found ${mine.length}`);
  check('feed exposes mediaType', mine.some((s) => s.mediaType === 'video'));

  const view = await api('POST', `/api/status/${created.body._id}/view`, { token });
  check('marking own status viewed works', view.status === 200, `got ${view.status}`);

  // ------------------------------------------ delete removes the stored file
  check('image file exists before delete', Boolean(imagePath && fs.existsSync(imagePath)));
  const deleted = await api('DELETE', `/api/status/${created.body._id}`, { token });
  check('delete status -> 200', deleted.status === 200, `got ${deleted.status}`);
  check('deleting the status deletes the stored image file', Boolean(imagePath && !fs.existsSync(imagePath)), imagePath);

  const otherUserDelete = await api('DELETE', `/api/status/${videoStatus.body._id}`);
  check('unauthenticated delete is rejected', otherUserDelete.status === 401, `got ${otherUserDelete.status}`);

  // delete the rest of the fixtures through the API (also cleans files)
  for (const id of [videoStatus.body._id, audioStatus.body._id, textOnly.body._id]) {
    await api('DELETE', `/api/status/${id}`, { token });
  }
  check('video file deleted after status cleanup', Boolean(videoPath && !fs.existsSync(videoPath)), videoPath);
  check('audio file deleted after status cleanup', Boolean(audioPath && !fs.existsSync(audioPath)), audioPath);

  // ------------------------------------------------------------- cleanup db
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', {
      serverSelectionTimeoutMS: 4000,
    });
    const User = require('../../src/models/User');
    await User.deleteMany({ email: new RegExp(`^status-${run}@chatgram\\.test$`) });
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
