/**
 * Mobile-width checks (iPhone 13 project).
 *
 * The layout must be single-pane: chat list first, a conversation replaces it
 * with a back button, and nothing may scroll horizontally.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn, addContact, createDirectChat, sendMessage } = require('./helpers');

test.describe.configure({ timeout: 120_000 });

test('mobile layout is single-pane, usable and has no horizontal overflow', async ({ page }) => {
  const alice = await registerUser('mob-alice');
  const bob = await registerUser('mob-bob');
  await addContact(alice, bob.user.id);
  await addContact(bob, alice.user.id);
  const chat = await createDirectChat(alice, bob.user.id);
  await sendMessage(bob, chat._id, 'Hello on mobile');

  await signIn(page, alice);

  // Chat list is the first pane.
  await expect(page.getByPlaceholder('Search chats')).toBeVisible({ timeout: 20_000 });

  // No horizontal scrolling at 390px.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  // Opening the conversation replaces the list; the back button returns.
  await page.getByRole('button', { name: new RegExp('^' + bob.user.displayName) }).first().click();
  await expect(page.getByPlaceholder('Type a message')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('section').getByText('Hello on mobile').first()).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByPlaceholder('Search chats')).toBeVisible({ timeout: 15_000 });

  // The composer is usable and messages send.
  await page.getByRole('button', { name: new RegExp('^' + bob.user.displayName) }).first().click();
  await page.getByPlaceholder('Type a message').fill('Sent from mobile width');
  await page.getByPlaceholder('Type a message').press('Enter');
  await expect(page.locator('section').getByText('Sent from mobile width').first()).toBeVisible({ timeout: 20_000 });
});


