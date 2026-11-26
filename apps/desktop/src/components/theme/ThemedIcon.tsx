/**
 * ThemedIcon - Mode-aware icon component
 * Shows ASCII text elements in retro mode, Lucide icons in modern mode
 */

import { useUIMode } from "@/stores/themeStore";
import type { LucideIcon } from "lucide-react";

interface ThemedIconProps {
  /** Lucide icon component to show in modern mode */
  modernIcon: LucideIcon;
  /** Text/element to show in retro mode (e.g., "[>_]", "[@]") */
  retroElement: React.ReactNode;
  /** Size for the Lucide icon */
  size?: number;
  /** Additional CSS classes */
  className?: string;
}

export function ThemedIcon({
  modernIcon: ModernIcon,
  retroElement,
  size = 18,
  className = "",
}: ThemedIconProps) {
  const { isRetro } = useUIMode();

  if (isRetro) {
    return (
      <span className={`font-mono text-inherit ${className}`}>
        {retroElement}
      </span>
    );
  }

  return <ModernIcon size={size} className={className} />;
}

export default ThemedIcon;
