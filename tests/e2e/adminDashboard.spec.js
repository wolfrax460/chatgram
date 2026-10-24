/**
 * Change 2 â€” the admin dashboard is its own route-based app: gate, shell,
 * Overview/Users/Inbox/Providers, command palette, browser back and the one
 * shared dark dropdown. Normal Chatgram accounts must never reach it.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only

test.describe.configure({ timeout: 150_000 });

async function adminLogin(page) {
  const response = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
  expect(response.ok(), `admin login: ${response.status()}`).toBeTruthy();
}

test.describe('admin dashboard', () => {
  test('a normal signed-in user only sees the admin password gate', async ({ page }) => {
    const user = await registerUser('admin-gate');
    await signIn(page, user);
    await page.goto(`${APP}/admin`, { waitUntil: 'networkidle' });
    await expect(page.locator('#admin-password')).toBeVisible({ timeout: 20_000 });
    expect(await page.locator('nav[aria-label="Admin sections"]').count()).toBe(0);
    // No user token can open any admin section either.
    await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle' });
    await expect(page.locator('#admin-password')).toBeVisible({ timeout: 20_000 });
  });

  test('sign in shows the shell, Overview KPIs and working navigation', async ({ page }) => {
    await adminLogin(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 200));
    });

    await page.goto(`${APP}/admin`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('nav[aria-label="Admin sections"]')).toBeVisible();
    await expect(page.getByText('Users', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ONLINE NOW', { exact: false })).toBeVisible();
    await expect(page.getByText('Needs attention')).toBeVisible();
    await expect(page.getByText('Messages per day')).toBeVisible();

    // Sidebar navigation to Users, then back with the browser button.
    await page.locator('nav[aria-label="Admin sections"] a', { hasText: 'Users' }).click();
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder('Search users by name, email or phone')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 20_000 });

    // Ctrl+K palette finds pages and opens them.
    await page.keyboard.press('Control+K');
    await expect(page.getByLabel('Command palette search')).toBeVisible();
    await page.getByLabel('Command palette search').fill('providers');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Model providers' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Feature routing')).toBeVisible();

    expect(errors, errors.join(' | ')).toHaveLength(0);
  });

  test('Users search opens a detail page and the safe actions are present', async ({ page }) => {
    await adminLogin(page);
    const probe = await registerUser('admin-user');
    const label = String(probe.user.displayName);
    await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle' });
    const search = page.getByPlaceholder('Search users by name, email or phone');
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(label);
    await expect(page.locator('.admin-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.admin-table tbody tr').first().click();
    await expect(page.getByRole('heading', { name: label })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page.getByText('Messages sent')).toBeVisible();
    // Conversation review is gated by the 9d reason prompt (not built yet).
    await expect(page.getByText('Security review flow', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByText('Force logout')).toBeVisible();
    await expect(page.getByText('Reset 2FA')).toBeVisible();
  });

  test('Inbox and Providers pages render their real data', async ({ page }) => {
    await adminLogin(page);
    await page.goto(`${APP}/admin/inbox`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Chatgram AI inbox' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('All types')).toBeVisible();
    await expect(page.getByText(/items/).first()).toBeVisible();

    await page.goto(`${APP}/admin/providers`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Model providers' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Add provider' })).toBeVisible();
    await expect(page.getByText('Feature routing')).toBeVisible();
    await expect(page.getByText('AI safety & limits')).toBeVisible();
  });

  test('the admin dashboard uses no native select elements', async ({ page }) => {
    await adminLogin(page);
    for (const route of ['/admin', '/admin/users', '/admin/inbox', '/admin/providers', '/admin/security']) {
      await page.goto(`${APP}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      expect(await page.locator('select').count(), `${route} has a native <select>`).toBe(0);
    }
  });
});
