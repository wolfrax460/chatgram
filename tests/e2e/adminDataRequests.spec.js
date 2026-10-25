/**
 * 9b Data requests page: a pending export request is created through the API,
 * then built and downloaded through the UI; a deletion request is created and
 * cancelled through the API and shows in the list.
 */
const { test, expect } = require('@playwright/test');
let mongoose;
try {
  mongoose = require('mongoose');
} catch {
  mongoose = require('../../server/node_modules/mongoose');
}
const { registerUser } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';

test.describe.configure({ timeout: 120_000 });

test.describe('data requests', () => {
  test('build an export from the queue and cancel a scheduled deletion', async ({ page }) => {
    const subject = await registerUser('dr-ui-subject');
    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();
    const loginBody = await login.json();
    const csrf = loginBody.csrfToken;

    const exportRequest = await page.request.post(`${API}/api/admin/data-requests`, {
      data: { userId: subject.user.id, type: 'export', reason: 'pw export' },
      headers: { 'X-Admin-CSRF': csrf },
    });
    expect(exportRequest.status(), `create export: ${exportRequest.status()}`).toBe(201);
    const exportId = (await exportRequest.json()).request.id;

    const deleteRequest = await page.request.post(`${API}/api/admin/data-requests`, {
      data: { userId: subject.user.id, type: 'delete', graceDays: 30, reason: 'pw delete' },
      headers: { 'X-Admin-CSRF': csrf },
    });
    expect(deleteRequest.status(), `create delete: ${deleteRequest.status()}`).toBe(201);
    const deleteId = (await deleteRequest.json()).request.id;
    const cancel = await page.request.post(`${API}/api/admin/data-requests/${deleteId}/cancel`, { headers: { 'X-Admin-CSRF': csrf } });
    expect(cancel.ok(), `cancel: ${cancel.status()}`).toBeTruthy();

    try {
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${APP}/admin/data-requests`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Data requests' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('New request')).toBeVisible();

      const buildButton = page.getByRole('button', { name: 'Build export' }).first();
      await expect(buildButton).toBeVisible({ timeout: 20_000 });
      await buildButton.click();
      await expect(page.getByRole('dialog', { name: 'Build this export now?' })).toBeVisible();
      await page.getByRole('button', { name: 'Build export', exact: true }).last().click();
      await expect(page.getByText(/Export ready/)).toBeVisible({ timeout: 20_000 });

      const completedRow = page.locator('.admin-table tbody tr', { hasText: subject.identifier }).filter({ hasText: 'completed' }).first();
      await expect(completedRow).toBeVisible({ timeout: 20_000 });
      await expect(completedRow.getByRole('link', { name: 'Download' })).toBeVisible();

      // The cancelled deletion is listed with the cancelled status.
      await page.getByRole('button', { name: 'Cancelled' }).click();
      await expect(page.locator('.admin-table tbody tr', { hasText: subject.identifier }).filter({ hasText: 'cancelled' }).first()).toBeVisible({ timeout: 20_000 });
      expect(errors, errors.join(' | ')).toHaveLength(0);
    } finally {
      await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 }).catch(() => undefined);
      const DataRequest = require('../../server/src/models/DataRequest');
      await DataRequest.deleteMany({ _id: { $in: [exportId, deleteId] } }).catch(() => undefined);
      await mongoose.connection.collection('users').deleteOne({ email: subject.identifier }).catch(() => undefined);
      await mongoose.disconnect().catch(() => undefined);
    }
  });
});
