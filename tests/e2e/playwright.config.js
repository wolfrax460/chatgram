/**
 * Playwright config for the Chatgram web app against the LOCAL STAGING stack.
 *
 * Prerequisites:
 *   - API running on http://127.0.0.1:5000  (scripts/start-staging.ps1)
 *   - MongoDB running locally
 *
 * The web app itself is started automatically by `webServer` below.
 * These tests never point at production: VITE_API_URL is forced here.
 */
const { defineConfig, devices } = require('@playwright/test');

const API_URL = process.env.E2E_API_URL || 'http://127.0.0.1:5000';
const WEB_URL = process.env.E2E_WEB_URL || 'http://localhost:5174';

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      // WebRTC calls need a camera/microphone in CI: use Chrome's fake devices.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/mobile.spec.js' },
    // Chromium-based mobile emulation (WebKit is not installed in this environment).
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: '**/mobile.spec.js' },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev -w @chatgram/web',
        url: WEB_URL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          VITE_API_URL: API_URL,
          VITE_SOCKET_URL: API_URL,
        },
      },
});
