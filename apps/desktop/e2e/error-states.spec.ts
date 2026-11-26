import { test, expect } from "./fixtures/test-fixtures";

const NOT_INITIALIZED_STATUS = {
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
};

const NO_VECTOR_DB_STATUS = {
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
};

test.describe("Error States", () => {
  test("chat shows needs-setup when no snapshot", async ({ tauriPage }) => {
    const { page } = tauriPage;

    // Set persistent override BEFORE navigating
    await tauriPage.overrideResponsePersistent({
      get_initialization_status: NOT_INITIALIZED_STATUS,
    });

    await page.goto("/");

    // Navigate to Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();
    await page.waitForTimeout(500);

    // ChatLayout should show NeedsSetup with "Snapshot Required"
    await expect(
      page.getByText("Snapshot Required").first(),
    ).toBeVisible({ timeout: 5000 });

    // The action button should be visible
    await expect(page.getByText("Go to Setup").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("insights shows needs-setup when no vector db", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;

    // Set persistent override BEFORE navigating
    await tauriPage.overrideResponsePersistent({
      get_initialization_status: NO_VECTOR_DB_STATUS,
    });

    await page.goto("/");

    // Navigate to Insights tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /insights/i })
      .click();
    await page.waitForTimeout(500);

    // InsightsLayout should show NeedsSetup
    await expect(
      page.getByText("Ingestion Required").first(),
    ).toBeVisible({ timeout: 5000 });

    await expect(page.getByText("Go to Setup").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("app recovers after tab switch from error state", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;

    // Set persistent override — insights will fail but home/chat work
    await tauriPage.overrideResponsePersistent({
      get_initialization_status: NO_VECTOR_DB_STATUS,
    });

    await page.goto("/");

    // Navigate to Insights tab — should show NeedsSetup
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /insights/i })
      .click();
    await page.waitForTimeout(500);

    await expect(
      page.getByText("Ingestion Required").first(),
    ).toBeVisible({ timeout: 5000 });

    // Switch to Home tab — should still render fine (has_snapshot + has_sqlite_db = true)
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /home/i })
      .click();
    await page.waitForTimeout(300);

    // Home tab should render — app didn't crash
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });
});
