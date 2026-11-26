import { test, expect } from "./fixtures/test-fixtures";

test.describe("Theme Switching", () => {
  test("toggle theme changes data-theme attribute", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Wait for app to load
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "retro");

    // The brand in retro mode shows "> Be Right Back"
    await expect(page.locator(".topbar-brand-prompt")).toBeVisible();

    // Click theme toggle button
    await page.locator(".topbar-theme-toggle").click();

    // Theme should now be modern
    await expect(html).toHaveAttribute("data-theme", "modern");

    // In modern mode, brand shows without the ">" prompt
    await expect(page.locator(".topbar-brand-text")).toBeVisible();

    // Toggle back to retro
    await page.locator(".topbar-theme-toggle").click();
    await expect(html).toHaveAttribute("data-theme", "retro");
  });

  test("theme persists across page reload", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Default is retro
    await expect(page.locator("html")).toHaveAttribute("data-theme", "retro");

    // Switch to modern via theme toggle click
    await page.locator(".topbar-theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "modern",
    );

    // Verify localStorage was set
    const stored = await page.evaluate(() =>
      localStorage.getItem("brb-ui-mode"),
    );
    expect(stored).toContain("modern");

    // Reload
    await page.reload();

    // In modern mode, the brand uses .topbar-brand-modern
    await expect(page.locator(".topbar-brand-text")).toBeVisible({
      timeout: 5000,
    });

    // Theme should still be modern after reload
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "modern",
    );
  });
});
