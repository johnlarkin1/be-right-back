import { test, expect } from "./fixtures/test-fixtures";

test.describe("Navigation", () => {
  test("click tabs to navigate between views", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Click Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();
    await page.waitForTimeout(300);

    // Click Insights tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /insights/i })
      .click();
    await page.waitForTimeout(300);

    // Click back to Home
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /home/i })
      .click();
    await page.waitForTimeout(300);

    // All navigation completed without errors
  });

  test("keyboard shortcuts switch tabs", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Meta+1 → Chat (TAB_ORDER: chat=⌘1, home=⌘2, insights=⌘3)
    await page.keyboard.press("Meta+1");
    await page.waitForTimeout(300);

    // Meta+2 → Home
    await page.keyboard.press("Meta+2");
    await page.waitForTimeout(300);

    // Meta+3 → Insights
    await page.keyboard.press("Meta+3");
    await page.waitForTimeout(300);
  });

  test("command palette opens and shows commands", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");
    await expect(page.locator(".topbar-brand").first()).toBeVisible();

    // Open command palette with Meta+K
    await page.keyboard.press("Meta+k");

    // Command palette input should appear
    await expect(page.locator(".command-palette-input")).toBeVisible({
      timeout: 3000,
    });

    // Type "chat" — should filter commands
    await page.keyboard.type("chat");
    await page.waitForTimeout(200);

    // Press Enter to select first result
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // Command palette should close
    await expect(page.locator(".command-palette-input")).not.toBeVisible();
  });
});
