//! Model tier system for dynamic VRAM-based model selection.
//!
//! Qwen3.5 uses a hybrid DeltaNet + Attention architecture. Models are available
//! in multiple sizes (9B, 4B, 2B, 0.8B) with 8-bit and 4-bit quantizations.
//! This module selects the optimal tier based on available system memory.

use std::process::Command;

/// Quantization level for a model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Quantization {
    /// 4-bit quantization (smaller, faster, default)
    #[default]
    Q4,
    /// 8-bit quantization (higher quality, ~2x size)
    Q8,
}

impl Quantization {
    /// Parse from string ("4bit" or "8bit"). Returns None for invalid input.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "4bit" => Some(Self::Q4),
            "8bit" => Some(Self::Q8),
            _ => None,
        }
    }

    /// String representation for persistence.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Q4 => "4bit",
            Self::Q8 => "8bit",
        }
    }

    /// Display label for UI.
    pub fn display_label(&self) -> &'static str {
        match self {
            Self::Q4 => "4-bit (faster, smaller)",
            Self::Q8 => "8-bit (higher quality)",
        }
    }
}

/// A model tier representing a specific Qwen3.5 model size.
#[derive(Debug, Clone)]
pub struct ModelTier {
    /// Short name: "9b", "4b", "2b", "0.8b"
    pub name: &'static str,
    /// Display name for UI: "Qwen3.5-9B", etc.
    pub display_name: &'static str,
    /// 8-bit quantized model ID (higher quality, used for personas)
    pub model_8bit: &'static str,
    /// 4-bit quantized model ID (faster, used for agent)
    pub model_4bit: &'static str,
    /// Minimum system memory (GB) to use this tier
    pub min_memory_gb: u64,
    /// Approximate size of 8-bit model in GB
    pub approx_size_8bit_gb: f32,
    /// Approximate size of 4-bit model in GB
    pub approx_size_4bit_gb: f32,
    /// Number of transformer layers
    pub num_layers: usize,
}

/// All available model tiers, ordered from largest to smallest.
pub const MODEL_TIERS: &[ModelTier] = &[
    ModelTier {
        name: "9b",
        display_name: "Qwen3.5-9B",
        model_8bit: "mlx-community/Qwen3.5-9B-8bit",
        model_4bit: "mlx-community/Qwen3.5-9B-4bit",
        min_memory_gb: 19,
        approx_size_8bit_gb: 10.4,
        approx_size_4bit_gb: 5.95,
        num_layers: 32,
    },
    ModelTier {
        name: "4b",
        display_name: "Qwen3.5-4B",
        model_8bit: "mlx-community/Qwen3.5-4B-8bit",
        model_4bit: "mlx-community/Qwen3.5-4B-4bit",
        min_memory_gb: 11,
        approx_size_8bit_gb: 4.5,
        approx_size_4bit_gb: 2.5,
        num_layers: 32,
    },
    ModelTier {
        name: "2b",
        display_name: "Qwen3.5-2B",
        model_8bit: "mlx-community/Qwen3.5-2B-8bit",
        model_4bit: "mlx-community/Qwen3.5-2B-4bit",
        min_memory_gb: 7,
        approx_size_8bit_gb: 2.5,
        approx_size_4bit_gb: 1.5,
        num_layers: 24,
    },
    ModelTier {
        name: "0.8b",
        display_name: "Qwen3.5-0.8B",
        model_8bit: "mlx-community/Qwen3.5-0.8B-8bit",
        model_4bit: "mlx-community/Qwen3.5-0.8B-4bit",
        min_memory_gb: 4,
        approx_size_8bit_gb: 1.0,
        approx_size_4bit_gb: 0.6,
        num_layers: 24,
    },
];

impl ModelTier {
    /// Get the model ID for the given quantization level.
    pub fn model_for_quantization(&self, quant: Quantization) -> &'static str {
        match quant {
            Quantization::Q4 => self.model_4bit,
            Quantization::Q8 => self.model_8bit,
        }
    }

    /// Get the approximate model size in GB for the given quantization.
    pub fn size_for_quantization(&self, quant: Quantization) -> f32 {
        match quant {
            Quantization::Q4 => self.approx_size_4bit_gb,
            Quantization::Q8 => self.approx_size_8bit_gb,
        }
    }

    /// Check if a given amount of available memory (after 5GB overhead) can run
    /// this tier at the given quantization.
    pub fn fits_in_memory(&self, available_memory_gb: u64, quant: Quantization) -> bool {
        let size = self.size_for_quantization(quant);
        (available_memory_gb as f32) >= size
    }

    /// Speed label for UI display.
    pub fn speed_label(&self) -> &'static str {
        match self.name {
            "0.8b" => "Fastest",
            "2b" => "Fast",
            "4b" => "Balanced",
            "9b" => "Best Quality",
            _ => "Unknown",
        }
    }

    /// Quality label for UI display.
    pub fn quality_label(&self) -> &'static str {
        match self.name {
            "0.8b" => "Basic",
            "2b" => "Good",
            "4b" => "Great",
            "9b" => "Best",
            _ => "Unknown",
        }
    }
}

/// User's model preference (tier + quantization).
#[derive(Debug, Clone)]
pub struct ModelPreference {
    pub tier_name: String,
    pub quantization: Quantization,
}

impl ModelPreference {
    /// Parse from stored format: "tier_name:quantization" (e.g., "4b:4bit").
    /// Falls back to 4-bit if quantization part is missing (backward compat).
    pub fn parse(stored: &str) -> Option<Self> {
        let parts: Vec<&str> = stored.splitn(2, ':').collect();
        let tier_name = parts[0];

        // Validate tier exists
        get_tier_by_name(tier_name)?;

        let quantization = parts
            .get(1)
            .and_then(|q| Quantization::parse(q))
            .unwrap_or(Quantization::Q4);

        Some(Self {
            tier_name: tier_name.to_string(),
            quantization,
        })
    }

    /// Serialize for storage.
    pub fn to_stored_string(&self) -> String {
        format!("{}:{}", self.tier_name, self.quantization.as_str())
    }

    /// Get the model ID for this preference.
    pub fn model_id(&self) -> &'static str {
        get_tier_by_name(&self.tier_name)
            .expect("ModelPreference should only contain valid tier names")
            .model_for_quantization(self.quantization)
    }

    /// Get the tier for this preference.
    pub fn tier(&self) -> &'static ModelTier {
        get_tier_by_name(&self.tier_name).expect("ModelPreference should only contain valid tier names")
    }
}

/// Get the effective model tier based on a stored preference string.
///
/// If the preference is valid, returns that tier. Otherwise falls back
/// to the auto-recommended tier.
pub fn get_tier_for_preference(preference: Option<&str>) -> &'static ModelTier {
    if let Some(stored) = preference
        && let Some(pref) = ModelPreference::parse(stored)
        && let Some(tier) = get_tier_by_name(&pref.tier_name)
    {
        return tier;
    }
    recommend_model_tier()
}

/// Get the effective quantization for a stored preference.
pub fn get_quantization_for_preference(preference: Option<&str>) -> Quantization {
    preference
        .and_then(ModelPreference::parse)
        .map(|p| p.quantization)
        .unwrap_or(Quantization::Q4)
}

/// Get the effective model ID based on a stored preference.
///
/// Respects both tier and quantization from the preference.
/// Falls back to the auto-recommended 4-bit model.
pub fn effective_model(preference: Option<&str>) -> &'static str {
    let tier = get_tier_for_preference(preference);
    let quant = get_quantization_for_preference(preference);
    tier.model_for_quantization(quant)
}

/// Detect total system memory in GB on macOS.
///
/// Uses `sysctl hw.memsize` to read the unified memory size on Apple Silicon.
/// Returns 0 if detection fails.
pub fn detect_system_memory_gb() -> u64 {
    let output = Command::new("sysctl").arg("-n").arg("hw.memsize").output();

    match output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.trim()
                .parse::<u64>()
                .map(|bytes| bytes / (1024 * 1024 * 1024))
                .unwrap_or(0)
        }
        _ => 0,
    }
}

/// Recommend the best model tier based on available system memory.
///
/// Picks the highest tier that fits with headroom for the embedding model (~1GB)
/// and OS overhead (~4GB). Falls back to the smallest tier if memory is very low.
pub fn recommend_model_tier() -> &'static ModelTier {
    let mem_gb = detect_system_memory_gb();
    // Reserve memory for embedding model + OS
    let available = mem_gb.saturating_sub(5);

    for tier in MODEL_TIERS {
        if available >= tier.min_memory_gb {
            return tier;
        }
    }

    // Fallback to smallest tier
    MODEL_TIERS.last().expect("MODEL_TIERS is non-empty")
}

/// Get the recommended persona model (4-bit) for this machine.
///
/// Uses 4-bit quantization for all tasks (training, chat, analysis).
/// The quality difference vs 8-bit is marginal, and this halves disk usage.
pub fn recommended_persona_model() -> &'static str {
    recommend_model_tier().model_4bit
}

/// Get the recommended agent model (4-bit) for this machine.
pub fn recommended_agent_model() -> &'static str {
    recommend_model_tier().model_4bit
}

/// Get a model tier by name (e.g., "9b", "4b", "2b", "0.8b").
pub fn get_tier_by_name(name: &str) -> Option<&'static ModelTier> {
    MODEL_TIERS.iter().find(|t| t.name == name)
}

/// Resolve the model tier for a concrete model ID (ignoring quantization).
///
/// e.g. `"mlx-community/Qwen3.5-4B-4bit"` -> the `"4b"` tier. Returns `None` for
/// model IDs that don't correspond to a known tier (e.g. a non-Qwen base model).
pub fn tier_for_model(model: &str) -> Option<&'static ModelTier> {
    let norm = normalize_model_name(model);
    MODEL_TIERS
        .iter()
        .find(|t| norm == format!("qwen3.5-{}", t.name) || norm.ends_with(&format!("-{}", t.name)))
}

/// Strip quantization suffix and HF org prefix to get the base model name.
///
/// e.g., "mlx-community/Qwen3.5-9B-4bit" -> "qwen3.5-9b"
pub fn normalize_model_name(model: &str) -> String {
    let name = model.rsplit('/').next().unwrap_or(model).to_lowercase();
    name.replace("-4bit", "").replace("-8bit", "").replace("-16bit", "")
}

/// Check if two model IDs are compatible (same base architecture).
///
/// Two models are compatible if they have the same base name (ignoring quantization).
/// e.g., "Qwen3.5-9B-4bit" and "Qwen3.5-9B-8bit" are compatible,
/// but "Qwen3.5-9B-4bit" and "Qwen3.5-4B-4bit" are not.
pub fn models_compatible(model_a: &str, model_b: &str) -> bool {
    normalize_model_name(model_a) == normalize_model_name(model_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_system_memory() {
        let mem = detect_system_memory_gb();
        // Should detect something on macOS
        assert!(mem > 0, "Expected non-zero memory, got {mem}");
    }

    #[test]
    fn test_recommend_tier() {
        let tier = recommend_model_tier();
        assert!(!tier.name.is_empty());
        assert!(!tier.model_8bit.is_empty());
    }

    #[test]
    fn test_get_tier_by_name() {
        assert!(get_tier_by_name("9b").is_some());
        assert!(get_tier_by_name("4b").is_some());
        assert!(get_tier_by_name("0.8b").is_some());
        assert!(get_tier_by_name("nonexistent").is_none());
    }

    #[test]
    fn test_tiers_ordered_by_size() {
        for window in MODEL_TIERS.windows(2) {
            assert!(
                window[0].min_memory_gb >= window[1].min_memory_gb,
                "Tiers should be ordered largest to smallest"
            );
        }
    }

    #[test]
    fn test_tier_thresholds_with_overhead() {
        // 24GB Mac: 24 - 5 = 19 >= 19 -> 9B tier
        assert_eq!(
            MODEL_TIERS.iter().find(|t| 19u64 >= t.min_memory_gb).unwrap().name,
            "9b"
        );
        // 16GB Mac: 16 - 5 = 11 >= 11 -> 4B tier
        assert_eq!(
            MODEL_TIERS.iter().find(|t| 11u64 >= t.min_memory_gb).unwrap().name,
            "4b"
        );
        // 12GB Mac: 12 - 5 = 7 >= 7 -> 2B tier
        assert_eq!(MODEL_TIERS.iter().find(|t| 7u64 >= t.min_memory_gb).unwrap().name, "2b");
        // 8GB Mac: 8 - 5 = 3 < 4 -> fallback to 0.8B
        assert!(MODEL_TIERS.iter().find(|t| 3u64 >= t.min_memory_gb).is_none());
    }

    #[test]
    fn test_recommended_helpers() {
        let persona = recommended_persona_model();
        let agent = recommended_agent_model();
        assert!(persona.contains("4bit"));
        assert!(agent.contains("4bit"));
    }

    #[test]
    fn test_quantization_roundtrip() {
        assert_eq!(Quantization::parse("4bit"), Some(Quantization::Q4));
        assert_eq!(Quantization::parse("8bit"), Some(Quantization::Q8));
        assert_eq!(Quantization::parse("invalid"), None);
        assert_eq!(Quantization::Q4.as_str(), "4bit");
        assert_eq!(Quantization::Q8.as_str(), "8bit");
    }

    #[test]
    fn test_model_preference_parse() {
        let pref = ModelPreference::parse("4b:4bit").unwrap();
        assert_eq!(pref.tier_name, "4b");
        assert_eq!(pref.quantization, Quantization::Q4);
        assert!(pref.model_id().contains("4B-4bit"));

        let pref = ModelPreference::parse("9b:8bit").unwrap();
        assert_eq!(pref.tier_name, "9b");
        assert_eq!(pref.quantization, Quantization::Q8);
        assert!(pref.model_id().contains("9B-8bit"));

        // Backward compat: no quantization defaults to 4bit
        let pref = ModelPreference::parse("2b").unwrap();
        assert_eq!(pref.quantization, Quantization::Q4);

        // Invalid tier returns None
        assert!(ModelPreference::parse("99b:4bit").is_none());
    }

    #[test]
    fn test_model_preference_stored_string() {
        let pref = ModelPreference::parse("4b:8bit").unwrap();
        assert_eq!(pref.to_stored_string(), "4b:8bit");
    }

    #[test]
    fn test_get_tier_for_preference() {
        // Valid preference returns that tier
        let tier = get_tier_for_preference(Some("4b:4bit"));
        assert_eq!(tier.name, "4b");

        // Invalid preference falls back to recommended
        let tier = get_tier_for_preference(Some("invalid"));
        assert_eq!(tier.name, recommend_model_tier().name);

        // None falls back to recommended
        let tier = get_tier_for_preference(None);
        assert_eq!(tier.name, recommend_model_tier().name);
    }

    #[test]
    fn test_effective_model() {
        assert!(effective_model(Some("9b:8bit")).contains("9B-8bit"));
        assert!(effective_model(Some("4b:4bit")).contains("4B-4bit"));
        assert!(effective_model(None).contains("4bit"));
    }

    #[test]
    fn test_tier_speed_quality_labels() {
        let tier = get_tier_by_name("9b").unwrap();
        assert_eq!(tier.speed_label(), "Best Quality");
        assert_eq!(tier.quality_label(), "Best");

        let tier = get_tier_by_name("0.8b").unwrap();
        assert_eq!(tier.speed_label(), "Fastest");
        assert_eq!(tier.quality_label(), "Basic");
    }

    #[test]
    fn test_model_for_quantization() {
        let tier = get_tier_by_name("4b").unwrap();
        assert!(tier.model_for_quantization(Quantization::Q4).contains("4bit"));
        assert!(tier.model_for_quantization(Quantization::Q8).contains("8bit"));
    }

    #[test]
    fn test_normalize_model_name() {
        assert_eq!(normalize_model_name("mlx-community/Qwen3.5-9B-4bit"), "qwen3.5-9b");
        assert_eq!(normalize_model_name("mlx-community/Qwen3.5-9B-8bit"), "qwen3.5-9b");
        assert_eq!(normalize_model_name("Qwen3.5-4B-4bit"), "qwen3.5-4b");
        assert_eq!(normalize_model_name("qwen3.5-2b"), "qwen3.5-2b");
        assert_eq!(normalize_model_name("mlx-community/Qwen3.5-0.8B-4bit"), "qwen3.5-0.8b");
    }

    #[test]
    fn test_tier_for_model() {
        assert_eq!(tier_for_model("mlx-community/Qwen3.5-9B-4bit").unwrap().name, "9b");
        assert_eq!(tier_for_model("mlx-community/Qwen3.5-4B-8bit").unwrap().name, "4b");
        assert_eq!(tier_for_model("Qwen3.5-2B-4bit").unwrap().name, "2b");
        assert_eq!(tier_for_model("mlx-community/Qwen3.5-0.8B-4bit").unwrap().name, "0.8b");
        // Unknown / non-tier models return None.
        assert!(tier_for_model("mlx-community/some-other-model").is_none());
    }

    #[test]
    fn test_models_compatible() {
        // Same tier, different quantization = compatible
        assert!(models_compatible(
            "mlx-community/Qwen3.5-9B-4bit",
            "mlx-community/Qwen3.5-9B-8bit"
        ));
        // Different tier = not compatible
        assert!(!models_compatible(
            "mlx-community/Qwen3.5-9B-4bit",
            "mlx-community/Qwen3.5-4B-4bit"
        ));
        // With and without HF prefix
        assert!(models_compatible("Qwen3.5-4B-4bit", "mlx-community/Qwen3.5-4B-8bit"));
        // No quantization suffix
        assert!(models_compatible("mlx-community/Qwen3.5-2B-4bit", "Qwen3.5-2B"));
    }
}
