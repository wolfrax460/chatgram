/**
 * 9b Users table extras: row selection + safe bulk actions, saved filter views
 * and column visibility (persisted in localStorage).
 */
const { test, expect } = require('@playwright/test');
const { registerUser } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);

let tempUser = null;

test.describe.configure({ timeout: 180_000 });

test.describe('users table extras', () => {
  test.afterAll(async () => {
    try {
      const mongoose = require('../../server/node_modules/mongoose');
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
      if (tempUser?.user?.id) await mongoose.connection.collection('users').deleteMany({ _id: new mongoose.Types.ObjectId(String(tempUser.user.id)) });
      await mongoose.connection.collection('adminaudits').deleteMany({ detail: /action=force-logout/ });
      await mongoose.disconnect();
    } catch (error) {
      console.warn('bulk ui cleanup skipped:', String(error.message || error).slice(0, 160));
    }
  });

  test('selection bulk action, saved view and column visibility', async ({ page }) => {
    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok()).toBeTruthy();
    tempUser = await registerUser('bulk-ui');
    await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('Search users by name, email or phone').fill(String(tempUser.user.displayName));
    await page.waitForTimeout(1000);

    // Saved view: name it, save, and it survives a reload.
    const viewName = `bulk view ${run}`;
    await page.getByLabel('Saved view name').fill(viewName);
    await page.getByRole('button', { name: 'Save view' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByPlaceholder('Search users by name, email or phone').fill(String(tempUser.user.displayName));
    await page.waitForTimeout(900);
    await page.getByLabel('Saved filter views').click();
    await expect(page.getByRole('option', { name: viewName })).toBeVisible();
    await page.getByRole('option', { name: viewName }).click();

    // Column visibility: hide Last seen.
    await expect(page.getByLabel(`Select ${tempUser.user.displayName}`)).toBeVisible({ timeout: 20_000 });
    const lastSeenCells = page.getByTestId('last-seen-cell');
    await expect(lastSeenCells.first()).toBeVisible({ timeout: 20_000 });
    const before = await lastSeenCells.count();
    expect(before).toBeGreaterThan(0);
    await page.getByRole('button', { name: /Last seen/ }).click();
    await expect(page.getByTestId('last-seen-cell')).toHaveCount(0);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('last-seen-cell')).toHaveCount(0);

    // Row selection + bulk force logout.
    await page.getByRole('button', { name: /Last seen/ }).click();
    await page.getByPlaceholder('Search users by name, email or phone').fill(String(tempUser.user.displayName));
    await page.waitForTimeout(1000);
    await page.getByLabel(`Select ${tempUser.user.displayName}`).check();
    await expect(page.getByText(/1 selected/)).toBeVisible();
    await page.getByRole('button', { name: /Force logout/ }).click();
    // The user's existing access token must stop working after the bulk logout.
    await expect
      .poll(async () => {
        const revoked = await page.request.get(`${API}/api/users/${tempUser.user.id}`, {
          headers: { Authorization: `Bearer ${tempUser.accessToken}` },
        });
        return revoked.status();
      }, { timeout: 20_000 })
      .toBe(401);
    await expect(page.getByText(/1 selected/)).toHaveCount(0);
  });
});
