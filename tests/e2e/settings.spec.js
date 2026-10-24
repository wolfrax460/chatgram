/**
 * Settings audit (section F) end-to-end tests.
 *
 * Every section is opened and every control that saves is exercised: profile,
 * privacy switches, blocked users, appearance (theme + text size), language,
 * time format, change email, log out other devices and delete account.
 */
const { test, expect } = require('@playwright/test');
const {
  apiRequest, registerUser, signIn, openTab,
} = require('./helpers');

test.describe.configure({ timeout: 150_000 });

async function openSettings(page) {
  await openTab(page, 'Settings');
  await expect(page.getByTestId('settings-display-name')).toBeVisible({ timeout: 20_000 });
}

async function privacy(account) {
  return apiRequest('GET', '/api/users/me/privacy', { token: account.accessToken });
}

test.describe('settings', () => {
  test('edit profile, privacy switches and blocked users all work and save', async ({ page }) => {
    const me = await registerUser('set-profile');
    const other = await registerUser('set-blocked');

    await signIn(page, me);
    await openSettings(page);

    // ---- profile edit
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('#dn').fill('Settings Tester');
    await page.locator('#ab').fill('Testing every control');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('settings-display-name')).toHaveText('Settings Tester', { timeout: 15_000 });
    const meNow = await apiRequest('GET', '/api/auth/me', { token: me.accessToken });
    expect(meNow.body.displayName).toBe('Settings Tester');
    expect(meNow.body.about).toBe('Testing every control');

    // ---- privacy switches
    await page.getByTestId('privacy-photo').click();
    await page.getByTestId('privacy-receipts').click();
    await page.getByTestId('privacy-email').click();
    await expect.poll(async () => (await privacy(me)).body.showProfilePhoto, { timeout: 15_000 }).toBe(false);
    const afterPrivacy = await privacy(me);
    expect(afterPrivacy.body.readReceipts).toBe(false);
    expect(afterPrivacy.body.showEmail).toBe(false);

    // "Who can add me to groups" -> contacts
    await page.getByRole('group', { name: 'Who can add me to groups' }).getByRole('button', { name: 'My contacts' }).click();
    await expect.poll(async () => (await privacy(me)).body.whoCanAddToGroups, { timeout: 15_000 }).toBe('contacts');

    // ---- blocked users list + unblock
    const block = await apiRequest('POST', `/api/users/${other.user.id}/block`, { token: me.accessToken });
    expect(block.status).toBe(200);
    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId('blocked-user')).toContainText(other.user.displayName, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Unblock' }).click();
    await expect(page.getByTestId('blocked-user')).toHaveCount(0, { timeout: 15_000 });
    const blocked = await apiRequest('GET', '/api/users/me/blocked', { token: me.accessToken });
    expect(blocked.body.length).toBe(0);
  });

  test('appearance, text size, time format and language persist', async ({ page }) => {
    const me = await registerUser('set-appearance');
    await signIn(page, me);
    await openSettings(page);

    // Theme -> dark
    await page.getByRole('button', { name: /^Dark$/ }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Text size -> large
    await page.getByRole('group', { name: 'Text size' }).getByRole('button', { name: 'Large' }).click();
    const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(fontSize).toBe('18px');

    // Time format -> 24h
    await page.getByRole('group', { name: 'Time format' }).getByRole('button', { name: /24-hour/ }).click();

    // Language -> French (persisted; translated surfaces use it)
    await page.getByTestId('settings-language').selectOption('fr');
    const prefs = await page.evaluate(() => ({
      prefs: JSON.parse(localStorage.getItem('chatgram.prefs') || '{}'),
      locale: localStorage.getItem('chatgram.locale'),
    }));
    expect(prefs.prefs.timeFormat).toBe('24h');
    expect(prefs.prefs.textSize).toBe('large');
    expect(prefs.locale).toBe('fr');

    // Survive a reload.
    await page.reload();
    await openSettings(page);
    const fontSizeAfter = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(fontSizeAfter).toBe('18px');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('change the sign-in email with a verification code', async ({ page }) => {
    const me = await registerUser('set-identifier');
    const newEmail = `settings-new-${Date.now().toString(36)}@chatgram.test`;

    await signIn(page, me);
    await openSettings(page);
    await page.getByRole('button', { name: /Change email or phone/ }).click();
    await page.locator('#new-identifier').fill(newEmail);

    const responsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/auth/account/identifier/request') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send verification code' }).click();
    const response = await responsePromise;
    const payload = await response.json();
    expect(payload.devCode).toBeTruthy();

    await page.locator('#identifier-code').fill(payload.devCode);
    await page.locator('#identifier-password').fill(me.password);
    await page.getByRole('button', { name: 'Verify and save' }).click();
    await expect(page.getByTestId('settings-notice')).toContainText(/email address was updated/i, { timeout: 20_000 });
    await expect(page.getByTestId('settings-identifier')).toHaveText(newEmail, { timeout: 15_000 });

    const meNow = await apiRequest('GET', '/api/auth/me', { token: me.accessToken });
    expect(meNow.status).toBe(401); // the old session generation is revoked
    const loginWithNewEmail = await apiRequest('POST', '/api/auth/login', {
      body: { identifier: newEmail, password: me.password },
    });
    expect(loginWithNewEmail.status).toBe(200);
  });

  test('log out other devices and delete the account', async ({ page }) => {
    const me = await registerUser('set-delete');
    await signIn(page, me);
    await openSettings(page);

    // ---- log out other devices (wrong password first, then correct)
    const otherDevice = await apiRequest('POST', '/api/auth/login', {
      body: { identifier: me.identifier, password: me.password },
    });
    expect(otherDevice.status).toBe(200);

    await page.getByLabel('Current password for signing out other devices').fill('wrong-password');
    await page.getByRole('button', { name: /Log out other devices/ }).click();
    await expect(page.getByTestId('settings-error')).toContainText(/not correct/i);
    await page.getByLabel('Current password for signing out other devices').fill(me.password);
    await page.getByRole('button', { name: /Log out other devices/ }).click();
    await expect(page.getByTestId('settings-notice')).toContainText(/signed out/i, { timeout: 15_000 });
    const oldDevice = await apiRequest('GET', '/api/auth/me', { token: otherDevice.body.accessToken });
    expect(oldDevice.status).toBe(401);

    // ---- delete account
    await page.getByTestId('delete-account').click();
    await expect(page.getByRole('dialog', { name: 'Delete account' })).toBeVisible();
    await page.locator('#delete-password').fill(me.password);
    await page.locator('#delete-confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Delete my account' }).click();

    // Back to the sign-in screen and the account is gone.
    await expect(page.getByRole('button', { name: /^Sign in$/ }).first()).toBeVisible({ timeout: 25_000 });
    const loginAfter = await apiRequest('POST', '/api/auth/login', {
      body: { identifier: me.identifier, password: me.password },
    });
    expect(loginAfter.status).toBe(401);
  });
});
