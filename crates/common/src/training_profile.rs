//! Hardware-aware training profiles for per-contact LoRA fine-tuning.
//!
//! On-device fine-tuning has to run on whatever Mac the user happens to own —
//! from an 8GB M1 Air up to a 128GB M3 Max. The model *tier* already adapts to
//! available memory (see [`crate::model_tiers`]), but the training
//! *hyperparameters* (LoRA rank, sequence length, how many layers to adapt, how
//! many steps to run) were historically fixed. That meant an 8GB machine ran the
//! exact same training intensity as a 64GB workstation — risking memory pressure
//! and swapping, and wasting time over-training on contacts with little data.
//!
//! [`TrainingProfile`] closes that gap. Given the selected model tier, the
//! machine's memory, and the number of training examples a contact actually has,
//! it derives a balanced configuration that:
//!
//! - keeps peak memory within budget (smaller `max_seq_length`, fewer adapted
//!   layers, conservative batch on low-memory machines),
//! - adapts only the top-N transformer layers — the layers that most influence
//!   surface texting *style*, which is exactly what a persona needs — cutting
//!   trainable parameters, optimizer state, and wall-clock time, and
//! - scales the step count to the available data so small contacts finish quickly
//!   without over-fitting and large contacts still get enough passes.
//!
//! The profile also produces a realistic time estimate so the UI can tell the
//! user what to expect on *their* hardware instead of a one-size-fits-all guess.

use crate::model_tiers::ModelTier;

/// Minimum unified memory (GB) required to run on-device LoRA training.
///
/// This is a **best-effort** floor, not a guarantee of headroom: an 8GB Mac runs
/// the smallest (0.8B) model at the shortest sequence length, but macOS +
/// WindowServer + the app itself routinely sit at 3-4GB resident, so an 8GB
/// machine can still see memory pressure near the edge. We refuse anything below
/// this outright (rather than thrashing swap) and let 8GB run with the most
/// conservative profile. Revisit upward if field reports show 8GB swapping.
pub const MIN_TRAINING_MEMORY_GB: u64 = 8;

/// Effective examples consumed per optimizer step is `batch_size * grad_accum`.
/// We target roughly this many passes over the data, clamped by the tier cap.
const TARGET_EPOCHS: f32 = 4.0;

/// Hard ceiling on passes over the data. The [`MIN_STEPS`] floor below would,
/// on a very small contact, imply dozens of epochs and severe over-fitting — and
/// the validation split is too small for early stopping to catch it. This caps
/// total epochs so the floor relaxes for tiny datasets.
const MAX_EPOCHS: f32 = 10.0;

/// Never run fewer than this many steps — below this a LoRA adapter barely moves
/// off the base model — *unless* honoring it would exceed [`MAX_EPOCHS`] on a
/// small dataset, in which case the epoch ceiling wins (see [`scale_steps`]).
const MIN_STEPS: usize = 120;

/// Below this many exported examples, a persona is trained on thin data and is
/// more likely to over-fit and sound less natural. Used to surface an honest
/// "limited history" warning in the training plan (not a hard gate).
pub const MIN_RECOMMENDED_EXAMPLES: usize = 100;

/// Learning rate every profile starts with. Matches the trainer's default.
pub const DEFAULT_LEARNING_RATE: f64 = 1e-5;

/// Validation cadence every profile starts with. Matches the trainer's default.
pub const DEFAULT_EVAL_STEPS: usize = 50;

/// Training settings a user can change in the training dialog's Advanced panel.
///
/// Every field is concrete. The UI starts from [`TrainingProfile::settings`],
/// edits fields, and sends the whole struct back.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TrainingSettings {
    pub max_steps: usize,
    pub learning_rate: f64,
    pub lora_rank: usize,
    /// Top layers to adapt. Equal to the tier's depth means all layers.
    pub num_layers: usize,
    pub batch_size: usize,
    pub gradient_accumulation_steps: usize,
    pub max_seq_length: usize,
    pub eval_steps: usize,
    pub early_stopping: bool,
}

/// Allowed ranges for [`TrainingSettings`]. The UI reads these to bound its
/// inputs; `with_settings` enforces them.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TrainingSettingsBounds {
    pub min_steps: usize,
    pub max_steps: usize,
    pub min_learning_rate: f64,
    pub max_learning_rate: f64,
    pub lora_ranks: Vec<usize>,
    pub max_layers: usize,
    pub max_batch_size: usize,
    pub max_grad_accum: usize,
    pub min_seq_length: usize,
    pub max_seq_length: usize,
    pub min_eval_steps: usize,
    pub max_eval_steps: usize,
}

impl TrainingSettings {
    /// Bounds for a tier. Only the layer count depends on the tier.
    pub fn bounds(tier: &ModelTier) -> TrainingSettingsBounds {
        TrainingSettingsBounds {
            min_steps: 1,
            max_steps: 3000,
            min_learning_rate: 1e-6,
            max_learning_rate: 1e-3,
            lora_ranks: vec![4, 8, 16, 32, 64],
            max_layers: tier.num_layers,
            max_batch_size: 8,
            max_grad_accum: 16,
            min_seq_length: 256,
            max_seq_length: 4096,
            min_eval_steps: 10,
            max_eval_steps: 1000,
        }
    }

    /// Check every field against [`Self::bounds`]. The error names the field.
    pub fn validate(&self, tier: &ModelTier) -> Result<(), String> {
        let b = Self::bounds(tier);
        let check = |name: &str, value: usize, min: usize, max: usize| {
            if (min..=max).contains(&value) {
                Ok(())
            } else {
                Err(format!("{name} must be between {min} and {max}, got {value}"))
            }
        };
        check("Steps", self.max_steps, b.min_steps, b.max_steps)?;
        check("Layers", self.num_layers, 1, b.max_layers)?;
        check("Batch size", self.batch_size, 1, b.max_batch_size)?;
        check(
            "Gradient accumulation",
            self.gradient_accumulation_steps,
            1,
            b.max_grad_accum,
        )?;
        check(
            "Sequence length",
            self.max_seq_length,
            b.min_seq_length,
            b.max_seq_length,
        )?;
        check(
            "Validation interval",
            self.eval_steps,
            b.min_eval_steps,
            b.max_eval_steps,
        )?;
        if !b.lora_ranks.contains(&self.lora_rank) {
            return Err(format!(
                "LoRA rank must be one of {:?}, got {}",
                b.lora_ranks, self.lora_rank
            ));
        }
        if !(self.learning_rate.is_finite()
            && self.learning_rate >= b.min_learning_rate
            && self.learning_rate <= b.max_learning_rate)
        {
            return Err(format!(
                "Learning rate must be between {:e} and {:e}, got {}",
                b.min_learning_rate, b.max_learning_rate, self.learning_rate
            ));
        }
        Ok(())
    }
}

/// Per-tier training preset. Captures the levers that trade memory/time against
/// adapter quality. `layer_fraction` is the share of transformer layers (from the
/// top) that receive LoRA adapters; `None` means all layers.
///
/// Note on `layer_fraction < 1.0`: prior to adaptive profiles the trainer always
/// adapted *all* layers. Adapting only the top half on the larger tiers (9B/4B)
/// is the main wall-clock/memory win here, and the top layers carry the most
/// surface-style signal — but at a fixed rank it does reduce representational
/// capacity vs. the old all-layer default, so a retrained persona will differ.
/// This is an accepted speed/quality tradeoff pending the persona-fidelity gate
/// in issue #228, which would validate the chosen fraction against all-layer
/// baselines. Until then `0.5` is a deliberate, conservative-leaning default, not
/// a tuned value.
#[derive(Debug, Clone, Copy)]
struct TierPreset {
    lora_rank: usize,
    lora_alpha: usize,
    max_seq_length: usize,
    batch_size: usize,
    gradient_accumulation_steps: usize,
    /// Fraction of layers (from the top) to adapt. `None` = all layers.
    layer_fraction: Option<f32>,
    /// Upper bound on optimizer steps for this tier (large models are slower per
    /// step and learn faster per step, so they get a lower cap to bound wall-clock).
    step_cap: usize,
    /// Estimated seconds per training step, low/high, for this tier at the
    /// preset's sequence length. Used to produce the UI time estimate.
    secs_per_step_low: f32,
    secs_per_step_high: f32,
    /// Fixed overhead in seconds (model load + export tail).
    overhead_secs_low: f32,
    overhead_secs_high: f32,
}

/// Look up the preset for a tier by name. Falls back to the smallest preset for
/// unknown tier names (defensive — `MODEL_TIERS` names are exhaustive today).
fn preset_for_tier(tier_name: &str) -> TierPreset {
    match tier_name {
        // 24GB+ machines. Largest model; adapt only the top half of layers to keep
        // wall-clock reasonable — top layers carry the most style signal.
        "9b" => TierPreset {
            lora_rank: 16,
            lora_alpha: 32,
            max_seq_length: 1024,
            batch_size: 1,
            gradient_accumulation_steps: 4,
            layer_fraction: Some(0.5),
            step_cap: 500,
            secs_per_step_low: 1.4,
            secs_per_step_high: 3.0,
            overhead_secs_low: 90.0,
            overhead_secs_high: 180.0,
        },
        // 16GB machines. Comfortable for the 4B model; adapt top half for speed.
        "4b" => TierPreset {
            lora_rank: 16,
            lora_alpha: 32,
            max_seq_length: 1024,
            batch_size: 1,
            gradient_accumulation_steps: 4,
            layer_fraction: Some(0.5),
            step_cap: 500,
            secs_per_step_low: 0.7,
            secs_per_step_high: 1.6,
            overhead_secs_low: 60.0,
            overhead_secs_high: 150.0,
        },
        // 12GB machines. Trim sequence length and rank to stay within budget; the
        // 2B model is fast enough to adapt all layers.
        "2b" => TierPreset {
            lora_rank: 8,
            lora_alpha: 16,
            max_seq_length: 768,
            batch_size: 1,
            gradient_accumulation_steps: 4,
            layer_fraction: None,
            step_cap: 400,
            secs_per_step_low: 0.4,
            secs_per_step_high: 0.9,
            overhead_secs_low: 45.0,
            overhead_secs_high: 120.0,
        },
        // 8GB machines (fallback tier). Most memory-constrained: short sequences,
        // small rank, conservative steps. The 0.8B model is tiny so all layers are
        // affordable and keep quality acceptable.
        _ => TierPreset {
            lora_rank: 8,
            lora_alpha: 16,
            max_seq_length: 512,
            batch_size: 1,
            gradient_accumulation_steps: 4,
            layer_fraction: None,
            step_cap: 350,
            secs_per_step_low: 0.25,
            secs_per_step_high: 0.6,
            overhead_secs_low: 40.0,
            overhead_secs_high: 100.0,
        },
    }
}

/// Adaptive LoRA fine-tuning configuration for one training run on this machine.
///
/// Produced by [`TrainingProfile::recommend`]. All numeric fields are passed
/// straight through to the Python trainer; the estimate fields drive UI copy.
#[derive(Debug, Clone, PartialEq)]
pub struct TrainingProfile {
    /// LoRA rank (size of the low-rank update matrices).
    pub lora_rank: usize,
    /// LoRA alpha (scaling; the trainer uses `alpha / rank` as the scale).
    pub lora_alpha: usize,
    /// Maximum tokens per training sequence. Lower = less activation memory.
    pub max_seq_length: usize,
    /// Number of top transformer layers to adapt. `None` = all layers.
    pub num_layers: Option<usize>,
    /// Micro-batch size (kept at 1 on consumer hardware to bound peak memory).
    pub batch_size: usize,
    /// Gradient accumulation steps; effective batch = `batch_size * this`.
    pub gradient_accumulation_steps: usize,
    /// Optimizer steps to run, scaled to data volume and capped per tier.
    pub max_steps: usize,
    /// AdamW learning rate.
    pub learning_rate: f64,
    /// Run a validation pass every this many steps.
    pub eval_steps: usize,
    /// Stop when validation loss stops improving.
    pub early_stopping: bool,
    /// Low end of the estimated wall-clock, in whole minutes.
    pub est_minutes_low: u32,
    /// High end of the estimated wall-clock, in whole minutes.
    pub est_minutes_high: u32,
    /// Tier this profile was built for (e.g. `"9b"`, `"0.8b"`). For UI/telemetry.
    pub tier_name: &'static str,
    /// Total system memory detected, in GB. For UI/telemetry.
    pub system_memory_gb: u64,
}

impl TrainingProfile {
    /// Recommend a profile for an explicit tier, memory size, and example count.
    ///
    /// `num_examples` is the number of exported training examples for the contact
    /// (the trainer further splits this 90/10 into train/validation). When the
    /// count is not yet known (e.g. for a pre-export UI estimate), pass a
    /// conservative estimate — see [`estimate_examples_from_messages`].
    pub fn recommend(tier: &ModelTier, system_memory_gb: u64, num_examples: usize) -> Self {
        let preset = preset_for_tier(tier.name);

        let num_layers = preset.layer_fraction.map(|frac| {
            // Adapt at least one layer; round to nearest, clamp to the tier's depth.
            let n = (tier.num_layers as f32 * frac).round() as usize;
            n.clamp(1, tier.num_layers)
        });

        let max_steps = scale_steps(num_examples, &preset);

        let (est_minutes_low, est_minutes_high) = estimate_minutes(max_steps, &preset, 1.0);

        Self {
            lora_rank: preset.lora_rank,
            lora_alpha: preset.lora_alpha,
            max_seq_length: preset.max_seq_length,
            num_layers,
            batch_size: preset.batch_size,
            gradient_accumulation_steps: preset.gradient_accumulation_steps,
            max_steps,
            learning_rate: DEFAULT_LEARNING_RATE,
            eval_steps: DEFAULT_EVAL_STEPS,
            early_stopping: true,
            est_minutes_low,
            est_minutes_high,
            tier_name: tier.name,
            system_memory_gb,
        }
    }

    /// The profile's values as user-facing settings. `num_layers` is concrete:
    /// "all layers" becomes the tier's depth.
    pub fn settings(&self, tier: &ModelTier) -> TrainingSettings {
        TrainingSettings {
            max_steps: self.max_steps,
            learning_rate: self.learning_rate,
            lora_rank: self.lora_rank,
            num_layers: self.num_layers.unwrap_or(tier.num_layers),
            batch_size: self.batch_size,
            gradient_accumulation_steps: self.gradient_accumulation_steps,
            max_seq_length: self.max_seq_length,
            eval_steps: self.eval_steps,
            early_stopping: self.early_stopping,
        }
    }

    /// Replace the profile's values with user settings from the Advanced panel.
    ///
    /// Rejects values outside [`TrainingSettings::bounds`]. LoRA alpha follows
    /// the rank at 2x, the same scale every preset uses. The time estimate is
    /// recomputed for the new step count and effective batch.
    pub fn with_settings(mut self, tier: &ModelTier, settings: &TrainingSettings) -> Result<Self, String> {
        settings.validate(tier)?;
        let preset = preset_for_tier(tier.name);

        self.max_steps = settings.max_steps;
        self.learning_rate = settings.learning_rate;
        self.lora_rank = settings.lora_rank;
        self.lora_alpha = settings.lora_rank * 2;
        self.num_layers = (settings.num_layers < tier.num_layers).then_some(settings.num_layers);
        self.batch_size = settings.batch_size;
        self.gradient_accumulation_steps = settings.gradient_accumulation_steps;
        self.max_seq_length = settings.max_seq_length;
        self.eval_steps = settings.eval_steps;
        self.early_stopping = settings.early_stopping;

        // A step costs roughly in proportion to the examples it processes.
        let preset_batch = (preset.batch_size * preset.gradient_accumulation_steps) as f32;
        let batch = (settings.batch_size * settings.gradient_accumulation_steps) as f32;
        let (low, high) = estimate_minutes(settings.max_steps, &preset, batch / preset_batch);
        self.est_minutes_low = low;
        self.est_minutes_high = high;
        Ok(self)
    }

    /// Whether this machine has enough memory to train on-device at all.
    pub fn meets_minimum_memory(system_memory_gb: u64) -> bool {
        system_memory_gb >= MIN_TRAINING_MEMORY_GB
    }
}

/// Scale the optimizer step count to the amount of training data.
///
/// Aims for ~[`TARGET_EPOCHS`] passes over the data given the effective batch
/// size, clamped to `[MIN_STEPS, preset.step_cap]`. Early stopping (handled in
/// the Python trainer) can still terminate sooner once validation loss plateaus.
fn scale_steps(num_examples: usize, preset: &TierPreset) -> usize {
    let effective_batch = (preset.batch_size * preset.gradient_accumulation_steps).max(1) as f32;
    // 90% of examples go to training (the rest to validation).
    let train_examples = ((num_examples as f32) * 0.9).max(1.0);
    let desired = (train_examples * TARGET_EPOCHS / effective_batch).round() as usize;
    // Epoch-bounded ceiling: never train past MAX_EPOCHS over the data. For
    // normal/large datasets this is far above MIN_STEPS and never binds; for tiny
    // contacts it relaxes the floor so we don't over-fit by running MIN_STEPS
    // steps over a handful of examples.
    let overfit_ceiling = (train_examples * MAX_EPOCHS / effective_batch).round().max(1.0) as usize;
    let floor = MIN_STEPS.min(overfit_ceiling);
    desired.clamp(floor, preset.step_cap)
}

/// Convert a step count + tier timing into a low/high minute estimate.
/// `step_scale` multiplies the preset's per-step cost (1.0 = preset batch).
fn estimate_minutes(max_steps: usize, preset: &TierPreset, step_scale: f32) -> (u32, u32) {
    let steps = max_steps as f32 * step_scale;
    let low_secs = steps * preset.secs_per_step_low + preset.overhead_secs_low;
    let high_secs = steps * preset.secs_per_step_high + preset.overhead_secs_high;
    // Round to whole minutes; never report below 1 minute, and keep high > low.
    let low = (low_secs / 60.0).round().max(1.0) as u32;
    let high = ((high_secs / 60.0).ceil() as u32).max(low + 1);
    (low, high)
}

/// Rough estimate of how many training examples a contact with `message_count`
/// messages will yield, for pre-export UI estimates only.
///
/// The exporter only turns question-initiated, multi-turn conversation windows
/// into examples (see the `training` crate), so the realized ratio is well below
/// 1:1. We use a conservative fraction and clamp to a sane floor so the UI never
/// shows a wildly optimistic step/time estimate. The *actual* profile used for
/// training is always recomputed from the real exported example count.
pub fn estimate_examples_from_messages(message_count: usize) -> usize {
    // Empirically ~12-18% of messages become example windows; use 15%.
    ((message_count as f32) * 0.15).round() as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_tiers::get_tier_by_name;

    fn tier(name: &str) -> &'static ModelTier {
        get_tier_by_name(name).expect("known tier")
    }

    #[test]
    fn low_end_machine_gets_conservative_profile() {
        // 8GB Mac -> 0.8B tier.
        let p = TrainingProfile::recommend(tier("0.8b"), 8, 2000);
        assert_eq!(p.max_seq_length, 512, "8GB should use short sequences");
        assert_eq!(p.lora_rank, 8, "8GB should use small rank");
        assert_eq!(p.batch_size, 1);
        assert!(p.max_steps <= 350, "8GB step cap");
        assert_eq!(p.tier_name, "0.8b");
    }

    #[test]
    fn high_end_machine_gets_richer_profile() {
        // 24GB Mac -> 9B tier.
        let p = TrainingProfile::recommend(tier("9b"), 24, 5000);
        assert_eq!(p.max_seq_length, 1024);
        assert_eq!(p.lora_rank, 16);
        // Top-half layer adaptation: 32 layers -> 16.
        assert_eq!(p.num_layers, Some(16));
        assert!(p.max_steps <= 500);
    }

    #[test]
    fn steps_scale_with_data_volume() {
        // Tiny contact -> the epoch ceiling relaxes the floor below MIN_STEPS so
        // we don't over-fit (see tiny_contact_does_not_overtrain).
        let small = TrainingProfile::recommend(tier("4b"), 16, 10);
        assert!(small.max_steps < MIN_STEPS);

        // Large contact -> capped at the tier ceiling.
        let large = TrainingProfile::recommend(tier("4b"), 16, 100_000);
        assert_eq!(large.max_steps, 500);

        // Mid-size contact -> somewhere in between and monotonic. A 400-example
        // contact has enough data that the normal MIN_STEPS floor applies.
        let mid = TrainingProfile::recommend(tier("4b"), 16, 400);
        assert!(mid.max_steps >= MIN_STEPS);
        assert!(mid.max_steps >= small.max_steps && mid.max_steps <= large.max_steps);
    }

    #[test]
    fn tiny_contact_does_not_overtrain() {
        // 10 examples -> 9 training. Honoring MIN_STEPS (120) would be ~53 epochs;
        // the epoch ceiling must keep us at/under MAX_EPOCHS.
        let p = TrainingProfile::recommend(tier("4b"), 16, 10);
        let train_examples = (10.0_f32 * 0.9).max(1.0);
        let effective_batch = 4.0_f32;
        let epochs = p.max_steps as f32 * effective_batch / train_examples;
        assert!(
            epochs <= MAX_EPOCHS + 1.0,
            "tiny contact trained ~{epochs} epochs ({} steps)",
            p.max_steps
        );
        assert!(p.max_steps >= 1, "still runs at least one step");
    }

    #[test]
    fn num_layers_never_exceeds_tier_depth() {
        for name in ["9b", "4b", "2b", "0.8b"] {
            let t = tier(name);
            let p = TrainingProfile::recommend(t, 16, 1000);
            if let Some(n) = p.num_layers {
                assert!(n >= 1 && n <= t.num_layers, "{name}: {n} vs {}", t.num_layers);
            }
        }
    }

    #[test]
    fn time_estimate_is_ordered_and_positive() {
        for name in ["9b", "4b", "2b", "0.8b"] {
            let p = TrainingProfile::recommend(tier(name), 16, 3000);
            assert!(p.est_minutes_low >= 1);
            assert!(
                p.est_minutes_high > p.est_minutes_low,
                "{name}: {:?}",
                (p.est_minutes_low, p.est_minutes_high)
            );
        }
    }

    #[test]
    fn larger_models_estimate_longer_than_smaller() {
        // Same data; bigger tier should not estimate *less* time at its cap.
        let big = TrainingProfile::recommend(tier("9b"), 24, 50_000);
        let small = TrainingProfile::recommend(tier("0.8b"), 8, 50_000);
        assert!(big.est_minutes_high >= small.est_minutes_high);
    }

    #[test]
    fn minimum_memory_gate() {
        assert!(!TrainingProfile::meets_minimum_memory(4));
        assert!(!TrainingProfile::meets_minimum_memory(7));
        assert!(TrainingProfile::meets_minimum_memory(8));
        assert!(TrainingProfile::meets_minimum_memory(64));
    }

    #[test]
    fn example_estimate_is_conservative() {
        assert_eq!(estimate_examples_from_messages(0), 0);
        assert_eq!(estimate_examples_from_messages(1000), 150);
        assert!(estimate_examples_from_messages(10_000) < 10_000);
    }

    #[test]
    fn effective_batch_is_consistent() {
        // Effective batch (batch_size * grad_accum) should be 4 on every tier so
        // gradient signal is comparable across hardware.
        for name in ["9b", "4b", "2b", "0.8b"] {
            let p = TrainingProfile::recommend(tier(name), 16, 1000);
            assert_eq!(p.batch_size * p.gradient_accumulation_steps, 4, "tier {name}");
        }
    }

    #[test]
    fn settings_round_trip_keeps_the_profile() {
        let t = tier("9b");
        let p = TrainingProfile::recommend(t, 48, 5000);
        let settings = p.settings(t);
        assert_eq!(settings.num_layers, 16);
        assert_eq!(settings.learning_rate, DEFAULT_LEARNING_RATE);
        let same = p.clone().with_settings(t, &settings).expect("defaults are in bounds");
        assert_eq!(same, p);
    }

    #[test]
    fn with_settings_applies_user_values() {
        let t = tier("4b");
        let p = TrainingProfile::recommend(t, 16, 5000);
        let mut settings = p.settings(t);
        settings.max_steps = 1200;
        settings.lora_rank = 32;
        settings.num_layers = t.num_layers;
        settings.early_stopping = false;
        let custom = p.clone().with_settings(t, &settings).unwrap();
        assert_eq!(custom.max_steps, 1200);
        assert_eq!(custom.lora_alpha, 64, "alpha follows rank at 2x");
        assert_eq!(custom.num_layers, None, "full depth means all layers");
        assert!(!custom.early_stopping);
        assert!(custom.est_minutes_high > p.est_minutes_high, "more steps take longer");
    }

    #[test]
    fn bigger_batch_estimates_longer() {
        let t = tier("4b");
        let p = TrainingProfile::recommend(t, 16, 5000);
        let mut settings = p.settings(t);
        settings.batch_size = 4;
        let custom = p.clone().with_settings(t, &settings).unwrap();
        assert!(custom.est_minutes_low > p.est_minutes_low);
    }

    #[test]
    fn with_settings_rejects_out_of_bounds() {
        let t = tier("2b");
        let p = TrainingProfile::recommend(t, 12, 1000);
        let base = p.settings(t);
        let cases: Vec<(&str, TrainingSettings)> = vec![
            (
                "Steps",
                TrainingSettings {
                    max_steps: 0,
                    ..base.clone()
                },
            ),
            (
                "Layers",
                TrainingSettings {
                    num_layers: t.num_layers + 1,
                    ..base.clone()
                },
            ),
            (
                "LoRA rank",
                TrainingSettings {
                    lora_rank: 12,
                    ..base.clone()
                },
            ),
            (
                "Learning rate",
                TrainingSettings {
                    learning_rate: 0.5,
                    ..base.clone()
                },
            ),
            (
                "Learning rate",
                TrainingSettings {
                    learning_rate: f64::NAN,
                    ..base.clone()
                },
            ),
            (
                "Batch size",
                TrainingSettings {
                    batch_size: 0,
                    ..base.clone()
                },
            ),
            (
                "Validation interval",
                TrainingSettings {
                    eval_steps: 5,
                    ..base.clone()
                },
            ),
        ];
        for (field, settings) in cases {
            let err = p.clone().with_settings(t, &settings).unwrap_err();
            assert!(err.starts_with(field), "{field}: {err}");
        }
    }

    #[test]
    fn every_recommended_profile_is_in_bounds() {
        for name in ["9b", "4b", "2b", "0.8b"] {
            let t = tier(name);
            for examples in [10, 1000, 100_000] {
                let p = TrainingProfile::recommend(t, 16, examples);
                p.settings(t)
                    .validate(t)
                    .unwrap_or_else(|e| panic!("{name}/{examples}: {e}"));
            }
        }
    }
}
