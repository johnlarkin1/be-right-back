/**
 * TopBar - Unified navigation bar with centered tabs and ghost menu
 * Supports dual UI modes: retro CRT aesthetic and modern clean design
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  Bot,
  Users,
  Ghost as GhostIcon,
  Settings,
  Info,
  Keyboard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Ghost } from "@/components/Ghost";
import { ThemeToggle } from "@/components/theme";
import { PrivacyBadge } from "@/components/home/PrivacyBadge";
import { Tooltip } from "@/components/ui/Tooltip";
import { useUIMode } from "@/stores/themeStore";
import type { TabId } from "@/types";

interface Tab {
  id: TabId;
  /** Label for retro mode (terminal-style) */
  retroLabel: string;
  /** Label for modern mode (clean) */
  modernLabel: string;
  /** ASCII glyph for retro mode */
  retroIcon: string;
  /** Lucide icon for modern mode */
  modernIcon: LucideIcon;
  /** Keyboard shortcut shown in the tooltip */
  shortcut: string;
}

/** Tabs in display order. The app opens on Insights. */
const TABS: Tab[] = [
  {
    id: "insights",
    retroLabel: "insights",
    modernLabel: "Insights",
    retroIcon: "#",
    modernIcon: BarChart3,
    shortcut: "⌘1",
  },
  {
    id: "casper",
    retroLabel: "ask casper",
    modernLabel: "Ask Casper",
    retroIcon: "?",
    modernIcon: Bot,
    shortcut: "⌘2",
  },
  {
    id: "personas",
    retroLabel: "personas",
    modernLabel: "Personas",
    retroIcon: "@",
    modernIcon: Users,
    shortcut: "⌘3",
  },
];

interface TopBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onAboutClick?: () => void;
  onShortcutsClick?: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  onAboutClick,
  onShortcutsClick,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [ghostExcited, setGhostExcited] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isRetro } = useUIMode();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const handleMenuToggle = () => {
    setMenuOpen(!menuOpen);
    setGhostExcited(true);
    // Reset ghost animation after a moment
    setTimeout(() => setGhostExcited(false), 600);
  };

  const handleMenuItemClick = (action: string) => {
    setMenuOpen(false);
    if (action === "about" && onAboutClick) {
      onAboutClick();
    }
    if (action === "shortcuts" && onShortcutsClick) {
      onShortcutsClick();
    }
  };

  return (
    <header className="topbar">
      {/* Left side - Brand */}
      <div className="topbar-side">
        {isRetro ? (
          <span className="topbar-brand">
            <span className="topbar-brand-prompt">&gt;</span> Be Right Back
          </span>
        ) : (
          <div className="topbar-brand-modern">
            <span className="topbar-brand-text">Be Right Back</span>
          </div>
        )}
      </div>

      {/* Center navigation */}
      <nav className="topbar-nav" aria-label="Main">
        <div className="topbar-nav-container">
          {TABS.map((tab) => {
            const ModernIcon = tab.modernIcon;
            const isActive = activeTab === tab.id;
            return (
              <Tooltip
                key={tab.id}
                content={`${tab.modernLabel}  ${tab.shortcut}`}
                position="bottom"
                delayMs={400}
                className="!cursor-pointer"
              >
                <button
                  onClick={() => onTabChange(tab.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`topbar-tab focus-ring ${isActive ? "active" : ""}`}
                >
                  <span className="topbar-tab-icon" aria-hidden="true">
                    {isRetro ? (
                      tab.retroIcon
                    ) : (
                      <ModernIcon size={16} strokeWidth={isActive ? 2.5 : 2} />
                    )}
                  </span>
                  <span className="topbar-tab-label">
                    {isRetro ? tab.retroLabel : tab.modernLabel}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </nav>

      {/* Right side - Theme toggle, Ghost/Menu button */}
      <div className="topbar-side topbar-side-right" ref={menuRef}>
        <PrivacyBadge variant="inline" />
        <Tooltip
          content="Toggle theme  ⌘⇧T"
          position="bottom"
          delayMs={400}
          className="!cursor-pointer"
        >
          <ThemeToggle compact />
        </Tooltip>
        <motion.button
          className={`topbar-ghost-button ${!isRetro ? "topbar-ghost-button-modern" : ""}`}
          onClick={handleMenuToggle}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          {/* Ghost icon container - fixed size for consistent positioning */}
          <motion.div
            className="flex items-center justify-center w-6 h-6"
            animate={
              ghostExcited
                ? {
                    rotate: [0, -15, 15, -10, 10, 0],
                    scale: [1, 1.1, 1.1, 1.05, 1.05, 1],
                  }
                : {}
            }
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            {isRetro ? (
              <Ghost
                size={24}
                variant={menuOpen ? "excited" : "standard"}
                animate={false}
              />
            ) : (
              <GhostIcon size={20} strokeWidth={2} />
            )}
          </motion.div>
          {/* Chevron - shown in both modes */}
          <motion.span
            className="topbar-menu-chevron"
            animate={{ rotate: menuOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            &#9662;
          </motion.span>
        </motion.button>

        {/* Dropdown Menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className={`topbar-menu ${!isRetro ? "topbar-menu-modern" : ""}`}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="topbar-menu-header">
                {!isRetro && (
                  <div className="topbar-menu-header-icon">
                    <GhostIcon size={18} />
                  </div>
                )}
                <div className="topbar-menu-header-text">
                  <span className="topbar-menu-title">Be Right Back</span>
                  <span className="topbar-menu-version">v0.1.0</span>
                </div>
              </div>
              <div className="topbar-menu-divider" />
              <button
                className="topbar-menu-item"
                onClick={() => handleMenuItemClick("about")}
              >
                <span className="topbar-menu-item-icon">
                  {isRetro ? "◈" : <Info size={16} />}
                </span>
                <span>About</span>
              </button>
              <button
                className="topbar-menu-item"
                onClick={() => handleMenuItemClick("settings")}
                disabled
              >
                <span className="topbar-menu-item-icon">
                  {isRetro ? "⚙" : <Settings size={16} />}
                </span>
                <span>Settings</span>
                <span className="topbar-menu-item-badge">soon</span>
              </button>
              <div className="topbar-menu-divider" />
              <button
                className="topbar-menu-item"
                onClick={() => handleMenuItemClick("shortcuts")}
              >
                <span className="topbar-menu-item-icon">
                  {isRetro ? "⌨" : <Keyboard size={16} />}
                </span>
                <span>Keyboard Shortcuts</span>
                <span className="topbar-menu-item-shortcut">⌘?</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

export default TopBar;
