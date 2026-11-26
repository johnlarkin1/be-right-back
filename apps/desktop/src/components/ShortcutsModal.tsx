/**
 * ShortcutsModal - Keyboard shortcuts reference modal
 */
import { motion, AnimatePresence } from "framer-motion";
import { useUIMode } from "@/stores/themeStore";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string;
  description: string;
}

const NAVIGATION_SHORTCUTS: ShortcutEntry[] = [
  {
    keys: "⌘ 1 / 2 / 3",
    description: "Go to Insights / Ask Casper / Personas",
  },
  { keys: "⌘ ⇧ [", description: "Previous tab" },
  { keys: "⌘ ⇧ ]", description: "Next tab" },
];

const ACTION_SHORTCUTS: ShortcutEntry[] = [
  { keys: "⌘ K", description: "Command palette" },
  { keys: "⌘ ⇧ T", description: "Toggle theme" },
  { keys: "?  /  ⌘ ?", description: "Keyboard shortcuts" },
  { keys: "Esc", description: "Close overlay" },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const { isRetro } = useUIMode();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="shortcuts-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="shortcuts-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <button className="shortcuts-modal-close" onClick={onClose}>
              ×
            </button>
            <h2 className="shortcuts-modal-title">
              {isRetro ? "> keyboard shortcuts_" : "Keyboard Shortcuts"}
            </h2>

            <div className="shortcuts-group">
              <h3 className="shortcuts-group-title">
                {isRetro ? "// navigation" : "Navigation"}
              </h3>
              {NAVIGATION_SHORTCUTS.map((s) => (
                <div key={s.keys} className="shortcuts-row">
                  <kbd className="shortcuts-key">{s.keys}</kbd>
                  <span className="shortcuts-desc">{s.description}</span>
                </div>
              ))}
            </div>

            <div className="shortcuts-group">
              <h3 className="shortcuts-group-title">
                {isRetro ? "// actions" : "Actions"}
              </h3>
              {ACTION_SHORTCUTS.map((s) => (
                <div key={s.keys} className="shortcuts-row">
                  <kbd className="shortcuts-key">{s.keys}</kbd>
                  <span className="shortcuts-desc">{s.description}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default ShortcutsModal;
