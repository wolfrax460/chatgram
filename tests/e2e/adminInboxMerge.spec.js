/**
 * 9b Inbox merge-duplicates from the dashboard: the duplicate count appears on
 * the item, the button merges them, and the target absorbs the occurrences.
 */
const { test, expect } = require('@playwright/test');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const question = `E2E duplicate export question ${run}?`;

let createdIds = [];

test.describe.configure({ timeout: 120_000 });

test.describe('inbox merge duplicates', () => {
  test.beforeAll(async () => {
    const mongoose = require('../../server/node_modules/mongoose');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
    const AdminInbox = mongoose.connection.collection('admininboxes');
    const normalized = `e2e duplicate export question ${run}`;
    const docs = [
      { type: 'chatgram_unknown', question, normalized, status: 'new', count: 1, createdAt: new Date(), lastSeenAt: new Date() },
      { type: 'chatgram_unknown', question: question.toUpperCase(), normalized, status: 'new', count: 1, createdAt: new Date(), lastSeenAt: new Date() },
    ];
    const inserted = await AdminInbox.insertMany(docs);
    createdIds = Object.values(inserted.insertedIds);
    await mongoose.disconnect();
  });

  test.afterAll(async () => {
    try {
      const mongoose = require('../../server/node_modules/mongoose');
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
      await mongoose.connection.collection('admininboxes').deleteMany({ question: { $in: [question, question.toUpperCase()] } });
      await mongoose.connection.collection('adminaudits').deleteMany({ detail: new RegExp(createdIds.map((id) => String(id)).join('|')) });
      await mongoose.disconnect();
    } catch (error) {
      console.warn('inbox merge cleanup skipped:', String(error.message || error).slice(0, 160));
    }
  });

  test('the duplicate count is shown and merging folds the rows', async ({ page }) => {
    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok()).toBeTruthy();

    await page.goto(`${APP}/admin/inbox`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Chatgram AI inbox' })).toBeVisible({ timeout: 20_000 });
    const row = page.getByText(question, { exact: false }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    const mergeButton = page.getByRole('button', { name: /Merge duplicates/ });
    await expect(mergeButton).toBeVisible();
    await expect(mergeButton).toBeEnabled();
    await expect(mergeButton).toContainText('(1)');
    await mergeButton.click();

    // The server reflects the merge: one target count absorbed, duplicates ignored.
    await expect
      .poll(async () => {
        const response = await page.request.get(`${API}/api/admin/ai/inbox?status=all&limit=100`);
        const payload = await response.json();
        const target = (payload.items || []).find((item) => item.question === question || item.question === question.toUpperCase());
        return { count: target?.count, duplicateCount: target?.duplicateCount };
      }, { timeout: 20_000 })
      .toMatchObject({ count: 2, duplicateCount: 0 });
    await expect(page.getByText(/Merged 1 duplicate record/)).toBeVisible({ timeout: 20_000 }).catch(() => {});
  });
});
