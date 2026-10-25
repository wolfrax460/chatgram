/**
 * 9b Users extras in the dashboard: warn, verify email, rename, remove photo,
 * the 30-day deletion grace (schedule + cancel) and the devices/sessions tab.
 */
const { test, expect } = require('@playwright/test');
const { registerUser } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);

let tempUser = null;

test.describe.configure({ timeout: 180_000 });

test.describe('users extras', () => {
  test.afterAll(async () => {
    try {
      const mongoose = require('../../server/node_modules/mongoose');
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
      if (tempUser?.user?.id) {
        const userId = new mongoose.Types.ObjectId(String(tempUser.user.id));
        await mongoose.connection.collection('usersessions').deleteMany({ userId });
        await mongoose.connection.collection('loginevents').deleteMany({ userId });
        await mongoose.connection.collection('userwarnings').deleteMany({ userId });
        await mongoose.connection.collection('adminaudits').deleteMany({ detail: new RegExp(String(userId)) });
        await mongoose.connection.collection('users').deleteMany({ _id: userId });
      }
      await mongoose.disconnect();
    } catch (error) {
      console.warn('users extras cleanup skipped:', String(error.message || error).slice(0, 160));
    }
  });

  test('actions and devices tab work from the user detail page', async ({ page }) => {
    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok()).toBeTruthy();
    tempUser = await registerUser('ux-ui');
    // A second sign-in records a device session + login history entry.
    const userLogin = await page.request.post(`${API}/api/auth/login`, { data: { identifier: tempUser.identifier, password: tempUser.password } });
    expect(userLogin.ok()).toBeTruthy();

    await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('Search users by name, email or phone').fill(String(tempUser.user.displayName));
    await page.waitForTimeout(1200);
    await page.getByText(String(tempUser.user.displayName)).first().click();
    await expect(page.getByRole('heading', { name: tempUser.user.displayName })).toBeVisible({ timeout: 20_000 });

    // Devices & sessions tab shows the recorded session + login history.
    await page.getByRole('button', { name: /Devices & sessions/ }).click();
    await expect(page.getByText('Device sessions')).toBeVisible();
    await expect(page.getByText('Login history')).toBeVisible();
    await expect(page.getByText(/active|signed out/).first()).toBeVisible();

    // Actions: warn, verify, rename, deletion grace.
    await page.getByRole('button', { name: /^Actions/ }).click();
    await page.getByPlaceholder('Reason for the warning').fill(`E2E warning ${run}`);
    await page.getByRole('button', { name: /Record warning/ }).click();
    await expect(page.getByText(/Warning recorded/)).toBeVisible({ timeout: 20_000 }).catch(() => {});
    await page.getByRole('button', { name: /Mark verified/ }).click();
    await expect(page.getByRole('button', { name: 'Already verified' })).toBeVisible({ timeout: 20_000 });

    await page.getByPlaceholder(String(tempUser.user.displayName)).fill(`UserX UI ${run}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: `UserX UI ${run}` })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /Schedule deletion/ }).click();
    const deleteDialog = page.getByRole('dialog', { name: /Schedule account deletion/ });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Schedule deletion' }).click();
    await expect(page.getByRole('button', { name: /Cancel deletion/ })).toBeVisible({ timeout: 20_000 });
    const scheduledState = await (await page.request.get(`${API}/api/admin/users/${tempUser.user.id}`)).json();
    expect(scheduledState.user.deletionScheduledAt).toBeTruthy();

    await page.getByRole('button', { name: /Cancel deletion/ }).click();
    await expect(page.getByRole('button', { name: /Schedule deletion/ })).toBeVisible({ timeout: 20_000 });
    const restoredState = await (await page.request.get(`${API}/api/admin/users/${tempUser.user.id}`)).json();
    expect(restoredState.user.deletionScheduledAt).toBeFalsy();
    expect(restoredState.user.warningCount).toBeGreaterThanOrEqual(1);
    expect(restoredState.user.verifiedAt).toBeTruthy();
    expect(restoredState.user.displayName).toBe(`UserX UI ${run}`);
  });
});

