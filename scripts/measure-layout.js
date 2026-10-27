#!/usr/bin/env node
/**
 * One-off layout measurement (not part of any test suite).
 * Signs in with a temporary local staging account, opens a chat at 1366x620 and
 * 1920x1080 and prints the viewport/document numbers for the app-shell fix.
 *
 *   node scripts/measure-layout.js
 */
const { chromium } = require('playwright');

const API = 'http://127.0.0.1:5000';
const APP = 'http://127.0.0.1:5174/';
const stamp = Date.now().toString(36);

async function login() {
  const stamp = Date.now().toString(36);
  const register = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `Layout User ${stamp}`, identifier: `layout-${stamp}@chatgram.test`, password: 'Layout1!' }),
  });
  if (!register.ok) throw new Error(`staging register: ${register.status} ${(await register.text()).slice(0, 120)}`);
  return register.json();
}

async function measure(page) {
  return page.evaluate(() => {
    // Fixed build: the .composer-safe wrapper sits at the viewport bottom.
    // Pre-fix build: walk up from the textarea to the composer container.
    let composer = document.querySelector('.composer-safe');
    if (!composer) {
      const input = document.querySelector('textarea[placeholder="Message Chatgram AI"], textarea[placeholder="Type a message"]');
      composer = input;
      while (composer && composer !== document.body) {
        const borderTop = getComputedStyle(composer.parentElement || composer).borderTopWidth;
        if (borderTop && borderTop !== '0px') {
          composer = composer.parentElement;
          break;
        }
        composer = composer.parentElement;
      }
      if (composer === document.body) composer = input;
    }
    const rect = composer ? composer.getBoundingClientRect() : null;
    return {
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      scrollYAfterWheel: (() => {
        window.scrollTo(0, 500);
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 500 }));
        return window.scrollY;
      })(),
      composerGap: rect ? Math.round((window.innerHeight - rect.bottom) * 10) / 10 : null,
    };
  });
}

async function setupChat(a) {
  const stamp = Date.now().toString(36);
  const register = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `Layout Partner ${stamp}`, identifier: `layout-partner-${stamp}@chatgram.test`, password: 'Layout1!' }),
  });
  const partner = await register.json();
  const chatResponse = await fetch(`${API}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({ type: 'direct', participantId: partner.user.id }),
  });
  const chat = await chatResponse.json();
  const chatId = chat._id || chat.id;
  for (let index = 1; index <= 40; index += 1) {
    await fetch(`${API}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${partner.accessToken}` },
      body: JSON.stringify({ chatId, type: 'text', content: `Layout message ${index}` }),
    });
  }
  return partner;
}

(async () => {
  const a = await login();
  const partner = await setupChat(a);

  const browser = await chromium.launch();
  const results = {};
  for (const [label, width, height] of [['1366x620', 1366, 620], ['1920x1080', 1920, 1080]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.addInitScript(([access, refresh, user]) => {
      localStorage.setItem('chatgram.theme', 'dark');
      localStorage.setItem('chatgram.accessToken', access);
      localStorage.setItem('chatgram.refreshToken', refresh || '');
      localStorage.setItem('chatgram.session.user', user);
    }, [a.accessToken, a.refreshToken || '', JSON.stringify(a.user)]);
    // Vite's first cold load can momentarily render the auth page while the
    // dependency pre-bundle settles; retry until the shell is really up.
    let ready = false;
    for (let attempt = 0; attempt < 4 && !ready; attempt += 1) {
      await page.goto(APP, { waitUntil: 'networkidle' });
      try {
        await page.getByTestId('ai-chat-row').waitFor({ timeout: 8_000 });
        ready = true;
      } catch {
        await page.waitForTimeout(1_500);
      }
    }
    if (!ready) throw new Error('app shell did not render for the staging account');
    // Open the long direct chat: the layout the bug report shows.
    await page.getByText(partner.user.displayName, { exact: false }).first().click({ timeout: 20_000 });
    await page.waitForSelector('.composer-safe, textarea[placeholder="Message Chatgram AI"], textarea[placeholder="Type a message"]', { timeout: 15_000 });
    await page.waitForTimeout(400);
    results[label] = await measure(page);
    await context.close();
  }
  await browser.close();

  console.log(JSON.stringify(results));
  process.exit(0);
})().catch((error) => {
  console.error('measurement failed:', String((error && error.stack) || error).slice(0, 500));
  process.exit(1);
});
