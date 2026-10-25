/**
 * 9d — security review mode in the admin dashboard: content stays hidden until a
 * written reason is entered, the transcript is read-only, the session is time
 * boxed, global message search requires the same reason and "Who viewed what"
 * records both.
 */
const { test, expect } = require('@playwright/test');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);

test.describe.configure({ timeout: 180_000 });

let subject = null;
let partner = null;
let chatId = '';
const messageText = `Oversight spec fixture ${run}: review this conversation please.`;
const searchReason = `Spec ${run}: global search review.`;

async function registerUser(request, label) {
  const identifier = `rv-ui-${label}-${run}@chatgram.test`;
  const response = await request.post(`${API}/api/auth/register`, {
    data: { displayName: `ReviewUI ${label} ${run}`, identifier, password: 'RvUiTest1!' },
  });
  expect(response.ok(), `register ${label}: ${response.status()}`).toBeTruthy();
  const body = await response.json();
  return { identifier, password: 'RvUiTest1!', accessToken: body.accessToken, user: body.user };
}

test.describe('admin oversight', () => {
  test.afterAll(async () => {
    try {
      const mongoose = require('../../server/node_modules/mongoose');
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
      const ids = [subject?.user?.id, partner?.user?.id].filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));
      if (chatId) {
        await mongoose.connection.collection('messages').deleteMany({ chatId: new mongoose.Types.ObjectId(String(chatId)) });
        await mongoose.connection.collection('chats').deleteMany({ _id: new mongoose.Types.ObjectId(String(chatId)) });
      }
      if (ids.length) {
        await mongoose.connection.collection('reviewsessions').deleteMany({ userId: { $in: ids } });
        await mongoose.connection.collection('users').deleteMany({ _id: { $in: ids } });
      }
      await mongoose.disconnect();
    } catch (error) {
      // Cleanup is best-effort; the staging stack is disposable.
      console.warn('review cleanup skipped:', String(error.message || error).slice(0, 160));
    }
  });

  test('content stays hidden until a reason is entered, then it is read-only and audited', async ({ page }) => {
    subject = await registerUser(page.request, 'subject');
    partner = await registerUser(page.request, 'partner');
    const chat = await page.request.post(`${API}/api/chats`, {
      headers: { Authorization: `Bearer ${subject.accessToken}` },
      data: { type: 'direct', participantId: partner.user.id },
    });
    expect(chat.ok(), `chat: ${chat.status()}`).toBeTruthy();
    const chatBody = await chat.json();
    chatId = chatBody._id || chatBody.id;
    const firstMessage = await page.request.post(`${API}/api/messages`, {
      headers: { Authorization: `Bearer ${subject.accessToken}` },
      data: { chatId, type: 'text', content: messageText },
    });
    expect(firstMessage.ok(), `message: ${firstMessage.status()}`).toBeTruthy();

    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok()).toBeTruthy();

    // Find the user's detail page through the Users search.
    await page.goto(`${APP}/admin/users`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('Search users by name, email or phone').fill(`ReviewUI subject ${run}`);
    await page.waitForTimeout(1200);
    await page.getByText(`ReviewUI subject ${run}`).first().click();
    await expect(page.getByRole('heading', { name: `ReviewUI subject ${run}` })).toBeVisible({ timeout: 20_000 });

    // Guard rail: no content before the reason.
    await page.getByRole('button', { name: /Conversations/ }).click();
    await expect(page.getByText('Security review required')).toBeVisible();
    expect(await page.getByText(messageText).count()).toBe(0);
    await expect(page.getByRole('button', { name: /Start review of/ })).toBeDisabled();

    // A short reason is not enough.
    await page.getByPlaceholder(/Report #1234/).fill('abuse');
    await expect(page.getByRole('button', { name: /Start review of/ })).toBeDisabled();

    // Start the review with a real reason.
    await page.getByPlaceholder(/Report #1234/).fill(`Spec ${run}: verifying the oversight review flow.`);
    await page.getByPlaceholder('REPORT-1234').fill(`REPORT-${run}`);
    await page.getByRole('button', { name: /Start review of/ }).click();
    await expect(page.getByText(/Security review mode/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/ends in/)).toBeVisible();

    // Read the conversation; it must be visible now, but read-only.
    await page.locator('.review-chat').first().click();
    await expect(page.getByText(messageText)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('cannot reply, edit or delete')).toBeVisible();
    expect(await page.locator('textarea').count()).toBe(0);
    expect(await page.getByRole('button', { name: /^Send$/ }).count()).toBe(0);

    // End the review, and confirm the page returns to the reason gate.
    await page.getByRole('button', { name: /End review/ }).click();
    await expect(page.getByText('Security review required')).toBeVisible({ timeout: 20_000 });

    // "Who viewed what" lists the review that just happened.
    await page.goto(`${APP}/admin/reviews`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Who viewed what' })).toBeVisible();
    await expect(page.getByText(`Spec ${run}: verifying the oversight review flow.`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`ReviewUI subject ${run}`).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Export CSV/ })).toBeVisible();

    // Global message search (9d #4): reason gate, then a read-only result.
    await page.locator('nav[aria-label="Admin sections"] a', { hasText: 'Message search' }).click();
    await expect(page.getByRole('heading', { name: 'Message search' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Security review required before searching')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start search review' })).toBeDisabled();
    await page.getByPlaceholder(/Report #1234: locating abusive messages/).fill(searchReason);
    await page.getByRole('button', { name: 'Start search review' }).click();
    await expect(page.getByText(/read-only search/)).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder('keyword or phrase (2+ characters)').fill(`fixture ${run}`);
    await page.getByRole('button', { name: 'Search messages' }).click();
    await expect(page.getByText(messageText)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(searchReason, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: /End review/ }).click();
    await expect(page.getByText('Security review required before searching')).toBeVisible({ timeout: 20_000 });
  });
});
