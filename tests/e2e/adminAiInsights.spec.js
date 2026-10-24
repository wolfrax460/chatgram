/**
 * 9b Chatgram AI pages: usage analytics + knowledge base editor.
 */
const { test, expect } = require('@playwright/test');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only

test.describe.configure({ timeout: 120_000 });

async function adminLogin(page) {
  const response = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
  expect(response.ok(), `admin login: ${response.status()}`).toBeTruthy();
}

test.describe('AI usage and knowledge base', () => {
  test('AI usage page shows totals, the daily chart and top questions', async ({ page }) => {
    await adminLogin(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    await page.goto(`${APP}/admin/ai-usage`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'AI usage' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Answers', { exact: true })).toBeVisible();
    await expect(page.getByText('Questions', { exact: true })).toBeVisible();
    await expect(page.getByText('Unknown answers')).toBeVisible();
    await expect(page.getByText('Answers per day')).toBeVisible();
    await expect(page.getByText('Answers per provider')).toBeVisible();
    await expect(page.getByText('Top questions')).toBeVisible();
    await expect(page.getByLabel('AI usage date range')).toBeVisible();
    expect(errors, errors.join(' | ')).toHaveLength(0);
  });

  test('the knowledge editor adds, finds and deletes an entry', async ({ page }) => {
    await adminLogin(page);
    await page.goto(`${APP}/admin/knowledge`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Knowledge base' })).toBeVisible({ timeout: 30_000 });

    const marker = `e2e knowledge ${Date.now().toString(36)}`;
    await page.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.getByRole('dialog', { name: 'Add knowledge entry' })).toBeVisible();
    await page.locator('label:has-text("Question (as a user would ask it)") input').fill(`${marker}?`);
    await page.locator('label:has-text("Answer the assistant should give") textarea').fill('This is an e2e answer.');
    await page.locator('label:has-text("Keywords (comma separated)") input').fill('e2e,test');
    await page.getByRole('button', { name: 'Add entry', exact: true }).last().click();
    await expect(page.getByText('Knowledge entry added.')).toBeVisible({ timeout: 20_000 });

    const search = page.getByLabel('Search the knowledge base');
    await search.fill(marker);
    await expect(page.locator('.admin-table tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.admin-table tbody tr').first()).toContainText(marker);

    await page.getByLabel(`Delete ${marker}?`).click();
    await expect(page.getByRole('dialog', { name: 'Delete this knowledge entry?' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete entry' }).click();
    await expect(page.getByText('Knowledge entry removed.')).toBeVisible({ timeout: 20_000 });
  });
});
