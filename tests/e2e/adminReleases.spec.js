/**
 * 9b App releases page: three platform cards, save a published Windows release,
 * confirm the public feed exposes it, then revert to drafts.
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

test.describe('app releases', () => {
  test('publishing a Windows release feeds the public endpoint', async ({ page }) => {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const AppRelease = require('../../server/src/models/AppRelease');
    await AppRelease.deleteMany({});

    try {
      const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
      expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();

      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${APP}/admin/releases`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'App releases' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Windows', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Android', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Web', { exact: true }).first()).toBeVisible();

      const windowsCard = page.locator('.admin-card', { hasText: 'NSIS installer' });
      await windowsCard.getByLabel('Version (e.g. 1.4.0)').fill('1.4.0');
      await windowsCard.getByLabel('File name').fill('chatgram-windows-setup.exe');
      await windowsCard.getByLabel('File URL (https or /downloads/…)').fill('/downloads/chatgram-windows-setup.exe');
      await windowsCard.getByLabel('SHA-256 (64 hex characters)').fill('a'.repeat(64));
      await windowsCard.getByLabel('Size in bytes').fill('84500000');
      await windowsCard.getByLabel('Release notes (shown on the landing page)').fill('E2E release notes.');
      await windowsCard.getByLabel('Published').check();
      await windowsCard.getByRole('button', { name: 'Save Windows' }).click();
      await expect(page.getByText('Releases saved.')).toBeVisible({ timeout: 20_000 });

      const feed = await page.request.get(`${API}/api/app/releases`);
      expect(feed.ok()).toBeTruthy();
      const feedBody = await feed.json();
      const windows = (feedBody.releases || []).find((row) => row.platform === 'windows');
      expect(windows?.version).toBe('1.4.0');
      expect(windows?.sha256).toBe('a'.repeat(64));
      expect(errors, errors.join(' | ')).toHaveLength(0);
    } finally {
      await AppRelease.deleteMany({});
      await mongoose.disconnect();
    }
  });
});
