use common::{
    detect_system_memory_gb, format_bytes, get_processed_data_dir, recommend_model_tier, scripts, tier_for_model,
    write_json_file, PythonEnvironment, TrainingProfile, SELF_PERSONA_ID, SELF_TRAINING_MIN_MESSAGES,
};
use personas::{PersonaMetadata, PersonaRegistry, TrainingConfig, TrainingMetrics};
use std::io::BufRead;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
use tracing::{debug, info, warn};
use training::export;

use crate::AppState;

use super::types::{
    TrainedPersonaResponse, TrainingPhase, TrainingPlanResponse, TrainingProgressEvent, TrainingSettings,
};

/// JSON structure emitted by the Python training script on stdout.
/// Lines that don't parse as this struct are ignored (human-readable output).
#[derive(serde::Deserialize, Debug)]
struct PythonTrainingProgress {
    #[serde(rename = "type")]
    event_type: Option<String>,
    phase: Option<String>,
    step: Option<usize>,
    total_steps: Option<usize>,
    progress: Option<f32>,
    loss: Option<f32>,
    val_loss: Option<f32>,
    message: Option<String>,
    training_duration_secs: Option<u64>,
    training_examples: Option<usize>,
}

/// Error message `train_persona` returns when the user cancels.
pub const TRAINING_CANCELLED: &str = "Training cancelled";

/// Train the "You" persona using the bundled Python environment.
///
/// The command takes no contact: it trains only on the user's own sent
/// messages. No code path trains a persona of another person (see AGENTS.md).
///
/// Streams stdout line-by-line, parsing JSON progress events from the Python
/// training script and emitting `training-progress` Tauri events to the frontend.
/// After successful training, registers the persona via `PersonaRegistry::register()`
/// so it appears in `list_personas`.
///
/// `cancel_training` stops the run. The command then fails with
/// [`TRAINING_CANCELLED`] and registers nothing.
///
/// `settings` holds the Advanced panel values. When present they replace the
/// hardware-aware profile, including its step count. Out-of-range values fail
/// the command before anything starts.
#[tauri::command]
pub async fn train_persona(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    base_model: String,
    max_steps: usize,
    settings: Option<TrainingSettings>,
) -> Result<String, String> {
    // Memory preflight: refuse fast (with a clear message) on machines that can't
    // fit even the smallest model + optimizer state, instead of thrashing swap.
    let system_memory_gb = detect_system_memory_gb();
    if system_memory_gb > 0 && !TrainingProfile::meets_minimum_memory(system_memory_gb) {
        return Err(format!(
            "Training a persona needs at least {min}GB of memory, but this Mac has {have}GB. \
             You can still chat with the base model and use search.",
            min = common::training_profile::MIN_TRAINING_MEMORY_GB,
            have = system_memory_gb,
        ));
    }

    state.training.begin();

    // Ensure Python environment is set up
    app.emit(
        "training-progress",
        TrainingProgressEvent {
            phase: TrainingPhase::Exporting,
            progress: 0.0,
            step: None,
            total_steps: Some(max_steps),
            loss: None,
            val_loss: None,
            message: "Setting up Python environment...".to_string(),
        },
    )
    .ok();

    let env = PythonEnvironment::ensure(&app)
        .await
        .map_err(|e| format!("Failed to setup Python: {}", e))?;

    let training_script = env.script(scripts::TRAIN);
    let data_dir = self_data_dir()?;
    let output_dir =
        personas::get_persona_dir(SELF_PERSONA_ID).map_err(|e| format!("Failed to get persona directory: {e}"))?;

    // Auto-export training data if it doesn't exist yet
    ensure_training_data(&app, &data_dir)?;

    // The export can take a while. Don't start the trainer if the user gave up.
    if state.training.is_cancel_requested() {
        info!("Training cancelled before the trainer started");
        return Err(TRAINING_CANCELLED.to_string());
    }

    // A persona registered before this run keeps its metadata.json. Without it,
    // the output directory holds only this run's files, which a cancel removes.
    let previously_registered = output_dir.join("metadata.json").exists();

    // Build a hardware-aware training profile from the selected model tier, the
    // machine's memory, and the actual exported example count. This
    // adapts LoRA rank, sequence length, adapted-layer count, and step budget so
    // training stays fast and within memory on consumer Macs (see TrainingProfile).
    let tier = tier_for_model(&base_model).unwrap_or_else(|| recommend_model_tier());
    let num_examples = read_training_examples_from_metadata(&data_dir).unwrap_or(0);
    let recommended = TrainingProfile::recommend(tier, system_memory_gb, num_examples);
    let custom = settings.is_some();
    let profile = match settings {
        Some(settings) => recommended.with_settings(tier, &settings.into())?,
        None => recommended,
    };
    // Without user settings, `max_steps` is a ceiling the profile may lower
    // under, never raise above. User settings choose the step count outright.
    // The `.max(1)` guards against a 0 being passed.
    let effective_max_steps = if custom {
        profile.max_steps
    } else {
        profile.max_steps.min(max_steps.max(1))
    };

    info!(
        tier = tier.name,
        system_memory_gb,
        num_examples,
        lora_rank = profile.lora_rank,
        max_seq_length = profile.max_seq_length,
        num_layers = ?profile.num_layers,
        max_steps = effective_max_steps,
        learning_rate = profile.learning_rate,
        batch_size = profile.batch_size,
        grad_accum = profile.gradient_accumulation_steps,
        eval_steps = profile.eval_steps,
        early_stopping = profile.early_stopping,
        custom,
        "Computed training profile"
    );

    // Spawn training process with stdout piped for progress streaming. All
    // hyperparameters come from the adaptive profile rather than fixed constants.
    let mut cmd = Command::new(&env.python_bin);
    cmd.arg(&training_script)
        .arg("--data")
        .arg(&data_dir)
        .arg("--output")
        .arg(&output_dir)
        .arg("--base-model")
        .arg(&base_model)
        .arg("--max-steps")
        .arg(effective_max_steps.to_string())
        .arg("--lora-rank")
        .arg(profile.lora_rank.to_string())
        .arg("--lora-alpha")
        .arg(profile.lora_alpha.to_string())
        .arg("--batch-size")
        .arg(profile.batch_size.to_string())
        .arg("--grad-accum")
        .arg(profile.gradient_accumulation_steps.to_string())
        .arg("--max-seq-length")
        .arg(profile.max_seq_length.to_string())
        .arg("--learning-rate")
        .arg(profile.learning_rate.to_string())
        .arg("--eval-steps")
        .arg(profile.eval_steps.to_string());
    if !profile.early_stopping {
        cmd.arg("--no-early-stopping");
    }
    // Only constrain the adapted-layer count when the profile asks to; omitting
    // the flag preserves the trainer's default of adapting all layers.
    if let Some(num_layers) = profile.num_layers {
        cmd.arg("--num-layers").arg(num_layers.to_string());
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start training: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // From here, `cancel_training` can kill the trainer. A kill closes stdout,
    // which ends the read loop below.
    state.training.attach(child);

    // Drain stderr on a background thread to prevent pipe deadlock.
    // If Python writes >64KB to stderr while Rust blocks on stdout/wait, both processes deadlock.
    let stderr_thread = std::thread::spawn(move || {
        let mut lines = Vec::new();
        if let Some(stderr) = stderr {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().map_while(|r| r.ok()) {
                debug!(target: "python_train", "{}", line);
                lines.push(line);
            }
        }
        lines
    });

    // Stream stdout line-by-line, parsing JSON progress events.
    // Non-JSON lines (human-readable output from print()) are logged but not emitted.
    let mut last_loss: Option<f32> = None;
    let mut last_train_loss: Option<f32> = None;
    let mut training_duration_secs: Option<u64> = None;
    let mut training_examples: Option<usize> = None;

    if let Some(stdout) = stdout {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    // Try to parse as JSON progress event
                    if let Ok(progress) = serde_json::from_str::<PythonTrainingProgress>(&line) {
                        if progress.event_type.as_deref() == Some("training_progress") {
                            let phase = progress.phase.as_deref().unwrap_or("training");

                            // Map Python phase names onto the four the frontend
                            // knows. An unrecognized name used to pass straight
                            // through and index TRAINING_PHASE_LABELS to
                            // `undefined`, blanking the label mid-run.
                            let frontend_phase = match phase {
                                "loading_data" => TrainingPhase::Exporting,
                                "downloading" => TrainingPhase::Downloading,
                                "training" | "validating" => TrainingPhase::Training,
                                "finalizing" | "complete" => TrainingPhase::Finalizing,
                                other => {
                                    warn!(
                                        phase = other,
                                        "Unknown training phase from Python, reporting as Training"
                                    );
                                    TrainingPhase::Training
                                }
                            };

                            // Track the latest loss for persona registration
                            if let Some(loss) = progress.loss {
                                last_loss = Some(loss);
                                last_train_loss = Some(loss);
                            }
                            if let Some(val_loss) = progress.val_loss {
                                last_loss = Some(val_loss);
                            }
                            if let Some(dur) = progress.training_duration_secs {
                                training_duration_secs = Some(dur);
                            }
                            if let Some(examples) = progress.training_examples {
                                training_examples = Some(examples);
                            }

                            let event = TrainingProgressEvent {
                                phase: frontend_phase,
                                progress: progress.progress.unwrap_or(0.0),
                                step: progress.step,
                                total_steps: progress.total_steps,
                                loss: progress.loss,
                                val_loss: progress.val_loss,
                                message: progress
                                    .message
                                    .unwrap_or_else(|| format!("Phase: {:?}", frontend_phase)),
                            };

                            app.emit("training-progress", event).ok();
                        }
                    }
                    // Non-JSON lines are human-readable output -- ignore silently
                }
                Err(e) => {
                    warn!(error = %e, "Failed to read training stdout line");
                    break;
                }
            }
        }
    }

    // Wait for process to complete
    let mut child = state.training.detach().ok_or("Training process handle was lost")?;
    let status = child.wait().map_err(|e| format!("Training process failed: {}", e))?;

    // Join the stderr drain thread to get collected lines
    let stderr_lines = stderr_thread.join().unwrap_or_default();

    if state.training.is_cancel_requested() {
        info!("Training cancelled, trainer stopped");
        if !previously_registered && output_dir.exists() {
            // Never registered, so nothing else points at these partial files.
            if let Err(e) = std::fs::remove_dir_all(&output_dir) {
                warn!(error = %e, ?output_dir, "Failed to remove partial training output");
            }
        } else if previously_registered {
            // mlx_lm checkpoints overwrite adapters.safetensors in place, so a
            // cancelled retrain can leave a partly trained adapter behind.
            warn!(
                ?output_dir,
                "Retrain cancelled; the adapter may hold a partial checkpoint"
            );
        }
        return Err(TRAINING_CANCELLED.to_string());
    }

    if !status.success() {
        let stderr_tail: String = stderr_lines
            .iter()
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        warn!(
            exit_code = status.code().unwrap_or(-1),
            stderr = %stderr_tail,
            "Training process failed"
        );

        return Err(format!(
            "Training failed (exit code {}):\n{}",
            status.code().unwrap_or(-1),
            stderr_tail
        ));
    }

    // === Register persona via PersonaRegistry ===
    // This is what makes list_personas() find the persona.
    // Try to read display_name from the export metadata in the data directory.
    let display_name = read_contact_name_from_metadata(&data_dir).unwrap_or_else(|| "You".to_string());

    let metadata = PersonaMetadata {
        persona_id: SELF_PERSONA_ID.to_string(),
        display_name,
        base_model: base_model.clone(),
        created_at: chrono::Utc::now(),
        training_config: TrainingConfig {
            lora_rank: profile.lora_rank,
            lora_alpha: profile.lora_alpha as f64,
            learning_rate: profile.learning_rate,
            max_steps: effective_max_steps,
            batch_size: profile.batch_size,
        },
        metrics: Some(TrainingMetrics {
            final_loss: last_loss.map(|l| l as f64).unwrap_or(0.0),
            training_duration_secs: training_duration_secs.unwrap_or(0),
            total_examples: training_examples.unwrap_or(0),
        }),
    };

    if let Err(e) = PersonaRegistry::register(&metadata) {
        warn!(error = %e, "Failed to register persona metadata (training artifacts still saved)");
    } else {
        info!(persona_id = SELF_PERSONA_ID, "Persona registered successfully");
    }

    // Invalidate contacts cache so has_persona flags are refreshed
    state.invalidate_contacts_cache().await;

    app.emit(
        "training-progress",
        TrainingProgressEvent {
            phase: TrainingPhase::Finalizing,
            progress: 1.0,
            step: Some(effective_max_steps),
            total_steps: Some(effective_max_steps),
            loss: last_train_loss,
            val_loss: None,
            message: "Training complete!".to_string(),
        },
    )
    .ok();

    Ok(output_dir.to_string_lossy().to_string())
}

/// Stop the persona training run in progress.
///
/// Kills the Python trainer if it is running. If the run is still exporting
/// data, it stops before the trainer starts. The pending `train_persona` call
/// then fails with [`TRAINING_CANCELLED`]. Returns true if a trainer process
/// was running.
#[tauri::command]
pub fn cancel_training(state: tauri::State<'_, AppState>) -> bool {
    let killed = state.training.request_cancel();
    info!(killed, "Training cancel requested");
    killed
}

/// Largest loss chart image `save_loss_chart` accepts. A 2x chart is ~200 KB.
const MAX_LOSS_CHART_BYTES: usize = 10 * 1024 * 1024;

/// Save a PNG of the training loss chart to the Downloads folder.
///
/// The frontend renders the chart to PNG bytes. This writes them to
/// `~/Downloads/brb-training-loss-<timestamp>.png`, reveals the file in
/// Finder, and returns its path.
#[tauri::command]
pub fn save_loss_chart(app: AppHandle, png: Vec<u8>) -> Result<String, String> {
    const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";
    if !png.starts_with(PNG_MAGIC) {
        return Err("The chart image is not a PNG.".to_string());
    }
    if png.len() > MAX_LOSS_CHART_BYTES {
        return Err("The chart image is too large.".to_string());
    }
    let dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .ok_or("Could not find the Downloads folder")?;
    let name = format!("brb-training-loss-{}.png", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let path = dir.join(name);
    std::fs::write(&path, &png).map_err(|e| format!("Failed to save the chart: {}", e))?;
    info!(?path, bytes = png.len(), "Saved loss chart");

    use tauri_plugin_opener::OpenerExt;
    if let Err(e) = app.opener().reveal_item_in_dir(&path) {
        warn!(error = %e, ?path, "Failed to reveal the saved loss chart");
    }
    Ok(path.to_string_lossy().to_string())
}

/// Number of conversation blocks to sample for LLM self-analysis.
/// Matches the CLI constant in `apps/cli/src/constants.rs`.
const SAMPLE_CONVERSATION_BLOCKS: usize = 100;

/// Ensure "You" training data (train.jsonl + metadata.json) exists.
///
/// If the data already exists, returns immediately. Otherwise, runs the full
/// export pipeline inline: snapshot -> the user's 1:1 conversations -> stats ->
/// LLM self-analysis -> system prompt -> JSONL export -> metadata write.
///
/// Emits `training-progress` events with phase `"exporting"` so the frontend
/// shows meaningful status during the export process.
fn ensure_training_data(app: &AppHandle, data_dir: &Path) -> Result<(), String> {
    let jsonl_path = data_dir.join("train.jsonl");

    // Skip if training data already exists
    if jsonl_path.exists() {
        info!("Training data already exists, skipping export");
        return Ok(());
    }

    info!("Training data not found, running auto-export");

    // Create the output directory
    std::fs::create_dir_all(data_dir).map_err(|e| format!("Failed to create data directory: {}", e))?;

    let metadata_path = data_dir.join("metadata.json");

    // Step 1: Snapshot
    emit_export_progress(app, 0.05, "Creating iMessage snapshot...");
    let snapshot_path =
        messages_db::db::snapshot::get_or_create_snapshot().map_err(|e| format!("Failed to create snapshot: {}", e))?;

    // Step 2: Load every 1:1 conversation with enough messages
    emit_export_progress(app, 0.10, "Loading your conversations...");
    let conversations = messages_db::db::queries::get_self_conversations(&snapshot_path, SELF_TRAINING_MIN_MESSAGES)
        .map_err(|e| format!("Failed to load conversations: {}", e))?;
    let all_messages: Vec<_> = conversations.iter().flat_map(|c| c.messages.iter().cloned()).collect();

    info!(
        conversations = conversations.len(),
        total_messages = all_messages.len(),
        "Loaded conversations for export"
    );

    // Step 3: Sample conversation blocks for LLM self-analysis
    emit_export_progress(app, 0.15, "Sampling conversation blocks...");
    let conversation_blocks = export::sample_self_blocks(&conversations, SAMPLE_CONVERSATION_BLOCKS)
        .map_err(|e| format!("Failed to sample conversation blocks: {}", e))?;

    // Step 4: Calculate stats of the user's own messages
    emit_export_progress(app, 0.20, "Analyzing your messaging patterns...");
    let persona_stats = export::calculate_persona_stats(&all_messages)
        .map_err(|e| format!("Failed to calculate persona stats: {}", e))?;

    // Step 5: Run LLM self-analysis (graceful fallback on failure)
    emit_export_progress(app, 0.30, "Running persona analysis...");
    let llm_analysis = match export::analyze_persona_with_llm(conversation_blocks) {
        Ok(Some(analysis)) => {
            info!(analysis_length = analysis.len(), "LLM analysis completed successfully");
            Some(analysis)
        }
        Ok(None) => {
            info!("LLM analysis skipped, using fallback prompt");
            None
        }
        Err(e) => {
            warn!(error = %e, "LLM analysis failed, using fallback prompt");
            None
        }
    };

    // Step 6: Build system prompt
    emit_export_progress(app, 0.50, "Building system prompt...");
    let system_prompt = if llm_analysis.is_some() || persona_stats.emoji_rate > 0.0 {
        export::build_system_prompt(Some(&persona_stats), llm_analysis.as_deref())
            .map_err(|e| format!("Failed to build system prompt: {}", e))?
    } else {
        export::build_fallback_prompt()
    };

    info!(prompt_length = system_prompt.len(), "System prompt built");

    // Step 7: Export the user's replies to JSONL
    emit_export_progress(app, 0.60, "Generating training examples...");
    let app_clone = app.clone();
    let mut metadata = export::export_self_to_jsonl(
        &conversations,
        &jsonl_path,
        Some(|current: usize, total: usize| {
            if current.is_multiple_of(50) || current == total {
                let export_progress = 0.60 + 0.35 * (current as f32 / total as f32);
                emit_export_progress(
                    &app_clone,
                    export_progress,
                    &format!("Writing examples ({}/{})", current, total),
                );
            }
        }),
    )
    .map_err(|e| format!("Failed to export training data: {}", e))?;

    // Step 8: Write metadata
    metadata.system_prompt = Some(system_prompt);
    metadata.persona_stats = Some(persona_stats);
    metadata.llm_analysis = llm_analysis;

    write_json_file(&metadata_path.to_path_buf(), &metadata).map_err(|e| format!("Failed to write metadata: {}", e))?;

    emit_export_progress(app, 1.0, "Export complete!");
    info!(
        training_examples = metadata.training_examples,
        total_messages = metadata.total_messages,
        "Auto-export complete"
    );

    Ok(())
}

/// Emit a training-progress event with the "exporting" phase.
fn emit_export_progress(app: &AppHandle, progress: f32, message: &str) {
    app.emit(
        "training-progress",
        TrainingProgressEvent {
            phase: TrainingPhase::Exporting,
            progress,
            step: None,
            total_steps: None,
            loss: None,
            val_loss: None,
            message: message.to_string(),
        },
    )
    .ok();
}

/// Read the exported `training_examples` count from metadata.json, if present.
fn read_training_examples_from_metadata(data_dir: &std::path::Path) -> Option<usize> {
    let metadata_path = data_dir.join("metadata.json");
    let content = std::fs::read_to_string(&metadata_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    value
        .get("training_examples")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
}

/// Compute the hardware-aware training plan for a contact, for display before
/// training starts.
///
/// If training data has already been exported, uses the real example count;
/// otherwise estimates from `message_count` so the modal can show a realistic
/// time range without paying the cost of a full export. The plan returned here is
/// advisory — `train_persona` always recomputes the profile from the real example
/// count at training time.
///
/// With `settings`, the plan's step count and time estimate describe those
/// settings instead. `recommended` always holds the hardware-aware defaults.
#[tauri::command]
pub async fn get_training_plan(
    state: tauri::State<'_, AppState>,
    message_count: usize,
    settings: Option<TrainingSettings>,
) -> Result<TrainingPlanResponse, String> {
    let base_model = {
        let pref = state.get_model_preference();
        common::effective_model(pref.as_deref()).to_string()
    };
    let tier = tier_for_model(&base_model).unwrap_or_else(|| recommend_model_tier());
    let system_memory_gb = detect_system_memory_gb();

    // Prefer the real exported example count if it exists; else estimate.
    let data_dir = self_data_dir()?;
    let num_examples = read_training_examples_from_metadata(&data_dir)
        .unwrap_or_else(|| common::training_profile::estimate_examples_from_messages(message_count));

    let recommended = TrainingProfile::recommend(tier, system_memory_gb, num_examples);
    let recommended_settings = recommended.settings(tier);
    let profile = match settings {
        Some(settings) => recommended.with_settings(tier, &settings.into())?,
        None => recommended,
    };

    Ok(TrainingPlanResponse {
        tier_name: profile.tier_name.to_string(),
        system_memory_gb,
        // If memory can't be detected (0), don't block — assume capable.
        can_train: system_memory_gb == 0 || TrainingProfile::meets_minimum_memory(system_memory_gb),
        max_steps: profile.max_steps,
        max_seq_length: profile.max_seq_length,
        lora_rank: profile.lora_rank,
        num_layers: profile.num_layers,
        est_minutes_low: profile.est_minutes_low,
        est_minutes_high: profile.est_minutes_high,
        low_data: num_examples < common::training_profile::MIN_RECOMMENDED_EXAMPLES,
        recommended: recommended_settings.into(),
        bounds: common::TrainingSettings::bounds(tier).into(),
    })
}

/// The export directory of the "You" persona's training data.
fn self_data_dir() -> Result<std::path::PathBuf, String> {
    get_processed_data_dir()
        .map(|dir| dir.join(SELF_PERSONA_ID))
        .map_err(|e| format!("Failed to get data directory: {e}"))
}

/// Read the contact_name from the export metadata.json in the data directory.
fn read_contact_name_from_metadata(data_dir: &std::path::Path) -> Option<String> {
    let metadata_path = data_dir.join("metadata.json");
    let content = std::fs::read_to_string(&metadata_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    value
        .get("contact_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// List the trained "You" persona, if one exists.
///
/// "You" is the only persona the app trains, so this reads only its
/// `metadata.json`. Other directories under `models/personas/` are ignored.
#[tauri::command]
pub async fn list_personas() -> Result<Vec<TrainedPersonaResponse>, String> {
    let results: Vec<TrainedPersonaResponse> = PersonaRegistry::load(SELF_PERSONA_ID)
        .ok()
        .map(|metadata| persona_metadata_to_response(&metadata))
        .into_iter()
        .collect();

    info!(count = results.len(), "Listed personas");
    Ok(results)
}

/// Convert `PersonaMetadata` (from the personas crate) to `TrainedPersonaResponse`
/// (the serializable type matching the frontend TypeScript interface).
///
/// Computes adapter file size by stat-ing the `adapters.safetensors` file at both
/// possible locations (flat and nested). If the file doesn't exist, size fields are 0.
fn persona_metadata_to_response(metadata: &PersonaMetadata) -> TrainedPersonaResponse {
    let persona_id = &metadata.persona_id;

    // Compute adapter size by checking both possible adapter file locations
    let adapter_size_bytes = get_adapter_size_bytes(persona_id).unwrap_or(0);
    let adapter_size_display = format_bytes(adapter_size_bytes);

    // Extract message_count from training metrics if available
    let message_count = metadata.metrics.as_ref().map(|m| m.total_examples).unwrap_or(0);

    // Format trained_at timestamp as ISO 8601 string
    let trained_at = metadata.created_at.to_rfc3339();

    TrainedPersonaResponse {
        id: persona_id.clone(),
        contact_id: persona_id.clone(),
        // Use display_name as the contact_name (best we have from metadata)
        contact_name: metadata.display_name.clone(),
        display_name: metadata.display_name.clone(),
        base_model: metadata.base_model.clone(),
        adapter_size_bytes,
        adapter_size_display,
        trained_at,
        message_count,
    }
}

/// Get the adapter file size in bytes by checking both possible locations.
fn get_adapter_size_bytes(persona_id: &str) -> Option<u64> {
    let persona_dir = personas::get_persona_dir(persona_id).ok()?;

    // Check flat path first: {persona_id}/adapters.safetensors
    let flat_path = persona_dir.join("adapters.safetensors");
    if let Ok(meta) = std::fs::metadata(&flat_path) {
        return Some(meta.len());
    }

    // Check nested path: {persona_id}/adapter/adapters.safetensors
    let nested_path = persona_dir.join("adapter/adapters.safetensors");
    if let Ok(meta) = std::fs::metadata(&nested_path) {
        return Some(meta.len());
    }

    None
}
