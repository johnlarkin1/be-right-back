/**
 * ModeAwareMascot - Mode-aware mascot that shows Ghost in retro mode
 * and Lucide icons in modern mode
 */

import { useUIMode } from "@/stores/themeStore";
import { Ghost } from "./Ghost";
import { Bot, Sparkles, MessageCircle, User } from "lucide-react";
import type { GhostVariant } from "@/types";

type ModernVariant = "bot" | "sparkles" | "message" | "user" | "none";

interface ModeAwareMascotProps {
  /** Ghost emotion/variant for retro mode */
  variant?: GhostVariant;
  /** Size in pixels */
  size?: number;
  /** What to show in modern mode */
  modernVariant?: ModernVariant;
  /** Additional CSS classes */
  className?: string;
  /** Whether to animate the ghost (retro mode only) */
  animate?: boolean;
}

const IconMap = {
  bot: Bot,
  sparkles: Sparkles,
  message: MessageCircle,
  user: User,
};

export function ModeAwareMascot({
  variant = "standard",
  size = 32,
  modernVariant = "bot",
  className = "",
  animate = true,
}: ModeAwareMascotProps) {
  const { isRetro } = useUIMode();

  // Retro mode: show the pixel ghost
  if (isRetro) {
    return (
      <Ghost
        variant={variant}
        size={size}
        animate={animate}
        className={className}
      />
    );
  }

  // Modern mode: show nothing if variant is "none"
  if (modernVariant === "none") {
    return null;
  }

  // Modern mode: show Lucide icon in rounded container
  const Icon = IconMap[modernVariant];
  const iconSize = Math.round(size * 0.6);

  return (
    <div
      className={`
        rounded-xl bg-[var(--color-accent-subtle)]
        flex items-center justify-center
        ${className}
      `}
      style={{ width: size, height: size }}
    >
      <Icon size={iconSize} className="text-[var(--color-accent)]" />
    </div>
  );
}

export default ModeAwareMascot;
