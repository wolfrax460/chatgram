/**
 * 9b Settings page: tabs, unsaved-changes bar, validation, persistence and the
 * backups panel. Secrets are never rendered - only "configured" badges.
 */
const { test, expect } = require('@playwright/test');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);

test.describe.configure({ timeout: 120_000 });

test.describe('settings page', () => {
  test.afterAll(async ({}) => {
    const login = await fetch(`${API}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    const body = await login.json();
    await fetch(`${API}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '), 'X-Admin-CSRF': body.csrfToken },
      body: JSON.stringify({ siteName: 'Chatgram', siteUrl: 'https://chatgram-xi.vercel.app', supportEmail: '', privacyUrl: '/docs/#privacy', termsUrl: '/docs/#terms', dataRetentionDays: 365, reviewLogRetentionDays: 730 }),
    }).catch(() => {});
  });

  test('tabs render, edits mark the form dirty, validation and saves work', async ({ page }) => {
    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok()).toBeTruthy();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    page.on('console', (message) => {
      // The validation step intentionally triggers one 400 (unsafe URL); that is not an app error.
      if (message.type() === 'error' && !/favicon|404 .*\/assets|400 \(Bad Request\)/i.test(message.text())) errors.push(message.text().slice(0, 200));
    });

    await page.goto(`${APP}/admin/settings`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /General/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Email & Telegram/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Retention/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Legal links/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Backups/ })).toBeVisible();

    // No secret values anywhere on the page.
    const body = await page.locator('main').innerText();
    expect(body).not.toMatch(/SMTP_PASS=|TELEGRAM_BOT_TOKEN=|mongodb\+srv/i);

    // General tab: edit the site name, see the unsaved bar, then save.
    const siteName = page.getByLabel('Site name');
    await siteName.fill(`Chatgram UI ${run}`);
    await expect(page.getByText(/Unsaved changes/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Save changes/ })).toBeEnabled();
    await page.getByRole('button', { name: /Save changes/ }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20_000 });
    const state = await (await page.request.get(`${API}/api/admin/settings`)).json();
    expect(state.settings.siteName).toBe(`Chatgram UI ${run}`);

    // Validation: an unsafe URL is refused by the server and surfaced.
    await page.getByLabel('Site URL').fill('javascript:alert(1)');
    await page.getByRole('button', { name: /Save changes/ }).click();
    await expect(page.getByText(/must be a \/path or an http\(s\) URL/i)).toBeVisible({ timeout: 20_000 });

    // Email tab: configured badges and write-only wording.
    await page.getByLabel('Site URL').fill('https://chatgram-xi.vercel.app');
    await page.getByRole('button', { name: /Email & Telegram/ }).click();
    await expect(page.getByText(/SMTP not configured|SMTP configured/)).toBeVisible();
    await expect(page.getByText(/write-only/i)).toBeVisible();

    // Retention tab.
    await page.getByRole('button', { name: /Retention/ }).click();
    await expect(page.getByLabel('Security review log retention (days)')).toBeVisible();

    // Backups tab: honest empty state or a backups table, plus the action button.
    await page.getByRole('button', { name: /Backups/ }).click();
    await expect(page.getByText('Database backups', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Back up now|Backing up/ })).toBeVisible();
    await expect(page.getByText(/Restore: stop the API/)).toBeVisible();

    // Restore the site name.
    await page.getByRole('button', { name: /General/ }).click();
    await siteName.fill('Chatgram');
    await page.getByRole('button', { name: /Save changes/ }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20_000 });

    expect(errors, errors.join(' | ')).toHaveLength(0);
  });
});

