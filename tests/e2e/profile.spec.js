/**
 * Profile panel end-to-end tests (section D).
 *
 * Every entry point opens the same panel: chat header, chat list avatar,
 * contacts list, group members, status viewer. The panel shows only what the
 * server allows (privacy switches + blocking), and its actions work.
 */
const { test, expect } = require('@playwright/test');
const {
  apiRequest, registerUser, signIn, openTab, addContact, createGroup, createDirectChat, sendMessage,
} = require('./helpers');

async function mutualContacts(a, b) {
  await addContact(a, b.user.id);
  await addContact(b, a.user.id);
}

async function openProfileFromChatList(page, name) {
  await openTab(page, 'Chats');
  await page.locator(`button[data-testid="chat-list-avatar"][title*="${name}"]`).first().click();
  await expect(page.getByTestId('profile-panel')).toBeVisible();
}

test.describe('profile panel', () => {
  test('opens from the chat list avatar and shows contact-only details', async ({ page }) => {
    const alice = await registerUser('profile-alice');
    const bob = await registerUser('profile-bob', { phone: true });
    await mutualContacts(alice, bob);
    const chat = await createDirectChat(alice, bob.user.id);
    await sendMessage(alice, chat._id, 'hello there');

    await signIn(page, alice);
    await openProfileFromChatList(page, bob.user.displayName);
    const panel = page.getByTestId('profile-panel');

    await expect(page.getByTestId('profile-name')).toHaveText(bob.user.displayName);
    // Bob registered with a phone: a contact sees it.
    await expect(page.getByTestId('profile-phone')).toBeVisible();
    // Actions are present.
    await expect(panel.getByRole('button', { name: 'Message' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Block' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Report' })).toBeVisible();
    // Enlarge the photo (initials fallback has no photo, so no lightbox).
    await page.getByRole('button', { name: 'Close profile' }).click();
    await expect(page.getByTestId('profile-panel')).toBeHidden();
  });

  test('opens from the conversation header', async ({ page }) => {
    const alice = await registerUser('hdr-alice');
    const bob = await registerUser('hdr-bob');
    await mutualContacts(alice, bob);
    const chat = await createDirectChat(alice, bob.user.id);
    await sendMessage(alice, chat._id, 'hi');

    await signIn(page, alice);
    await openTab(page, 'Chats');
    await page.getByText(bob.user.displayName, { exact: true }).first().click();
    await page.getByRole('button', { name: new RegExp(`Open ${bob.user.displayName}'s profile`) }).first().click();
    await expect(page.getByTestId('profile-panel')).toBeVisible();
    await expect(page.getByTestId('profile-name')).toHaveText(bob.user.displayName);
  });

  test('respects profile privacy: hidden email and hidden last seen', async ({ page }) => {
    const alice = await registerUser('priv-alice');
    const bob = await registerUser('priv-bob');
    await mutualContacts(alice, bob);

    const hide = await apiRequest('PUT', '/api/users/me/privacy', {
      token: bob.accessToken,
      body: { showEmail: false, showOnlineStatus: false },
    });
    expect(hide.status).toBe(200);

    await signIn(page, alice);
    await openTab(page, 'Contacts');
    await page.getByRole('button', { name: `Open ${bob.user.displayName}'s profile` }).first().click();
    const panel = page.getByTestId('profile-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('profile-email')).toHaveCount(0);
    await expect(page.getByTestId('profile-presence')).toHaveText(/Last seen hidden/i);
  });

  test('block from the panel stops messages in both directions', async ({ page }) => {
    const alice = await registerUser('block-alice');
    const bob = await registerUser('block-bob');
    await mutualContacts(alice, bob);
    const chat = await createDirectChat(alice, bob.user.id);
    await sendMessage(alice, chat._id, 'before block');

    await signIn(page, alice);
    await openProfileFromChatList(page, bob.user.displayName);
    const panel = page.getByTestId('profile-panel');
    await panel.getByRole('button', { name: 'Block' }).click();
    await panel.getByRole('button', { name: 'Yes, block' }).click();
    await expect(page.getByText(/is blocked/i)).toBeVisible();

    // Server-side enforcement (both directions).
    const stillThere = await apiRequest('GET', `/api/users/${alice.user.id}/profile`, { token: bob.accessToken });
    expect(stillThere.status).toBe(404);
    const send = await apiRequest('POST', '/api/messages', {
      token: bob.accessToken,
      body: { chatId: chat._id, type: 'text', content: 'blocked?' },
    });
    expect(send.status).toBe(403);

    // Unblock restores messaging.
    await panel.getByRole('button', { name: 'Unblock' }).first().click();
    await expect(page.getByText(/is unblocked/i)).toBeVisible();
    const after = await apiRequest('POST', '/api/messages', {
      token: bob.accessToken,
      body: { chatId: chat._id, type: 'text', content: 'unblocked!' },
    });
    expect(after.status).toBe(201);
  });

  test('mute action stores the mute server-side', async ({ page }) => {
    const alice = await registerUser('mute-alice');
    const bob = await registerUser('mute-bob');
    await mutualContacts(alice, bob);
    await createDirectChat(alice, bob.user.id);

    await signIn(page, alice);
    await openProfileFromChatList(page, bob.user.displayName);
    const panel = page.getByTestId('profile-panel');
    await panel.getByRole('button', { name: 'Mute' }).click();
    await expect(page.getByText(/Notifications muted/i)).toBeVisible();

    const muted = await apiRequest('GET', '/api/users/me/muted', { token: alice.accessToken });
    expect(muted.status).toBe(200);
    expect(muted.body.length).toBeGreaterThan(0);
  });

  test('report sends a moderation report', async ({ page }) => {
    const alice = await registerUser('report-alice');
    const bob = await registerUser('report-bob');
    await mutualContacts(alice, bob);

    await signIn(page, alice);
    await openTab(page, 'Contacts');
    await page.getByRole('button', { name: `Open ${bob.user.displayName}'s profile` }).first().click();
    const panel = page.getByTestId('profile-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Report' }).click();
    await page.getByRole('radio', { name: /Spam or unwanted messages/ }).check();
    await page.getByRole('dialog', { name: /Report / }).getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText(/Report sent/i)).toBeVisible();
  });

  test('shows common groups and shared media', async ({ page }) => {
    const alice = await registerUser('shared-alice');
    const bob = await registerUser('shared-bob');
    await mutualContacts(alice, bob);
    const groupName = `Shared group ${Date.now().toString(36)}`;
    await createGroup(alice, groupName, [bob.user.id]);
    const chat = await createDirectChat(alice, bob.user.id);
    await apiRequest('POST', '/api/messages', {
      token: alice.accessToken,
      body: { chatId: chat._id, type: 'image', mediaUrl: 'https://example.com/shared-photo.png' },
    });

    await signIn(page, alice);
    await openProfileFromChatList(page, bob.user.displayName);
    const panel = page.getByTestId('profile-panel');
    await expect(page.getByText(/1 group in common/i)).toBeVisible();
    await expect(panel.getByText(groupName)).toBeVisible();
    await expect(panel.getByRole('button', { name: /Shared image/i })).toBeVisible();
  });

  test('opens from a group member list', async ({ page }) => {
    const alice = await registerUser('grp-alice');
    const bob = await registerUser('grp-bob');
    const groupName = `Profile group ${Date.now().toString(36)}`;
    await createGroup(alice, groupName, [bob.user.id]);

    await signIn(page, alice);
    await openTab(page, 'Groups');
    await page.getByRole('button', { name: 'Info' }).first().click();
    await page.getByTitle(`Open ${bob.user.displayName}'s profile`).click();
    await expect(page.getByTestId('profile-panel')).toBeVisible();
    await expect(page.getByTestId('profile-name')).toHaveText(bob.user.displayName);
  });
});


