import { defineConfig, devices } from "@playwright/test";

export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? `postgres://${process.env.USER ?? "postgres"}@localhost:5432/lastro_e2e`;

/**
 * End-to-end POC tests: real browser, real passkeys (Chrome virtual authenticator with PRF),
 * real Stellar testnet. Needs `.env.local` with testnet keys (`pnpm stellar:setup`) and an
 * empty, migrated database at E2E_DATABASE_URL (`pnpm test:e2e` handles both).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: E2E_BASE_URL,
    viewport: { width: 1280, height: 860 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm start -p ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/entrar`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: E2E_DATABASE_URL, APP_ORIGIN: E2E_BASE_URL, WEBAUTHN_RP_ID: "localhost" },
  },
});
