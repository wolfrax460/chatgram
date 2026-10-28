/**
 * Item 7 — landing Features + Downloads tab.
 *
 * The landing site is a separate app from /web/, so this spec targets the
 * deployed site by default (set E2E_LANDING_URL to test a local preview).
 * The download cards must come from the published App releases feed, and the
 * links must serve the real installers.
 */
const { test, expect } = require('@playwright/test');

const LANDING = process.env.E2E_LANDING_URL || 'https://chatgram-xi.vercel.app';

test.describe.configure({ timeout: 120_000 });

async function firstBytes(url) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-1' } });
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, magic: String.fromCharCode(...buffer.slice(0, 2)) };
}

test.describe('landing downloads', () => {
  test('Windows/Android cards come from the release feed and link to real files', async ({ page }) => {
    const feedResponse = await page.request.get(`${LANDING}/api/app/releases`);
    expect(feedResponse.ok()).toBeTruthy();
    const feed = await feedResponse.json();
    const windows = (feed.releases || []).find((row) => row.platform === 'windows');
    const android = (feed.releases || []).find((row) => row.platform === 'android');
    expect(windows?.version, 'windows release published').toBeTruthy();
    expect(android?.version, 'android release published').toBeTruthy();

    await page.goto(`${LANDING}/`, { waitUntil: 'networkidle' });
    const section = page.locator('#download');
    await section.getByText('Chatgram for Windows').waitFor({ timeout: 30_000 });

    const text = await section.innerText();
    expect(text).toContain(`Version ${windows.version}`);
    expect(text).toContain(windows.sha256.slice(0, 16));
    expect(text).toMatch(/More info/i);
    expect(text).toMatch(/Run anyway/i);
    expect(text).toContain(`Version ${android.version}`);
    expect(text).toMatch(/Android 7\.0\+/);
    expect(text).toMatch(/Install unknown apps/i);
    expect(text).toMatch(/MB/);

    await expect(section.locator('img[src="/assets/apk-qr.svg"]')).toBeVisible();
    const qr = await page.request.get(`${LANDING}/assets/apk-qr.svg`);
    expect(qr.status()).toBe(200);

    const windowsHref = await section.getByRole('link', { name: 'Download for Windows' }).getAttribute('href');
    const androidHref = await section.getByRole('link', { name: 'Download APK' }).getAttribute('href');
    // The Windows installer is advertised as the direct API-host URL
    // (https://chatgram.duckdns.org/downloads/...) or as the same-origin proxy
    // path; both must point at the real installer. Android stays same-origin.
    expect(windowsHref, 'Windows download link').toBeTruthy();
    expect(windowsHref, 'Windows download link').toContain('chatgram-windows-setup.exe');
    const windowsIsAbsolute = /^https:\/\//i.test(windowsHref);
    if (windowsIsAbsolute) {
      expect(windowsHref).toBe(windows.fileUrl);
    }
    expect(androidHref).toBe(android.fileUrl);

    // Request each link as-is: absolute URLs are fetched directly, relative
    // paths are resolved against the landing origin.
    const resolveDownloadUrl = (href) => (/^https?:\/\//i.test(href) ? href : `${LANDING}${href}`);
    const exe = await firstBytes(resolveDownloadUrl(windowsHref));
    expect([200, 206]).toContain(exe.status);
    expect(exe.magic).toBe('MZ');
    const apk = await firstBytes(resolveDownloadUrl(androidHref));
    expect([200, 206]).toContain(apk.status);
    expect(apk.magic).toBe('PK');

    // Features list only shipped things: Chatgram AI and the two native apps.
    const features = await page.locator('#features').innerText();
    expect(features).toMatch(/Chatgram AI/i);
    expect(features).toMatch(/Windows and Android apps/i);

    // The changelog is rendered from the same release feed.
    const changelog = await page.locator('#whats-new').innerText();
    expect(changelog).toContain(`v${windows.version}`);
    expect(changelog).toMatch(/Windows|Android|Web/);

    // No links to the retired APK/zip builds.
    await expect(page.locator('a[href*="downloads/chatgram.apk"], a[href*="chatgram-windows.zip"]')).toHaveCount(0);
  });

  test('the landing screenshots are real app captures', async ({ page }) => {
    await page.goto(`${LANDING}/`, { waitUntil: 'networkidle' });
    for (const asset of ['/assets/landing-chat-list.png', '/assets/landing-conversation.png', '/assets/landing-ai.png']) {
      const response = await page.request.get(`${LANDING}${asset}`);
      expect(response.status(), asset).toBe(200);
      expect(Number(response.headers()['content-length']) || 1, asset).toBeGreaterThan(0);
    }
  });
});
