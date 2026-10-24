/**
 * Change 3 regression: native <select> dropdown lists must be dark with
 * readable text on the dark theme — never a white box with invisible options.
 *
 * Native option popups are painted by the browser, so this asserts the computed
 * styles the popup is painted from: `color-scheme: dark` on the document plus a
 * dark background / light text on select and option, with >= 4.5:1 contrast.
 *
 * Runs against the local staging stack only.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn, openTab } = require('./helpers');

const API = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
// Same-origin by host: the app must be reached through 127.0.0.1 (not
// localhost) so the API on another port is the SAME site and the admin
// SameSite=Strict session cookie is sent.
const APP = 'http://127.0.0.1:5174';
// Local staging-only admin password; documented in scripts/start-staging.ps1.
const STAGING_ADMIN_PASSWORD = 'staging-admin-password-123';

function parseColor(value) {
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number(part.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function isWhite(color) {
  return color && color.r >= 250 && color.g >= 250 && color.b >= 250;
}

async function forceDarkTheme(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chatgram.theme', 'dark');
    } catch {
      /* ignore */
    }
  });
}

/** Computed styles the browser uses to paint a select and its option list. */
async function selectPaintStyles(select) {
  return select.evaluate((element) => {
    const style = getComputedStyle(element);
    const option = element.querySelector('option');
    const optionStyle = option ? getComputedStyle(option) : null;
    return {
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      darkClass: document.documentElement.classList.contains('dark'),
      background: style.backgroundColor,
      color: style.color,
      optionBackground: optionStyle ? optionStyle.backgroundColor : '',
      optionColor: optionStyle ? optionStyle.color : '',
      optionCount: element.options.length,
      sampleOption: option ? option.textContent.trim() : '',
    };
  });
}

function assertDarkAndReadable(styles, label) {
  expect(styles.darkClass, `${label}: dark theme active`).toBe(true);
  expect(styles.colorScheme, `${label}: document color-scheme`).toContain('dark');
  expect(styles.optionCount, `${label}: has options`).toBeGreaterThan(0);

  const optionBackground = parseColor(styles.optionBackground);
  const optionColor = parseColor(styles.optionColor);
  expect(optionBackground, `${label}: option background is a colour`).not.toBeNull();
  expect(optionColor, `${label}: option text colour`).not.toBeNull();
  expect(isWhite(optionBackground), `${label}: option list is not white (${styles.optionBackground})`).toBe(false);
  const ratio = contrastRatio(optionColor, optionBackground);
  expect(ratio, `${label}: option contrast ${ratio.toFixed(2)}:1 (${styles.optionColor} on ${styles.optionBackground})`).toBeGreaterThanOrEqual(4.5);

  // The closed control must not be a white box either.
  const controlBackground = parseColor(styles.background);
  if (controlBackground && controlBackground.a > 0.5) {
    expect(isWhite(controlBackground), `${label}: closed select is not white`).toBe(false);
  }
}

test.describe.configure({ timeout: 120_000 });

test.describe('Change 3 — dark native select popups', () => {
  test('the auth sign-up country select paints dark options', async ({ page }) => {
    await forceDarkTheme(page);
    await page.goto(`${APP}/`);
    await page.locator('[data-testid="go-signup"]').click({ timeout: 30_000 });
    // Typing a phone number reveals the country-code select.
    await page.locator('#signup-identifier').fill('0788123456');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 30_000 });
    assertDarkAndReadable(await selectPaintStyles(select), 'auth country select');
  });

  test('a signed-in settings select paints dark options', async ({ page }) => {
    await forceDarkTheme(page);
    const user = await registerUser('select-settings');
    await signIn(page, user);
    await page.goto(`${APP}/`);
    await openTab(page, 'Settings');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 30_000 });
    assertDarkAndReadable(await selectPaintStyles(select), 'settings select');
  });

  for (const viewport of [
    { width: 1366, height: 600 },
    { width: 1920, height: 1080 },
  ]) {
    test(`admin Model providers + feature routing selectors are dark at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await forceDarkTheme(page);
      const login = await page.request.post(`${API}/api/admin/auth/login`, {
        data: { password: STAGING_ADMIN_PASSWORD },
      });
      expect(login.ok(), `admin login: ${login.status()}`).toBeTruthy();

      await page.goto(`${APP}/admin`);
      await expect(page.getByText('Model providers', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
      await page.getByText('Model providers', { exact: false }).first().scrollIntoViewIfNeeded();

      const providerSelect = page.locator('label:has-text("Provider") select').first();
      await expect(providerSelect).toBeVisible({ timeout: 15_000 });
      assertDarkAndReadable(await selectPaintStyles(providerSelect), `admin provider picker @${viewport.width}`);

      const routingSelect = page.locator('select[aria-label$="primary provider"]').first();
      await expect(routingSelect).toBeVisible({ timeout: 15_000 });
      assertDarkAndReadable(await selectPaintStyles(routingSelect), `admin feature routing @${viewport.width}`);
    });
  }
});
