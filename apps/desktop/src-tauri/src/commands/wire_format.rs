//! Wire-format guards for the IPC boundary.
//!
//! The TypeScript types in `apps/desktop/src/` are hand-written mirrors of these
//! structs, and nothing links the two at compile time. Each test below pins a
//! field name that a real defect got wrong: a mismatch here is invisible to both
//! `cargo check` and `tsc`, and shows up only as a permanently `undefined` field
//! at runtime.
//!
//! The boundary convention is **snake_case** — no `#[serde(rename_all = ...)]` on
//! payload structs. That is deliberate: there is no attribute to forget.

#[cfg(test)]
mod tests {
    use crate::commands::analysis::AnalysisProgressEvent;
    use crate::commands::casper::CasperModelInfo;
    use crate::commands::insights::AggregationType;
    use crate::commands::system::IngestionProgressEvent;
    use crate::commands::types::{TrainingPhase, TrainingProgressEvent};
    use ingestion::IngestionStage;

    /// `CasperModelMenu.tsx` reads `display_name`. This struct carried no
    /// `rename_all`, so a camelCase TS mirror read `undefined` and the menu
    /// rendered its "Model" fallback forever.
    #[test]
    fn casper_model_info_is_snake_case() {
        let json = serde_json::to_value(CasperModelInfo {
            display_name: "Qwen3.5-9B".into(),
            model_id: "mlx-community/Qwen3.5-9B-4bit".into(),
            tier_name: "9b".into(),
            quantization: "4-bit".into(),
        })
        .unwrap();

        assert!(json.get("display_name").is_some(), "TS reads .display_name");
        assert!(json.get("model_id").is_some());
        assert!(json.get("tier_name").is_some());
        assert!(json.get("displayName").is_none(), "no camelCase on the boundary");
    }

    /// `useConversationAnalysis.ts` reads `is_complete`. This struct used to
    /// carry `rename_all = "camelCase"`, so it emitted `isComplete` and the
    /// completion branch never fired.
    #[test]
    fn analysis_progress_event_is_snake_case() {
        let json = serde_json::to_value(AnalysisProgressEvent {
            phase: "generating".into(),
            content: None,
            is_complete: true,
            error: None,
        })
        .unwrap();

        assert!(json.get("is_complete").is_some(), "TS reads .is_complete");
        assert!(json.get("isComplete").is_none(), "no camelCase on the boundary");
    }

    /// The TS mirror declared an `error` field and `"complete"` / `"error"`
    /// phases that this struct cannot produce, leaving two dead branches in
    /// `TrainingModal.tsx`. Completion is signalled by the resolved
    /// `train_persona` promise, not by a phase.
    #[test]
    fn training_progress_event_has_no_error_channel() {
        let json = serde_json::to_value(TrainingProgressEvent {
            phase: TrainingPhase::Finalizing,
            progress: 1.0,
            step: Some(500),
            total_steps: Some(500),
            loss: Some(0.42),
            val_loss: None,
            message: "Finalizing adapter".into(),
        })
        .unwrap();

        assert!(
            json.get("error").is_none(),
            "TS declared error?: string; this struct has no such field"
        );
        assert!(json.get("total_steps").is_some(), "TS reads .total_steps");
        assert_eq!(json["phase"], "finalizing");
    }

    /// These three fields were `String` and are now enums. Each must still
    /// serialize to the exact literals the matching TypeScript union already
    /// declares, or the swap silently changes the wire.
    #[test]
    fn enums_match_their_typescript_unions() {
        // IngestionStage -> types.ts `IngestionStage`
        for (variant, expected) in [
            (IngestionStage::Snapshot, "snapshot"),
            (IngestionStage::Parsing, "parsing"),
            (IngestionStage::Chunking, "chunking"),
            (IngestionStage::Embedding, "embedding"),
            (IngestionStage::Saving, "saving"),
            (IngestionStage::Analyzing, "analyzing"),
        ] {
            assert_eq!(serde_json::to_value(variant).unwrap(), expected);
        }

        // AggregationType -> types.ts `AggregationType`
        for (variant, expected) in [
            (AggregationType::Daily, "daily"),
            (AggregationType::Weekly, "weekly"),
            (AggregationType::Monthly, "monthly"),
        ] {
            assert_eq!(serde_json::to_value(variant).unwrap(), expected);
        }

        // TrainingPhase -> types.ts `TrainingProgressEvent["phase"]`
        for (variant, expected) in [
            (TrainingPhase::Exporting, "exporting"),
            (TrainingPhase::Downloading, "downloading"),
            (TrainingPhase::Training, "training"),
            (TrainingPhase::Finalizing, "finalizing"),
        ] {
            assert_eq!(serde_json::to_value(variant).unwrap(), expected);
        }
    }

    /// The cancellation event is the only one with no active stage. It must
    /// serialize `current_stage` as JSON null, which the frontend models as
    /// `IngestionStage | null`.
    #[test]
    fn cancelled_ingestion_reports_a_null_stage() {
        let json = serde_json::to_value(IngestionProgressEvent {
            stages: vec![],
            current_stage: None,
            is_complete: false,
            error: Some("Ingestion cancelled by user".into()),
            stats: None,
        })
        .unwrap();

        assert!(json["current_stage"].is_null());
    }
}
