import { test, expect } from "./fixtures/test-fixtures";

test.describe("Casper Search", () => {
  test("casper search input is visible on dashboard", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Wait for dashboard to load (not loading state)
    await expect(page.locator("text=Loading...")).not.toBeVisible({
      timeout: 5000,
    });

    // The Casper greeting should be visible
    await expect(
      page.getByText(/I'm Casper/i).first(),
    ).toBeVisible({ timeout: 5000 });

    // The search input should be present on the dashboard
    // DashboardView renders an input inside a form
    const searchInput = page.locator("input[type='text']").first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test("typing in search input works", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Wait for dashboard to load
    await expect(page.locator("text=Loading...")).not.toBeVisible({
      timeout: 5000,
    });

    // Find the search input and type a query
    const searchInput = page.locator("input[type='text']").first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill("Who do I text the most?");

    // Verify the input value
    await expect(searchInput).toHaveValue("Who do I text the most?");
  });

  test("example queries are visible", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Wait for dashboard to load
    await expect(page.locator("text=Loading...")).not.toBeVisible({
      timeout: 5000,
    });

    // The "Try asking things like:" text should be visible
    await expect(
      page.getByText("Try asking things like:").first(),
    ).toBeVisible({ timeout: 5000 });

    // At least one example query should be visible
    // EXAMPLE_QUERIES includes "Who do I text the most?"
    await expect(
      page.getByText("Who do I text the most?").first(),
    ).toBeVisible({ timeout: 5000 });

    // Another example query should also be visible
    await expect(
      page.getByText("Find messages about weekend plans").first(),
    ).toBeVisible({ timeout: 5000 });
  });
});
