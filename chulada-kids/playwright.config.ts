import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://chulada:chulada_dev@localhost:5432/chulada_e2e";

/**
 * E2E contra `next dev` con base propia (chulada_e2e) y el SIMULADOR de pagos
 * (no hay acceso a Mercado Pago desde este entorno). Ver STATUS.md.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DB,
      APP_URL: `http://localhost:${PORT}`,
      PAYMENTS_DRIVER: "fake",
      ALLOW_FAKE_PAYMENTS: "true",
      MP_WEBHOOK_SECRET: "e2e-webhook-secret",
      NEXT_TELEMETRY_DISABLED: "1",
      STORAGE_DIR: "./storage-e2e",
    },
  },
});
