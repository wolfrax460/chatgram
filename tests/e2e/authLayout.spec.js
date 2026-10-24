/**
 * Auth screens must fit short laptop viewports without scrolling (and stay
 * reachable when scrolling is unavoidable on phones).
 *
 * Reference problem: on a 1366x600 window the sign-in / sign-up cards were
 * taller than the viewport, so the primary button and footer were cut off.
 */
const { test, expect } = require('@playwright/test');

const LAPTOP_SIZES = [
  { width: 1366, height: 600 },
  { width: 1366, height: 680 },
  { width: 1280, height: 600 },
  { width: 1440, height: 700 },
  { width: 1920, height: 1080 },
];

const KEY_ELEMENTS = ['auth-primary', 'auth-google', 'auth-footer', 'auth-language', 'auth-version'];

async function openAuth(page) {
  await page.goto('/');
  await expect(page.getByTestId('auth-page')).toBeVisible({ timeout: 20_000 });
}

/** No vertical overflow in either the document or the auth scroll container. */
async function expectNoVerticalOverflow(page) {
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="auth-page"]');
    return {
      docScroll: document.documentElement.scrollHeight,
      docClient: document.documentElement.clientHeight,
      innerHeight: window.innerHeight,
      shellScroll: shell ? shell.scrollHeight : 0,
      shellClient: shell ? shell.clientHeight : 0,
    };
  });
  expect(metrics.docScroll).toBeLessThanOrEqual(metrics.innerHeight + 1);
  expect(metrics.shellScroll).toBeLessThanOrEqual(metrics.shellClient + 1);
}

async function expectElementsInsideViewport(page, height) {
  for (const id of KEY_ELEMENTS) {
    const locator = page.getByTestId(id);
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${id} should have a box`).not.toBeNull();
    expect(box.y, `${id} top inside viewport`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${id} bottom inside viewport`).toBeLessThanOrEqual(height + 1);
  }
}

test.describe('auth layout fits short laptop viewports', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const size of LAPTOP_SIZES) {
    test(`sign in fits at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await openAuth(page);
      await expectNoVerticalOverflow(page);
      await expectElementsInsideViewport(page, size.height);
    });

    test(`sign up fits at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await openAuth(page);
      await page.getByTestId('go-signup').click();
      await expect(page.getByLabel('Confirm password')).toBeVisible();
      await expectNoVerticalOverflow(page);
      await expectElementsInsideViewport(page, size.height);
    });
  }

  test('the two password fields sit side by side on wide screens', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 680 });
    await openAuth(page);
    await page.getByTestId('go-signup').click();
    const password = await page.locator('#signup-password').boundingBox();
    const confirm = await page.locator('#signup-confirm').boundingBox();
    expect(password).not.toBeNull();
    expect(confirm).not.toBeNull();
    // Same row, confirm to the right.
    expect(Math.abs(password.y - confirm.y)).toBeLessThanOrEqual(2);
    expect(confirm.x).toBeGreaterThan(password.x + password.width / 2);
  });
});

test('mobile 390x700: no horizontal overflow, everything reachable by scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openAuth(page);

  const horizontal = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(horizontal.scroll).toBeLessThanOrEqual(horizontal.client + 1);

  // Whatever it needs, the primary action must be reachable and fully visible.
  await page.getByTestId('auth-primary').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('auth-primary')).toBeVisible();
  const button = await page.getByTestId('auth-primary').boundingBox();
  expect(button).not.toBeNull();
  expect(button.y).toBeGreaterThanOrEqual(0);
  expect(button.y + button.height).toBeLessThanOrEqual(700 + 1);

  await page.getByTestId('auth-footer').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('auth-language')).toBeVisible();
  const lang = await page.getByTestId('auth-language').boundingBox();
  expect(lang.y + lang.height).toBeLessThanOrEqual(700 + 1);
});
