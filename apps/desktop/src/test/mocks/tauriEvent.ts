/**
 * Mock for @tauri-apps/api/event — the listen() function
 */
import { vi } from "vitest";

type Listener<T = unknown> = (event: { payload: T }) => void;

const listenerMap = new Map<string, Set<Listener>>();

export const mockListen = vi.fn(
  async <T>(channel: string, handler: Listener<T>): Promise<() => void> => {
    if (!listenerMap.has(channel)) {
      listenerMap.set(channel, new Set());
    }
    const listeners = listenerMap.get(channel)!;
    listeners.add(handler as Listener);
    return () => {
      listeners.delete(handler as Listener);
    };
  },
);

export function emitMockEvent<T>(channel: string, payload: T): void {
  const listeners = listenerMap.get(channel);
  if (listeners) {
    for (const listener of listeners) {
      listener({ payload });
    }
  }
}

export function resetEventMocks(): void {
  listenerMap.clear();
  mockListen.mockClear();
}
