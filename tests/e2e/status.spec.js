/**
 * Status (stories) end-to-end tests against the local staging stack.
 *
 * Covers: photo / video / voice-note posting, uncropped viewer, auto-advance,
 * captions, client-side limit messages, upload cancel, deletion, and that a
 * contact sees someone else's status.
 */
const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  registerUser, signIn, openTab, addContact,
} = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures');
const IMAGE = path.join(FIXTURES, 'status-image.png');
const VIDEO = path.join(FIXTURES, 'status-video.webm');
const AUDIO = path.join(FIXTURES, 'status-audio.webm');

async function openComposer(page) {
  await openTab(page, 'Status');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('status-composer')).toBeVisible();
}

async function pickFile(page, filePath) {
  await page.getByTestId('status-file-input').setInputFiles(filePath);
}

/** .webm needs an explicit mime type so the browser reports audio vs video. */
async function pickAs(page, filePath, name, mimeType) {
  await page.getByTestId('status-file-input').setInputFiles({
    name,
    mimeType,
    buffer: fs.readFileSync(filePath),
  });
}

async function postStatus(page) {
  await page.getByRole('button', { name: 'Post status' }).click();
  await expect(page.getByTestId('status-composer')).toBeHidden({ timeout: 30_000 });
}

test.describe('status media', () => {
  test('posts a photo, shows it uncropped in the viewer and auto-advances', async ({ page }) => {
    const account = await registerUser('status-photo');
    await signIn(page, account);
    await openComposer(page);

    await pickFile(page, IMAGE);
    await expect(page.locator('img[alt="Status preview"]')).toBeVisible();
    await page.getByLabel('Caption (optional)').fill('Photo caption');
    // contain + letterbox: the preview must not be cropped
    const imgClass = await page.locator('img[alt="Status preview"]').getAttribute('class');
    expect(imgClass).toContain('object-contain');

    await postStatus(page);

    await expect(page.getByText('1 update')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /My status/ }).click();

    const viewer = page.getByTestId('status-viewer');
    await expect(viewer).toBeVisible();
    const media = page.getByTestId('status-media-image');
    await expect(media).toBeVisible();
    expect(await media.getAttribute('class')).toContain('object-contain');
    await expect(page.getByText('Photo caption')).toBeVisible();
    await expect(page.getByTestId('status-progress')).toHaveCount(1);

    // The progress bar actually advances (5 s image timer).
    await page.waitForTimeout(600);
    const width = await page.getByTestId('status-progress-fill').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(0);
    const valueNow = await page.getByTestId('status-progress').getAttribute('aria-valuenow');
    expect(Number(valueNow)).toBeGreaterThan(5);

    // Escape closes.
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
  });

  test('posts a video with a caption, plays it and auto-advances when it ends', async ({ page }) => {
    const account = await registerUser('status-video');
    await signIn(page, account);
    await openComposer(page);

    await pickFile(page, VIDEO);
    // duration is read client-side and shown next to the file name
    await expect(page.getByText(/0:0[2-4]/)).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Caption (optional)').fill('Video caption');

    await postStatus(page);
    await expect(page.getByText('1 update')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /My status/ }).click();
    const video = page.getByTestId('status-media-video');
    await expect(video).toBeVisible();
    await expect(page.getByText('Video caption')).toBeVisible();

    // Playback reaches the end (3 s clip) and the viewer advances/closes.
    await expect(page.getByTestId('status-viewer')).toBeHidden({ timeout: 25_000 });
  });

  test('posts a voice note and plays it in the viewer', async ({ page }) => {
    const account = await registerUser('status-audio');
    await signIn(page, account);
    await openComposer(page);

    await pickAs(page, AUDIO, 'status-audio.webm', 'audio/webm');
    // The audio preview is a real player with a waveform.
    await expect(page.getByRole('button', { name: 'Play voice note' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Caption (optional)').fill('Voice caption');

    await postStatus(page);
    await expect(page.getByText('1 update')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /My status/ }).click();
    await expect(page.getByTestId('status-audio-player')).toBeVisible();
    await expect(page.getByText('Voice caption')).toBeVisible();
    await expect(page.getByTestId('status-viewer')).toBeHidden({ timeout: 25_000 });
  });

  test('rejects a file over the image limit with a message naming the limit', async ({ page }) => {
    const account = await registerUser('status-big');
    await signIn(page, account);
    await openComposer(page);

    await page.getByTestId('status-file-input').setInputFiles({
      name: 'too-big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 4096, 1),
    });
    await expect(page.getByRole('alert')).toContainText(/10 MB/);
    await expect(page.getByRole('button', { name: 'Post status' })).toBeDisabled();
  });

  test('rejects an unsupported file type', async ({ page }) => {
    const account = await registerUser('status-type');
    await signIn(page, account);
    await openComposer(page);

    await page.getByTestId('status-file-input').setInputFiles({
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    });
    await expect(page.getByRole('alert')).toContainText(/cannot be used in a status/i);
  });

  test('uploads with a progress bar and can be cancelled', async ({ page, context }) => {
    const account = await registerUser('status-cancel');
    await signIn(page, account);
    await openComposer(page);

    // Throttle the connection so the progress UI is observable, then cancel.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 100,
      downloadThroughput: 5 * 1024 * 1024,
      uploadThroughput: 40 * 1024,
    });

    await pickFile(page, IMAGE);
    await expect(page.locator('img[alt="Status preview"]')).toBeVisible();
    await page.getByRole('button', { name: 'Post status' }).click();

    await expect(page.getByTestId('status-upload-progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel upload' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel upload' }).click();

    // Cancelling returns to an editable composer, and nothing was posted.
    await expect(page.getByTestId('status-composer')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post status' })).toBeEnabled();
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    // A cancelled upload can be retried without re-picking the file.
    await page.getByRole('button', { name: 'Post status' }).click();
    await expect(page.getByTestId('status-composer')).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('1 update')).toBeVisible({ timeout: 20_000 });
  });

  test('hold pauses the viewer and arrow keys move between statuses', async ({ page }) => {
    const account = await registerUser('status-pause');
    const base = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
    for (const text of ['First status', 'Second status']) {
      const response = await fetch(`${base}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.accessToken}` },
        body: JSON.stringify({ text }),
      });
      expect(response.status).toBe(201);
    }

    await signIn(page, account);
    await openTab(page, 'Status');
    await expect(page.getByText('2 updates')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /My status/ }).click();

    const fills = page.getByTestId('status-progress-fill');
    await expect(page.getByTestId('status-progress')).toHaveCount(2);

    const widthOf = async (locator) =>
      locator.evaluate((el) => el.getBoundingClientRect().width);

    // Baseline: the first status' progress advances.
    await expect(page.getByText('First status')).toBeVisible();
    await page.waitForTimeout(500);
    const before = await widthOf(fills.first());
    expect(before).toBeGreaterThan(0);

    // Hold in the middle of the viewer: progress freezes.
    const box = await page.getByTestId('status-viewer').boundingBox();
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    const atHold = await widthOf(fills.first());
    await page.waitForTimeout(700);
    const afterHold = await widthOf(fills.first());
    expect(Math.abs(afterHold - atHold)).toBeLessThan(4);
    await page.mouse.up();

    // Release resumes.
    await page.waitForTimeout(400);
    const resumed = await widthOf(fills.first());
    expect(resumed).toBeGreaterThan(afterHold);

    // Right arrow goes to the second status (progress resets on item 2).
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('Second status')).toBeVisible();
    await page.waitForTimeout(300);
    const secondWidth = await widthOf(fills.nth(1));
    expect(secondWidth).toBeGreaterThan(0);

    // Left arrow goes back.
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('First status')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-viewer')).toBeHidden();
  });

  test('deletes an own status from the viewer', async ({ page }) => {
    const account = await registerUser('status-delete');
    await signIn(page, account);
    await openComposer(page);
    await page.getByLabel('Text status').fill('Delete me');
    await postStatus(page);
    await expect(page.getByText('1 update')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /My status/ }).click();
    await page.getByRole('button', { name: 'Delete status' }).click();
    await expect(page.getByTestId('status-viewer')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText('Tap to add a photo, video or voice note')).toBeVisible({ timeout: 15_000 });
  });

  test('a contact sees the status in Recent updates', async ({ page }) => {
    const author = await registerUser('status-author');
    const viewer = await registerUser('status-viewer');
    // Mutual contact so the status is visible.
    await addContact(author, viewer.user.id);
    await addContact(viewer, author.user.id);

    // Author posts through the API (covered by the UI tests above).
    const response = await fetch(`${process.env.E2E_API_URL || 'http://127.0.0.1:5000'}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${author.accessToken}` },
      body: JSON.stringify({ text: 'Hello contacts' }),
    });
    expect(response.status).toBe(201);

    await signIn(page, viewer);
    await openTab(page, 'Status');
    await expect(page.getByText('E2E status-author')).toBeVisible({ timeout: 20_000 });
  });
});
