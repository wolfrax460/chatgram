/**
 * 9b Groups page: search a group, inspect members, freeze/unfreeze and delete.
 * A test group is created through the real API and removed afterwards.
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

test.describe('groups administration', () => {
  test('search, freeze and delete a group from the dashboard', async ({ page }) => {
    const owner = await registerUser('grp-ui-owner');
    const member = await registerUser('grp-ui-member');
    const groupName = `PW GRP ${stamp}`;
    const created = await apiRequest('POST', '/api/chats', {
      token: owner.accessToken,
      body: { type: 'group', groupName, participantIds: [member.user.id] },
    });
    expect(created.status).toBe(201);
    const groupId = created.body._id || created.body.id;

    try {
      const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
      expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();

      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${APP}/admin/groups`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Groups' })).toBeVisible({ timeout: 30_000 });

      await page.getByLabel('Search groups').fill(groupName);
      const row = page.locator('.admin-table tbody tr').first();
      await expect(row).toContainText(groupName, { timeout: 20_000 });
      await expect(row).toContainText('active');
      await row.click();

      await expect(page.getByText('Moderation')).toBeVisible();
      await expect(page.getByText(member.user.displayName)).toBeVisible();

      await page.getByRole('button', { name: 'Freeze group' }).click();
      await page.getByRole('button', { name: 'Freeze group', exact: true }).last().click();
      await expect(page.getByText(/Group frozen/)).toBeVisible({ timeout: 20_000 });

      // A frozen group refuses messages for members.
      const blocked = await apiRequest('POST', '/api/messages', {
        token: member.accessToken,
        body: { chatId: groupId, type: 'text', content: 'blocked while frozen' },
      });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('GROUP_FROZEN');

      await page.getByRole('button', { name: 'Unfreeze group' }).click();
      await page.getByRole('button', { name: 'Unfreeze', exact: true }).last().click();
      await expect(page.getByText(/Group unfrozen/)).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Delete group' }).click();
      await expect(page.getByRole('dialog', { name: `Delete "${groupName}"?` })).toBeVisible();
      await page.getByRole('button', { name: 'Delete group', exact: true }).last().click();
      await expect(page.getByText('Group deleted.')).toBeVisible({ timeout: 20_000 });
      expect(errors, errors.join(' | ')).toHaveLength(0);
    } finally {
      if (mongoose.connection.readyState === 0) await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      const Chat = require('../../server/src/models/Chat');
      const Message = require('../../server/src/models/Message');
      await Message.deleteMany({ chatId: new mongoose.Types.ObjectId(String(groupId)) }).catch(() => {});
      await Chat.deleteOne({ _id: new mongoose.Types.ObjectId(String(groupId)) }).catch(() => {});
      await mongoose.connection.collection('users').deleteMany({
        _id: { $in: [owner.user.id, member.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) },
      });
    }
  });
});
