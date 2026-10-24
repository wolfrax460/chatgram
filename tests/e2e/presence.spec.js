/**
 * Presence in the UI: when the other person closes the app, the chat header must
 * stop claiming they are "online" and fall back to "last seen …".
 *
 * This is the regression that made users look permanently online: the client
 * trusted a stored flag instead of live sockets, so nobody ever went offline.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, addContact, createDirectChat } = require('./helpers');

test.describe.configure({ timeout: 480_000 });

const WEB = process.env.E2E_WEB_URL || 'http://localhost:5174';

/** Seed the app's storage and open it. Generous timeout: Vite compiles cold. */
async function openAs(browser, account) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(
    ([access, refresh, user]) => {
      localStorage.setItem('chatgram.accessToken', access);
      localStorage.setItem('chatgram.refreshToken', refresh || '');
      localStorage.setItem('chatgram.session.user', user);
    },
    [account.accessToken, account.refreshToken || '', JSON.stringify(account.user)],
  );
  const page = await context.newPage();
  await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('nav', { state: 'attached', timeout: 120_000 });
  return { context, page };
}

test('closing the app makes the other side show "last seen" instead of "online"', async ({ browser }) => {
  const alice = await registerUser('presence-alice');
  const bob = await registerUser('presence-bob');
  await addContact(alice, bob.user.id);
  await addContact(bob, alice.user.id);
  await createDirectChat(alice, bob.user.id);

  const a = await openAs(browser, alice);
  const b = await openAs(browser, bob);
  try {
    // A opens the conversation; B is connected, so the header says "online".
    await a.page.getByText(/E2E presence-bob/).first().click({ timeout: 120_000 });
    await expect(a.page.getByPlaceholder(/Type a message|Reconnecting/)).toBeVisible({ timeout: 60_000 });
    await expect(a.page.getByText('online', { exact: true })).toBeVisible({ timeout: 60_000 });

    // B closes the app entirely: the socket drops and the server says offline.
    await b.context.close();

    // A must stop saying "online" and show a last-seen line instead.
    await expect(a.page.getByText(/last seen/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(a.page.getByText('online', { exact: true })).toHaveCount(0);
  } finally {
    await a.context.close().catch(() => {});
    await b.context.close().catch(() => {});
  }
});
