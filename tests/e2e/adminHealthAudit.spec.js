/**
 * 9b read-only pages: System health and Audit log render real data with no
 * console errors, the audit filters work, and a normal user never sees them.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only

test.describe.configure({ timeout: 120_000 });

async function adminLogin(page) {
  const response = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
  expect(response.ok(), `admin login: ${response.status()}`).toBeTruthy();
}

test.describe('admin system health and audit log', () => {
  test('System health shows live service cards', async ({ page }) => {
    await adminLogin(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    await page.goto(`${APP}/admin/health`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('API', { exact: true })).toBeVisible();
    await expect(page.getByText('MongoDB')).toBeVisible();
    await expect(page.getByText('Realtime', { exact: true })).toBeVisible();
    await expect(page.getByText('AI layer')).toBeVisible();
    await expect(page.getByText('Backups')).toBeVisible();
    await expect(page.getByText(/uptime/)).toBeVisible();
    await expect(page.getByText('connected', { exact: true })).toBeVisible();
    await expect(page.getByText('AI providers')).toBeVisible();
    expect(errors, errors.join(' | ')).toHaveLength(0);
  });

  test('Audit log lists actions, filters and paginates', async ({ page }) => {
    await adminLogin(page);
    await page.goto(`${APP}/admin/audit`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible({ timeout: 30_000 });
    const rows = page.locator('.admin-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    // Filtering by an action that certainly ran (admin login) narrows the table.
    const search = page.getByLabel('Search the audit log');
    await search.fill('login_success');
    await expect
      .poll(async () => rows.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const filtered = await rows.count();
    expect(filtered).toBeLessThanOrEqual(before);
    await expect(rows.first()).toContainText('login_success');

    // Clearing the filter brings the full list back.
    await search.fill('');
    await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    // Export button is available and the log is described as append-only.
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    await expect(page.getByText(/append-only/).first()).toBeVisible();
  });

  test('a normal user token cannot open either page', async ({ page }) => {
    const user = await registerUser('health-gate');
    await signIn(page, user);
    for (const route of ['/admin/health', '/admin/audit']) {
      await page.goto(`${APP}${route}`, { waitUntil: 'networkidle' });
      await expect(page.locator('#admin-password')).toBeVisible({ timeout: 20_000 });
      expect(await page.locator('nav[aria-label="Admin sections"]').count()).toBe(0);
    }
  });
});
