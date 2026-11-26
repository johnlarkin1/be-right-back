/**
 * useGlobalShortcuts - Global keyboard shortcut listener
 */
import { useEffect, useCallback } from "react";

export interface ShortcutCallbacks {
  onNextTab: () => void;
  onPrevTab: () => void;
  onGoToInsights: () => void;
  onGoToCasper: () => void;
  onGoToPersonas: () => void;
  onToggleTheme: () => void;
  onOpenShortcuts: () => void;
  onOpenCommandPalette: () => void;
  onEscape: () => void;
}

function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export function useGlobalShortcuts(callbacks: ShortcutCallbacks) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey;
      const shift = e.shiftKey;
      const inInput = isInputElement(e.target);

      // Escape — always fires
      if (e.key === "Escape") {
        e.preventDefault();
        callbacks.onEscape();
        return;
      }

      // ⌘K — always fires (toggle command palette)
      if (meta && e.code === "KeyK" && !shift) {
        e.preventDefault();
        callbacks.onOpenCommandPalette();
        return;
      }

      // All remaining shortcuts are suppressed in inputs
      if (inInput) return;

      // ⌘⇧[ — Previous tab
      if (meta && shift && e.code === "BracketLeft") {
        e.preventDefault();
        callbacks.onPrevTab();
        return;
      }

      // ⌘⇧] — Next tab
      if (meta && shift && e.code === "BracketRight") {
        e.preventDefault();
        callbacks.onNextTab();
        return;
      }

      // ⌘1/2/3 — Direct tab navigation
      if (meta && !shift && e.code === "Digit1") {
        e.preventDefault();
        callbacks.onGoToInsights();
        return;
      }
      if (meta && !shift && e.code === "Digit2") {
        e.preventDefault();
        callbacks.onGoToCasper();
        return;
      }
      if (meta && !shift && e.code === "Digit3") {
        e.preventDefault();
        callbacks.onGoToPersonas();
        return;
      }

      // ⌘⇧T — Toggle theme
      if (meta && shift && e.code === "KeyT") {
        e.preventDefault();
        callbacks.onToggleTheme();
        return;
      }

      // ⌘? (⌘⇧/) — Open shortcuts modal
      if (meta && shift && e.code === "Slash") {
        e.preventDefault();
        callbacks.onOpenShortcuts();
        return;
      }

      // ? (bare, no meta) — Open shortcuts modal (Linear/Notion style)
      if (!meta && !e.altKey && !e.ctrlKey && e.key === "?") {
        e.preventDefault();
        callbacks.onOpenShortcuts();
        return;
      }
    },
    [callbacks],
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}
