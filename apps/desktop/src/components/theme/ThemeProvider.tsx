/**
 * ThemeProvider - Applies theme to document on mount and mode changes
 */
import { useEffect, type ReactNode } from "react";
import { useThemeStore } from "@/stores/themeStore";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const mode = useThemeStore((state) => state.mode);

  // Apply theme on mount and mode change
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    // Set color-scheme for native elements (scrollbars, inputs, etc.)
    document.documentElement.style.colorScheme = "dark";
  }, [mode]);

  return <>{children}</>;
}
