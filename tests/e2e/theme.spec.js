/**
 * Theme polish: thin dark scrollbars, no bright dividers in dark mode, and the
 * help launcher must not float over the composer inside the app.
 */
const { test, expect } = require('@playwright/test');
const { registerUser, signIn, openTab } = require('./helpers');

test.describe.configure({ timeout: 120_000 });

function luminance(rgbText) {
  const numbers = String(rgbText).match(/[\d.]+/g)?.map(Number) ?? [];
  if (numbers.length < 3) return 0;
  const [r, g, b] = numbers;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

async function scrollbarCheck(page) {
  return page.evaluate(() => {
    const results = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(element);
      const scrollable = element.scrollHeight > element.clientHeight + 2;
      const overflow = /(auto|scroll)/.test(style.overflowY);
      if (!scrollable || !overflow) continue;
      const color = style.scrollbarColor || '';
      results.push({ tag: element.tagName, cls: String(element.className).slice(0, 60), color });
      if (results.length >= 10) break;
    }
    return {
      containers: results,
      documentColor: getComputedStyle(document.documentElement).scrollbarColor,
    };
  });
}

test('no scrollbar track is light and the launcher never covers the composer', async ({ page }) => {
  const me = await registerUser('theme-user');
  await signIn(page, me);

  for (const size of [
    { width: 1366, height: 600 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await openTab(page, 'Chats');

    // The floating launcher is gone inside the app; the sidebar opens the widget.
    await expect(page.getByTestId('help-launcher')).toHaveCount(0);
    const helpButton = page.getByTestId('sidebar-help');
    await expect(helpButton).toBeVisible();
    await helpButton.click();
    await expect(page.getByRole('dialog').filter({ hasText: /help/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const check = await scrollbarCheck(page);
    // The scrollbar must be themed (thin + explicit colours), not OS-default light.
    expect(check.documentColor).not.toBe('');
    expect(check.documentColor).toMatch(/transparent|rgba?\(0,\s*0,\s*0,\s*0\)/);
    for (const container of check.containers) {
      const parts = String(container.color).split(/\s(?=rgba?\()/);
      // parts[0] = thumb, parts[1] = track. The track must be dark/transparent.
      const track = parts[1] ?? 'rgba(0, 0, 0, 0)';
      if (!track.includes('transparent')) {
        expect(luminance(track), `scrollbar track ${track} on ${container.tag}`).toBeLessThan(0.5);
      }
    }
  }

  // Dark theme: faded dividers instead of white 1px lines.
  await openTab(page, 'Settings');
  await page.getByRole('button', { name: /^Dark$/ }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const colors = await page.evaluate(() =>
    Array.from(document.querySelectorAll('aside, section, div'))
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          cls: String(element.className).slice(0, 80),
          color: style.borderBottomColor,
          width: style.borderBottomWidth,
          style: style.borderBottomStyle,
        };
      })
      // Only real dividers (an unstyled div reports currentColor for a zero-width border).
      .filter((entry) => entry.style !== 'none' && entry.width !== '0px' && entry.color !== 'rgba(0, 0, 0, 0)')
      .slice(0, 40),
  );
  for (const entry of colors) {
    expect(luminance(entry.color), `divider ${entry.color} on ${entry.cls}`).toBeLessThan(0.75);
  }
});
