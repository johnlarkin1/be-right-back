"use client";

import { useSyncExternalStore } from "react";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

let mediaQueryList: MediaQueryList | null = null;

/** One MediaQueryList for the page, made on first use (never on the server). */
function query(): MediaQueryList {
  mediaQueryList ??= window.matchMedia(MEDIA_QUERY);
  return mediaQueryList;
}

function subscribe(callback: () => void): () => void {
  const mediaQuery = query();
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return query().matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/** True while the visitor asks the OS for reduced motion. Follows live changes. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
