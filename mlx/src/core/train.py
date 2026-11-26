#!/usr/bin/env python3
import random
import sys
import time
import traceback
import types
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import mlx.core as mx
import ujson as json  # https://dev.to/dollardhingra/benchmarking-python-json-serializers-json-vs-ujson-vs-orjson-1o16
from mlx.utils import tree_flatten
from mlx_lm import load
from mlx_lm.lora import train_model
from mlx_lm.tuner.datasets import ChatDataset

from config.training import Config
from core.callbacks import TrainingCallback
from fidelity.heldout import (
    DEFAULT_SEED,
    DEFAULT_VAL_FRACTION,
    MIN_VAL_EXAMPLES,
    data_sha256,
    split_examples,
    write_heldout,
)
from utils.data import get_data_stats, load_jsonl
from utils.ipc import send_response
from utils.mlx_memory import configure_cache_limit
from utils.msg_break import (
    BREAK_LOSS_WEIGHT,
    break_weighted_training,
    output_only_token_lora,
    read_msg_break_token,
    register_msg_break,
    token_lora_keys,
)
from utils.plotting import plot_training_losses
from utils.time import format_time
from utils.train_debug import (
    CRASH_TRACE_NAME,
    MEMORY_LOG_NAME,
    LoggedDataset,
    MemoryLog,
    device_report,
    disable_crash_trace,
    enable_crash_trace,
    token_length_stats,
    top_processes,
    track_validation,
)

# Examples tokenized at startup for the length summary in memory_log.jsonl.
LENGTH_SAMPLE_SIZE = 2000


def default_layer_keys(model: Any) -> list[str]:
    """The keys mlx-lm picks when none are given: every linear layer in a block."""
    import mlx.nn as nn

    keys: set[str] = set()
    for layer in model.layers:
        for path, module in layer.named_modules():
            if isinstance(module, nn.Linear | nn.QuantizedLinear):
                keys.add(path)
    return sorted(keys)


def run_training(config: Config, data_dir: Path) -> None:
    config.output_dir.mkdir(parents=True, exist_ok=True)
    memory_log = MemoryLog(config.output_dir / MEMORY_LOG_NAME)
    enable_crash_trace(config.output_dir / CRASH_TRACE_NAME)
    try:
        _run_training(config, data_dir, memory_log)
    except BaseException as e:
        memory_log.record("exit", error=f"{type(e).__name__}: {e}")
        raise
    else:
        memory_log.record("exit", error=None)
        disable_crash_trace()
    finally:
        memory_log.close()


def _run_training(config: Config, data_dir: Path, memory_log: MemoryLog) -> None:
    print("=== Be Right Back - LoRA Training ===")
    print(f"debug log: {memory_log.path}", file=sys.stderr)
    memory_log.record(
        "start",
        base_model=config.model.base_model,
        max_steps=config.training.max_steps,
        batch_size=config.training.batch_size,
        grad_accum=config.training.gradient_accumulation_steps,
        max_seq_length=config.training.max_seq_length,
        num_layers=config.training.num_layers,
        lora_rank=config.lora.rank,
        eval_steps=config.training.eval_steps,
        **device_report(),
        top_processes=top_processes(),
    )
    cache = configure_cache_limit()
    print(f"mlx cache limit: {cache or 'not set (no GPU working set)'}")
    if cache:
        memory_log.record("cache_limit", **cache)
    print(f"base model: {config.model.base_model}")
    print(f"training data: {config.data_path}")
    print(f"output: {config.output_dir}")
    print()

    send_response(
        {
            "type": "training_progress",
            "phase": "loading_data",
            "step": 0,
            "total_steps": config.training.max_steps,
            "progress": 0.0,
            "message": "Loading training data...",
        }
    )

    # load training data
    print("[1/4] loading training data...")
    examples = load_jsonl(config.data_path)

    if not examples:
        print("error: no valid training examples found", file=sys.stderr)
        sys.exit(1)

    stats = get_data_stats(examples)
    print(f"  loaded {stats['total_examples']} examples")
    print(
        f"  {stats['user_messages']} user messages, {stats['assistant_messages']} assistant messages"
    )
    print(f"  average {stats['avg_messages_per_example']} messages per example")
    print()

    # Split into train/valid (90/10) with a seeded shuffle. The export is in
    # conversation order, so a tail slice would validate only on the newest messages.
    train_examples, valid_examples, val_indices = split_examples(
        examples, seed=DEFAULT_SEED, val_fraction=DEFAULT_VAL_FRACTION
    )
    # Hash the data now; heldout.json is written only after training succeeds, so a
    # failed retrain never pairs a new split with the old adapter.
    data_hash = data_sha256(config.data_path)

    print(f"  train: {len(train_examples)} examples, valid: {len(valid_examples)} examples")
    if len(valid_examples) < MIN_VAL_EXAMPLES and config.training.early_stopping_patience:
        print(
            f"  warning: only {len(valid_examples)} validation examples "
            f"(< {MIN_VAL_EXAMPLES}); early stopping disabled because val loss is too noisy"
        )
        config.training.early_stopping_patience = None
    print()

    # The export names its bubble break token. Training registers that token.
    metadata_path = data_dir / "metadata.json"
    with open(metadata_path, encoding="utf-8") as f:
        metadata = json.load(f)
    msg_break_token = read_msg_break_token(metadata, str(metadata_path))

    send_response(
        {
            "type": "training_progress",
            "phase": "downloading",
            "step": 0,
            "total_steps": config.training.max_steps,
            "progress": 0.0,
            "message": "Loading model and tokenizer...",
        }
    )

    # load model and tokenizer
    print("[2/4] loading model and tokenizer...")
    memory_log.set_phase("loading_model")
    model, tokenizer = load(config.model.base_model, tokenizer_config={"trust_remote_code": True})  # type: ignore[misc]
    break_id = register_msg_break(tokenizer, msg_break_token, model)
    print("  model and tokenizer loaded")
    print(f"  {msg_break_token} id: {break_id}")
    print()

    # create datasets using MLX-LM's ChatDataset
    print("[3/4] preparing datasets...")
    mask_prompt = config.training.mask_prompt
    print(f"  mask_prompt={config.training.mask_prompt} (training only on assistant responses)")
    train_set = ChatDataset(train_examples, tokenizer, chat_key="messages", mask_prompt=mask_prompt)  # type: ignore[arg-type]
    valid_set = ChatDataset(valid_examples, tokenizer, chat_key="messages", mask_prompt=mask_prompt)  # type: ignore[arg-type]
    print("  datasets prepared")
    print()

    rng = random.Random(0)
    sample = rng.sample(range(len(train_set)), min(LENGTH_SAMPLE_SIZE, len(train_set)))
    memory_log.record(
        "dataset",
        train_examples=len(train_set),
        valid_examples=len(valid_set),
        sampled=len(sample),
        **token_length_stats(
            [len(train_set.process(train_set[i])[0]) for i in sample],
            config.training.max_seq_length,
        ),
    )

    send_response(
        {
            "type": "training_progress",
            "phase": "training",
            "step": 0,
            "total_steps": config.training.max_steps,
            "progress": 0.0,
            "message": "Starting LoRA training...",
        }
    )

    # configure training args
    print("[4/4] starting LoRA training...")
    print(f"  max steps: {config.training.max_steps}")
    print(f"  learning rate: {config.training.learning_rate}")
    print(f"  batch size: {config.training.batch_size}")
    print(f"  lora rank: {config.lora.rank}, alpha: {config.lora.alpha}")
    print(f"  target modules: {', '.join(config.lora.target_modules or [])}")
    print()
    print("training progress:")
    print("-" * 60)

    # create training args as SimpleNamespace
    # Detect actual number of layers from loaded model
    try:
        num_model_layers = (
            len(model.model.layers)
            if hasattr(model, "model")
            else len(model.language_model.model.layers)
        )
    except AttributeError:
        raise RuntimeError(f"Cannot detect layer count from model structure: {type(model)}")

    # Apply LoRA to only the top-N layers when the profile requests it. Adapting
    # fewer layers cuts trainable params, optimizer state, and wall-clock time --
    # the top layers carry the most style signal, which is what a persona needs.
    # Clamp to the model's actual depth so an over-large request is harmless.
    requested_layers = config.training.num_layers
    if requested_layers is not None and requested_layers > 0:
        lora_num_layers = min(requested_layers, num_model_layers)
    else:
        lora_num_layers = num_model_layers
    print(f"  adapting top {lora_num_layers}/{num_model_layers} layers")

    # LoRA on the output rows lets the break token's output row train. The input
    # side passes no gradient, so backprop stops at the top adapted layer.
    layer_keys = config.lora.target_modules or default_layer_keys(model)
    lora_keys = [*layer_keys, *token_lora_keys(model)]
    print(f"  token LoRA keys: {', '.join(token_lora_keys(model)) or 'none'}")
    print(f"  {msg_break_token} loss weight: {BREAK_LOSS_WEIGHT}")

    training_args = types.SimpleNamespace(
        # mlx-lm 0.32+ prints `model` and `data` in its run header.
        model=config.model.base_model,
        data=str(config.data_path),
        seed=0,
        num_layers=lora_num_layers,
        fine_tune_type="lora",
        lora_parameters={
            "rank": config.lora.rank,
            "scale": config.lora.alpha / config.lora.rank,
            "dropout": config.lora.dropout,
            "keys": lora_keys,
        },
        batch_size=config.training.batch_size,
        iters=config.training.max_steps,
        val_batches=25,
        learning_rate=config.training.learning_rate,
        warmup_steps=config.training.warmup_steps,
        lr_schedule=None,
        optimizer="adamw",
        optimizer_config={"adamw": {"weight_decay": config.training.weight_decay}},
        steps_per_report=config.training.report_steps,
        steps_per_eval=config.training.eval_steps,
        save_every=config.training.save_steps,
        adapter_path=str(config.output_dir),
        max_seq_length=config.training.max_seq_length,
        grad_checkpoint=True,
        grad_accumulation_steps=config.training.gradient_accumulation_steps,
        resume_adapter_file=None,
    )

    start_time = time.time()

    # track training/validation metrics for plotting
    loss_history: dict[str, list] = {
        "train_iterations": [],
        "train_losses": [],
        "val_iterations": [],
        "val_losses": [],
        "learning_rates": [],
        "iterations_per_second": [],
        "tokens_per_second": [],
        "peak_memory": [],
    }
    training_callback = TrainingCallback(config, loss_history, memory_log)

    early_stop_iteration: int | None = None

    try:
        # call MLX-LM's train_model directly with our datasets
        mx.random.seed(training_args.seed)
        memory_log.set_phase("training")
        memory_log.start_sampler()
        with (
            track_validation(memory_log),
            output_only_token_lora(),
            break_weighted_training(break_id),
        ):
            train_model(
                training_args,
                model,
                LoggedDataset(train_set, memory_log),  # type: ignore[arg-type]
                LoggedDataset(valid_set, memory_log),  # type: ignore[arg-type]
                training_callback=training_callback,  # type: ignore[arg-type]
            )
        memory_log.set_phase("finalizing")

        elapsed = time.time() - start_time

        print("-" * 60)
        print(f"training completed in {format_time(elapsed)}")
        print()

    except StopIteration:
        elapsed = time.time() - start_time

        if training_callback.stopped_early:
            early_stop_iteration = training_callback.stop_iteration
            print("-" * 60)
            print(
                "training stopped early after "
                f"{format_time(elapsed)} at iteration {early_stop_iteration} "
                f"(patience={config.training.early_stopping_patience}, "
                f"threshold={config.training.early_stopping_threshold})"
            )
            print()

            # Save adapter weights since early stopping bypassed MLX-LM's final save
            print("saving adapter weights after early stop...")
            adapter_file = config.output_dir / "adapters.safetensors"
            adapter_weights = dict(tree_flatten(model.trainable_parameters()))
            mx.save_safetensors(str(adapter_file), adapter_weights)
            print(f"adapter weights saved to {adapter_file}")
            print()
        else:
            raise

    except KeyboardInterrupt:
        print("\ntraining interrupted by user")
        elapsed = time.time() - start_time
        print(f"trained for {format_time(elapsed)}")
        sys.exit(1)

    except Exception as e:
        print(f"\nerror during training: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    send_response(
        {
            "type": "training_progress",
            "phase": "finalizing",
            "step": config.training.max_steps,
            "total_steps": config.training.max_steps,
            "progress": 0.95,
            "message": "Saving training artifacts...",
        }
    )

    # save loss history
    print("saving loss history...")
    loss_history_path = config.output_dir / "loss_history.json"

    # prepare loss history data
    loss_data = {
        "train_iterations": loss_history["train_iterations"],
        "train_losses": loss_history["train_losses"],
    }

    # add validation losses if available
    if loss_history["val_iterations"]:
        loss_data["val_iterations"] = loss_history["val_iterations"]
        loss_data["val_losses"] = loss_history["val_losses"]

    # add additional training metrics if available
    if loss_history["learning_rates"]:
        loss_data["learning_rates"] = loss_history["learning_rates"]
    if loss_history["iterations_per_second"]:
        loss_data["iterations_per_second"] = loss_history["iterations_per_second"]
    if loss_history["tokens_per_second"]:
        loss_data["tokens_per_second"] = loss_history["tokens_per_second"]
    if loss_history["peak_memory"]:
        loss_data["peak_memory"] = loss_history["peak_memory"]

    with open(loss_history_path, "w", encoding="utf-8") as f:
        json.dump(loss_data, f, indent=2)

    print(f"loss history saved to {loss_history_path}")

    # generate loss plot
    plot_path = config.output_dir / "loss_plot.png"
    try:
        print("generating loss plot...")
        plot_training_losses(loss_data, plot_path)
        print(f"loss plot saved to {plot_path}")
    except Exception as e:
        print(f"warning: could not generate plot: {e}")

    write_heldout(
        config.output_dir,
        data_path=config.data_path,
        total_examples=len(examples),
        val_indices=val_indices,
        seed=DEFAULT_SEED,
        val_fraction=DEFAULT_VAL_FRACTION,
        sha256=data_hash,
    )

    # save training metadata
    print("saving training metadata...")
    training_metadata_path = config.output_dir / "training_metadata.json"
    training_metadata = {
        "contact_id": config.contact_id,
        "contact_name": config.contact_name,
        "base_model": config.model.base_model,
        "training_data_path": str(config.data_path),
        "training_examples": len(examples),
        "training_config": config.to_dict(),
        "training_start": datetime.now(UTC).isoformat(),
        "training_duration_seconds": elapsed,
        "adapter_path": str(config.output_dir / "adapters.safetensors"),
        "loss_history_path": str(loss_history_path),
        "loss_plot_path": str(plot_path) if plot_path.exists() else None,
        "best_val_loss": (
            None
            if training_callback.best_val_iteration is None
            else training_callback.best_val_loss
        ),
        "best_val_iteration": training_callback.best_val_iteration,
        "early_stopping_iteration": early_stop_iteration,
    }

    with open(training_metadata_path, "w", encoding="utf-8") as f:
        json.dump(training_metadata, f, indent=2)

    print(f"training metadata saved to {training_metadata_path}")

    # copy export metadata to chat_metadata.json for inference
    print("copying export metadata for chat...")
    chat_metadata_path = config.output_dir / "chat_metadata.json"

    # read the original export metadata from data directory
    export_metadata_path = data_dir / "metadata.json"
    if export_metadata_path.exists():
        with open(export_metadata_path, encoding="utf-8") as f:
            export_metadata = json.load(f)

        with open(chat_metadata_path, "w", encoding="utf-8") as f:
            json.dump(export_metadata, f, indent=2)

        print(f"chat metadata saved to {chat_metadata_path}")
    else:
        print(f"warning: export metadata not found at {export_metadata_path}")
        print("chat will use fallback system prompt")

    # Emit final completion progress
    final_loss = loss_history["train_losses"][-1] if loss_history["train_losses"] else None
    send_response(
        {
            "type": "training_progress",
            "phase": "complete",
            "step": config.training.max_steps,
            "total_steps": config.training.max_steps,
            "progress": 1.0,
            "loss": round(final_loss, 6) if final_loss is not None else None,
            "message": "Training complete!",
            "training_duration_secs": int(elapsed),
            "training_examples": len(examples),
        }
    )

    print()
    print("training complete!")
    print(f"  adapter saved to {config.output_dir / 'adapters.safetensors'}")
    print(f"  training metadata saved to {training_metadata_path}")
    print(f"  chat metadata saved to {chat_metadata_path}")
    if plot_path.exists():
        print(f"  loss plot saved to {plot_path}")
