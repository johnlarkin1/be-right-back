/**
 * CompactStatsBar - Horizontal compressed stats display
 * Shows key metrics in a single row at the top of the dashboard
 * Supports dual UI modes (retro terminal vs modern clean)
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw,
  Camera,
  Database,
  HardDrive,
  type LucideIcon,
} from "lucide-react";
import { useUIMode } from "../../stores/themeStore";
import { Tooltip } from "../ui/Tooltip";
import { tooltipContent } from "../ui/tooltipContent";
import { formatNumber } from "../../lib/format";

interface CompactStatsBarProps {
  messageCount: number;
  contactCount: number;
  chunkCount: number;
  lastSnapshot: string | null;
  // Storage info
  snapshotSize?: string;
  embeddingsSize?: string;
  totalSize?: string;
  // Actions
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

export function CompactStatsBar({
  messageCount,
  contactCount,
  chunkCount,
  lastSnapshot,
  snapshotSize,
  embeddingsSize,
  totalSize,
  onRefresh,
  isRefreshing = false,
  className = "",
}: CompactStatsBarProps) {
  const { isRetro } = useUIMode();
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleRefreshClick = () => {
    setShowConfirmModal(true);
  };

  const handleConfirm = () => {
    setShowConfirmModal(false);
    onRefresh?.();
  };

  const handleCancel = () => {
    setShowConfirmModal(false);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`compact-stats-bar ${className}`}
      >
        {/* Data stats */}
        <div className="compact-stats-items">
          <StatItem label="messages" value={formatNumber(messageCount)} />
          <Divider />
          <StatItem label="contacts" value={formatNumber(contactCount)} />
          <Divider />
          <StatItem label="chunks" value={formatNumber(chunkCount)} />
          {lastSnapshot && (
            <>
              <Divider />
              <StatItem label="updated" value={lastSnapshot} />
            </>
          )}
        </div>

        {/* Storage stats */}
        {(snapshotSize || embeddingsSize || totalSize) && (
          <div className="compact-stats-storage">
            {snapshotSize && (
              <StorageItem
                label="snapshot"
                value={snapshotSize}
                icon="snapshot"
                isRetro={isRetro}
              />
            )}
            {embeddingsSize && (
              <StorageItem
                label="vectors"
                value={embeddingsSize}
                icon="vectors"
                isRetro={isRetro}
              />
            )}
            {totalSize && (
              <StorageItem
                label="total"
                value={totalSize}
                icon="disk"
                isRetro={isRetro}
              />
            )}
          </div>
        )}

        {/* Update button */}
        {onRefresh && (
          <motion.button
            onClick={handleRefreshClick}
            disabled={isRefreshing}
            className="compact-stats-update-btn"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isRefreshing ? (
              <>
                {isRetro ? (
                  <motion.svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    animate={{ rotate: 360 }}
                    transition={{
                      repeat: Infinity,
                      duration: 1,
                      ease: "linear",
                    }}
                  >
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </motion.svg>
                ) : (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      repeat: Infinity,
                      duration: 1,
                      ease: "linear",
                    }}
                  >
                    <RefreshCw size={14} />
                  </motion.div>
                )}
                <span>Syncing...</span>
              </>
            ) : (
              <>
                {isRetro ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                ) : (
                  <RefreshCw size={14} />
                )}
                <Tooltip
                  content={tooltipContent.syncNewMessages}
                  position="bottom"
                >
                  <span>Sync New Messages</span>
                </Tooltip>
              </>
            )}
          </motion.button>
        )}
      </motion.div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <ConfirmModal
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            messageCount={messageCount}
            isRetro={isRetro}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** Confirmation modal for sync operation */
function ConfirmModal({
  onConfirm,
  onCancel,
  messageCount,
  isRetro,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  messageCount: number;
  isRetro: boolean;
}) {
  return (
    <motion.div
      className="confirm-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="confirm-modal"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-modal-header">
          {isRetro ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          ) : (
            <RefreshCw size={24} />
          )}
          <h3>Sync New Messages</h3>
        </div>

        <div className="confirm-modal-body">
          <p>This will:</p>
          <ul>
            <li>
              <span className="confirm-step-icon">📸</span>
              Create a new snapshot of your iMessage database
            </li>
            <li>
              <span className="confirm-step-icon">🔍</span>
              Find new messages since last sync ({formatNumber(
                messageCount,
              )}{" "}
              existing)
            </li>
            <li>
              <span className="confirm-step-icon">🧠</span>
              Generate embeddings for semantic search
            </li>
            <li>
              <span className="confirm-step-icon">💾</span>
              Update your local databases
            </li>
          </ul>
          <p className="confirm-privacy-note">
            <span className="confirm-lock-icon">🔒</span>
            All data stays on your device - nothing is sent to the cloud.
          </p>
        </div>

        <div className="confirm-modal-actions">
          <button className="confirm-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm-btn-confirm" onClick={onConfirm}>
            Start Sync
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Labels that have tooltip explanations
const statLabelTooltips: Record<string, string | undefined> = {
  chunks: tooltipContent.chunks,
};

function StatItem({ label, value }: { label: string; value: string }) {
  const tooltip = statLabelTooltips[label];

  return (
    <div className="compact-stats-item">
      <span className="compact-stats-value">{value}</span>
      {tooltip ? (
        <Tooltip content={tooltip} position="bottom">
          <span className="compact-stats-label">{label}</span>
        </Tooltip>
      ) : (
        <span className="compact-stats-label">{label}</span>
      )}
    </div>
  );
}

// Storage labels that have tooltip explanations
const storageLabelTooltips: Record<string, string | undefined> = {
  snapshot: tooltipContent.snapshot,
  vectors: tooltipContent.vectors,
  total: tooltipContent.total,
};

function StorageItem({
  label,
  value,
  icon,
  isRetro,
}: {
  label: string;
  value: string;
  icon: "snapshot" | "vectors" | "disk";
  isRetro: boolean;
}) {
  const tooltip = storageLabelTooltips[label];

  return (
    <div className="compact-stats-storage-item">
      {tooltip ? (
        <Tooltip content={tooltip} position="bottom">
          <span className="storage-item-trigger">
            <StorageIcon type={icon} isRetro={isRetro} />
            <span className="compact-stats-storage-label">{label}</span>
          </span>
        </Tooltip>
      ) : (
        <>
          <StorageIcon type={icon} isRetro={isRetro} />
          <span className="compact-stats-storage-label">{label}</span>
        </>
      )}
      <span className="compact-stats-storage-value">{value}</span>
    </div>
  );
}

/** Storage icon mappings for modern mode */
const storageIconMap: Record<"snapshot" | "vectors" | "disk", LucideIcon> = {
  snapshot: Camera,
  vectors: Database,
  disk: HardDrive,
};

function StorageIcon({
  type,
  isRetro,
}: {
  type: "snapshot" | "vectors" | "disk";
  isRetro: boolean;
}) {
  // Modern mode: use Lucide icons
  if (!isRetro) {
    const Icon = storageIconMap[type];
    return <Icon size={14} strokeWidth={1.5} />;
  }

  // Retro mode: use custom SVG icons
  const iconProps = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "snapshot":
      // Camera/snapshot icon
      return (
        <svg {...iconProps}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    case "vectors":
      // Database/neural network icon
      return (
        <svg {...iconProps}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
    case "disk":
      // Hard drive icon
      return (
        <svg {...iconProps}>
          <line x1="22" y1="12" x2="2" y2="12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          <line x1="6" y1="16" x2="6.01" y2="16" />
          <line x1="10" y1="16" x2="10.01" y2="16" />
        </svg>
      );
  }
}

function Divider() {
  return <span className="compact-stats-divider">|</span>;
}

export default CompactStatsBar;
