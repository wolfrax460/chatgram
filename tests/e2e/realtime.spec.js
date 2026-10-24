/**
 * Two-session realtime chat: live messages, typing indicator, read ticks and
 * unread badges. Each user gets an isolated browser context (localStorage/token
 * isolation â€” see helpers.newSession).
 */
const { test, expect } = require('@playwright/test');
const {
  registerUser, newSession, addContact, createDirectChat,
} = require('./helpers');

test.describe.configure({ timeout: 120_000 });

async function openChat(page, name) {
  // The row has an avatar button ("Open X's profile") and a content button that
  // starts with the display name; anchor the regex so the content button wins.
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByPlaceholder(/Type a message|Reconnecting/)).toBeVisible({ timeout: 20_000 });
}

test.describe('realtime chat', () => {
  test('messages, typing, read ticks and unread badges work across two sessions', async ({ page, browser }) => {
    const alice = await registerUser('rt-alice');
    const bob = await registerUser('rt-bob');
    await addContact(alice, bob.user.id);
    await addContact(bob, alice.user.id);
    const chat = await createDirectChat(alice, bob.user.id);

    await newSession(browser, bob).then(async (bobSession) => {
      await newSession(browser, alice).then(async (aliceSession) => {
        try {
          const alicePage = aliceSession.page;
          const bobPage = bobSession.page;
          await openChat(alicePage, bob.user.displayName);
          await openChat(bobPage, alice.user.displayName);

          // Wait for the sockets to authenticate and join the rooms.
          await alicePage.waitForTimeout(1500);

          // ---- typing indicator
          await bobPage.getByPlaceholder('Type a message').pressSequentially('typing…', { delay: 60 });
          await expect(alicePage.locator('header').first().getByText('typing…')).toBeVisible({ timeout: 15_000 });

          // ---- live message
          const typed = 'Hello from the realtime test';
          await bobPage.getByPlaceholder('Type a message').fill(typed);
          await bobPage.getByPlaceholder('Type a message').press('Enter');
          await expect(alicePage.locator('section').getByText(typed, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

          // ---- read tick for the sender once the other side has it open
          await expect(bobPage.getByLabel('Read').first()).toBeVisible({ timeout: 20_000 });

          // ---- unread badge: Alice reloads to the chat list, Bob sends again
          await alicePage.reload();
          await expect(alicePage.getByPlaceholder('Search chats')).toBeVisible({ timeout: 20_000 });
          await alicePage.waitForTimeout(1200);
          await bobPage.getByPlaceholder('Type a message').fill('Unread badge test');
          await bobPage.getByPlaceholder('Type a message').press('Enter');
          // The chat-list row shows the preview and an unread badge.
          await expect(alicePage.locator('aside').getByText('Unread badge test', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
          await expect(alicePage.locator('aside').getByText('1', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

          // And the conversation itself opens from the list.
          await openChat(alicePage, bob.user.displayName);
          await expect(alicePage.locator('section').getByText('Unread badge test', { exact: false }).first()).toBeVisible();
          expect(chat._id).toBeTruthy();
        } finally {
          await aliceSession.context.close();
          await bobSession.context.close();
        }
      });
    });
  });
});


