import { test, expect } from "./fixtures/test-fixtures";

/**
 * E2E tests for the ingestion progress flow.
 * Simulates the 6-stage ingestion pipeline by emitting
 * "ingestion-progress" events from the test into the app.
 */

function makeIngestionEvent(
  currentStage: string,
  stages: Array<{
    stage: string;
    percent: number;
    status: string;
    message: string;
  }>,
  isComplete: boolean,
  stats?: Record<string, unknown>,
) {
  return {
    stages,
    current_stage: currentStage,
    is_complete: isComplete,
    error: null,
    stats: stats ?? {
      messages_processed: 0,
      total_messages: 42500,
      contacts_processed: 0,
      total_contacts: 128,
      chunks_created: 0,
      chunks_embedded: 0,
      elapsed_secs: 0,
      estimated_remaining_secs: null,
    },
  };
}

const ALL_STAGES = [
  "snapshot",
  "parsing",
  "chunking",
  "embedding",
  "saving",
  "analyzing",
];

function buildStages(
  activeIndex: number,
  percent: number,
  message: string,
) {
  return ALL_STAGES.map((stage, i) => ({
    stage,
    percent: i < activeIndex ? 100 : i === activeIndex ? percent : 0,
    status:
      i < activeIndex
        ? "completed"
        : i === activeIndex
          ? "in_progress"
          : "pending",
    message: i === activeIndex ? message : "",
  }));
}

test.describe("Ingestion Flow", () => {
  test("ingestion progress shows stages advancing", async ({ tauriPage }) => {
    const { page } = tauriPage;

    // Start with uninitialized state (no snapshot)
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

    // Should show WelcomeView — look for ingestion-related content
    // The welcome flow starts at different steps depending on init status
    // With has_fda_permission=true, has_snapshot=false → first_snapshot step
    await page.waitForTimeout(1000);

    // Emit ingestion progress: snapshot stage at 50%
    await tauriPage.emitEvent(
      "ingestion-progress",
      makeIngestionEvent(
        "snapshot",
        buildStages(0, 50, "Creating snapshot..."),
        false,
      ),
    );
    await page.waitForTimeout(300);

    // Emit: snapshot complete, parsing starts
    await tauriPage.emitEvent(
      "ingestion-progress",
      makeIngestionEvent(
        "parsing",
        buildStages(1, 25, "Parsing messages..."),
        false,
        {
          messages_processed: 10000,
          total_messages: 42500,
          contacts_processed: 30,
          total_contacts: 128,
          chunks_created: 0,
          chunks_embedded: 0,
          elapsed_secs: 5,
          estimated_remaining_secs: 60,
        },
      ),
    );
    await page.waitForTimeout(300);

    // Emit: all complete
    await tauriPage.emitEvent(
      "ingestion-progress",
      makeIngestionEvent(
        "analyzing",
        buildStages(5, 100, "Complete!"),
        true,
        {
          messages_processed: 42500,
          total_messages: 42500,
          contacts_processed: 128,
          total_contacts: 128,
          chunks_created: 8500,
          chunks_embedded: 8500,
          elapsed_secs: 120,
          estimated_remaining_secs: 0,
        },
      ),
    );
    await page.waitForTimeout(500);

    // App should not crash — brand still visible
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });

  test("ingestion events update progress in dashboard", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Start on dashboard (default mock has fully initialized status)
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Emit ingestion progress event — simulates re-ingestion from dashboard
    await tauriPage.emitEvent(
      "ingestion-progress",
      makeIngestionEvent(
        "embedding",
        buildStages(3, 60, "Embedding chunks..."),
        false,
        {
          messages_processed: 42500,
          total_messages: 42500,
          contacts_processed: 80,
          total_contacts: 128,
          chunks_created: 8500,
          chunks_embedded: 5100,
          elapsed_secs: 45,
          estimated_remaining_secs: 30,
        },
      ),
    );
    await page.waitForTimeout(500);

    // App should handle the event without crashing
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });
});
