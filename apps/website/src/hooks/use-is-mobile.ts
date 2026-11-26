"use client";

import { useSyncExternalStore } from "react";

const MEDIA_QUERY = "(hover: none) and (pointer: coarse)";

function subscribe(callback: () => void): () => void {
  const mediaQuery = window.matchMedia(MEDIA_QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(MEDIA_QUERY).matches;
}

function getServerSnapshot(): boolean {
  // Default to false (desktop) on server
  return false;
}

/**
 * Hook to detect if the user is on a touch-primary device (mobile/tablet).
 * Uses the CSS media query (hover: none) and (pointer: coarse) which is
 * the most reliable way to detect touch-primary devices.
 *
 * Returns true for mobile/tablet devices, false for desktop.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
