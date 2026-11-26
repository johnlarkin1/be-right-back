import { test as base } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extended Playwright test fixture with Tauri IPC mocking.
 *
 * - Injects tauri-mock.js via addInitScript before the app loads
 * - Provides helpers to emit events and override mock responses
 */
export const test = base.extend<{
  tauriPage: ReturnType<typeof createTauriHelpers>;
}>({
  tauriPage: async ({ page }, use) => {
    // Inject the Tauri mock before any navigation
    const mockPath = path.resolve(__dirname, "tauri-mock.js");
    await page.addInitScript({ path: mockPath });

    const helpers = createTauriHelpers(page);
    await use(helpers);
  },
});

function createTauriHelpers(page: import("@playwright/test").Page) {
  return {
    page,

    /** Emit a Tauri event into the app (as if the Rust backend sent it) */
    async emitEvent(name: string, payload: unknown) {
      await page.evaluate(
        ({ name, payload }) => {
          (window as any).__E2E_EMIT_EVENT(name, payload);
        },
        { name, payload },
      );
    },

    /** Override a mock response for a specific command (current page context only) */
    async overrideResponse(cmd: string, data: unknown) {
      await page.evaluate(
        ({ cmd, data }) => {
          (window as any).__MOCK_RESPONSES[cmd] = data;
        },
        { cmd, data },
      );
    },

    /**
     * Override mock responses that persist across page reloads.
     * Uses addInitScript so the overrides are applied before the app loads.
     * Call this BEFORE page.goto() or page.reload().
     */
    async overrideResponsePersistent(
      overrides: Record<string, unknown>,
    ) {
      await page.addInitScript((data: Record<string, unknown>) => {
        // This runs after tauri-mock.js sets up __MOCK_RESPONSES
        // Use a short delay via queueMicrotask to ensure tauri-mock.js runs first
        const apply = () => {
          if ((window as any).__MOCK_RESPONSES) {
            Object.assign((window as any).__MOCK_RESPONSES, data);
          } else {
            // If tauri-mock.js hasn't run yet, retry on next microtask
            queueMicrotask(apply);
          }
        };
        apply();
      }, overrides);
    },
  };
}

export { expect } from "@playwright/test";
