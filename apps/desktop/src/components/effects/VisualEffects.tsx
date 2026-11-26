/**
 * VisualEffects - Mode-aware wrapper for visual effects
 * Renders CRTEffect in retro mode, ModernEffect in modern mode
 */

import { useUIMode } from "@/stores/themeStore";
import { CRTEffect } from "./CRTEffect";
import { ModernEffect } from "./ModernEffect";

export function VisualEffects() {
  const { isRetro } = useUIMode();

  return isRetro ? <CRTEffect /> : <ModernEffect />;
}

export default VisualEffects;
