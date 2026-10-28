/* Scratch verification for the OTP banners + chat-list reply preview
 * (not committed, no Playwright suite added). */
const { chromium } = require('playwright');
const mongoose = require('F:/projects/chatgram/server/node_modules/mongoose');

const API = 'http://127.0.0.1:5004';
const WEB = 'http://127.0.0.1:5174';
const MONGO = 'mongodb://127.0.0.1:27017/chatgram_staging_msg';
const PASSWORD = 'OtpTestPass1!';
const run = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function register(label) {
  const res = await api('POST', '/api/auth/register', {
    body: { displayName: `Otp ${label} ${run}`, identifier: `otp-${run}-${label}@chatgram.test`, password: PASSWORD },
  });
  if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, refresh: res.body.refreshToken, user: res.body.user, identifier: `otp-${run}-${label}@chatgram.test` };
}

async function main() {
  const browser = await chromium.launch();

  /* ---------------------------------------------------------- PART 1: signup */
  const email = `otp-flow-${run}@chatgram.test`;
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(WEB);
  await page.getByTestId('go-signup').click();
  await page.fill('#signup-name', `Otp Tester ${run}`);
  await page.fill('#signup-identifier', email);
  await page.fill('#signup-password', PASSWORD);
  await page.fill('#signup-confirm', PASSWORD);
  await page.locator('input[type="checkbox"]').check();
  await page.getByTestId('auth-primary').click();
  await page.waitForSelector('#signup-code', { timeout: 25000 });

  const banner = async () => {
    const el = page.locator('div[role="alert"]').first();
    return (await el.count()) ? (await el.innerText()).trim() : '(no banner)';
  };
  const submitCode = async (value) => {
    await page.fill('#signup-code', value);
    await page.getByTestId('auth-primary').click();
    await sleep(700);
    return { banner: await banner(), value: await page.inputValue('#signup-code') };
  };

  let result = await submitCode('111111');
  console.log('1) wrong code   ->', JSON.stringify(result.banner));
  console.log('   digits kept  ->', JSON.stringify(result.value));
  console.log('   resend visible ->', await page.getByRole('button', { name: 'Resend code' }).isVisible());

  for (let attempt = 2; attempt <= 5; attempt += 1) {
    result = await submitCode('111111');
  }
  result = await submitCode('111111');
  console.log('2) 6th attempt  ->', JSON.stringify(result.banner));
  result = await submitCode('111111');
  console.log('3) code gone    ->', JSON.stringify(result.banner));

  // Resend, then make the live code expire in the local staging DB only.
  await page.getByRole('button', { name: 'Resend code' }).click();
  await sleep(900);
  await mongoose.connect(MONGO);
  const expired = await mongoose.connection.db
    .collection('verificationcodes')
    .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
  console.log('   staged DB rows expired:', expired.modifiedCount);
  result = await submitCode('222222');
  console.log('4) expired code ->', JSON.stringify(result.banner));
  console.log('   resend visible ->', await page.getByRole('button', { name: 'Resend code' }).isVisible());
  await page.screenshot({ path: 'F:\\projects\\chatgram\\test-results\\otp-expired-banner.png' });

  /* ---------------------------------------- PART 2: identifier change confirm */
  const owner = await register('owner');
  const newEmail = `otp-new-${run}@chatgram.test`;
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => console.log('[pageerror:settings]', String(e).slice(0, 200)));
  await page2.addInitScript(([access, refresh, user]) => {
    localStorage.setItem('chatgram.accessToken', access);
    localStorage.setItem('chatgram.refreshToken', refresh || '');
    localStorage.setItem('chatgram.session.user', user);
  }, [owner.token, owner.refresh || '', JSON.stringify(owner.user)]);
  await page2.goto(WEB);
  await page2.waitForSelector('nav', { state: 'attached', timeout: 30000 });
  await page2.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page2.getByText('Change email or phone', { exact: false }).first().click();
  await page2.fill('#new-identifier', newEmail);
  await page2.getByText('Send verification code', { exact: false }).first().click();
  await page2.waitForSelector('#identifier-code', { timeout: 20000 });
  await page2.fill('#identifier-code', '000000');
  await page2.fill('#identifier-password', PASSWORD);
  await page2.getByText('Verify and save', { exact: false }).first().click();
  await sleep(900);
  const settingsBanner = await page2.locator('[role="alert"]').first().innerText();
  console.log('5) identifier confirm wrong code ->', JSON.stringify(settingsBanner.trim()));

  /* ------------------------------------------------- PART 3: chat list preview */
  const alice = await register('alice');
  const bob = await register('bob');
  const chat = await api('POST', '/api/chats', {
    token: alice.token,
    body: { type: 'direct', participantId: String(bob.user.id || bob.user._id) },
  });
  const chatId = String(chat.body._id || chat.body.id);
  await api('POST', '/api/messages', { token: bob.token, body: { chatId, type: 'text', content: 'original from bob' } });
  await api('POST', '/api/messages', { token: alice.token, body: { chatId, type: 'text', content: `> Bob: original from bob\nmy reply text ${run}` } });

  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page3 = await ctx3.newPage();
  await page3.addInitScript(([access, refresh, user]) => {
    localStorage.setItem('chatgram.accessToken', access);
    localStorage.setItem('chatgram.refreshToken', refresh || '');
    localStorage.setItem('chatgram.session.user', user);
  }, [alice.token, alice.refresh || '', JSON.stringify(alice.user)]);
  await page3.goto(WEB);
  await page3.waitForSelector('nav', { state: 'attached', timeout: 30000 });
  await sleep(2500);
  const row = page3.getByText(`Otp bob ${run}`, { exact: false }).first();
  const rowBox = await row.boundingBox();
  const sidebar = await page3.getByRole('complementary').innerText();
  const previewLine = sidebar.split('\n').filter((line) => line.includes('my reply text') || line.includes('original from bob') || line.includes('>'));
  console.log('6) OUTGOING reply preview lines:', JSON.stringify(previewLine));
  console.log('   sidebar contains ">":', sidebar.includes('>'));

  await api('POST', '/api/messages', { token: bob.token, body: { chatId, type: 'text', content: `> Alice: original from alice\nsure thing ${run}` } });
  await sleep(2500);
  const sidebar2 = await page3.getByRole('complementary').innerText();
  const previewLine2 = sidebar2.split('\n').filter((line) => line.includes('sure thing') || line.includes('>'));
  console.log('7) INCOMING reply preview lines:', JSON.stringify(previewLine2));
  console.log('   sidebar contains ">":', sidebar2.includes('>'));
  await page3.screenshot({ path: 'F:\\projects\\chatgram\\test-results\\chatlist-reply-preview.png' });
  void rowBox;

  await mongoose.disconnect();
  await browser.close();
  console.log('\nDONE run', run);
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });

