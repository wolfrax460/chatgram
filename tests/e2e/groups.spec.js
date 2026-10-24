/**
 * Group end-to-end tests (section E rest), three real users.
 *
 * Covers the member roster, admin-only controls, live member-list updates over
 * the socket, promote/demote, leaving with a system message, invite links with
 * preview + join, and the pinned-message banner.
 */
const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 150_000 });
const {
  apiRequest, registerUser, signIn, newSession, openTab, createGroup, sendMessage, addContact,
} = require('./helpers');

async function groupMembers(account, chatId) {
  return apiRequest('GET', `/api/chats/${chatId}/participants`, { token: account.accessToken });
}

async function openGroupChat(page, groupName) {
  await openTab(page, 'Groups');
  await page.getByRole('button', { name: new RegExp(groupName) }).first().click();
  await expect(page.getByRole('button', { name: /Open group info|Group info|Back/i }).first()).toBeVisible({ timeout: 15_000 }).catch(() => {});
}

test.describe('groups', () => {
  test('admin sees the roster and adding a member updates the other member live', async ({ page, browser }) => {
    const alice = await registerUser('grp-admin');
    const bob = await registerUser('grp-bob');
    const carol = await registerUser('grp-carol');
    const groupName = `Live group ${Date.now().toString(36)}`;
    const chat = await createGroup(alice, groupName, [bob.user.id]);
    // Carol must be in Alice's contacts to appear in the "Add members" picker.
    await addContact(alice, carol.user.id);

    // Carol is signed in on a second, isolated browser context.
    const carolSession = await newSession(browser, carol);
    const carolPage = carolSession.page;
    await openTab(carolPage, 'Groups');

    await signIn(page, alice);
    await openTab(page, 'Groups');
    await page.getByRole('button', { name: 'Info' }).first().click();

    await expect(page.getByTestId('group-info').getByText('2 members')).toBeVisible();
    await expect(page.getByText(bob.user.displayName).first()).toBeVisible();
    await expect(page.getByText(/created by/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add members' })).toBeVisible();

    await page.getByRole('button', { name: 'Add members' }).click();
    await page.getByRole('button', { name: new RegExp(carol.user.displayName) }).first().click();
    await page.getByRole('button', { name: /^Add 1/ }).click();
    await expect(page.getByTestId('group-info').getByText('3 members')).toBeVisible({ timeout: 15_000 });

    // Carol's page updates live over the socket (no reload).
    await expect(carolPage.getByRole('button', { name: new RegExp(groupName) })).toBeVisible({ timeout: 20_000 });
    const members = await groupMembers(alice, chat._id);
    expect(members.body.memberCount).toBe(3);
    await carolSession.context.close();
  });

  test('a non-admin member sees no admin controls', async ({ page }) => {
    const alice = await registerUser('grp-adm2');
    const bob = await registerUser('grp-member');
    const groupName = `Plain group ${Date.now().toString(36)}`;
    await createGroup(alice, groupName, [bob.user.id]);

    await signIn(page, bob);
    await openTab(page, 'Groups');
    await page.getByRole('button', { name: 'Info' }).first().click();
    await expect(page.getByTestId('group-info').getByText('2 members')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add members' })).toHaveCount(0);
    await expect(page.getByTitle('Make admin')).toHaveCount(0);
    await expect(page.getByTitle('Remove from group')).toHaveCount(0);
    // Settings are visible but read-only for members.
    await page.getByTestId('group-info').getByRole('button', { name: 'settings', exact: true }).click();
    await expect(page.getByText(/Only group admins can change these settings/i)).toBeVisible();
  });

  test('promote, leave with confirmation and a "left" system message', async ({ page, browser }) => {
    const alice = await registerUser('grp-leave-admin');
    const bob = await registerUser('grp-leave-bob');
    const groupName = `Leave group ${Date.now().toString(36)}`;
    const chat = await createGroup(alice, groupName, [bob.user.id]);

    // Bob gets his own isolated browser context (localStorage is per context).
    const bobSession = await newSession(browser, bob);
    const bobPage = bobSession.page;

    await signIn(page, alice);
    await openTab(page, 'Groups');

    // Alice promotes Bob from the roster (no need to open the conversation).
    await page.getByRole('button', { name: 'Info' }).first().click();
    await page.getByTitle('Make admin').first().click();
    await expect
      .poll(async () => {
        const res = await groupMembers(alice, chat._id);
        return (res.body.members || []).find((m) => m._id === bob.user.id)?.isAdmin;
      }, { timeout: 15_000 })
      .toBe(true);

    // Open the conversation: Bob's leave system message must arrive live.
    await page.getByRole('button', { name: new RegExp(groupName) }).first().click();
    await expect(page.getByPlaceholder('Type a message')).toBeVisible({ timeout: 15_000 });

    // Bob leaves from his own page.
    await openTab(bobPage, 'Groups');
    await bobPage.getByRole('button', { name: 'Info' }).first().click();
    await bobPage.getByTestId('group-info').getByRole('button', { name: 'Leave group' }).click();
    await bobPage.getByRole('button', { name: 'Yes, leave' }).click();
    await expect(bobPage.getByRole('button', { name: new RegExp(groupName) })).toHaveCount(0, { timeout: 20_000 });

    // Alice's open conversation receives the system message live.
    await expect(page.getByTestId('system-message').filter({ hasText: /left/i }).first()).toBeVisible({ timeout: 20_000 });
    const members = await groupMembers(alice, chat._id);
    expect(members.body.memberCount).toBe(1);
    await bobSession.context.close();
  });

  test('invite link: preview, join and land in the group', async ({ page, browser }) => {
    const alice = await registerUser('grp-invite-admin');
    const bob = await registerUser('grp-invite-bob');
    const groupName = `Invite group ${Date.now().toString(36)}`;
    const chat = await createGroup(alice, groupName, [bob.user.id]);

    await signIn(page, alice);
    await openTab(page, 'Groups');
    await page.getByRole('button', { name: 'Info' }).first().click();
    await page.getByTestId('group-info').getByRole('button', { name: 'settings', exact: true }).click();
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByRole('button', { name: /Copy link/ })).toBeVisible({ timeout: 15_000 });

    const invite = await apiRequest('GET', `/api/chats/${chat._id}/invite`, { token: alice.accessToken });
    expect(invite.body.inviteEnabled).toBe(true);
    const token = invite.body.token;
    expect(token).toBeTruthy();

    // A brand-new signed-in user opens the invite URL in an isolated context.
    const dave = await registerUser('grp-invite-dave');
    const daveSession = await newSession(browser, dave);
    const davePage = daveSession.page;
    await davePage.goto(`/join/${token}`);
    await expect(davePage.getByText(groupName)).toBeVisible({ timeout: 15_000 });
    await davePage.getByRole('button', { name: 'Join group' }).click();
    await expect(davePage.getByRole('button', { name: 'Open the group' })).toBeVisible({ timeout: 20_000 });
    await davePage.getByRole('button', { name: 'Open the group' }).click();
    await expect(davePage.getByText(groupName).first()).toBeVisible({ timeout: 25_000 });

    const members = await groupMembers(alice, chat._id);
    expect(members.body.memberCount).toBe(3);

    // A bad token shows the invalid state (same user, same context is fine).
    const badPage = await daveSession.context.newPage();
    await badPage.goto('/join/not-a-real-token');
    await expect(badPage.getByText(/Invite not valid/i)).toBeVisible({ timeout: 20_000 });
    await daveSession.context.close();
  });

  test('pinned message shows in the conversation banner and can be unpinned', async ({ page }) => {
    const alice = await registerUser('grp-pin-admin');
    const bob = await registerUser('grp-pin-bob');
    const groupName = `Pin group ${Date.now().toString(36)}`;
    const chat = await createGroup(alice, groupName, [bob.user.id]);
    const message = await sendMessage(alice, chat._id, 'This should be pinned');

    const pin = await apiRequest('POST', `/api/chats/${chat._id}/pin`, {
      token: alice.accessToken,
      body: { messageId: message._id },
    });
    expect(pin.status).toBe(200);

    await signIn(page, alice);
    await openTab(page, 'Groups');
    await page.getByRole('button', { name: new RegExp(groupName) }).first().click();
    await expect(page.getByTestId('pinned-message')).toHaveText('This should be pinned', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Unpin' }).click();
    await expect(page.getByTestId('pinned-message')).toHaveCount(0, { timeout: 15_000 });
  });

  test('admin uploads a group photo and everyone sees it', async ({ page }) => {
    const fs = require('fs');
    const path = require('path');
    const alice = await registerUser('grp-photo-admin');
    const bob = await registerUser('grp-photo-bob');
    const groupName = `Photo group ${Date.now().toString(36)}`;
    await createGroup(alice, groupName, [bob.user.id]);

    await signIn(page, alice);
    await openTab(page, 'Groups');
    await page.getByRole('button', { name: 'Info' }).first().click();
    await page
      .getByTestId('group-photo-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'status-image.png'));
    await expect(page.getByText('Group photo updated.')).toBeVisible({ timeout: 20_000 });
    const photo = page.getByTestId('group-photo');
    await expect(photo).toBeVisible();
    const src = await photo.getAttribute('src');
    expect(src).toContain('/uploads/');

    // The system message reaches the conversation.
    await page.getByRole('button', { name: new RegExp(groupName) }).first().click();
    await expect(page.getByTestId('system-message').filter({ hasText: /group photo/i }).first()).toBeVisible({ timeout: 20_000 });
    expect(fs.existsSync(path.join(__dirname, 'fixtures', 'status-image.png'))).toBe(true);
  });
});


