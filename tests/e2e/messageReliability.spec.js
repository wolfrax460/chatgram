/**
 * End-to-end regression: "I send a message, it appears, then disappears" and
 * "the sidebar unread badge stays on a conversation I already read".
 *
 * Root cause (fixed in the client, see apps/web/src/lib/useRealtime.ts and
 * apps/web/src/App.tsx): the access token lives 1 day. Once it expires while the
 * app stays open, every REST call still works — the API client refreshes the
 * token silently on 401 — but the Socket.IO connection keeps its dead token and
 * the server leaves it UNAUTHENTICATED. The composer sent over that socket, the
 * server answered `message:error: Not authenticated`, nothing was stored, and the
 * optimistic bubble (clock icon) disappeared on the next refetch. This spec pins
 * the real-world condition (expired access token + valid refresh token in
 * localStorage) and asserts the message is published and stays.
 *
 * The second test pins the unread badge: reading an open conversation must clear
 * the row badge instead of leaving it until an unrelated refetch.
 *
 * Staging only: the JWT secret below is the throw-away value
 * scripts/start-staging.ps1 sets locally (never the production secret).
 */
const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const { registerUser, signIn, createDirectChat, sendMessage, apiRequest } = require('./helpers');

const JWT_SECRET = process.env.E2E_JWT_SECRET || 'local-staging-jwt-secret-0123456789abcdef';

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** HS256 JWT for the *staging* secret, already expired. */
function expiredAccessToken(userId, tokenVersion = 0) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ userId: String(userId), tv: Number(tokenVersion) || 0, iat: now - 7200, exp: now - 3600 }),
  );
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64Url(signature)}`;
}

async function messages(chatId, token) {
  const result = await apiRequest('GET', `/api/messages?chatId=${chatId}&limit=200`, { token });
  if (result.status !== 200) throw new Error(`GET messages: ${result.status} ${JSON.stringify(result.body)}`);
  return Array.isArray(result.body) ? result.body : result.body.messages || [];
}

async function waitForMessage(chatId, token, text, timeoutMs = 8000) {
  const started = Date.now();
  let rows = [];
  while (Date.now() - started < timeoutMs) {
    rows = await messages(chatId, token);
    if (rows.some((row) => String(row.content) === text)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return rows;
}

test.describe('message reliability', () => {
  test('a message sent with an expired access token is published and stays on screen', async ({ page }) => {
    const owner = await registerUser('reliability-owner');
    const peer = await registerUser('reliability-peer');
    const chat = await createDirectChat(owner, peer.user.id || peer.user._id);
    const chatId = String(chat._id || chat.id);

    // Exactly the state the desktop app reaches after a day: the stored access
    // token is dead, the refresh token is still good.
    const expired = expiredAccessToken(owner.user.id || owner.user._id, owner.user.tokenVersion);
    await signIn(page, { ...owner, accessToken: expired });

    // The chat list must load (REST refreshes the token) and the socket must
    // re-authenticate with the refreshed token (otherwise every send is dropped).
    const row = page.getByText(peer.user.displayName, { exact: false }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();

    const composer = page.locator('textarea').first();
    await expect(composer).toBeVisible({ timeout: 15000 });
    const text = `must-stay-${Date.now().toString(36)}`;
    await composer.fill(text);
    await composer.press('Enter');

    // 1. The bubble is on screen and is NOT stuck on the clock ("sending") icon.
    await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[aria-label="Sending"]')).toHaveCount(0, { timeout: 10000 });

    // 2. It is really stored, with a real server id (the old bug persisted nothing).
    const rows = await waitForMessage(chatId, owner.accessToken, text);
    const stored = rows.find((message) => String(message.content) === text);
    expect(stored, 'the message must exist on the server').toBeTruthy();
    expect(String(stored._id)).not.toMatch(/^tmp-/);

    // 3. It survives a conversation refetch (this is what made it "disappear").
    await page.reload();
    await page.getByText(peer.user.displayName, { exact: false }).first().click();
    await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('a message arriving in the open conversation does not leave a stuck unread badge', async ({ page }) => {
    const owner = await registerUser('unread-owner');
    const peer = await registerUser('unread-peer');
    const chat = await createDirectChat(owner, peer.user.id || peer.user._id);
    const chatId = String(chat._id || chat.id);
    const text = `while-open-${Date.now().toString(36)}`;

    await signIn(page, owner);

    // The conversation is open and focused BEFORE the message arrives — exactly
    // the situation in the report ("am reading messages and still that one").
    await page.getByText(peer.user.displayName, { exact: false }).first().click();
    const composer = page.locator('textarea').first();
    await expect(composer).toBeVisible({ timeout: 15000 });

    await sendMessage(peer, chatId, text);
    await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15000 });

    // The open conversation marks the message read on the server...
    await expect
      .poll(
        async () => {
          const chats = await apiRequest('GET', '/api/chats', { token: owner.accessToken });
          const row = (chats.body || []).find((entry) => String(entry._id || entry.id) === chatId);
          return Number(row?.unreadCount);
        },
        { timeout: 10000 },
      )
      .toBe(0);

    // ...and the sidebar badge must follow. It used to stay on the row (the
    // cached ['chats'] list was never refreshed after the read) even though the
    // server already reported 0.
    const badge = page.locator(`[data-testid="chat-unread-badge"][data-chat-id="${chatId}"]`);
    await expect(badge).toHaveCount(0, { timeout: 5000 });
  });
});
