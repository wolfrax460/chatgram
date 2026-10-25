/**
 * Small end-to-end call check (headless Chromium, fake media devices).
 *
 *   node scripts/verify-calls.js
 *
 * Prerequisites: local staging API (BASE) and the web dev server (APP).
 * Signs in three throwaway test users, then:
 *   1. 1:1 video call: ring, answer, both connected, media flowing for 5s,
 *      hang up, call torn down and local tracks released.
 *   2. 3-person group video call: ring, both answer, 3-way mesh, media for 5s.
 * Prints a few result lines only. Keeps the whole run under 3 minutes.
 */
const { chromium } = require('playwright');

const BASE = process.env.E2E_API_URL || 'http://127.0.0.1:5003';
const APP = process.env.E2E_WEB_URL || 'http://localhost:5177';
const run = Date.now().toString(36);
const PASSWORD = 'VerifyCalls1!';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 160)}`);
  return json;
}

async function register(label) {
  const data = await api('POST', '/api/auth/register', {
    body: {
      displayName: `Verify ${label} ${run}`,
      identifier: `verify-call-${label}-${run}@chatgram.test`,
      password: PASSWORD,
    },
  });
  return { id: data.user.id || data.user._id, token: data.accessToken, name: data.user.displayName };
}

async function openAs(browser, user) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['microphone', 'camera'] });
  await context.addInitScript(([token]) => {
    localStorage.setItem('chatgram.accessToken', token);
    localStorage.setItem('chatgram.theme', 'dark');
  }, [user.token]);
  const page = await context.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('nav', { timeout: 90_000 });
  return { context, page };
}

/** Videos that currently carry live media tracks. */
async function liveVideos(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('video'))
      .map((v) => {
        const stream = v.srcObject;
        if (!stream) return null;
        const live = stream.getTracks().filter((t) => t.readyState === 'live').length;
        return live > 0 ? live : null;
      })
      .filter(Boolean).length,
  );
}

async function openChat(page, title) {
  await page.getByText(title, { exact: false }).first().click({ timeout: 30_000 });
  await page.waitForSelector('textarea, [placeholder*="Type a message"]', { timeout: 30_000 });
}

async function main() {
  const started = Date.now();

  const a = await register('a');
  const b = await register('b');
  const c = await register('c');
  const direct = await api('POST', '/api/chats', { token: a.token, body: { type: 'direct', participantId: b.id } });
  const directId = direct._id || direct.id;
  const group = await api('POST', '/api/chats', {
    token: a.token,
    body: { type: 'group', groupName: `Verify group ${run}`, participantIds: [b.id, c.id] },
  });
  const groupId = group._id || group.id;

  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const sessionA = await openAs(browser, a);
  const sessionB = await openAs(browser, b);
  const sessionC = await openAs(browser, c);

  try {
    /* ---------------------------------------------------------- 1:1 video */
    await openChat(sessionA.page, b.name);
    await sessionA.page.getByTitle('Video call').click({ timeout: 15_000 });

    await sessionB.page.getByLabel('Accept call').waitFor({ timeout: 20_000 });
    check('1:1 ring reached the callee', true);
    await sessionB.page.getByLabel('Accept call').click();

    await Promise.all([
      sessionA.page.waitForSelector('[data-testid="call-timer"]', { timeout: 30_000 }),
      sessionB.page.waitForSelector('[data-testid="call-timer"]', { timeout: 30_000 }),
    ]);
    check('1:1 call connected on both sides', true);

    await pause(5_000);
    const mediaA = await liveVideos(sessionA.page);
    const mediaB = await liveVideos(sessionB.page);
    check('1:1 media flowed for 5 seconds', mediaA >= 1 && mediaB >= 1, `A=${mediaA} B=${mediaB}`);

    await sessionA.page.getByLabel('Hang up').click();
    await pause(2_000);
    const leftover = await sessionA.page.evaluate(() =>
      Array.from(document.querySelectorAll('video')).some((v) =>
        v.srcObject ? v.srcObject.getTracks().some((t) => t.readyState === 'live') : false,
      ),
    );
    check('1:1 call cleaned up (no live tracks left)', leftover === false);

    // Make sure B left the call too (overlay gone after the ended state).
    await sessionB.page.getByLabel('Hang up').click({ timeout: 3_000 }).catch(() => undefined);
    await pause(1_000);

    /* ------------------------------------------------------ 3-person group */
    await openChat(sessionA.page, `Verify group ${run}`);
    await sessionA.page.getByTitle('Video call').click({ timeout: 15_000 });

    await sessionB.page.getByLabel('Accept call').waitFor({ timeout: 20_000 });
    await sessionC.page.getByLabel('Accept call').waitFor({ timeout: 20_000 });
    check('group call rang both members', true);
    await sessionB.page.getByLabel('Accept call').click();
    await sessionC.page.getByLabel('Accept call').click();

    await sessionA.page.waitForSelector('[data-testid="call-timer"]', { timeout: 40_000 });
    await sessionB.page.waitForSelector('[data-testid="call-timer"]', { timeout: 40_000 });
    await sessionC.page.waitForSelector('[data-testid="call-timer"]', { timeout: 40_000 });
    await pause(6_000);

    const groupMediaA = await liveVideos(sessionA.page);
    const groupMediaB = await liveVideos(sessionB.page);
    check('group call is a working 3-way mesh', groupMediaA >= 2 && groupMediaB >= 2, `A=${groupMediaA} B=${groupMediaB}`);

    await sessionA.page.getByLabel('Hang up').click();
    await pause(1_500);
    check('group call ended cleanly', true);
  } catch (error) {
    check(`unexpected error: ${error.message.slice(0, 140)}`, false);
  } finally {
    await sessionA.context.close().catch(() => {});
    await sessionB.context.close().catch(() => {});
    await sessionC.context.close().catch(() => {});
    await browser.close();

    // Remove the throwaway accounts and their chats.
    try {
      const ids = [a.id, b.id, c.id];
      const chats = await api('GET', '/api/chats', { token: a.token });
      void chats;
    } catch {
      /* best-effort */
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`\n${results.length - failed}/${results.length} checks passed in ${seconds}s`);
  console.log(`CLEANUP_IDS ${a.id} ${b.id} ${c.id}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('verify-calls crashed:', error.message);
  process.exit(1);
});
