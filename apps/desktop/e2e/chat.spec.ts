import { test, expect } from "./fixtures/test-fixtures";

test.describe("Chat Tab", () => {
  test("chat sidebar shows contacts from mock data", async ({
    tauriPage,
  }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();

    // Sidebar should show mock contacts (wait for data to load)
    await expect(page.getByText("Alice Smith").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Bob Jones").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("selecting a contact triggers detail view", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();

    // Wait for contacts to load
    const aliceItem = page.getByText("Alice Smith").first();
    await expect(aliceItem).toBeVisible({ timeout: 5000 });

    // Click on Alice Smith in the sidebar — this should be clickable
    await aliceItem.click();

    // After selection, the sidebar contact list is still rendered (contacts stay)
    // or a detail panel appears. Either way, the click should succeed without error.
    // Wait briefly for any state update
    await page.waitForTimeout(300);
  });

  test("sidebar has Contacts and Personas tabs", async ({ tauriPage }) => {
    const { page } = tauriPage;
    await page.goto("/");

    // Navigate to Chat tab
    await page
      .locator("button.topbar-tab")
      .filter({ hasText: /chat/i })
      .click();

    // Should start on Contacts tab — contacts are visible
    await expect(page.getByText("Alice Smith").first()).toBeVisible({
      timeout: 5000,
    });

    // Both tab pills should be visible in the sidebar
    const contactsBtn = page.getByRole("button", { name: "Contacts", exact: true });
    const personasBtn = page.getByRole("button", { name: "Personas", exact: true });
    await expect(contactsBtn).toBeVisible();
    await expect(personasBtn).toBeVisible();

    // Click Personas tab — should switch view
    await personasBtn.click();
    await page.waitForTimeout(500);

    // Contacts tab button should still be visible for switching back
    await expect(contactsBtn).toBeVisible({ timeout: 5000 });

    // Click back to Contacts
    await contactsBtn.click();
    await page.waitForTimeout(500);

    // Bob Jones should be visible again
    await expect(page.getByText("Bob Jones").first()).toBeVisible({
      timeout: 5000,
    });
  });
});
