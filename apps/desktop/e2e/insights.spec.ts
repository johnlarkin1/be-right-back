import { test, expect } from "./fixtures/test-fixtures";

test.describe("Insights Tab", () => {
  test("insights tab loads and shows analytics", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Insights tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /insights/i })
      .click();

    // Wait for the insights layout to render
    await expect(page.locator(".insights-layout").first()).toBeVisible({
      timeout: 5000,
    });

    // Conversation Analytics title should be visible
    await expect(
      page.getByText("Conversation Analytics").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("shows needs-setup when vector db missing", async ({ tauriPage }) => {
    const { page } = tauriPage;

    // Set persistent override BEFORE navigating
    await tauriPage.overrideResponsePersistent({
      get_initialization_status: {
        has_fda_permission: true,
        has_snapshot: true,
        snapshot_date: "2025-01-14T12:00:00Z",
        snapshot_message_count: 42500,
        snapshot_contact_count: 128,
        has_sqlite_db: true,
        has_vector_db: false,
        has_base_model: false,
        has_trained_persona: false,
        current_stage: "snapshot_complete",
        is_fully_initialized: false,
        snapshot_size_bytes: 52428800,
        snapshot_size_display: "50.0 MB",
        embeddings_size_bytes: 0,
        embeddings_size_display: "0 B",
        total_data_size_bytes: 52428800,
        total_data_size_display: "50.0 MB",
        last_ingestion_date: null,
        last_ingestion_duration_secs: null,
        chunk_count: 0,
      },
    });

    await page.goto("/");

    // Navigate to Insights tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /insights/i })
      .click();
    await page.waitForTimeout(500);

    // Should show NeedsSetup — InsightsLayout checks has_vector_db
    await expect(page.getByText("Ingestion Required").first()).toBeVisible({
      timeout: 5000,
    });

    await expect(page.getByText("Go to Setup").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("insights header is visible with title", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Insights tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /insights/i })
      .click();

    // Wait for insights to load
    await expect(page.locator(".insights-layout").first()).toBeVisible({
      timeout: 5000,
    });

    // The title should be visible
    await expect(
      page.getByText("Conversation Analytics").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("insights tab renders chart containers", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Insights tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /insights/i })
      .click();

    // The insights layout container should be present
    await expect(page.locator(".insights-layout").first()).toBeVisible({
      timeout: 5000,
    });

    // The two-column grid row (WordCloud + Heatmap) should be in the DOM
    await expect(page.locator(".insights-grid-row").first()).toBeVisible({
      timeout: 5000,
    });

    // MESSAGE TIMELINE section should be visible
    await expect(page.getByText("Message Timeline").first()).toBeVisible({
      timeout: 5000,
    });
  });
});
