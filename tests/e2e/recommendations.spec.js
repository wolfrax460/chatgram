/**
 * Item 4 — the empty-screen recommendation is server-driven, dismissible and
 * editable in /web/admin → Announcements; the quick actions include Send document.
 */
const { test, expect } = require('@playwright/test');
const { apiRequest, registerUser, signIn } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only

test.describe.configure({ timeout: 120_000 });

test.describe('empty-screen recommendations (item 4)', () => {
  test('the card and the quick actions come from the app', async ({ page }) => {
    const user = await registerUser('rec-empty');
    await signIn(page, user);
    await page.getByText('Welcome to Chatgram').waitFor({ timeout: 20_000 });

    await expect(page.locator('[data-testid="empty-recommendation"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="recommendation-cta"]')).toBeVisible();
    await expect(page.locator('[data-testid="dismiss-recommendation"]')).toBeVisible();

    const quick = page.locator('[data-testid="empty-quick-actions"]');
    await expect(quick).toBeVisible();
    for (const label of ['Send document', 'Add contact', 'Invite a friend', 'New group', 'Chatgram AI']) {
      await expect(quick.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('dismissing a recommendation persists and it is not shown again', async ({ page }) => {
    const user = await registerUser('rec-dismiss');
    await signIn(page, user);
    await page.getByText('Welcome to Chatgram').waitFor({ timeout: 20_000 });
    const before = await apiRequest('GET', '/api/app/recommendations', { token: user.accessToken });
    const card = page.locator('[data-testid="empty-recommendation"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const cardText = await card.innerText();
    const displayed = before.body.recommendations.find((row) => cardText.includes(row.title)) || before.body.recommendations[0];
    const firstKey = displayed.key;
    const firstTitle = displayed.title;

    await page.locator('[data-testid="dismiss-recommendation"]').click();

    await expect
      .poll(async () => {
        const after = await apiRequest('GET', '/api/app/recommendations', { token: user.accessToken });
        return (after.body.recommendations || []).map((row) => row.key);
      }, { timeout: 15_000 })
      .not.toContain(firstKey);

    await page.reload();
    await page.getByText('Welcome to Chatgram').waitFor({ timeout: 20_000 });
    const cardAfter = page.locator('[data-testid="empty-recommendation"]');
    await expect(cardAfter).toBeVisible();
    await expect(cardAfter).not.toContainText(firstTitle);
  });

  test('Send document opens the chat picker', async ({ page }) => {
    const user = await registerUser('rec-doc');
    await signIn(page, user);
    await page.getByText('Welcome to Chatgram').waitFor({ timeout: 20_000 });
    await page.locator('[data-testid="empty-quick-actions"]').getByRole('button', { name: 'Send document' }).click();
    await page.locator('[data-testid="empty-quick-actions"] input[type="file"], input[type="file"]').first().setInputFiles({
      name: 'chatgram-test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello from the empty screen'),
    });
    await expect(page.getByRole('dialog', { name: 'Send document' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('chatgram-test.txt')).toBeVisible();
  });

  test('the admin editor saves a recommendation and users see it', async ({ page, context }) => {
    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();

    await page.goto(`${APP}/admin/announcements`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible({ timeout: 30_000 });
    const titleInput = page.locator('label:has-text("Title") input').first();
    await expect(titleInput).toBeVisible({ timeout: 20_000 });
    const original = await titleInput.inputValue();
    const marker = `e2e ${Date.now().toString(36)}`;
    await titleInput.fill(`${original} ${marker}`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Recommendations saved.')).toBeVisible({ timeout: 20_000 });

    // A signed-in user sees the edited copy in a separate context.
    const user = await registerUser('rec-editor');
    const userPage = await context.newPage();
    await signIn(userPage, user);
    await userPage.getByText('Welcome to Chatgram').waitFor({ timeout: 20_000 });
    const cardText = await userPage.locator('[data-testid="empty-recommendation"]').innerText();
    const { body } = await apiRequest('GET', '/api/app/recommendations', { token: user.accessToken });
    const edited = (body.recommendations || []).some((row) => row.title.includes(marker));
    expect(edited || cardText.includes(marker)).toBeTruthy();

    // Restore the original title so staging stays tidy.
    await page.reload({ waitUntil: 'networkidle' });
    const restoreInput = page.locator('label:has-text("Title") input').first();
    await restoreInput.fill(original);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Recommendations saved.')).toBeVisible({ timeout: 20_000 });
  });
});
