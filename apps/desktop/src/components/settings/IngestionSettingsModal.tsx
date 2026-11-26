/**
 * IngestionSettingsModal - Configure ingestion and embedding settings
 * Supports dual UI modes (retro terminal / modern clean)
 *
 * Two modes:
 * - "ingest": Full modal with date filters and analytics settings
 * - "re-embed": Only analytics settings (for re-running clustering)
 *
 * "Number of Topics" sets the target topic count; Leiden lands near it.
 * Advanced settings hold PCA, UMAP and seed controls.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shield, ChevronDown, ChevronUp } from "lucide-react";
import { ModeAwareMascot } from "@/components/ModeAwareMascot";
import { useUIMode } from "@/stores/themeStore";
import type {
  IngestionSettings,
  IngestionModalMode,
  AnalyticsSettings,
  ResolvedAnalyticsSettings,
} from "@/types";
import {
  DEFAULT_ANALYTICS_SETTINGS,
  DEFAULT_INGESTION_SETTINGS,
} from "@/types";
import { useIngestionSettings } from "@/hooks/useIngestionSettings";

interface IngestionSettingsModalProps {
  mode: IngestionModalMode;
  isOpen: boolean;
  onConfirm: (settings: IngestionSettings) => void;
  onCancel: () => void;
}

/** Fill every null from the defaults so the sliders always have a value. */
function resolveAnalytics(
  s: AnalyticsSettings | null,
): ResolvedAnalyticsSettings {
  const d = DEFAULT_ANALYTICS_SETTINGS;
  if (!s) return d;
  return {
    target_topics: s.target_topics ?? d.target_topics,
    pca_dims: s.pca_dims ?? d.pca_dims,
    umap_n_neighbors: s.umap_n_neighbors ?? d.umap_n_neighbors,
    umap_min_dist: s.umap_min_dist ?? d.umap_min_dist,
    umap_spread: s.umap_spread ?? d.umap_spread,
    random_state: s.random_state ?? d.random_state,
  };
}

export function IngestionSettingsModal({
  mode,
  isOpen,
  onConfirm,
  onCancel,
}: IngestionSettingsModalProps) {
  const {
    settings,
    dateRange,
    isLoading,
    updateSettings,
    updateAnalytics,
    resetToDefaults,
    resetToSaved,
  } = useIngestionSettings();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minMessagesEnabled, setMinMessagesEnabled] = useState(
    settings.min_messages_per_contact !== null,
  );

  // Sync toggle state with settings
  useEffect(() => {
    setMinMessagesEnabled(settings.min_messages_per_contact !== null);
  }, [settings.min_messages_per_contact]);

  const effectiveAnalytics: ResolvedAnalyticsSettings = useMemo(
    () => resolveAnalytics(settings.analytics),
    [settings.analytics],
  );

  const handleTopicsChange = useCallback(
    (value: number) => {
      updateAnalytics({ target_topics: value });
    },
    [updateAnalytics],
  );

  const handleAdvancedChange = useCallback(
    (partial: Partial<AnalyticsSettings>) => {
      updateAnalytics(partial);
    },
    [updateAnalytics],
  );

  const handleToggleAdvanced = useCallback(() => {
    setShowAdvanced((prev) => !prev);
  }, []);

  // Format date for input[type="date"]
  const formatDateForInput = (isoDate: string | null): string => {
    if (!isoDate) return "";
    return isoDate.split("T")[0];
  };

  // Handle date change. The key is typed against IngestionSettings rather than
  // written as a string literal — a computed key skips the excess-property
  // check, so a stale name here would silently write a field nothing reads.
  const handleDateChange = (
    field: "start_date" | "end_date",
    value: string,
  ) => {
    updateSettings({ [field]: value || null } as Partial<IngestionSettings>);
  };

  // Handle min messages toggle
  const handleMinMessagesToggle = () => {
    if (minMessagesEnabled) {
      updateSettings({ min_messages_per_contact: null });
    } else {
      updateSettings({
        min_messages_per_contact:
          DEFAULT_INGESTION_SETTINGS.min_messages_per_contact ?? 50,
      });
    }
    setMinMessagesEnabled(!minMessagesEnabled);
  };

  // Handle confirm
  const handleConfirm = () => {
    onConfirm(settings);
  };

  // Handle reset — reverts to defaults and restores simple mode.
  const handleReset = () => {
    resetToDefaults();
    setMinMessagesEnabled(
      DEFAULT_INGESTION_SETTINGS.min_messages_per_contact !== null,
    );
    setShowAdvanced(false);
  };

  // Handle cancel — discard unsaved changes before closing.
  const handleCancel = () => {
    resetToSaved();
    onCancel();
  };

  const { isRetro } = useUIMode();
  const isIngestMode = mode === "ingest";
  const title = isIngestMode ? "Ingestion Settings" : "Re-Analyze Settings";
  const confirmText = isIngestMode ? "Start Ingestion" : "Re-Analyze";

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="settings-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancel}
          />

          {/* Modal */}
          <motion.div
            className={`settings-modal ${isRetro ? "settings-modal--retro" : "settings-modal--modern"}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            {/* Close button */}
            <button className="settings-modal-close" onClick={handleCancel}>
              {isRetro ? "x" : <X size={16} />}
            </button>

            {/* Header */}
            <div className="settings-modal-header">
              <ModeAwareMascot
                variant="excited"
                size={40}
                modernVariant="sparkles"
                animate
              />
              <h2 className="settings-modal-title">{title}</h2>
              <p className="settings-modal-subtitle">
                {isIngestMode
                  ? "Configure how your messages are processed"
                  : "Adjust clustering parameters for your embeddings"}
              </p>
            </div>

            {/* Loading state */}
            {isLoading ? (
              <div className="settings-loading">
                <p>Loading settings...</p>
              </div>
            ) : (
              <div className="settings-modal-content">
                {/* Core Filters (only in ingest mode) */}
                {isIngestMode && (
                  <div className="settings-section">
                    <h3 className="settings-section-title">Date Range</h3>

                    {/* Date pickers */}
                    <div className="settings-row">
                      <label className="settings-label">Start Date</label>
                      <input
                        type="date"
                        className="settings-input"
                        value={formatDateForInput(settings.start_date)}
                        min={
                          dateRange
                            ? formatDateForInput(dateRange.earliest_date)
                            : undefined
                        }
                        max={
                          dateRange
                            ? formatDateForInput(dateRange.latest_date)
                            : undefined
                        }
                        onChange={(e) =>
                          handleDateChange("start_date", e.target.value)
                        }
                      />
                      {dateRange && (
                        <span className="settings-hint">
                          Earliest:{" "}
                          {formatDateForInput(dateRange.earliest_date)}
                        </span>
                      )}
                    </div>

                    <div className="settings-row">
                      <label className="settings-label">End Date</label>
                      <input
                        type="date"
                        className="settings-input"
                        value={formatDateForInput(settings.end_date)}
                        min={
                          dateRange
                            ? formatDateForInput(dateRange.earliest_date)
                            : undefined
                        }
                        max={
                          dateRange
                            ? formatDateForInput(dateRange.latest_date)
                            : undefined
                        }
                        onChange={(e) =>
                          handleDateChange("end_date", e.target.value)
                        }
                      />
                      {dateRange && (
                        <span className="settings-hint">
                          Latest: {formatDateForInput(dateRange.latest_date)}
                        </span>
                      )}
                    </div>

                    {/* Min messages filter */}
                    <div className="settings-section-divider" />
                    <h3 className="settings-section-title">Contact Filter</h3>

                    <div className="settings-row settings-row-toggle">
                      <div className="settings-toggle-group">
                        <label className="settings-label">
                          Minimum messages per contact
                        </label>
                        <button
                          className={`settings-toggle ${minMessagesEnabled ? "enabled" : ""}`}
                          onClick={handleMinMessagesToggle}
                        >
                          <span className="settings-toggle-thumb" />
                        </button>
                      </div>

                      {minMessagesEnabled && (
                        <div className="settings-slider-group">
                          <input
                            type="range"
                            className="settings-slider"
                            min={10}
                            max={500}
                            step={10}
                            value={settings.min_messages_per_contact ?? 50}
                            onChange={(e) =>
                              updateSettings({
                                min_messages_per_contact: parseInt(
                                  e.target.value,
                                ),
                              })
                            }
                          />
                          <span className="settings-slider-value">
                            {settings.min_messages_per_contact}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Topics Slider */}
                <div className="settings-section">
                  <h3 className="settings-section-title">Number of Topics</h3>
                  <SettingsSlider
                    label={`${effectiveAnalytics.target_topics} topic categories`}
                    value={effectiveAnalytics.target_topics}
                    min={5}
                    max={40}
                    step={1}
                    onChange={handleTopicsChange}
                    hint="About how many topics to find. The count can land a little above or below."
                  />
                </div>

                {/* Advanced Settings (collapsible) */}
                <div className="settings-section settings-section-advanced">
                  <button
                    className="settings-advanced-toggle"
                    onClick={handleToggleAdvanced}
                  >
                    <span className="settings-advanced-icon">
                      {isRetro ? (
                        showAdvanced ? (
                          "-"
                        ) : (
                          "+"
                        )
                      ) : showAdvanced ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </span>
                    <span className="settings-advanced-label">
                      Advanced Settings
                    </span>
                    <span className="settings-advanced-hint">
                      {isRetro ? "PCA + UMAP parameters" : "PCA + UMAP"}
                    </span>
                  </button>

                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div
                        className="settings-advanced-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        {/* PCA */}
                        <div className="settings-subsection">
                          <h4 className="settings-subsection-title">
                            Dimensionality Reduction
                          </h4>
                          <SettingsSlider
                            label="PCA Dimensions"
                            value={effectiveAnalytics.pca_dims}
                            min={10}
                            max={100}
                            step={5}
                            onChange={(v) =>
                              handleAdvancedChange({ pca_dims: v })
                            }
                            hint="Reduce embedding dimensions before clustering"
                          />
                        </div>

                        {/* UMAP */}
                        <div className="settings-subsection">
                          <h4 className="settings-subsection-title">
                            UMAP (Visualization)
                          </h4>
                          <SettingsSlider
                            label="Neighbors"
                            value={effectiveAnalytics.umap_n_neighbors}
                            min={5}
                            max={50}
                            step={5}
                            onChange={(v) =>
                              handleAdvancedChange({ umap_n_neighbors: v })
                            }
                            hint="Local vs global structure balance"
                          />
                          <SettingsSlider
                            label="Min Distance"
                            value={effectiveAnalytics.umap_min_dist}
                            min={0.0}
                            max={1.0}
                            step={0.05}
                            decimals={2}
                            onChange={(v) =>
                              handleAdvancedChange({ umap_min_dist: v })
                            }
                            hint="How tightly packed points appear"
                          />
                          <SettingsSlider
                            label="Spread"
                            value={effectiveAnalytics.umap_spread}
                            min={0.5}
                            max={3.0}
                            step={0.1}
                            decimals={1}
                            onChange={(v) =>
                              handleAdvancedChange({ umap_spread: v })
                            }
                            hint="Scale of embedding spread"
                          />
                        </div>

                        {/* Random state */}
                        <div className="settings-subsection">
                          <h4 className="settings-subsection-title">
                            Reproducibility
                          </h4>
                          <div className="settings-row">
                            <label className="settings-label">
                              Random Seed
                            </label>
                            <input
                              type="number"
                              className="settings-input settings-input-small"
                              value={effectiveAnalytics.random_state}
                              min={0}
                              onChange={(e) =>
                                handleAdvancedChange({
                                  random_state: isNaN(parseInt(e.target.value))
                                    ? 42
                                    : parseInt(e.target.value),
                                })
                              }
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Privacy note */}
                <div className="settings-privacy-note">
                  <span className="settings-privacy-icon">
                    {isRetro ? "*" : <Shield size={14} />}
                  </span>
                  All processing happens locally on your device. Your data never
                  leaves your Mac.
                </div>

                {/* Actions */}
                <div className="settings-actions">
                  <button
                    className="settings-btn settings-btn-secondary"
                    onClick={handleCancel}
                  >
                    Cancel
                  </button>
                  <button
                    className="settings-btn settings-btn-secondary"
                    onClick={handleReset}
                  >
                    Reset Defaults
                  </button>
                  <button
                    className="settings-btn settings-btn-primary"
                    onClick={handleConfirm}
                  >
                    {confirmText}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Slider component for numeric settings */
function SettingsSlider({
  label,
  value,
  min,
  max,
  step,
  decimals = 0,
  hint,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const displayValue = disabled
    ? "—"
    : decimals > 0
      ? value.toFixed(decimals)
      : value;

  return (
    <div
      className={`settings-row settings-row-slider ${disabled ? "settings-row-disabled" : ""}`}
    >
      <div className="settings-slider-header">
        <label className="settings-label">{label}</label>
        <span className="settings-slider-value">{displayValue}</span>
      </div>
      <input
        type="range"
        className="settings-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  );
}

export default IngestionSettingsModal;
