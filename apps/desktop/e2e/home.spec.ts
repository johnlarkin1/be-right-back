import { test, expect } from "./fixtures/test-fixtures";

test.describe("Home Page", () => {
  test("app loads and shows dashboard", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Brand text should be visible
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Dashboard should render (not the welcome/onboarding view)
    await expect(page.locator("text=Loading...")).not.toBeVisible({
      timeout: 5000,
    });

    // Should NOT show welcome/onboarding content
    await expect(
      page.locator("text=Welcome to Be Right Back"),
    ).not.toBeVisible();
  });

  test("shows welcome view when not initialized", async ({ tauriPage }) => {
    const { page } = tauriPage;

    // Set persistent override BEFORE navigating
    await tauriPage.overrideResponsePersistent({
      get_initialization_status: {
        has_fda_permission: true,
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
      },
    });

    await page.goto("/");

    // Should NOT show the dashboard (no "Hey, I'm Casper!" or stats)
    await expect(page.locator("text=Loading...")).not.toBeVisible({
      timeout: 5000,
    });
    // Brand should still be visible
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
    // Should NOT show the Casper greeting (dashboard content)
    await expect(page.getByText("Hey, I'm Casper!")).not.toBeVisible();
  });

  test("stats bar shows message and contact counts", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Wait for dashboard to load
    await expect(page.locator("text=Loading...")).not.toBeVisible({
      timeout: 5000,
    });

    // The CompactStatsBar should display formatted counts from mock data
    // 42500 messages → "42.5K", 128 contacts
    await expect(
      page.locator(".compact-stats-value", { hasText: "42.5K" }).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(".compact-stats-value", { hasText: "128" }).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});
