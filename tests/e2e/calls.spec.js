/**
 * 1:1 WebRTC calls (signalling + overlay) with Chrome's fake media devices.
 */
const { test, expect } = require('@playwright/test');
const {
  registerUser, signIn, newSession, openTab, addContact, createDirectChat,
} = require('./helpers');

test.describe.configure({ timeout: 180_000 });

async function openDirectChat(page, partnerName) {
  await openTab(page, 'Chats');
  await page.getByRole('button', { name: new RegExp(`^${partnerName}`) }).first().click();
  await expect(page.getByPlaceholder(/Type a message|Reconnecting/)).toBeVisible({ timeout: 20_000 });
}

test('a direct call rings the other user and can be declined', async ({ browser }) => {
  const alice = await registerUser('call-alice');
  const bob = await registerUser('call-bob');
  await addContact(alice, bob.user.id);
  await addContact(bob, alice.user.id);
  await createDirectChat(alice, bob.user.id);

  const a = await newSession(browser, alice);
  const b = await newSession(browser, bob);
  try {
    await openDirectChat(a.page, bob.user.displayName);

    const callDialog = b.page.getByRole('dialog', { name: 'Call' });
    await a.page.getByRole('button', { name: 'Call', exact: true }).click();
    await expect(b.page.getByTestId('call-title')).toContainText(`${alice.user.displayName} is calling`, {
      timeout: 20_000,
    });
    await expect(callDialog).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'Accept call' })).toBeVisible();

    await b.page.getByRole('button', { name: 'Decline call' }).click();
    await expect(a.page.getByTestId('call-message')).toContainText('Call declined', { timeout: 20_000 });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('the other user can accept a call and either side can hang up', async ({ browser }) => {
  const alice = await registerUser('call-accept-a');
  const bob = await registerUser('call-accept-b');
  await addContact(alice, bob.user.id);
  await addContact(bob, alice.user.id);
  await createDirectChat(alice, bob.user.id);

  const a = await newSession(browser, alice);
  const b = await newSession(browser, bob);
  try {
    await openDirectChat(a.page, bob.user.displayName);
    await a.page.getByRole('button', { name: 'Call', exact: true }).click();

    await expect(b.page.getByRole('button', { name: 'Accept call' })).toBeVisible({ timeout: 20_000 });
    await b.page.getByRole('button', { name: 'Accept call' }).click();

    // Both peers show the live timer once the peer connection is up.
    await expect(a.page.getByTestId('call-timer')).toBeVisible({ timeout: 30_000 });
    await expect(b.page.getByTestId('call-timer')).toBeVisible({ timeout: 30_000 });

    await a.page.getByRole('button', { name: 'Hang up' }).click();
    await expect(b.page.getByTestId('call-message')).toContainText('Call ended', { timeout: 20_000 });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
