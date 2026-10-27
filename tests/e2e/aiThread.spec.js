/**
 * Change 1 — Chatgram AI must behave like a normal Chatgram conversation
 * (Meta AI in WhatsApp), not like a separate page.
 *
 * Runs against the local staging stack; the AI provider is the deterministic
 * mock in tests/e2e/mockAiProvider.js, configured through the real admin API.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn } = require('./helpers');
const mockAi = require('./mockAiProvider');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const APP = process.env.E2E_WEB_URL || 'http://127.0.0.1:5174';

test.describe.configure({ timeout: 180_000 });

test.describe('Chatgram AI thread', () => {
  test.beforeAll(async () => {
    await mockAi.start();
  });

  test.afterAll(async () => {
    await mockAi.stop();
  });

  test.beforeEach(async ({ request }) => {
    await mockAi.configure(request, API);
  });

  test.afterEach(async ({ request }) => {
    await mockAi.unconfigure(request, API);
  });

  async function openAiThread(page) {
    await expect(page.locator('[data-testid="ai-chat-row"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="ai-chat-row"]').click();
    await expect(page.locator('[data-testid="ai-thread"]')).toBeVisible({ timeout: 20_000 });
  }

  async function sendQuestion(page, text) {
    const box = page.getByPlaceholder('Message Chatgram AI');
    await box.fill(text);
    await box.press('Enter');
  }

  test('the pinned row opens the standard chat view with an AI header and no call buttons', async ({ page }) => {
    const user = await registerUser('ai-thread');
    await signIn(page, user);

    const pinned = page.locator('[data-testid="ai-chat-row"]');
    await expect(pinned).toBeVisible({ timeout: 30_000 });
    await expect(pinned).toContainText('Chatgram AI');
    await expect(pinned).toContainText('Official');

    await pinned.click();
    await expect(page.locator('[data-testid="ai-thread"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="ai-header-title"]')).toHaveText('Chatgram AI');
    await expect(page.locator('[data-testid="ai-header-subtitle"]')).toHaveText('AI');

    // Same header as people, minus the things an AI cannot do.
    await expect(page.getByRole('button', { name: 'Search in chat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'More' })).toBeVisible();
    expect(await page.getByRole('button', { name: 'Voice call' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Video call' }).count()).toBe(0);

    // Standard chat composer: text box + emoji; attach stays hidden because the
    // configured providers read text only (and the UI says why).
    await expect(page.getByPlaceholder('Message Chatgram AI')).toBeVisible();
    expect(await page.getByTitle('Attach').count()).toBe(0);
    await expect(page.locator('[data-testid="ai-attach-note"]')).toContainText('text only');
    await expect(page.locator('[data-testid="ai-disclaimer"]')).toContainText('can make mistakes');

    // Same message-list chrome: once a chat is open the AI thread is the right pane.
    await expect(page.locator('nav')).toBeVisible();
  });

  test('typing indicator, streaming markdown and XSS-as-text', async ({ page }) => {
    const user = await registerUser('ai-stream');
    await signIn(page, user);
    await openAiThread(page);

    await sendQuestion(page, 'Show me markdown and lists');

    // The placeholder bubble + typing line are visible before the first token.
    await expect(page.locator('[data-testid="ai-typing"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="ai-message-user"]')).toBeVisible();

    // The streamed answer renders real markdown safely.
    const answer = page.locator('[data-testid="ai-message-assistant"]').last();
    await expect(answer).toContainText('Chatgram AI', { timeout: 30_000 });
    await expect(answer.locator('strong')).toContainText('Chatgram AI');
    await expect(answer.locator('ul li')).toHaveCount(2);
    await expect(answer.locator('ol li')).toHaveCount(2);
    await expect(answer.locator('pre code')).toContainText('console.log');

    // The model's <script> tag must be shown as text, never executed.
    await expect(answer).toContainText('<script>window.__xss = true; alert("xss")</script>');
    expect(await page.evaluate(() => Boolean(window.__xss))).toBe(false);
    await expect(answer.locator('script')).toHaveCount(0);

    // Suggestion pills belong to the empty thread only.
    await expect(page.locator('[data-testid="ai-suggestions"]')).toHaveCount(0);
  });

  test('copy, good, bad and reply-to work on an answer', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const user = await registerUser('ai-actions');
    await signIn(page, user);
    await openAiThread(page);

    // Suggestion pills disappear after the first message.
    await expect(page.locator('[data-testid="ai-suggestion-pill"]').first()).toBeVisible();
    await page.locator('[data-testid="ai-suggestion-pill"]').first().click();
    await expect(page.locator('[data-testid="ai-suggestions"]')).toHaveCount(0);

    const answer = page.locator('[data-testid="ai-message-assistant"]').last();
    await expect(answer.locator('strong')).toContainText('Chatgram AI', { timeout: 30_000 });

    await answer.getByRole('button', { name: 'Copy answer' }).click();
    await expect(page.getByText('Answer copied.')).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('Chatgram AI');

    await answer.getByRole('button', { name: 'Good answer' }).click();
    await expect(page.getByText('Thanks for the feedback.')).toBeVisible({ timeout: 15_000 });
    await answer.getByRole('button', { name: 'Bad answer' }).click();
    await expect(page.getByText(/Chatgram team will look at this answer/)).toBeVisible({ timeout: 15_000 });

    // Reply quotes the specific answer.
    await answer.getByRole('button', { name: 'Reply to this message' }).click();
    await expect(page.getByText('Chatgram AI', { exact: false }).first()).toBeVisible();
    await sendQuestion(page, 'Tell me more');
    const quoted = page.locator('[data-testid="ai-message-user"]').last();
    await expect(quoted).toContainText('Tell me more');
    await expect(quoted).toContainText('Chatgram AI');
  });

  test('clear chat empties the conversation from the three-dot menu', async ({ page }) => {
    const user = await registerUser('ai-clear');
    await signIn(page, user);
    await openAiThread(page);

    await sendQuestion(page, 'Something to clear');
    await expect(page.locator('[data-testid="ai-message-assistant"]').last().locator('strong')).toContainText('Chatgram AI', { timeout: 30_000 });
    await expect(page.locator('[data-testid="ai-thread"]')).toHaveAttribute('data-busy', 'false', { timeout: 30_000 });

    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('button', { name: 'New conversation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous conversations' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear chat' }).click();

    await expect(page.locator('[data-testid="ai-message-assistant"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ai-message-user"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ai-intro"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-suggestion-pill"]').first()).toBeVisible();
  });

  test('the Ask Chatgram AI search row sends the typed query', async ({ page }) => {
    const user = await registerUser('ai-search');
    await signIn(page, user);

    const search = page.getByPlaceholder('Search chats');
    await search.fill('what can you do for me');
    const askRow = page.locator('[data-testid="ask-ai-row"]');
    await expect(askRow).toBeVisible({ timeout: 15_000 });
    await askRow.click();

    await expect(page.locator('[data-testid="ai-thread"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="ai-message-user"]').first()).toContainText('what can you do for me');
    await expect(page.locator('[data-testid="ai-message-assistant"]').last().locator('strong')).toContainText('Chatgram AI', { timeout: 30_000 });
  });

  test('the pinned row previews the AI answer after leaving the thread', async ({ page }) => {
    const user = await registerUser('ai-preview');
    await signIn(page, user);
    await openAiThread(page);
    await sendQuestion(page, 'Give me the preview answer');
    await expect(page.locator('[data-testid="ai-message-assistant"]').last().locator('strong')).toContainText('Chatgram AI', { timeout: 30_000 });
    await expect(page.locator('[data-testid="ai-thread"]')).toHaveAttribute('data-busy', 'false', { timeout: 30_000 });

    // Back to the normal chat list: the pinned row shows the last answer.
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    const pinned = page.locator('[data-testid="ai-chat-row"]');
    await expect(pinned).toBeVisible();
    await expect(pinned).not.toContainText('Official · Ask anything');
  });
});
