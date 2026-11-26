/**
 * CommandPalette - Searchable command overlay (⌘K)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Bot,
  Users,
  BarChart3,
  Monitor,
  Keyboard,
  Info,
} from "lucide-react";
import { useUIMode } from "@/stores/themeStore";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  retroIcon: string;
  modernIcon: typeof MessageSquare;
  section: string;
}

const COMMANDS: Command[] = [
  {
    id: "go-insights",
    label: "Go to Insights",
    shortcut: "⌘1",
    retroIcon: "#",
    modernIcon: BarChart3,
    section: "Navigation",
  },
  {
    id: "go-casper",
    label: "Go to Ask Casper",
    shortcut: "⌘2",
    retroIcon: "?",
    modernIcon: Bot,
    section: "Navigation",
  },
  {
    id: "go-personas",
    label: "Go to Personas",
    shortcut: "⌘3",
    retroIcon: "@",
    modernIcon: Users,
    section: "Navigation",
  },
  {
    id: "toggle-theme",
    label: "Toggle Theme",
    shortcut: "⌘⇧T",
    retroIcon: "◐",
    modernIcon: Monitor,
    section: "Actions",
  },
  {
    id: "shortcuts",
    label: "Keyboard Shortcuts",
    shortcut: "?",
    retroIcon: "⌨",
    modernIcon: Keyboard,
    section: "Actions",
  },
  {
    id: "about",
    label: "About",
    retroIcon: "◈",
    modernIcon: Info,
    section: "Actions",
  },
];

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (commandId: string) => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  onExecute,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { isRetro } = useUIMode();

  const filtered = COMMANDS.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase()),
  );

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Clamp selectedIndex when filtered list changes
  useEffect(() => {
    setSelectedIndex((prev) =>
      Math.min(prev, Math.max(0, filtered.length - 1)),
    );
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll(".command-palette-item");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        onExecute(filtered[selectedIndex].id);
        onClose();
      }
    },
    [filtered, selectedIndex, onExecute, onClose],
  );

  // Group filtered commands by section
  const sections = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    (acc[cmd.section] ??= []).push(cmd);
    return acc;
  }, {});

  // Track flat index for selection highlighting
  let flatIndex = -1;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="command-palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="command-palette"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="command-palette-input-wrapper">
              {isRetro && <span className="command-palette-prompt">&gt;</span>}
              <input
                ref={inputRef}
                className="command-palette-input"
                placeholder={
                  isRetro ? "type a command..." : "Search commands..."
                }
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
              />
            </div>
            <div className="command-palette-divider" />
            <div className="command-palette-list" ref={listRef}>
              {filtered.length === 0 ? (
                <div className="command-palette-empty">
                  {isRetro ? "no matches found_" : "No results"}
                </div>
              ) : (
                Object.entries(sections).map(([section, cmds]) => (
                  <div key={section}>
                    <div className="command-palette-section">
                      {isRetro ? `// ${section.toLowerCase()}` : section}
                    </div>
                    {cmds.map((cmd) => {
                      flatIndex++;
                      const idx = flatIndex;
                      const Icon = cmd.modernIcon;
                      return (
                        <button
                          key={cmd.id}
                          className={`command-palette-item ${idx === selectedIndex ? "selected" : ""}`}
                          onClick={() => {
                            onExecute(cmd.id);
                            onClose();
                          }}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <span className="command-palette-item-icon">
                            {isRetro ? cmd.retroIcon : <Icon size={16} />}
                          </span>
                          <span className="command-palette-item-label">
                            {cmd.label}
                          </span>
                          {cmd.shortcut && (
                            <span className="command-palette-item-shortcut">
                              {cmd.shortcut}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default CommandPalette;
