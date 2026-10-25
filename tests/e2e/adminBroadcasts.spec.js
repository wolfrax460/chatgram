/**
 * 9b Announcements: banner publishing with confirmation, the in-app banner a
 * signed-in user actually sees, and the message-broadcast preview flow.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const bannerText = `E2E announcement ${run}: Chatgram AI is in your chat list.`;

let adminHeaders = null;
let tempUser = null;
const createdBodies = [bannerText, `E2E broadcast ${run}: welcome to Chatgram.`];

async function adminSession(request) {
  const login = await request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
  expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();
  const cookies = login.headers()['set-cookie'] || '';
  const cookie = cookies.split(',').map((part) => part.split(';')[0]).join('; ');
  const body = await login.json();
  return { Cookie: cookie, 'X-Admin-CSRF': body.csrfToken };
}

test.describe.configure({ timeout: 180_000 });

test.describe('announcements and broadcasts', () => {
  test.afterAll(async () => {
    try {
      const mongoose = require('../../server/node_modules/mongoose');
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
      const broadcasts = await mongoose.connection.collection('broadcasts').find({ body: { $in: createdBodies } }).toArray();
      const ids = broadcasts.map((row) => row._id);
      await mongoose.connection.collection('broadcasts').deleteMany({ _id: { $in: ids } });
      if (tempUser?.user?.id) {
        const userId = new mongoose.Types.ObjectId(String(tempUser.user.id));
        const chats = await mongoose.connection.collection('chats').find({ participants: userId }).toArray();
        const chatIds = chats.map((row) => row._id);
        await mongoose.connection.collection('messages').deleteMany({ chatId: { $in: chatIds } });
        await mongoose.connection.collection('chats').deleteMany({ _id: { $in: chatIds } });
        await mongoose.connection.collection('users').deleteMany({ _id: userId });
      }
      await mongoose.connection.collection('adminaudits').deleteMany({ detail: new RegExp(run) });
      await mongoose.disconnect();
    } catch (error) {
      console.warn('announcement cleanup skipped:', String(error.message || error).slice(0, 160));
    }
  });

  test('banner publish flow, in-app banner and message preview', async ({ page }) => {
    adminHeaders = await adminSession(page.request);
    tempUser = await registerUser('cast-ui');
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));

    // Admin: create and publish a banner.
    await page.goto(`${APP}/admin/broadcasts`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Announcement type').click();
    await page.getByRole('option', { name: 'In-app banner' }).click();
    await page.getByPlaceholder(/New: Chatgram AI is now/).fill(bannerText);
    await page.getByRole('button', { name: /Save draft/ }).click();
    await expect(page.getByText(bannerText.slice(0, 40))).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Publish/ }).first().click();
    await expect(page.getByRole('dialog', { name: /Publish this banner/ })).toBeVisible();
    await page.getByRole('button', { name: 'Publish banner' }).click();
    await expect(page.getByText('sent').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The public endpoint now serves the banner.
    const publicBanner = await (await page.request.get(`${API}/api/app/announcements`)).json();
    expect(publicBanner.banner?.body).toBe(bannerText);

    // A signed-in user sees it in the app and can dismiss it.
    await signIn(page, tempUser);
    await page.goto(`${APP}/web/`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('announcement-banner')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('announcement-banner')).toContainText(bannerText);
    await page.getByRole('button', { name: /Dismiss announcement/ }).click();
    await expect(page.getByTestId('announcement-banner')).toHaveCount(0);

    // Message broadcast: preview shows the audience and requires confirmation.
    const draft = await page.request.post(`${API}/api/admin/broadcasts`, {
      headers: adminHeaders,
      data: { kind: 'message', body: createdBodies[1], segment: 'selected', recipientIds: [tempUser.user.id] },
    });
    expect(draft.ok(), `message draft: ${draft.status()}`).toBeTruthy();
    await page.goto(`${APP}/admin/broadcasts`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Preview & send/ }).first().click();
    const dialog = page.getByRole('dialog', { name: /Send this message/ });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText('1 accounts');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    expect(errors, errors.join(' | ')).toHaveLength(0);
  });
});
