/**
 * Bug fix: answering an Inbox question from the dashboard must deliver ONE
 * incoming message from the Chatgram Support system account into the Support
 * conversation, never into a person-to-person chat and never from the admin
 * account. The AI placeholder is refused.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';
const ADMIN_PASSWORD = 'staging-admin-password-123'; // local staging only
const run = Date.now().toString(36);
const question = `E2E system answer question ${run}?`;
const answerText = `Your data export lives in Settings, Account, under “Export my data” (${run}).`;
const FALLBACK = "I don't have a confirmed answer on that yet, I've noted it for the team.";
const privateMessage = `E2E private message ${run}`;

let asker = null;
let partner = null;
let privateChatId = '';
let privateChatLastMessage = '';
let inboxId = '';
let systemChatId = '';

test.describe.configure({ timeout: 180_000 });

async function withDb(fn) {
  const mongoose = require('../../server/node_modules/mongoose');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chatgram_staging', { serverSelectionTimeoutMS: 5000 });
  try {
    return await fn(mongoose);
  } finally {
    await mongoose.disconnect();
  }
}

test.describe('system answers', () => {
  test.afterAll(async () => {
    try {
      await withDb(async (mongoose) => {
        const db = mongoose.connection.db;
        const ids = [asker?.user?.id, partner?.user?.id].filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));
        const chats = ids.length ? await db.collection('chats').find({ participants: { $in: ids } }).toArray() : [];
        const chatIds = chats.map((row) => row._id);
        await db.collection('messages').deleteMany({ chatId: { $in: chatIds } });
        await db.collection('chats').deleteMany({ _id: { $in: chatIds } });
        if (inboxId) {
          await db.collection('admininboxes').deleteOne({ _id: new mongoose.Types.ObjectId(String(inboxId)) });
          await db.collection('aiknowledges').deleteMany({ inboxId: new mongoose.Types.ObjectId(String(inboxId)) });
          await db.collection('adminaudits').deleteMany({ detail: new RegExp(String(inboxId)) });
        }
        await db.collection('users').deleteMany({ _id: { $in: ids } });
      });
    } catch (error) {
      console.warn('system answers cleanup skipped:', String(error.message || error).slice(0, 160));
    }
  });

  test('the dashboard answer arrives from Support in the Support thread only', async ({ page }) => {
    asker = await registerUser('sys-asker');
    partner = await registerUser('sys-partner');
    const chat = await page.request.post(`${API}/api/chats`, {
      headers: { Authorization: `Bearer ${asker.accessToken}` },
      data: { type: 'direct', participantId: partner.user.id },
    });
    expect(chat.ok(), `private chat: ${chat.status()}`).toBeTruthy();
    const chatBody = await chat.json();
    privateChatId = chatBody._id || chatBody.id;
    const sent = await page.request.post(`${API}/api/messages`, {
      headers: { Authorization: `Bearer ${asker.accessToken}` },
      data: { chatId: privateChatId, type: 'text', content: privateMessage },
    });
    expect(sent.ok(), `private message: ${sent.status()}`).toBeTruthy();

    // An unresolved AI question from the asker, as the AI pipeline would record it.
    await withDb(async (mongoose) => {
      const { AdminInbox } = require('../../server/src/ai/chatgram');
      const item = await AdminInbox.create({
        type: 'chatgram_unknown',
        question,
        normalized: question.toLowerCase(),
        askerId: new mongoose.Types.ObjectId(String(asker.user.id)),
        status: 'new',
      });
      inboxId = String(item._id);
      privateChatLastMessage = String((await mongoose.connection.db.collection('chats').findOne({ _id: new mongoose.Types.ObjectId(String(privateChatId)) }))?.lastMessage || '');
    });

    const login = await page.request.post(`${API}/api/admin/auth/login`, { data: { password: ADMIN_PASSWORD } });
    expect(login.ok()).toBeTruthy();

    await page.goto(`${APP}/admin/inbox`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Chatgram AI inbox' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();

    // The placeholder is refused before anything is delivered or stored.
    await page.locator('#inbox-answer').fill(FALLBACK);
    await page.getByRole('button', { name: /Save to knowledge base/ }).click();
    await expect(page.getByText(/placeholder .* cannot be saved/i)).toBeVisible({ timeout: 20_000 }).catch(async () => {
      // Older server wording fallback: any error chip containing "confirmed answer".
      await expect(page.getByText(/confirmed answer/i)).toBeVisible({ timeout: 10_000 });
    });

    await page.locator('#inbox-answer').fill(answerText);
    const answerResponse = page.waitForResponse((response) => response.url().includes(`/api/admin/ai/inbox/${inboxId}/answer`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: /Save to knowledge base/ }).click();
    const response = await answerResponse;
    expect(response.status(), 'answer response').toBe(200);

    // The user sees it as an incoming message in the Chatgram Support thread.
    await signIn(page, asker);
    await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
    const supportRow = page.getByText('Chatgram Support', { exact: false }).first();
    await expect(supportRow).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(privateMessage, { exact: false }).first()).toBeVisible();
    await supportRow.click();
    await expect(page.getByText(answerText, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Chatgram AI answer:/)).toHaveCount(0);
    await expect(page.getByText(FALLBACK)).toHaveCount(0);

    // The private chat is untouched: same message count, same preview.
    await withDb(async (mongoose) => {
      const db = mongoose.connection.db;
      const privateMessages = await db.collection('messages').find({ chatId: new mongoose.Types.ObjectId(String(privateChatId)) }).toArray();
      expect(privateMessages.length, 'private chat messages').toBe(1);
      expect(String(privateMessages[0].content)).toBe(privateMessage);
      const privateChat = await db.collection('chats').findOne({ _id: new mongoose.Types.ObjectId(String(privateChatId)) });
      expect(String(privateChat.lastMessage)).toBe(privateChatLastMessage);

      // Exactly one delivered answer, from the system account, in the Support chat.
      const support = await db.collection('users').findOne({ isSupportAccount: true });
      expect(support, 'support account exists').toBeTruthy();
      const systemChat = await db.collection('chats').findOne({ type: 'direct', participants: { $all: [support._id, new mongoose.Types.ObjectId(String(asker.user.id))] } });
      expect(systemChat, 'support conversation exists').toBeTruthy();
      systemChatId = String(systemChat._id);
      const delivered = await db.collection('messages').find({ chatId: systemChat._id }).toArray();
      expect(delivered.length, 'delivered messages').toBe(1);
      expect(String(delivered[0].senderId)).toBe(String(support._id));
      expect(String(delivered[0].content)).toBe(answerText);
      expect(String(systemChat.lastMessage)).toBe(String(delivered[0]._id));
    });
  });
});
