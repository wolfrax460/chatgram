/**
 * Message-level actions (section 9 basics): edit, star, forward, report.
 */
const { test, expect } = require('@playwright/test');
const {
  apiRequest, registerUser, signIn, addContact, createDirectChat, createGroup, sendMessage,
} = require('./helpers');

test.describe.configure({ timeout: 150_000 });

async function openChat(page, name) {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByPlaceholder(/Type a message|Reconnecting/)).toBeVisible({ timeout: 20_000 });
}

function bubbleFor(page, text) {
  // Scope to the conversation pane: the same text also appears in the chat-list
  // preview, which would otherwise resolve first and never contain the menu.
  return page
    .locator('section')
    .getByText(text, { exact: false })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"group")][1]');
}

test.describe('message actions', () => {
  test('edit my own message shows the new text and an edited label', async ({ page }) => {
    const alice = await registerUser('msg-edit-a');
    const bob = await registerUser('msg-edit-b');
    await addContact(alice, bob.user.id);
    await addContact(bob, alice.user.id);
    const chat = await createDirectChat(alice, bob.user.id);
    const sent = await sendMessage(alice, chat._id, 'Original via UI');

    await signIn(page, alice);
    await openChat(page, bob.user.displayName);

    const bubble = bubbleFor(page, 'Original via UI');
    await bubble.hover();
    await bubble.getByTitle('More').click();
    await page.getByRole('button', { name: 'Edit message' }).click();
    const editor = page.getByLabel('Edit message');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.fill('Edited via UI');
    await page.getByRole('button', { name: /Save/ }).click();

    await expect(page.getByText('Edited via UI').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('edited', { exact: false }).first()).toBeVisible();

    const history = await apiRequest('GET', `/api/messages?chatId=${chat._id}`, { token: alice.accessToken });
    const row = (history.body?.messages || []).find((message) => message._id === sent._id);
    expect(row.content).toBe('Edited via UI');
    expect(row.editedAt).toBeTruthy();
  });

  test('star a message and see the star marker', async ({ page }) => {
    const alice = await registerUser('msg-star-a');
    const bob = await registerUser('msg-star-b');
    await addContact(alice, bob.user.id);
    await addContact(bob, alice.user.id);
    const chat = await createDirectChat(alice, bob.user.id);
    const sent = await sendMessage(alice, chat._id, 'Star me please');

    await signIn(page, alice);
    await openChat(page, bob.user.displayName);
    const bubble = bubbleFor(page, 'Star me please');
    await bubble.hover();
    await bubble.getByTitle('More').click();
    await page.getByRole('button', { name: 'Star message' }).click();

    await expect(page.getByLabel('Starred').first()).toBeVisible({ timeout: 20_000 });
    const history = await apiRequest('GET', `/api/messages?chatId=${chat._id}`, { token: alice.accessToken });
    const row = (history.body?.messages || []).find((message) => message._id === sent._id);
    expect(row.starred).toBe(true);
  });

  test('forward a message into another chat', async ({ page }) => {
    const alice = await registerUser('msg-fwd-a');
    const bob = await registerUser('msg-fwd-b');
    await addContact(alice, bob.user.id);
    await addContact(bob, alice.user.id);
    const chat = await createDirectChat(alice, bob.user.id);
    const groupName = `Forward group ${Date.now().toString(36)}`;
    await createGroup(alice, groupName, [bob.user.id]);
    await sendMessage(alice, chat._id, 'Forward this text');

    await signIn(page, alice);
    await openChat(page, bob.user.displayName);
    const bubble = bubbleFor(page, 'Forward this text');
    await bubble.hover();
    await bubble.getByTitle('More').click();
    await bubble.getByText('Forward', { exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Forward message' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Forward message' }).getByRole('button', { name: new RegExp(groupName) }).click();
    await expect(page.getByText('Message forwarded.')).toBeVisible({ timeout: 20_000 });
  });

  test('report a received message', async ({ page }) => {
    const alice = await registerUser('msg-report-a');
    const bob = await registerUser('msg-report-b');
    await addContact(alice, bob.user.id);
    await addContact(bob, alice.user.id);
    const chat = await createDirectChat(alice, bob.user.id);
    await sendMessage(bob, chat._id, 'Suspicious message content');

    await signIn(page, alice);
    await openChat(page, bob.user.displayName);
    const bubble = bubbleFor(page, 'Suspicious message content');
    await bubble.hover();
    await bubble.getByTitle('More').click();
    await page.getByRole('button', { name: 'Report message' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report message' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /Abusive content/ }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText(/Report sent \(/)).toBeVisible({ timeout: 20_000 });
  });
});
