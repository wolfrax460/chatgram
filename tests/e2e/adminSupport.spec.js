/**
 * 9b Support desk UI: stats, ticket queue, read-only transcript and the reply
 * guard for contact-only tickets. A ticket is seeded directly in the staging DB
 * and removed afterwards.
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
const stamp = Date.now().toString(36);

test.describe.configure({ timeout: 120_000 });

test.describe('support desk', () => {
  test('stats, queue, ticket detail and the reply guard', async ({ page }) => {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    const SupportTicket = require('../../server/src/models/SupportTicket');
    const ticketId = SupportTicket.newTicketId();
    await SupportTicket.create({
      ticketId,
      guestId: `pw-support-${stamp}`,
      contact: `pw-support-${stamp}@chatgram.test`,
      contactType: 'email',
      summary: `Playwright support ticket ${stamp}`,
      transcript: [{ role: 'guest', text: `I cannot sign in from the browser ${stamp}` }],
      meta: { page: '/web/help' },
    });

    try {
      const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
      expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();

      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
      await page.goto(`${APP}/admin/support`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Open tickets')).toBeVisible();
      await expect(page.getByText('Support channels')).toBeVisible();

      const search = page.getByLabel('Search support tickets');
      await search.fill(ticketId);
      const row = page.locator('.admin-table tbody tr').first();
      await expect(row).toContainText(ticketId, { timeout: 20_000 });
      await row.click();
      await expect(page.getByText(`I cannot sign in from the browser ${stamp}`)).toBeVisible({ timeout: 20_000 });
      const replyBox = page.getByPlaceholder(/no conversation attached/);
      await expect(replyBox).toBeVisible();
      await expect(replyBox).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Send reply' })).toBeDisabled();
      expect(errors, errors.join(' | ')).toHaveLength(0);
    } finally {
      await SupportTicket.deleteOne({ ticketId });
      await mongoose.disconnect();
    }
  });
});
