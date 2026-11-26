/**
 * AppShell - Main layout wrapper with mode-aware visual effects
 */
import { useState, useMemo } from "react";
import type { ReactNode } from "react";
import { VisualEffects } from "@/components/effects";
import { TopBar } from "@/components/TopBar";
import { AboutModal } from "@/components/AboutModal";
import { ShortcutsModal } from "@/components/ShortcutsModal";
import { CommandPalette } from "@/components/CommandPalette";
import { WanderingGhost } from "@/components/Ghost";
import { useUIMode, useThemeStore } from "@/stores/themeStore";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import type { TabId } from "@/types";

const TAB_ORDER: TabId[] = ["insights", "casper", "personas"];

interface AppShellProps {
  children: ReactNode;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  showWanderingGhost?: boolean;
}

export function AppShell({
  children,
  activeTab,
  onTabChange,
  showWanderingGhost = true,
}: AppShellProps) {
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const { isRetro } = useUIMode();
  const toggleMode = useThemeStore((state) => state.toggleMode);

  const goNextTab = () => {
    const idx = TAB_ORDER.indexOf(activeTab);
    onTabChange(TAB_ORDER[(idx + 1) % TAB_ORDER.length]);
  };

  const goPrevTab = () => {
    const idx = TAB_ORDER.indexOf(activeTab);
    onTabChange(TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
  };

  const handleEscape = () => {
    if (showCommandPalette) {
      setShowCommandPalette(false);
    } else if (showShortcuts) {
      setShowShortcuts(false);
    } else if (showAbout) {
      setShowAbout(false);
    }
  };

  const handleCommandExecute = (commandId: string) => {
    switch (commandId) {
      case "go-insights":
        onTabChange("insights");
        break;
      case "go-casper":
        onTabChange("casper");
        break;
      case "go-personas":
        onTabChange("personas");
        break;
      case "toggle-theme":
        toggleMode();
        break;
      case "shortcuts":
        setShowShortcuts(true);
        break;
      case "about":
        setShowAbout(true);
        break;
    }
  };

  const shortcutCallbacks = useMemo(
    () => ({
      onNextTab: goNextTab,
      onPrevTab: goPrevTab,
      onGoToInsights: () => onTabChange("insights"),
      onGoToCasper: () => onTabChange("casper"),
      onGoToPersonas: () => onTabChange("personas"),
      onToggleTheme: toggleMode,
      onOpenShortcuts: () => setShowShortcuts(true),
      onOpenCommandPalette: () => setShowCommandPalette((prev) => !prev),
      onEscape: handleEscape,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeTab,
      onTabChange,
      toggleMode,
      showCommandPalette,
      showShortcuts,
      showAbout,
    ],
  );

  useGlobalShortcuts(shortcutCallbacks);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface)]">
      {/* Mode-aware visual effects (CRT for retro, ambient for modern) */}
      <VisualEffects />

      {/* Wandering ghost mascot - only in retro mode */}
      {showWanderingGhost && isRetro && (
        <WanderingGhost size={24} variant="mischievous" />
      )}

      {/* Unified TopBar with navigation and ghost menu */}
      <TopBar
        activeTab={activeTab}
        onTabChange={onTabChange}
        onAboutClick={() => setShowAbout(true)}
        onShortcutsClick={() => setShowShortcuts(true)}
      />

      {/* Main content area */}
      <main className="flex-1 flex flex-col min-h-0">{children}</main>

      {/* Modals & Overlays */}
      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
      <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onExecute={handleCommandExecute}
      />
    </div>
  );
}

export default AppShell;
