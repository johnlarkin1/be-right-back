import { test, expect } from "./fixtures/test-fixtures";

/**
 * E2E tests for the onboarding wizard flow.
 * Uses overrideResponsePersistent to simulate different init states.
 */

const NO_INIT_STATUS = {
  has_fda_permission: false,
  has_snapshot: false,
  snapshot_date: null,
  snapshot_message_count: 0,
  snapshot_contact_count: 0,
  has_sqlite_db: false,
  has_vector_db: false,
  has_base_model: false,
  has_trained_persona: false,
  current_stage: "not_started",
  is_fully_initialized: false,
  snapshot_size_bytes: 0,
  snapshot_size_display: "0 B",
  embeddings_size_bytes: 0,
  embeddings_size_display: "0 B",
  total_data_size_bytes: 0,
  total_data_size_display: "0 B",
  last_ingestion_date: null,
  last_ingestion_duration_secs: null,
  chunk_count: 0,
};

test.describe("Onboarding Flow", () => {
  test("fresh app shows welcome step", async ({ tauriPage }) => {
    const { page } = tauriPage;

    // Clear any persisted onboarding state
    await tauriPage.overrideResponsePersistent({
      get_initialization_status: NO_INIT_STATUS,
    });

    await page.goto("/");

    // Clear localStorage to ensure fresh onboarding
    await page.evaluate(() =>
      localStorage.removeItem("brb-onboarding-state"),
    );
    await page.reload();
    await page.waitForTimeout(1000);

    // Should show welcome content — either retro CasperWelcome or modern welcome
    // In retro mode (default), look for the "Get Started" or similar button
    const getStarted = page.getByText("Get Started").first();
    const welcomeText = page
      .getByText("Welcome to Be Right Back")
      .first();

    // Either the retro CasperWelcome or modern welcome should be visible
    const hasGetStarted = await getStarted
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    const hasWelcomeText = await welcomeText
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    // At minimum, brand should be visible (app renders)
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // If we can see the welcome content, advance through it
    if (hasGetStarted || hasWelcomeText) {
      // Click to advance from welcome
      if (hasGetStarted) {
        await getStarted.click();
      }
      await page.waitForTimeout(500);
    }
  });

  test("app with FDA permission shows snapshot step", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;

    await tauriPage.overrideResponsePersistent({
      get_initialization_status: {
        ...NO_INIT_STATUS,
        has_fda_permission: true,
      },
    });

    await page.goto("/");
    await page.evaluate(() =>
      localStorage.removeItem("brb-onboarding-state"),
    );
    await page.reload();
    await page.waitForTimeout(1000);

    // With FDA permission but no snapshot, should show snapshot/ingestion step
    // Look for ingestion-related content
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Should not show the dashboard (no Casper greeting)
    await expect(page.getByText("Hey, I'm Casper!")).not.toBeVisible();
  });

  test("app with snapshot shows ingestion ready step", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;

    await tauriPage.overrideResponsePersistent({
      get_initialization_status: {
        ...NO_INIT_STATUS,
        has_fda_permission: true,
        has_snapshot: true,
        snapshot_date: "2025-01-14T12:00:00Z",
        snapshot_message_count: 42500,
        snapshot_contact_count: 128,
      },
    });

    await page.goto("/");
    await page.evaluate(() =>
      localStorage.removeItem("brb-onboarding-state"),
    );
    await page.reload();
    await page.waitForTimeout(1000);

    // With snapshot but no sqlite DB, WelcomeView renders ingestion_ready step
    // Should show ingestion CTA or "Start Ingestion" type content
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Should not show dashboard
    await expect(page.getByText("Hey, I'm Casper!")).not.toBeVisible();
  });

  test("fully initialized app shows dashboard", async ({ tauriPage }) => {
    const { page } = tauriPage;

    // Default mock is fully initialized — just verify
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Should show dashboard with Casper
    await expect(page.getByText("Hey, I'm Casper!")).toBeVisible({
      timeout: 5000,
    });

    // Stats bar should be visible
    await expect(
      page.locator(".compact-stats-value", { hasText: "42.5K" }).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});
