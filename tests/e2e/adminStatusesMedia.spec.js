/**
 * 9b Statuses & media page: KPI cards, status list + drawer removal, media
 * library with attachment removal. A status and a message attachment are seeded
 * for the test and cleaned up afterwards.
 */
const { test, expect } = require('@playwright/test');
let mongoose;
try {
  mongoose = require('mongoose');
} catch {
  mongoose = require('../../server/node_modules/mongoose');
}
const { apiRequest, registerUser } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const stamp = Date.now().toString(36);

test.describe.configure({ timeout: 120_000 });

test.describe('statuses and media', () => {
  test('status removal and attachment removal are audited and rendered', async ({ page }) => {
    const owner = await registerUser('media-ui-owner');
    const viewer = await registerUser('media-ui-viewer');
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const Status = require('../../server/src/models/Status');
    const status = await Status.create({
      userId: owner.user.id,
      text: `PW media status ${stamp}`,
      mediaUrl: 'https://res.cloudinary.com/demo/image/upload/pw-sample.jpg',
      mediaType: 'image',
      mediaSize: 65432,
    });
    const chat = await apiRequest('POST', '/api/chats', {
      token: owner.accessToken,
      body: { type: 'direct', participantId: viewer.user.id },
    });
    const chatId = chat.body._id || chat.body.id;
    const message = await apiRequest('POST', '/api/messages', {
      token: owner.accessToken,
      body: { chatId, type: 'image', mediaUrl: 'https://res.cloudinary.com/demo/image/upload/pw-attachment.jpg' },
    });
    const messageId = message.body._id || message.body.id;

    try {
      const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
      expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();

      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${APP}/admin/statuses`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Statuses & media' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Status media', { exact: true })).toBeVisible();
      await expect(page.getByText('Message attachments', { exact: true })).toBeVisible();

      await page.getByLabel('Filter statuses or media').fill(`PW media status ${stamp}`);
      const statusRow = page.locator('.admin-table tbody tr').first();
      await expect(statusRow).toContainText(`PW media status ${stamp}`, { timeout: 20_000 });
      await statusRow.click();
      await expect(page.getByRole('button', { name: 'Remove status' })).toBeVisible();
      await page.getByRole('button', { name: 'Remove status' }).click();
      await page.getByRole('button', { name: 'Remove status', exact: true }).last().click();
      await expect(page.getByText('Status removed.')).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Media library' }).click();
      await page.getByLabel('Filter statuses or media').fill('');
      await expect(page.getByText('Media library')).toBeVisible();
      const mediaRow = page.locator('.admin-table tbody tr').first();
      await expect(mediaRow).toBeVisible({ timeout: 20_000 });
      await mediaRow.click();
      await expect(page.getByRole('button', { name: /Remove attachment/ })).toBeVisible();
      await page.getByRole('button', { name: /Remove attachment/ }).click();
      await page.getByRole('button', { name: 'Remove attachment', exact: true }).last().click();
      await expect(page.getByText('Message media removed for everyone.')).toBeVisible({ timeout: 20_000 });
      expect(errors, errors.join(' | ')).toHaveLength(0);
    } finally {
      const Message = require('../../server/src/models/Message');
      await Status.deleteMany({ userId: new mongoose.Types.ObjectId(String(owner.user.id)) });
      await Message.deleteMany({ chatId: new mongoose.Types.ObjectId(String(chatId)) });
      await mongoose.connection.collection('chats').deleteOne({ _id: new mongoose.Types.ObjectId(String(chatId)) });
      await mongoose.connection.collection('users').deleteMany({
        _id: { $in: [owner.user.id, viewer.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) },
      });
      await mongoose.disconnect();
    }
  });
});
