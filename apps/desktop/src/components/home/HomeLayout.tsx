/**
 * HomeLayout - Main home page router
 * Routes between WelcomeView (first-run onboarding) and DashboardView (initialized)
 * Supports dual UI modes (retro/modern)
 */
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { Ghost } from "@/components/Ghost";
import { WelcomeView } from "@/components/home/WelcomeView";
import { DashboardView } from "@/components/home/DashboardView";
import { useInitStatus } from "@/hooks/useInitStatus";
import { useUIMode } from "@/stores/themeStore";
import type { TabId } from "@/types";

interface HomeLayoutProps {
  onNavigate: (tab: TabId) => void;
}

export function HomeLayout({ onNavigate }: HomeLayoutProps) {
  const { isRetro } = useUIMode();
  const {
    status: initStatus,
    isLoading,
    error,
    refresh: refreshStatus,
  } = useInitStatus();

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center text-center"
        >
          <Ghost size={48} variant="sleepy" animate={true} />
          <p
            className={`mt-4 ${
              isRetro
                ? "font-terminal text-[var(--color-text-muted)]"
                : "text-sm text-[var(--color-text-secondary)]"
            }`}
          >
            Loading...
          </p>
        </motion.div>
      </div>
    );
  }

  // No status available (shouldn't happen, but handle gracefully)
  if (!initStatus) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          {isRetro ? (
            <Ghost size={64} variant="worried" />
          ) : (
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-error)]/10 flex items-center justify-center mb-4">
              <RefreshCw size={32} className="text-[var(--color-error)]" />
            </div>
          )}
          <p
            className={`mt-4 ${
              isRetro
                ? "font-terminal text-[var(--color-error)]"
                : "text-sm text-[var(--color-error)]"
            }`}
          >
            Failed to load status
          </p>
          {error && (
            <p
              className={`mt-2 ${
                isRetro
                  ? "font-mono text-xs text-[var(--color-error)]"
                  : "text-xs text-[var(--color-error)]"
              }`}
            >
              {error}
            </p>
          )}
          <button
            className={`mt-4 px-4 py-2 rounded-[var(--radius-button)] transition-all ${
              isRetro
                ? "font-terminal border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]"
                : "bg-[var(--color-accent)] text-white hover:brightness-110"
            }`}
            onClick={refreshStatus}
          >
            {isRetro ? "[Retry]" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  // Show WelcomeView if not fully initialized
  // Require BOTH a snapshot AND ingestion to show dashboard
  if (!initStatus.has_snapshot || !initStatus.has_sqlite_db) {
    return <WelcomeView initStatus={initStatus} onComplete={refreshStatus} />;
  }

  // Show DashboardView only if we have both snapshot AND databases
  return <DashboardView initStatus={initStatus} onNavigate={onNavigate} />;
}

export default HomeLayout;
