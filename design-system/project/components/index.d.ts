// Be Right Back components. Types are documentation, taken from apps/desktop/src.
import type { ReactNode, ComponentType } from "react";

export type GhostColor = "green" | "pink" | "purple" | "cyan" | "amber";
export type GhostVariant = "standard" | "happy" | "sleepy" | "surprised" | "angry" | "sad" | "mischievous" | "worried" | "excited" | "bored" | "thinking";
export type TabId = "home" | "chat" | "insights";
export type UIMode = "retro" | "modern";

export interface GhostProps {
  /** Expression. Also sets the color when `color` is not given. */
  variant?: GhostVariant;
  /** Overrides the variant color. */
  color?: GhostColor;
  /** Size in pixels. Default 48. */
  size?: number;
  /** Float animation. Default true. */
  animate?: boolean;
  className?: string;
  glowIntensity?: "none" | "subtle" | "medium" | "strong";
}
export interface ModeAwareMascotProps {
  /** Ghost expression for retro mode. */
  variant?: GhostVariant;
  size?: number;
  /** What to show in modern mode. */
  modernVariant?: "bot" | "sparkles" | "message" | "user" | "none";
  className?: string;
  /** Animate the ghost. Retro only. */
  animate?: boolean;
}
export interface TopBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onAboutClick?: () => void;
  onShortcutsClick?: () => void;
}
export interface ThemeToggleProps {
  /** Icon-only button for the top bar. */
  compact?: boolean;
  /** Show the "UI Mode" label. */
  showLabel?: boolean;
}
export interface TooltipProps {
  content: string;
  children: ReactNode;
  /** Preferred side. Default "bottom". */
  position?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
  className?: string;
}
export interface AccordionProps {
  title: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
  id?: string;
}
export interface StepStatusIconProps {
  status: "completed" | "active" | "pending";
  size: number;
  color: string;
  isRetro: boolean;
  checkFg?: string;
  pendingColor?: string;
  checkSize?: number;
}
export interface MarkdownRendererProps {
  content: string;
  className?: string;
}
export interface MessageBubbleProps {
  message: string;
  isUser: boolean;
  isStreaming?: boolean;
}
export interface TypingIndicatorProps {}
export interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}
export interface PrivacyBadgeProps {
  variant?: "inline" | "card";
  className?: string;
}
export interface CompactStatsBarProps {
  messageCount: number;
  contactCount: number;
  chunkCount: number;
  /** A display string such as "2h ago". */
  lastSnapshot: string | null;
  snapshotSize?: string;
  embeddingsSize?: string;
  totalSize?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
}
export interface ThinkingBlockProps {
  thinking: string;
  defaultExpanded?: boolean;
}
export interface CasperToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "success" | "error";
  durationMs?: number;
  resultPreview?: string;
  error?: string;
}
export interface ToolCallCardProps {
  tool: CasperToolCall;
  compact?: boolean;
  defaultExpanded?: boolean;
}

export declare const Ghost: ComponentType<GhostProps>;
export declare const ModeAwareMascot: ComponentType<ModeAwareMascotProps>;
export declare const TopBar: ComponentType<TopBarProps>;
export declare const ThemeToggle: ComponentType<ThemeToggleProps>;
export declare const Tooltip: ComponentType<TooltipProps>;
export declare const Accordion: ComponentType<AccordionProps>;
export declare const StepStatusIcon: ComponentType<StepStatusIconProps>;
export declare const MarkdownRenderer: ComponentType<MarkdownRendererProps>;
export declare const MessageBubble: ComponentType<MessageBubbleProps>;
export declare const TypingIndicator: ComponentType<TypingIndicatorProps>;
export declare const ChatInput: ComponentType<ChatInputProps>;
export declare const PrivacyBadge: ComponentType<PrivacyBadgeProps>;
export declare const CompactStatsBar: ComponentType<CompactStatsBarProps>;
export declare const ThinkingBlock: ComponentType<ThinkingBlockProps>;
export declare const ToolCallCard: ComponentType<ToolCallCardProps>;
/** Returns the current mode. It follows data-theme on the html element. */
export declare function useUIMode(): { mode: UIMode; isRetro: boolean; isModern: boolean };
