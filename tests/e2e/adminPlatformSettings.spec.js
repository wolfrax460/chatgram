/**
 * 9b Feature flags page: the admin page renders, a flag change reaches the
 * public feature feed, and it is restored.
 */
const { test, expect } = require('@playwright/test');
let mongoose;
try {
  mongoose = require('mongoose');
} catch {
  mongoose = require('../../server/node_modules/mongoose');
}

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging';

test.describe.configure({ timeout: 120_000 });

test.describe('feature flags & maintenance', () => {
  test('the page renders and a saved flag reaches the public feed', async ({ page }) => {
    const adminLogin = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(adminLogin.ok(), `admin login: ${adminLogin.status()}`).toBeTruthy();
    const adminBody = await adminLogin.json();

    try {
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${APP}/admin/flags`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Feature flags & maintenance' })).toBeVisible({ timeout: 30_000 });
      for (const label of ['Registration', 'Status', 'Groups', 'File uploads', 'Chatgram AI', 'Support widget']) {
        await expect(page.getByLabel(label).first()).toBeVisible();
      }
      await expect(page.getByLabel('Maintenance mode')).toBeVisible();
      await expect(page.getByLabel('Read-only mode')).toBeVisible();
      await expect(page.getByText('Upload limit', { exact: true }).first()).toBeVisible();

      // Turn the AI flag off through the UI, save, and check the public feed.
      await page.getByLabel('Chatgram AI').first().uncheck();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Platform settings saved.')).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => (await (await page.request.get(`${API}/api/app/features`)).json()).aiEnabled, { timeout: 15_000 })
        .toBe(false);

      // Restore it through the UI.
      await page.getByLabel('Chatgram AI').first().check();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Platform settings saved.')).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => (await (await page.request.get(`${API}/api/app/features`)).json()).aiEnabled, { timeout: 15_000 })
        .toBe(true);
      expect(errors, errors.join(' | ')).toHaveLength(0);
    } finally {
      // Restore every default through the API (also refreshes the server cache).
      const settings = {
        registrationEnabled: true,
        statusEnabled: true,
        groupsEnabled: true,
        fileUploadsEnabled: true,
        aiEnabled: true,
        supportWidgetEnabled: true,
        maintenanceMode: false,
        maintenanceMessage: 'Chatgram is under maintenance. We will be back shortly.',
        readOnlyMode: false,
        maxUploadMb: 100,
      };
      await page.request.put(`${API}/api/admin/platform-settings`, {
        data: { settings },
        headers: { Cookie: (await page.context().cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join('; '), 'X-Admin-CSRF': adminBody.csrfToken },
      }).catch(() => undefined);
      await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 }).catch(() => undefined);
      await mongoose.connection.collection('platformsettings').deleteMany({}).catch(() => undefined);
      await mongoose.disconnect().catch(() => undefined);
    }
  });
});
