/**
 * Custom render helper wrapping ThemeProvider for component tests
 */
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { useThemeStore } from "@/stores/themeStore";

interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  theme?: "retro" | "modern";
}

export function renderWithProviders(
  ui: ReactElement,
  { theme = "retro", ...options }: RenderWithProvidersOptions = {},
) {
  useThemeStore.setState({ mode: theme });
  return render(ui, options);
}
