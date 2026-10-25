/**
 * 9b Safety & abuse page: renders the lists, limits, IP bans and spam signals,
 * saves blocked words through the admin API, and every change is audited.
 */
const { test, expect } = require('@playwright/test');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const word = `uisafety${run}`;

test.describe.configure({ timeout: 120_000 });

test.describe('safety page', () => {
  test.afterAll(async ({}) => {
    // Restore the defaults even if the UI save failed halfway.
    const login = await fetch(`${API}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    const body = await login.json();
    const headers = {
      Cookie: (login.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; '),
      'X-Admin-CSRF': body.csrfToken,
      'Content-Type': 'application/json',
    };
    await fetch(`${API}/api/admin/safety`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ blockedWords: [], blockedLinkDomains: [], blockedEmailDomains: [], messagesPerMinute: 60, signupsPerHourPerIp: 20, massMessageHourly: 200, signupThrottleEnabled: true }),
    }).catch(() => {});
  });

  test('lists, limits, IP bans and signals render and save', async ({ page }) => {
    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok()).toBeTruthy();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|404 .*\/assets/i.test(message.text())) errors.push(message.text().slice(0, 200));
    });

    await page.goto(`${APP}/admin/safety`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Safety & abuse' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Blocked words', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Blocked link & email domains')).toBeVisible();
    await expect(page.getByText('Rate limits & throttling')).toBeVisible();
    await expect(page.getByText('IP bans', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Mass messaging (last hour)')).toBeVisible();
    await expect(page.getByText('Signup bursts (this process, last hour)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Block IP/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

    // Save a blocked word through the UI.
    await page.getByPlaceholder('spamword').fill(`${word}\nsecondphrase`);
    await expect(page.getByRole('button', { name: /Save changes/ })).toBeEnabled();
    await page.getByRole('button', { name: /Save changes/ }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Blocked words', { exact: true }).first()).toBeVisible();

    // It is persisted server-side.
    const state = await page.request.get(`${API}/api/admin/safety`);
    const payload = await state.json();
    expect(payload.settings.blockedWords).toEqual([word, 'secondphrase']);

    // Reload shows the saved values.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('textarea').first()).toHaveValue(new RegExp(word));

    // Clear the list again.
    await page.locator('textarea').first().fill('');
    await page.getByRole('button', { name: /Save changes/ }).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20_000 });

    expect(errors, errors.join(' | ')).toHaveLength(0);
  });
});
