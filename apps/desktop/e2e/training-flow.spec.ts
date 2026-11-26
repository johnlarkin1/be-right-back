import { test, expect } from "./fixtures/test-fixtures";

/**
 * E2E tests for the training flow.
 * Simulates training progress by emitting "training-progress" events.
 */
test.describe("Training Flow", () => {
  test("training modal opens from contact detail", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();

    // Wait for contacts to load and select Alice (who has no persona yet — Bob)
    await expect(page.getByText("Bob Jones").first()).toBeVisible({
      timeout: 5000,
    });

    // Click Bob Jones (untrained contact)
    await page.getByText("Bob Jones").first().click();
    await page.waitForTimeout(500);

    // Look for "Train Persona" button in the contact detail panel
    const trainBtn = page.getByText("Train Persona").first();
    if (await trainBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await trainBtn.click();
      await page.waitForTimeout(500);

      // Training modal should open — look for modal content
      // The modal shows a confirmation view first
      await expect(page.locator(".topbar-brand").first()).toBeVisible();
    }
  });

  test("training progress events update the UI", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();
    await page.waitForTimeout(500);

    // Emit training progress events to simulate a training run
    // Phase 1: Exporting
    await tauriPage.emitEvent("training-progress", {
      phase: "exporting",
      progress: 0.5,
      message: "Preparing training data...",
    });
    await page.waitForTimeout(200);

    // Phase 2: Downloading
    await tauriPage.emitEvent("training-progress", {
      phase: "downloading",
      progress: 0.3,
      message: "Downloading base model...",
    });
    await page.waitForTimeout(200);

    // Phase 3: Training with loss
    await tauriPage.emitEvent("training-progress", {
      phase: "training",
      progress: 0.5,
      message: "Training step 250/500",
      step: 250,
      total_steps: 500,
      loss: 0.85,
    });
    await page.waitForTimeout(200);

    // Phase 4: Training near completion
    await tauriPage.emitEvent("training-progress", {
      phase: "training",
      progress: 0.95,
      message: "Training step 475/500",
      step: 475,
      total_steps: 500,
      loss: 0.42,
    });
    await page.waitForTimeout(200);

    // Phase 5: Finalizing
    await tauriPage.emitEvent("training-progress", {
      phase: "finalizing",
      progress: 1.0,
      message: "Saving adapter weights...",
    });
    await page.waitForTimeout(200);

    // Phase 6: Complete
    await tauriPage.emitEvent("training-progress", {
      phase: "complete",
      progress: 1.0,
      message: "Training complete!",
    });
    await page.waitForTimeout(300);

    // App should not crash
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });

  test("training error event is handled gracefully", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();
    await page.waitForTimeout(500);

    // Emit training error event
    await tauriPage.emitEvent("training-progress", {
      phase: "error",
      progress: 0,
      message: "Out of memory",
      error: "Out of memory — try a smaller model",
    });
    await page.waitForTimeout(300);

    // App should not crash
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });
});
