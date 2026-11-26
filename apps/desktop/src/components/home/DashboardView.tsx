/**
 * DashboardView - Home page with Casper Q&A as the main feature.
 *
 * Thin wrapper that opens directly into the consolidated CasperChat (thread
 * sidebar + chat). Shows a collapsible stats bar and a stale-index banner above
 * the conversation, and guards with NeedsSetup / IngestionProgress when Casper
 * isn't ready. Supports dual UI modes (retro/modern).
 */
import { useState, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight } from "lucide-react";
import {
  getInitializationStatus,
  checkIngestionFreshness,
  type IngestionFreshness,
} from "@/services/tauri";
import { CompactStatsBar } from "./CompactStatsBar";
import { IngestionProgress } from "./IngestionProgress";
import { CasperChat } from "./CasperChat";
import { NeedsSetup } from "./NeedsSetup";
import { IngestionSettingsModal } from "@/components/settings/IngestionSettingsModal";
import { useIngestion } from "@/hooks/useIngestion";
import { useUIMode } from "@/stores/themeStore";
import type { TabId, InitializationStatus, IngestionSettings } from "@/types";

interface DashboardViewProps {
  initStatus: InitializationStatus | null;
  onNavigate: (tab: TabId) => void;
  className?: string;
}

export function DashboardView({
  initStatus,
  onNavigate: _onNavigate,
  className = "",
}: DashboardViewProps) {
  const { isRetro } = useUIMode();
  const ingestion = useIngestion();
  const [showIngestionProgress, setShowIngestionProgress] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [statsCollapsed, setStatsCollapsed] = useState(true); // Collapsed by default in chat mode
  const [liveInitStatus, setLiveInitStatus] =
    useState<InitializationStatus | null>(initStatus);
  const [freshness, setFreshness] = useState<IngestionFreshness | null>(null);
  const [freshnessDismissed, setFreshnessDismissed] = useState(false);

  // Update live status when prop changes
  useEffect(() => {
    setLiveInitStatus(initStatus);
  }, [initStatus]);

  // Check whether the index has fallen behind the live Messages DB, so we can
  // prompt a re-ingest (stale data is what makes Casper answer from old messages).
  // Re-runs when status changes (e.g. after an ingestion completes).
  useEffect(() => {
    const ready =
      liveInitStatus?.has_snapshot &&
      liveInitStatus?.has_vector_db &&
      (liveInitStatus?.chunk_count ?? 0) > 0;
    if (!ready) return;
    checkIngestionFreshness()
      .then((f) => {
        setFreshness(f);
        if (!f.is_stale) setFreshnessDismissed(false);
      })
      .catch(() => setFreshness(null));
  }, [liveInitStatus]);

  // Handle update snapshot - show settings modal first
  const handleUpdateSnapshot = () => {
    setShowSettingsModal(true);
  };

  // Handle confirm from settings modal
  const handleConfirmIngestion = async (settings: IngestionSettings) => {
    setShowSettingsModal(false);
    setShowIngestionProgress(true);
    await ingestion.startIngestion(settings);
  };

  // Format last snapshot date based on UI mode
  const formatLastSnapshot = () => {
    if (!liveInitStatus?.snapshot_date) return null;
    try {
      const date = new Date(liveInitStatus.snapshot_date);

      if (isRetro) {
        // Retro mode: ISO format (yyyy-mm-dd)
        return date.toISOString().split("T")[0];
      } else {
        // Modern mode: Human readable (January 1st, 2026)
        const day = date.getDate();
        const ordinal =
          day % 10 === 1 && day !== 11
            ? "st"
            : day % 10 === 2 && day !== 12
              ? "nd"
              : day % 10 === 3 && day !== 13
                ? "rd"
                : "th";
        const month = date.toLocaleDateString("en-US", { month: "long" });
        const year = date.getFullYear();
        return `${month} ${day}${ordinal}, ${year}`;
      }
    } catch {
      return liveInitStatus.snapshot_date;
    }
  };

  // Show ingestion progress if running
  if (showIngestionProgress && (ingestion.isRunning || ingestion.isComplete)) {
    return (
      <div
        className={`flex min-h-full items-center justify-center p-8 ${className}`}
      >
        <div className="max-w-lg w-full">
          <IngestionProgress
            stages={ingestion.stages}
            currentStage={ingestion.currentStage}
            stats={ingestion.stats}
            isComplete={ingestion.isComplete}
            error={ingestion.error}
            isRunning={ingestion.isRunning}
            setupMessage={ingestion.setupMessage}
            onCancel={ingestion.cancelIngestion}
          />

          {ingestion.isComplete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-6 text-center"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={async () => {
                  // Refresh status to get updated counts after ingestion
                  try {
                    const freshStatus = await getInitializationStatus();
                    setLiveInitStatus(freshStatus);
                  } catch (err) {
                    console.error("Failed to refresh status:", err);
                  }
                  setShowIngestionProgress(false);
                  ingestion.reset();
                }}
                className={`flex items-center gap-2 mx-auto px-6 py-2 rounded-[var(--radius-button)] font-medium transition-all ${
                  isRetro
                    ? "bg-[var(--color-crt-text)] text-[var(--color-crt-bg)] font-mono font-bold"
                    : "bg-[var(--color-accent)] text-white hover:brightness-110"
                }`}
              >
                Back to Home
                {!isRetro && <ArrowRight size={16} />}
              </motion.button>
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  // Check if Casper is ready (has snapshot + vector db + actual chunks)
  const casperReady =
    liveInitStatus?.has_snapshot &&
    liveInitStatus?.has_vector_db &&
    (liveInitStatus?.chunk_count ?? 0) > 0;

  // Setup guards: surface what's missing before Casper can answer. "Go to Setup"
  // opens the ingestion settings modal (rendered below).
  let content: ReactNode;
  if (liveInitStatus && !liveInitStatus.has_snapshot) {
    content = (
      <NeedsSetup
        title="Snapshot Required"
        description="Create a snapshot of your iMessage data first. This safely copies your messages for processing while keeping everything local on your device."
        actionLabel="Go to Setup"
        onAction={handleUpdateSnapshot}
        variant="pink"
        ghostVariant="sleepy"
      />
    );
  } else if (liveInitStatus && !liveInitStatus.has_vector_db) {
    content = (
      <NeedsSetup
        title="Search Not Ready"
        description="Run data ingestion to enable Casper's semantic search. This builds a searchable index of your conversations."
        actionLabel="Go to Setup"
        onAction={handleUpdateSnapshot}
        variant="pink"
        ghostVariant="sad"
      />
    );
  } else if (liveInitStatus && (liveInitStatus.chunk_count ?? 0) === 0) {
    content = (
      <NeedsSetup
        title="No Data Yet"
        description="Your vector database exists but has no message chunks. Run ingestion to index your conversations so Casper can search them."
        actionLabel="Go to Setup"
        onAction={handleUpdateSnapshot}
        variant="pink"
        ghostVariant="sleepy"
      />
    );
  } else {
    content = (
      <div className="flex flex-col min-h-full">
        {/* Collapsible Stats Bar - controlled by CasperChat header */}
        <AnimatePresence>
          {!statsCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="p-4 pb-2">
                <CompactStatsBar
                  messageCount={liveInitStatus?.snapshot_message_count ?? 0}
                  contactCount={liveInitStatus?.snapshot_contact_count ?? 0}
                  chunkCount={liveInitStatus?.chunk_count ?? 0}
                  lastSnapshot={formatLastSnapshot()}
                  snapshotSize={liveInitStatus?.snapshot_size_display}
                  embeddingsSize={liveInitStatus?.embeddings_size_display}
                  totalSize={liveInitStatus?.total_data_size_display}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stale-index banner: live Messages DB has newer messages than the index */}
        {casperReady && freshness?.is_stale && !freshnessDismissed && (
          <div className="px-4 pt-3">
            <div
              className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm rounded-[var(--radius-card)] ${
                isRetro
                  ? "font-mono border border-[var(--color-ghost-pink)]/40 text-[var(--color-ghost-pink)]"
                  : "bg-[var(--color-ghost-pink)]/10 border border-[var(--color-ghost-pink)]/30 text-[var(--color-text-primary)]"
              }`}
            >
              <span>
                {isRetro ? "! " : ""}New messages since your last index
                {freshness.days_behind > 0
                  ? ` (~${freshness.days_behind} day${freshness.days_behind === 1 ? "" : "s"} behind)`
                  : ""}
                . Casper won't see them until you re-ingest.
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleUpdateSnapshot}
                  className={`px-3 py-1 rounded-[var(--radius-button)] font-medium transition-all ${
                    isRetro
                      ? "bg-[var(--color-crt-text)] text-[var(--color-crt-bg)] font-bold"
                      : "bg-[var(--color-accent)] text-white hover:brightness-110"
                  }`}
                >
                  {isRetro ? "[re-ingest]" : "Re-ingest"}
                </button>
                <button
                  onClick={() => setFreshnessDismissed(true)}
                  aria-label="Dismiss"
                  className="opacity-60 hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Consolidated chat interface */}
        <CasperChat
          messageCount={liveInitStatus?.snapshot_message_count ?? 0}
          contactCount={liveInitStatus?.snapshot_contact_count ?? 0}
          statsCollapsed={statsCollapsed}
          onToggleStats={() => setStatsCollapsed(!statsCollapsed)}
          onRefresh={handleUpdateSnapshot}
          isRefreshing={ingestion.isRunning}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-h-full ${className}`}>
      {content}

      {/* Settings Modal */}
      <IngestionSettingsModal
        mode="ingest"
        isOpen={showSettingsModal}
        onConfirm={handleConfirmIngestion}
        onCancel={() => setShowSettingsModal(false)}
      />
    </div>
  );
}

export default DashboardView;
