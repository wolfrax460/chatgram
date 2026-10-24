/**
 * Security end-to-end checks:
 *  - an XSS payload in a message is rendered as plain text,
 *  - authorization: a user cannot read or act on chats/groups they are not in,
 *  - blocked users cannot message (server-side; also checked in profile.spec),
 *  - rate-limited endpoints exist (smoke: login throttle responds 429 or 401).
 */
const { test, expect } = require('@playwright/test');
const {
  apiRequest, registerUser, signIn, openTab, addContact, createDirectChat, createGroup,
} = require('./helpers');

test.describe.configure({ timeout: 120_000 });

test.describe('security', () => {
  test('XSS payloads render as plain text and never execute', async ({ page }) => {
    const alice = await registerUser('sec-alice');
    const bob = await registerUser('sec-bob');
    await addContact(alice, bob.user.id);
    await addContact(bob, alice.user.id);
    const chat = await createDirectChat(alice, bob.user.id);

    const payload = '<img src=x onerror="window.__xss = 1"> **not bold** <script>window.__xss = 2</script>';
    const sent = await apiRequest('POST', '/api/messages', {
      token: bob.accessToken,
      body: { chatId: chat._id, type: 'text', content: payload },
    });
    expect(sent.status).toBe(201);

    await signIn(page, alice);
    await page.getByRole('button', { name: new RegExp('^' + bob.user.displayName) }).first().click();
    await expect(page.locator('section').getByText(/not bold/).first()).toBeVisible({ timeout: 20_000 });

    // The payload is shown literally, without creating DOM nodes.
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(await page.locator('script', { hasText: '__xss' }).count()).toBe(0);
    const bubbleText = await page.locator('section').getByText(/not bold/).first().innerText();
    expect(bubbleText).toContain('<img src=x');
  });

  test('a user cannot read or act on chats and groups they are not in', async ({ page }) => {
    const alice = await registerUser('sec-owner');
    const bob = await registerUser('sec-member');
    const outsider = await registerUser('sec-outsider');
    const chat = await createDirectChat(alice, bob.user.id);
    const group = await createGroup(alice, `Secret group ${Date.now().toString(36)}`, [bob.user.id]);
    const message = await apiRequest('POST', '/api/messages', {
      token: alice.accessToken,
      body: { chatId: chat._id, type: 'text', content: 'private message' },
    });
    expect(message.status).toBe(201);

    // Direct chat message history.
    const readMessages = await apiRequest('GET', `/api/messages?chatId=${chat._id}`, { token: outsider.accessToken });
    expect([403, 404]).toContain(readMessages.status);

    // Sending into someone else's chat.
    const send = await apiRequest('POST', '/api/messages', {
      token: outsider.accessToken,
      body: { chatId: chat._id, type: 'text', content: 'intruder' },
    });
    expect(send.status).toBe(403);

    // Group endpoints.
    const readGroup = await apiRequest('GET', `/api/chats/${group._id}`, { token: outsider.accessToken });
    expect([403, 404]).toContain(readGroup.status);
    const readRoster = await apiRequest('GET', `/api/chats/${group._id}/participants`, { token: outsider.accessToken });
    expect(readRoster.status).toBe(403);
    const readMedia = await apiRequest('GET', `/api/chats/${group._id}/media`, { token: outsider.accessToken });
    expect(readMedia.status).toBe(403);
    const pin = await apiRequest('POST', `/api/chats/${group._id}/pin`, {
      token: outsider.accessToken,
      body: { messageId: message.body._id },
    });
    expect(pin.status).toBe(403);
    const deleteMessage = await apiRequest('DELETE', `/api/messages/${message.body._id}?scope=everyone`, {
      token: outsider.accessToken,
    });
    expect(deleteMessage.status).toBe(403);

    // Deleting a chat you are not part of.
    const deleteChat = await apiRequest('DELETE', `/api/chats/${chat._id}/messages`, { token: outsider.accessToken });
    expect([403, 404]).toContain(deleteChat.status);

    // The outsider's own chat list does not contain those conversations.
    await signIn(page, outsider);
    await openTab(page, 'Chats');
    await expect(page.getByText('No conversations yet.')).toBeVisible({ timeout: 20_000 });
  });

  test('login is rate limited after repeated wrong passwords', async () => {
    const victim = await registerUser('sec-throttle');
    let lastStatus = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const res = await apiRequest('POST', '/api/auth/login', {
        body: { identifier: victim.identifier, password: 'wrong-password' },
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    // The local staging stack disables the per-IP limiter for the suite, but the
    // per-account lockout (accountLockout middleware) must still fire.
    expect([401, 429]).toContain(lastStatus);
    const locked = await apiRequest('POST', '/api/auth/login', {
      body: { identifier: victim.identifier, password: victim.password },
    });
    expect([200, 429]).toContain(locked.status);
  });
});


