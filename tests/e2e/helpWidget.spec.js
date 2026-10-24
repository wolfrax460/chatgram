/**
 * Help-centre widget (section W): three tabs, article search/reader, AI chat,
 * guest sessions, human handoff and login-aware greeting.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn } = require('./helpers');

test.describe.configure({ timeout: 150_000 });

async function openWidget(page) {
  // Guests get the floating launcher; signed-in users open the same widget from
  // the sidebar Help button (the floating launcher is hidden in the app so it
  // never covers the composer).
  const sidebar = page.getByTestId('sidebar-help');
  if ((await sidebar.count()) > 0) {
    await sidebar.first().click();
  } else {
    await page.getByTestId('help-launcher').click();
  }
  await expect(page.getByTestId('help-widget')).toBeVisible({ timeout: 15_000 });
}

test.describe('help widget', () => {
  test('guest: home, ask the assistant, article citation, resolve and delete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('help-launcher')).toBeVisible({ timeout: 20_000 });
    await openWidget(page);

    // Home tab content.
    await expect(page.getByText(/Hello! How can we help\?/)).toBeVisible();
    await expect(page.getByText('Status', { exact: true })).toBeVisible();
    await expect(page.getByText('Suggested articles')).toBeVisible();
    await expect(page.getByTestId('ask-question')).toBeVisible();

    // Start a conversation and ask a question.
    await page.getByTestId('ask-question').click();
    const composer = page.getByRole('textbox', { name: 'Message' });
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill('How do I change my password?');
    await page.getByRole('button', { name: 'Send message' }).click();

    // Assistant answer + article citation. The welcome bubble exists already, so
    // wait for the last assistant bubble to contain the actual answer.
    await expect
      .poll(async () => (await page.getByTestId('help-message-assistant').last().innerText()).toLowerCase(), {
        timeout: 30_000,
      })
      .toMatch(/password|settings|account/);
    const citation = page.getByRole('button', { name: /Read the article/ }).first();
    await expect(citation).toBeVisible();
    await citation.click();

    // Article reader opens with the body and a "Was this helpful?" card.
    await expect(page.getByTestId('help-article-body')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Was this helpful?')).toBeVisible();
    await expect(page.getByText('Still need help? Ask a question')).toBeVisible();

    // Back to the conversation and resolve it.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(page.getByText(/Chatgram Assistant|Support ·/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(page.getByText(/Marked as resolved/)).toBeVisible({ timeout: 20_000 });
  });

  test('help tab search and article list', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('help-launcher')).toBeVisible({ timeout: 20_000 });
    await openWidget(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();

    // Collections with article counts.
    await expect(page.getByText(/article(s)?$/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('help-search').fill('password');
    const result = page.getByText('Change your password', { exact: true }).first();
    await expect(result).toBeVisible({ timeout: 20_000 });
    await result.click();
    await expect(page.getByTestId('help-article-body')).toBeVisible({ timeout: 20_000 });

    // No-results fallback.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByTestId('help-search').fill('zzzznothing');
    await expect(page.getByText(/No articles matched/)).toBeVisible({ timeout: 20_000 });
  });

  test('handoff to a person creates a ticket and shows its id', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('help-launcher')).toBeVisible({ timeout: 20_000 });
    await openWidget(page);
    await page.getByTestId('ask-question').click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('textbox', { name: 'Message' }).fill('I need a person please');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByTestId('help-message-assistant').first()).toBeVisible({ timeout: 25_000 });

    await page.getByRole('button', { name: /Talk to a person/ }).first().click();
    await page.getByLabel('Your email (so we can reply)').fill('widget-test@chatgram.test');
    await page.getByRole('button', { name: 'Send to the team' }).click();
    await expect(page.getByText(/Your ticket is CG-/).first()).toBeVisible({ timeout: 25_000 });
  });

  test('signed-in user gets a named greeting and the conversation survives a reload', async ({ page }) => {
    const account = await registerUser('widget-user');
    await signIn(page, account);
    await openWidget(page);

    const firstName = String(account.user.displayName).split(' ')[0];
    await expect(page.getByText(new RegExp(`Hello ${firstName}! How can we help\\?`))).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('ask-question').click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('textbox', { name: 'Message' }).fill('What are the status limits?');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByTestId('help-message-assistant').first()).toBeVisible({ timeout: 25_000 });

    // Reload: the Messages tab reads the conversation back from the server.
    await page.reload();
    await expect(page.getByTestId('sidebar-help')).toBeVisible({ timeout: 20_000 });
    await openWidget(page);
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(page.getByText(/Chatgram Assistant|Support Â·/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Escape closes the widget', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('help-launcher')).toBeVisible({ timeout: 20_000 });
    await openWidget(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-widget')).toBeHidden({ timeout: 10_000 });
  });
});

