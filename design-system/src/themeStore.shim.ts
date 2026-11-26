// Design-system stand-in for apps/desktop/src/stores/themeStore.ts.
// The preview frame owns data-theme, so the store follows the attribute and does not persist.
import { create } from "zustand";
export type UIMode = "retro" | "modern";
interface ThemeState { mode: UIMode; setMode: (mode: UIMode) => void; toggleMode: () => void; }
const read = (): UIMode => document.documentElement.getAttribute("data-theme") === "modern" ? "modern" : "retro";
const apply = (mode: UIMode) => document.documentElement.setAttribute("data-theme", mode);
export const useThemeStore = create<ThemeState>()((set, get) => ({
  mode: read(),
  setMode: (mode) => { set({ mode }); apply(mode); },
  toggleMode: () => { const next = get().mode === "retro" ? "modern" : "retro"; set({ mode: next }); apply(next); },
}));
const FONTS: Record<string, string> = {
  app: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=VT323&display=swap",
  website: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
};
function font(key: string) {
  if (document.querySelector(`link[data-brb-font="${key}"]`)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = FONTS[key]; l.setAttribute("data-brb-font", key);
  document.head.appendChild(l);
}
function sync() {
  if (useThemeStore.getState().mode !== read()) useThemeStore.setState({ mode: read() });
  if (document.documentElement.getAttribute("data-theme") === "website") font("website");
}
font("app"); sync();
new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
export function useUIMode() {
  const mode = useThemeStore((s) => s.mode);
  return { mode, isRetro: mode === "retro", isModern: mode === "modern" };
}
