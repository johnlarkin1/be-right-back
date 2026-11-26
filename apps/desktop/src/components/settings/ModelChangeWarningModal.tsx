/**
 * ModelChangeWarningModal - Confirmation dialog when changing models
 * would break existing trained personas.
 */
import { motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";
import type { IncompatiblePersona } from "@/types";

interface Props {
  incompatiblePersonas: IncompatiblePersona[];
  newModelName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ModelChangeWarningModal({
  incompatiblePersonas,
  newModelName,
  onConfirm,
  onCancel,
}: Props) {
  const { isRetro } = useUIMode();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`
          relative w-[400px] max-h-[80vh] overflow-auto
          ${
            isRetro
              ? "border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-sm"
              : "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-2xl text-sm"
          }
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            {isRetro ? (
              <span className="text-amber-400">[!]</span>
            ) : (
              <AlertTriangle size={18} className="text-amber-400" />
            )}
            <span
              className={`font-semibold ${isRetro ? "text-[var(--color-crt-text)]" : "text-[var(--color-text-primary)]"}`}
            >
              Persona Compatibility
            </span>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
          >
            {isRetro ? (
              <span className="text-[var(--color-text-muted)]">[x]</span>
            ) : (
              <X size={16} className="text-[var(--color-text-muted)]" />
            )}
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-3">
          <p
            className={`leading-relaxed ${isRetro ? "text-[var(--color-crt-text)]" : "text-[var(--color-text-secondary)]"}`}
          >
            Switching to <span className="font-semibold">{newModelName}</span>{" "}
            will make {incompatiblePersonas.length} trained persona
            {incompatiblePersonas.length > 1 ? "s" : ""} incompatible. They will
            need to be retrained.
          </p>

          <div
            className={`mt-3 rounded-lg p-3 ${
              isRetro
                ? "border border-[var(--color-border)] bg-[var(--color-surface-secondary)]"
                : "bg-[var(--color-surface)]"
            }`}
          >
            {incompatiblePersonas.map((p) => (
              <div
                key={p.persona_id}
                className={`flex justify-between py-1.5 ${
                  isRetro
                    ? "text-[var(--color-crt-text)]"
                    : "text-[var(--color-text-primary)]"
                }`}
              >
                <span className="font-medium">{p.display_name}</span>
                <span
                  className={`text-[10px] ${isRetro ? "text-crt-text-dim" : "text-[var(--color-text-muted)]"}`}
                >
                  {p.trained_with_model.split("/").pop()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-5 pb-5 pt-2">
          <button
            onClick={onCancel}
            className={`
              px-4 py-2 text-xs transition-colors cursor-pointer
              ${
                isRetro
                  ? "border border-[var(--color-border)] text-[var(--color-crt-text)] hover:bg-[var(--color-surface-secondary)]"
                  : "rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              }
            `}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`
              px-4 py-2 text-xs font-medium transition-colors cursor-pointer
              ${
                isRetro
                  ? "border border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                  : "rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
              }
            `}
          >
            Change Anyway
          </button>
        </div>
      </motion.div>
    </div>
  );
}
