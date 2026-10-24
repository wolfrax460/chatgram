/** Check the deployed auth screens at the reference viewports (production). */
const { chromium } = require('playwright');

const BASE = 'https://chatgram-xi.vercel.app/web/';
const SIZES = [
  { width: 1366, height: 600, allowScroll: false },
  { width: 1280, height: 600, allowScroll: false },
  { width: 1440, height: 700, allowScroll: false },
  { width: 390, height: 700, allowScroll: true },
];

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  for (const size of SIZES) {
    for (const screen of ['signin', 'signup']) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      const page = await context.newPage();
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="auth-page"]', { timeout: 45_000 });
      if (screen === 'signup') await page.locator('[data-testid="go-signup"]').click();
      await page.waitForTimeout(150);

      const metrics = await page.evaluate(() => {
        const shell = document.querySelector('[data-testid="auth-page"]');
        return {
          docScroll: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          shellOverflow: shell ? shell.scrollHeight - shell.clientHeight : 0,
        };
      });

      // Laptops: no scrolling at all. Phones: scrolling allowed but all actions
      // must be reachable (scroll each one into view and check it is visible).
      const noOverflow = metrics.docScroll <= metrics.innerHeight + 1 && metrics.shellOverflow <= 1;
      const reachable = async (id) => {
        const locator = page.locator(`[data-testid="${id}"]`);
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        if (!box) return false;
        const scrollY = await page.evaluate(() => window.scrollY);
        void scrollY;
        return box.height > 0;
      };
      const primary = await reachable('auth-primary');
      const google = await reachable('auth-google');
      const footer = await reachable('auth-footer');
      const lang = await reachable('auth-language');
      const overflowOk = size.allowScroll ? true : noOverflow;
      const ok = overflowOk && primary && google && footer && lang;
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${screen} ${size.width}x${size.height} overflowPx=${metrics.shellOverflow} (scrolling ${size.allowScroll ? 'allowed' : 'not allowed'}) primary=${primary} google=${google} footer=${footer} lang=${lang}`,
      );
      await context.close();
    }
  }
  await browser.close();
  console.log(failures === 0 ? 'PRODUCTION AUTH LAYOUT OK' : `PRODUCTION AUTH LAYOUT FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
