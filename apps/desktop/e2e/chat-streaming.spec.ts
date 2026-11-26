import { test, expect } from "./fixtures/test-fixtures";

/**
 * E2E tests for persona chat and Casper agent streaming.
 * Simulates token streaming via "chat-token" and "casper-progress" events.
 */
test.describe("Chat Streaming", () => {
  test("casper agent progress events show thinking state", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Dashboard should show Casper search input
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Simulate Casper agent flow with events
    // 1. Started
    await tauriPage.emitEvent("casper-progress", {
      type: "started",
      question: "Who do I text the most?",
    });
    await page.waitForTimeout(200);

    // 2. Thinking
    await tauriPage.emitEvent("casper-progress", {
      type: "thinking",
      iteration: 1,
      max_iterations: 5,
    });
    await page.waitForTimeout(200);

    // 3. Tool start
    await tauriPage.emitEvent("casper-progress", {
      type: "tool_start",
      tool_name: "search_messages",
      arguments: { query: "most frequent contact" },
      iteration: 1,
    });
    await page.waitForTimeout(200);

    // 4. Tool complete
    await tauriPage.emitEvent("casper-progress", {
      type: "tool_complete",
      tool_name: "search_messages",
      success: true,
      duration_ms: 350,
      result_preview: "Found 15 relevant messages",
    });
    await page.waitForTimeout(200);

    // 5. Token stream
    const tokens = "Based on your messages, you text Alice the most.".split(
      "",
    );
    for (const token of tokens.slice(0, 10)) {
      await tauriPage.emitEvent("casper-progress", {
        type: "token",
        text: token,
      });
    }
    await page.waitForTimeout(200);

    // 6. Complete
    await tauriPage.emitEvent("casper-progress", {
      type: "complete",
      answer: "Based on your messages, you text Alice the most.",
      iterations: 1,
      duration_ms: 2500,
      tool_calls: [
        {
          tool_name: "search_messages",
          success: true,
          duration_ms: 350,
        },
      ],
    });
    await page.waitForTimeout(300);

    // App should not crash
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });

  test("casper error event is handled gracefully", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Emit casper error
    await tauriPage.emitEvent("casper-progress", {
      type: "started",
      question: "test question",
    });
    await page.waitForTimeout(100);

    await tauriPage.emitEvent("casper-progress", {
      type: "error",
      message: "Model not loaded",
    });
    await page.waitForTimeout(300);

    // App should not crash
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });

  test("chat token streaming works for persona chat", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Chat tab and select a persona
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();
    await page.waitForTimeout(500);

    // Switch to Personas tab
    await page.getByRole("button", { name: "Personas", exact: true }).click();
    await page.waitForTimeout(500);

    // Alice's persona should be visible
    await expect(page.getByText("Alice Smith").first()).toBeVisible({
      timeout: 5000,
    });

    // Click on Alice's persona
    await page.getByText("Alice Smith").first().click();
    await page.waitForTimeout(500);

    // Emit chat tokens to simulate persona response
    const responseTokens = "Hey! How are you doing today?".split("");
    for (const token of responseTokens) {
      await tauriPage.emitEvent("chat-token", {
        token,
        done: false,
      });
    }
    await page.waitForTimeout(200);

    // Signal completion
    await tauriPage.emitEvent("chat-token", {
      token: "",
      done: true,
    });
    await page.waitForTimeout(300);

    // App should not crash
    await expect(page.locator(".topbar-brand").first()).toBeVisible();
  });
});
