import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against an already running stack (docker compose up, or pnpm dev + worker).
 * E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD and E2E_DOMAIN override the defaults.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
})
