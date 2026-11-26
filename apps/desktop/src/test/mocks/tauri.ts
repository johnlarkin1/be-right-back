/**
 * Mock for @tauri-apps/api/core — the invoke() function
 *
 * Usage in tests:
 *   import { configureInvoke, resetInvokeMocks } from '@/test/mocks/tauri';
 *   vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
 */
import { vi } from "vitest";

type InvokeHandler = (args?: Record<string, unknown>) => unknown;

const commandRegistry = new Map<string, InvokeHandler>();

/**
 * The mock invoke function. Looks up the command in the registry
 * and returns the registered response (or rejects if not configured).
 */
export const mockInvoke = vi.fn(
  async (command: string, args?: Record<string, unknown>) => {
    const handler = commandRegistry.get(command);
    if (!handler) {
      throw new Error(
        `[mockInvoke] No mock configured for command: "${command}"`,
      );
    }
    return handler(args);
  },
);

/**
 * Register a mock response for a Tauri invoke command.
 * @param command - The command name (e.g. "get_initialization_status")
 * @param response - A static value or a function that receives args and returns a value
 */
export function configureInvoke(
  command: string,
  response: unknown | InvokeHandler,
): void {
  if (typeof response === "function") {
    commandRegistry.set(command, response as InvokeHandler);
  } else {
    commandRegistry.set(command, () => response);
  }
}

/**
 * Reset all mock invoke state — clear registry and vi.fn() call history.
 */
export function resetInvokeMocks(): void {
  commandRegistry.clear();
  mockInvoke.mockClear();
}
