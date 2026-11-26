/**
 * ErrorBoundary - Catches rendering errors in child component trees
 * Prevents a single tab crash from taking down the entire app
 */
import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Ghost } from "@/components/Ghost";
import { useUIMode } from "@/stores/themeStore";

interface ErrorBoundaryProps {
  children: ReactNode;
  tabName: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[ErrorBoundary] ${this.props.tabName} tab crashed:`,
      error,
      info.componentStack,
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          tabName={this.props.tabName}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

/** Functional fallback component that can use hooks */
function ErrorFallback({
  error,
  tabName,
  onReset,
}: {
  error: Error | null;
  tabName: string;
  onReset: () => void;
}) {
  const { isRetro } = useUIMode();

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 bg-[var(--color-surface)]">
      {isRetro ? (
        <Ghost size={64} variant="worried" animate />
      ) : (
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-error)]/10 flex items-center justify-center">
          <AlertTriangle size={32} className="text-[var(--color-error)]" />
        </div>
      )}

      <h3
        className={`mt-4 mb-2 ${
          isRetro
            ? "font-mono text-[var(--color-crt-text)]"
            : "text-lg font-semibold text-[var(--color-text-primary)]"
        }`}
      >
        {tabName} crashed
      </h3>

      <p
        className={`max-w-md mb-4 ${
          isRetro
            ? "font-mono text-sm text-[var(--color-crt-text-dim)]"
            : "text-sm text-[var(--color-text-secondary)]"
        }`}
      >
        Something went wrong rendering this tab. You can try again or switch to
        another tab.
      </p>

      {error && (
        <pre
          className={`max-w-lg mb-4 px-3 py-2 rounded text-left overflow-auto text-xs ${
            isRetro
              ? "font-mono text-[var(--color-error)] bg-[var(--color-crt-bg-light)] border border-[var(--color-crt-border)]"
              : "text-[var(--color-error)] bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
          }`}
        >
          {error.message}
        </pre>
      )}

      <button
        onClick={onReset}
        className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius-button)] transition-all ${
          isRetro
            ? "font-mono border border-[var(--color-crt-text)] text-[var(--color-crt-text)] hover:bg-[var(--color-crt-bg-light)]"
            : "bg-[var(--color-accent)] text-white hover:brightness-110"
        }`}
      >
        {isRetro ? "[Retry]" : <RefreshCw size={16} />}
        Try Again
      </button>
    </div>
  );
}

export default ErrorBoundary;
