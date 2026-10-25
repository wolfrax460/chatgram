/**
 * 9b moderation UI: the reports queue resolves a real message report with an
 * audited action, and the user detail page suspends an account (login blocked),
 * then restores it.
 */
const { test, expect } = require('@playwright/test');
let mongoose;
try {
  mongoose = require('mongoose');
} catch {
  // mongoose lives in the server workspace; Playwright runs from the repo root.
  mongoose = require('../../server/node_modules/mongoose');
}
const { apiRequest, registerUser } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';
const stamp = Date.now().toString(36);

test.describe.configure({ timeout: 180_000 });

async function adminLogin(page) {
  const response = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
  expect(response.ok(), `admin login: ${response.status()}`).toBeTruthy();
}

test.describe('reports and account moderation', () => {
  test('the report queue shows a message report and resolving it is audited', async ({ page }) => {
    const reporter = await registerUser('mod-ui-reporter');
    const target = await registerUser('mod-ui-target');
    let reportId = null;
    try {
      const chat = await apiRequest('POST', '/api/chats', { token: reporter.accessToken, body: { type: 'direct', participantId: target.user.id } });
      const chatId = chat.body._id || chat.body.id;
      const message = await apiRequest('POST', '/api/messages', { token: target.accessToken, body: { chatId, type: 'text', content: `ui report content ${stamp}` } });
      const messageId = message.body._id || message.body.id;
      const report = await apiRequest('POST', `/api/messages/${messageId}/report`, {
        token: reporter.accessToken,
        body: { reason: 'spam', details: `reported from the ui ${stamp}` },
      });
      reportId = report.body.reportId;
      expect(report.status).toBe(201);

      await adminLogin(page);
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${APP}/admin/reports`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Reports & moderation' })).toBeVisible({ timeout: 30_000 });

      const search = page.getByLabel('Search reports');
      await search.fill(`reported from the ui ${stamp}`);
      const row = page.locator('.admin-table tbody tr').first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).toContainText('spam');
      await row.click();
      await expect(page.getByText('Report detail')).toBeVisible();
      await expect(page.getByText(`ui report content ${stamp}`, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/read-only/).first()).toBeVisible();

      await page.getByRole('button', { name: 'Dismiss' }).click();
      await expect(page.getByRole('dialog', { name: 'Dismiss this report?' })).toBeVisible();
      await page.getByRole('button', { name: 'Dismiss report' }).click();
      await expect(page.getByText('Report dismissed.')).toBeVisible({ timeout: 20_000 });
      expect(errors, errors.join(' | ')).toHaveLength(0);
    } finally {
      if (mongoose.connection.readyState === 0) await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      await mongoose.connection.collection('reports').deleteMany({ reporterId: new mongoose.Types.ObjectId(String(reporter.user.id)) });
      await mongoose.connection.collection('users').deleteMany({ _id: { $in: [reporter.user.id, target.user.id].map((id) => new mongoose.Types.ObjectId(String(id))) } });
    }
  });

  test('user detail suspends an account and blocks sign-in, then restores it', async ({ page }) => {
    const target = await registerUser('mod-ui-suspend');
    try {
      await adminLogin(page);
      await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 30_000 });
      await page.getByLabel('Search users').fill(target.identifier);
      const row = page.locator('.admin-table tbody tr').first();
      await expect(row).toContainText(target.identifier, { timeout: 20_000 });
      await row.click();
      await expect(page.getByRole('heading', { name: target.user.displayName })).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Actions' }).click();
      await expect(page.getByText('Suspend or ban this account')).toBeVisible();
      await page.getByLabel('Suspension days').fill('2');
      await page.getByLabel('Reason (recorded in the audit log)').fill(`e2e suspension ${stamp}`);
      await page.getByRole('button', { name: 'Suspend' }).click();
      await expect(page.getByRole('dialog', { name: `Suspend ${target.user.displayName}?` })).toBeVisible();
      await page.getByRole('button', { name: 'Suspend account' }).click();
      await expect(page.getByText(/suspended for 2 day/)).toBeVisible({ timeout: 20_000 });

      const blocked = await apiRequest('POST', '/api/auth/login', { body: { identifier: target.identifier, password: target.password } });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('ACCOUNT_SUSPENDED');

      // Restore access through the same page, then the account signs in again.
      await page.getByRole('button', { name: 'Restore access' }).click();
      await expect(page.getByRole('dialog', { name: new RegExp(`Restore ${target.user.displayName}`) })).toBeVisible();
      await page.getByRole('button', { name: 'Restore access', exact: true }).last().click();
      await expect(page.getByText(/is active again/)).toBeVisible({ timeout: 20_000 });
      const restored = await apiRequest('POST', '/api/auth/login', { body: { identifier: target.identifier, password: target.password } });
      expect(restored.status).toBe(200);
    } finally {
      if (mongoose.connection.readyState === 0) await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      await mongoose.connection.collection('users').deleteOne({ _id: new mongoose.Types.ObjectId(String(target.user.id)) });
    }
  });
});
