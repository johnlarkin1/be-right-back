/**
 * TrainingSettingsPanel - the "Advanced" section of the training dialog.
 *
 * Starts from the hardware-aware settings for this Mac. Each field shows its
 * recommended value and the backend's bounds.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type { TrainingSettings, TrainingSettingsBounds } from "@/types";

/** Learning rates offered in the picker, low to high. */
const LEARNING_RATES = [
  1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3,
];

/** Sequence lengths offered in the picker. */
const SEQ_LENGTHS = [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096];

type NumericKey = Exclude<keyof TrainingSettings, "early_stopping">;

/** Field-level errors for settings outside the bounds. */
export function validateSettings(
  settings: TrainingSettings,
  bounds: TrainingSettingsBounds,
): Partial<Record<keyof TrainingSettings, string>> {
  const errors: Partial<Record<keyof TrainingSettings, string>> = {};
  const range = (key: NumericKey, min: number, max: number) => {
    const value = settings[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors[key] = `${min}–${max}`;
    }
  };
  range("max_steps", bounds.min_steps, bounds.max_steps);
  range("num_layers", 1, bounds.max_layers);
  range("batch_size", 1, bounds.max_batch_size);
  range("gradient_accumulation_steps", 1, bounds.max_grad_accum);
  range("max_seq_length", bounds.min_seq_length, bounds.max_seq_length);
  range("eval_steps", bounds.min_eval_steps, bounds.max_eval_steps);
  if (!bounds.lora_ranks.includes(settings.lora_rank)) {
    errors.lora_rank = bounds.lora_ranks.join(", ");
  }
  const lr = settings.learning_rate;
  if (
    !Number.isFinite(lr) ||
    lr < bounds.min_learning_rate ||
    lr > bounds.max_learning_rate
  ) {
    errors.learning_rate = `${formatLearningRate(bounds.min_learning_rate)}–${formatLearningRate(bounds.max_learning_rate)}`;
  }
  return errors;
}

/** True when two settings objects hold the same values. */
export function sameSettings(a: TrainingSettings, b: TrainingSettings) {
  return (Object.keys(a) as (keyof TrainingSettings)[]).every(
    (key) => a[key] === b[key],
  );
}

/** Format a learning rate as "1e-5" or "2e-4". */
export function formatLearningRate(lr: number): string {
  const [mantissa, exponent] = lr.toExponential().split("e");
  const m = Number(mantissa);
  return `${Number.isInteger(m) ? m : m.toFixed(1)}e${Number(exponent)}`;
}

interface TrainingSettingsPanelProps {
  settings: TrainingSettings;
  recommended: TrainingSettings;
  bounds: TrainingSettingsBounds;
  isRetro: boolean;
  onChange: (settings: TrainingSettings) => void;
}

export function TrainingSettingsPanel({
  settings,
  recommended,
  bounds,
  isRetro,
  onChange,
}: TrainingSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const font = isRetro ? "font-mono" : "font-[var(--font-body)]";
  const errors = validateSettings(settings, bounds);
  const isCustom = !sameSettings(settings, recommended);

  const set = <K extends keyof TrainingSettings>(
    key: K,
    value: TrainingSettings[K],
  ) => onChange({ ...settings, [key]: value });

  const learningRates = LEARNING_RATES.filter(
    (lr) => lr >= bounds.min_learning_rate && lr <= bounds.max_learning_rate,
  );
  if (!learningRates.includes(settings.learning_rate)) {
    learningRates.push(settings.learning_rate);
    learningRates.sort((a, b) => a - b);
  }
  const seqLengths = SEQ_LENGTHS.filter(
    (n) => n >= bounds.min_seq_length && n <= bounds.max_seq_length,
  );
  if (!seqLengths.includes(settings.max_seq_length)) {
    seqLengths.push(settings.max_seq_length);
    seqLengths.sort((a, b) => a - b);
  }

  return (
    <div
      className={`
        border border-[var(--color-border)]
        ${isRetro ? "rounded-sm" : "rounded-xl"}
      `}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`
          w-full flex items-center gap-2 px-4 py-2.5 text-sm
          text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
          transition-colors ${font}
        `}
      >
        {isRetro ? (
          <span className="text-[var(--color-accent)]">
            {open ? "[-]" : "[+]"}
          </span>
        ) : open ? (
          <ChevronDown size={16} />
        ) : (
          <ChevronRight size={16} />
        )}
        <span>{isRetro ? "advanced settings" : "Advanced settings"}</span>
        <span
          className={`
            ml-auto text-xs
            ${isCustom ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}
          `}
        >
          {isCustom ? "Custom" : "Recommended for this Mac"}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <NumberField
              label="Steps"
              value={settings.max_steps}
              min={bounds.min_steps}
              max={bounds.max_steps}
              step={10}
              recommended={recommended.max_steps}
              error={errors.max_steps}
              isRetro={isRetro}
              onChange={(v) => set("max_steps", v)}
            />
            <SelectField
              label="Learning rate"
              value={settings.learning_rate}
              options={learningRates.map((lr) => ({
                value: lr,
                label: formatLearningRate(lr),
              }))}
              recommended={formatLearningRate(recommended.learning_rate)}
              error={errors.learning_rate}
              isRetro={isRetro}
              onChange={(v) => set("learning_rate", v)}
            />
            <SelectField
              label="LoRA rank"
              value={settings.lora_rank}
              options={bounds.lora_ranks.map((r) => ({
                value: r,
                label: String(r),
              }))}
              recommended={String(recommended.lora_rank)}
              error={errors.lora_rank}
              isRetro={isRetro}
              onChange={(v) => set("lora_rank", v)}
            />
            <NumberField
              label={`Layers (of ${bounds.max_layers})`}
              value={settings.num_layers}
              min={1}
              max={bounds.max_layers}
              recommended={recommended.num_layers}
              error={errors.num_layers}
              isRetro={isRetro}
              onChange={(v) => set("num_layers", v)}
            />
            <NumberField
              label="Batch size"
              value={settings.batch_size}
              min={1}
              max={bounds.max_batch_size}
              recommended={recommended.batch_size}
              error={errors.batch_size}
              isRetro={isRetro}
              onChange={(v) => set("batch_size", v)}
            />
            <NumberField
              label="Grad accumulation"
              value={settings.gradient_accumulation_steps}
              min={1}
              max={bounds.max_grad_accum}
              recommended={recommended.gradient_accumulation_steps}
              error={errors.gradient_accumulation_steps}
              isRetro={isRetro}
              onChange={(v) => set("gradient_accumulation_steps", v)}
            />
            <SelectField
              label="Max tokens"
              value={settings.max_seq_length}
              options={seqLengths.map((n) => ({
                value: n,
                label: n.toLocaleString(),
              }))}
              recommended={recommended.max_seq_length.toLocaleString()}
              error={errors.max_seq_length}
              isRetro={isRetro}
              onChange={(v) => set("max_seq_length", v)}
            />
            <NumberField
              label="Validate every"
              value={settings.eval_steps}
              min={bounds.min_eval_steps}
              max={bounds.max_eval_steps}
              step={10}
              suffix="steps"
              recommended={recommended.eval_steps}
              error={errors.eval_steps}
              isRetro={isRetro}
              onChange={(v) => set("eval_steps", v)}
            />
          </div>

          <label
            className={`flex items-start gap-2 text-sm text-[var(--color-text-primary)] ${font}`}
          >
            <input
              type="checkbox"
              checked={settings.early_stopping}
              onChange={(e) => set("early_stopping", e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              Stop early when validation loss stalls
              <span className="block text-xs text-[var(--color-text-muted)]">
                Ends the run after 3 validation passes without improvement.
              </span>
            </span>
          </label>

          <div
            className={`flex items-center justify-between text-xs text-[var(--color-text-muted)] ${font}`}
          >
            <span>
              Effective batch{" "}
              <span className="tabular-nums text-[var(--color-text-primary)]">
                {settings.batch_size * settings.gradient_accumulation_steps}
              </span>
              {" · "}LoRA alpha{" "}
              <span className="tabular-nums text-[var(--color-text-primary)]">
                {settings.lora_rank * 2}
              </span>
            </span>
            {isCustom && (
              <button
                type="button"
                onClick={() => onChange(recommended)}
                className="flex items-center gap-1 hover:text-[var(--color-text-primary)] transition-colors"
              >
                {isRetro ? "[reset]" : <RotateCcw size={12} />}
                {!isRetro && "Reset to recommended"}
              </button>
            )}
          </div>

          <p className={`text-xs text-[var(--color-text-muted)] ${font}`}>
            Bigger batches, more tokens, and more layers use more memory. If
            training runs out of memory, lower them first.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Fields
// ============================================

function fieldClasses(isRetro: boolean, hasError: boolean) {
  return `
    w-full px-2.5 py-1.5 text-sm tabular-nums
    bg-[var(--color-surface)] text-[var(--color-text-primary)]
    border ${hasError ? "border-[var(--color-error)]" : "border-[var(--color-border)]"}
    focus:outline-none focus:border-[var(--color-accent)]
    ${isRetro ? "font-mono rounded-sm" : "font-[var(--font-body)] rounded-lg"}
  `;
}

function FieldShell({
  label,
  hint,
  error,
  isRetro,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  isRetro: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = `training-setting-${label.toLowerCase().replace(/\W+/g, "-")}`;
  const font = isRetro ? "font-mono" : "font-[var(--font-body)]";
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className={`block text-xs text-[var(--color-text-secondary)] ${font}`}
      >
        {label}
      </label>
      {children(id)}
      <p
        className={`text-[11px] ${error ? "text-[var(--color-error)]" : "text-[var(--color-text-muted)]"} ${font}`}
      >
        {error ? `Allowed: ${error}` : hint}
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  recommended,
  error,
  isRetro,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  recommended: number;
  error?: string;
  isRetro: boolean;
  onChange: (value: number) => void;
}) {
  // Keep the typed text so a half-typed number is not overwritten.
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (Number(text) !== value) setText(String(value));
  }

  return (
    <FieldShell
      label={label}
      hint={`Recommended: ${recommended.toLocaleString()}${suffix ? ` ${suffix}` : ""}`}
      error={error}
      isRetro={isRetro}
    >
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const parsed = Number(e.target.value);
            onChange(e.target.value === "" ? NaN : parsed);
          }}
          onBlur={() => {
            if (!Number.isFinite(value)) return;
            const clamped = Math.min(max, Math.max(min, Math.round(value)));
            if (clamped !== value) onChange(clamped);
            setText(String(clamped));
          }}
          className={fieldClasses(isRetro, Boolean(error))}
        />
      )}
    </FieldShell>
  );
}

function SelectField({
  label,
  value,
  options,
  recommended,
  error,
  isRetro,
  onChange,
}: {
  label: string;
  value: number;
  options: { value: number; label: string }[];
  recommended: string;
  error?: string;
  isRetro: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <FieldShell
      label={label}
      hint={`Recommended: ${recommended}`}
      error={error}
      isRetro={isRetro}
    >
      {(id) => (
        <select
          id={id}
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className={fieldClasses(isRetro, Boolean(error))}
        >
          {options.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}
