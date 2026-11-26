/**
 * CasperModelMenu - Model-tier selector dropdown for the Casper chat header.
 *
 * Owns all model state (tier list, selection, compatibility-warning modal) and the
 * thinking-mode toggle. Extracted from the old DashboardView landing page so the
 * consolidated CasperChat header can switch models. Supports dual UI modes (retro/modern).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Brain, Loader2, Lock, RotateCcw } from "lucide-react";
import {
  getCasperModelInfo,
  checkModelCompatibility,
  type CasperModelInfo,
} from "@/services/tauri";
import { ModelChangeWarningModal } from "@/components/settings/ModelChangeWarningModal";
import { useDropdownDirection } from "@/hooks/useDropdownDirection";
import { useUIMode } from "@/stores/themeStore";
import { useModelStore, useSelectedTier } from "@/stores/modelStore";
import type { IncompatiblePersona, ModelTierInfo } from "@/types";

interface CasperModelMenuProps {
  thinkingEnabled: boolean;
  onThinkingChange: (enabled: boolean) => void;
}

export function CasperModelMenu({
  thinkingEnabled,
  onThinkingChange,
}: CasperModelMenuProps) {
  const { isRetro } = useUIMode();
  const [modelInfo, setModelInfo] = useState<CasperModelInfo | null>(null);
  const modelDisplayName = modelInfo?.display_name ?? null;
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [warningModal, setWarningModal] = useState<{
    personas: IncompatiblePersona[];
    tierName: string;
    displayName: string;
  } | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const { direction: dropdownDirection, dropdownRef } = useDropdownDirection(
    modelTriggerRef,
    showModelMenu,
  );

  // Model store
  const { tiers, isChanging, fetchTiers, selectTier, resetToAuto } =
    useModelStore();
  const selectedTier = useSelectedTier();

  const refreshModelInfo = useCallback(() => {
    getCasperModelInfo()
      .then((info) => setModelInfo(info))
      .catch(() => setModelInfo(null));
  }, []);

  // Fetch model info + tiers on mount
  useEffect(() => {
    refreshModelInfo();
    fetchTiers();
  }, [refreshModelInfo, fetchTiers]);

  const handleTierSelect = useCallback(
    async (tier: ModelTierInfo) => {
      if (!tier.is_available || tier.is_selected || isChanging) return;

      // Check compatibility first
      try {
        const incompatible = await checkModelCompatibility(tier.tier_name);
        if (incompatible.length > 0) {
          setWarningModal({
            personas: incompatible,
            tierName: tier.tier_name,
            displayName: tier.display_name,
          });
          return;
        }

        // No incompatible personas — switch directly
        await selectTier(tier.tier_name);
        refreshModelInfo();
        setShowModelMenu(false);
      } catch (err) {
        console.error("Failed to change model:", err);
      }
    },
    [isChanging, selectTier, refreshModelInfo],
  );

  const handleWarningConfirm = useCallback(async () => {
    if (!warningModal) return;
    try {
      await selectTier(warningModal.tierName);
      refreshModelInfo();
      setShowModelMenu(false);
    } catch (err) {
      console.error("Failed to change model:", err);
    } finally {
      setWarningModal(null);
    }
  }, [warningModal, selectTier, refreshModelInfo]);

  const handleResetToAuto = useCallback(async () => {
    try {
      await resetToAuto();
      refreshModelInfo();
      setShowModelMenu(false);
    } catch (err) {
      console.error("Failed to reset model:", err);
    }
  }, [resetToAuto, refreshModelInfo]);

  // Close model menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(e.target as Node)
      ) {
        setShowModelMenu(false);
      }
    };
    if (showModelMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showModelMenu]);

  return (
    <div className="relative" ref={modelMenuRef}>
      <button
        ref={modelTriggerRef}
        onClick={() => setShowModelMenu(!showModelMenu)}
        className={`
          flex items-center gap-1.5 px-2 py-1 text-xs transition-all cursor-pointer rounded-md
          ${
            isRetro
              ? "font-mono text-[var(--color-text-muted)] hover:text-[var(--color-crt-text)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }
        `}
      >
        {isRetro ? (
          `[${modelDisplayName || "model"} ${thinkingEnabled ? "▪ thinking" : ""}]`
        ) : (
          <>
            <span>{modelDisplayName || "Model"}</span>
            {thinkingEnabled && (
              <span className="text-purple-400">Thinking</span>
            )}
            <ChevronDown
              size={11}
              className={`transition-transform ${showModelMenu ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {/* Dropdown menu */}
      <AnimatePresence>
        {showModelMenu && (
          <motion.div
            ref={dropdownRef}
            initial={{
              opacity: 0,
              y: dropdownDirection === "down" ? -4 : 4,
              scale: 0.95,
            }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: dropdownDirection === "down" ? -4 : 4,
              scale: 0.95,
            }}
            transition={{ duration: 0.15 }}
            className={`
              absolute right-0 z-50 min-w-[280px] py-1 max-h-[60vh] overflow-y-auto
              ${dropdownDirection === "down" ? "top-full mt-1" : "bottom-full mb-1"}
              ${
                isRetro
                  ? "border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-xs"
                  : "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-xl text-xs"
              }
            `}
          >
            {/* Loading / changing indicator */}
            {isChanging && (
              <div className="flex items-center gap-2 px-3 py-2 text-[var(--color-text-muted)]">
                {isRetro ? (
                  <span className="animate-pulse">[...]</span>
                ) : (
                  <Loader2 size={12} className="animate-spin" />
                )}
                <span>Switching model...</span>
              </div>
            )}

            {/* Model tier list */}
            {!isChanging &&
              tiers.map((tier) => (
                <button
                  key={tier.tier_name}
                  disabled={!tier.is_available}
                  onClick={() => handleTierSelect(tier)}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 transition-colors
                    ${
                      !tier.is_available
                        ? "opacity-40 cursor-not-allowed"
                        : tier.is_selected
                          ? "cursor-default"
                          : "cursor-pointer"
                    }
                    ${
                      isRetro
                        ? tier.is_available && !tier.is_selected
                          ? "hover:bg-[var(--color-surface-secondary)] text-[var(--color-crt-text)]"
                          : "text-[var(--color-crt-text)]"
                        : tier.is_available && !tier.is_selected
                          ? "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-primary)]"
                    }
                  `}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {!tier.is_available ? (
                      isRetro ? (
                        <span className="text-[var(--color-text-muted)] w-3.5 text-center flex-shrink-0">
                          x
                        </span>
                      ) : (
                        <Lock
                          size={12}
                          className="text-[var(--color-text-muted)] flex-shrink-0"
                        />
                      )
                    ) : (
                      <span className="w-3.5 flex-shrink-0" />
                    )}
                    <div className="text-left min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{tier.display_name}</span>
                        {tier.is_recommended && (
                          <span
                            className={`text-[9px] px-1 py-0.5 rounded ${
                              isRetro
                                ? "text-[var(--color-ghost-pink)]"
                                : "bg-[var(--color-ghost-pink)]/10 text-[var(--color-ghost-pink)]"
                            }`}
                          >
                            {isRetro ? "*rec" : "Rec"}
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-[10px] leading-snug ${isRetro ? "text-crt-text-dim" : "text-[var(--color-text-muted)]"}`}
                      >
                        ~{tier.model_size_gb.toFixed(1)}GB
                        {" · "}
                        {tier.speed_label}
                        {!tier.is_available &&
                          ` · Needs ${tier.min_memory_gb + 5}GB+ RAM`}
                      </div>
                    </div>
                  </div>
                  {tier.is_selected && (
                    <span className="text-[var(--color-ghost-pink)] ml-2 flex-shrink-0">
                      {isRetro ? "*" : "✓"}
                    </span>
                  )}
                </button>
              ))}

            {/* Reset to auto option (only if user has a manual preference) */}
            {!isChanging && selectedTier && !selectedTier.is_recommended && (
              <>
                <div className={`my-1 border-t border-[var(--color-border)]`} />
                <button
                  onClick={handleResetToAuto}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer
                    ${
                      isRetro
                        ? "hover:bg-[var(--color-surface-secondary)] text-[var(--color-crt-text)]"
                        : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                    }
                  `}
                >
                  {isRetro ? (
                    <span className="text-[var(--color-text-muted)] w-3.5 text-center">
                      ~
                    </span>
                  ) : (
                    <RotateCcw
                      size={12}
                      className="text-[var(--color-text-muted)]"
                    />
                  )}
                  <span>Reset to recommended</span>
                </button>
              </>
            )}

            {/* Divider */}
            <div className={`my-1 border-t border-[var(--color-border)]`} />

            {/* Thinking toggle */}
            <button
              onClick={() => {
                onThinkingChange(!thinkingEnabled);
                setShowModelMenu(false);
              }}
              className={`
                w-full flex items-center justify-between px-3 py-2 transition-colors cursor-pointer
                ${
                  isRetro
                    ? "hover:bg-[var(--color-surface-secondary)] text-[var(--color-crt-text)]"
                    : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                }
              `}
            >
              <div className="flex items-center gap-2">
                {isRetro ? (
                  <span className="text-purple-400">[T]</span>
                ) : (
                  <Brain size={14} className="text-purple-400" />
                )}
                <div className="text-left">
                  <div className="font-medium">Thinking mode</div>
                  <div
                    className={`text-[10px] ${isRetro ? "text-crt-text-dim" : "text-[var(--color-text-muted)]"}`}
                  >
                    Think longer for complex tasks
                  </div>
                </div>
              </div>
              {/* Toggle switch */}
              <div
                className={`
                  w-8 h-4.5 rounded-full relative transition-colors flex-shrink-0 ml-3
                  ${thinkingEnabled ? "bg-purple-500" : "bg-[var(--color-border)]"}
                `}
              >
                <div
                  className={`
                    absolute top-[3px] w-3 h-3 rounded-full bg-white transition-transform
                    ${thinkingEnabled ? "translate-x-[14px]" : "translate-x-[3px]"}
                  `}
                />
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Model change warning modal */}
      <AnimatePresence>
        {warningModal && (
          <ModelChangeWarningModal
            incompatiblePersonas={warningModal.personas}
            newModelName={warningModal.displayName}
            onConfirm={handleWarningConfirm}
            onCancel={() => setWarningModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default CasperModelMenu;
