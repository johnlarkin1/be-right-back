from config.training import Config
from utils.ipc import send_response
from utils.train_debug import MemoryLog


class TrainingCallback:
    """Callback class to capture loss values during training.

    Emits JSON progress lines on stdout for the Tauri backend to parse,
    following the same JSON-lines protocol used by embed.py and analytics.py.

    Progress lines have the format:
        {"type": "training_progress", "step": N, "total_steps": M, "loss": X, "phase": "training", ...}
    """

    def __init__(self, config: Config, loss_history: dict, memory_log: MemoryLog | None = None):
        self.loss_history = loss_history
        self.memory_log = memory_log
        self.config = config
        self.best_val_loss = float("inf")
        self.best_val_iteration: int | None = None
        self.stopped_early = False
        self.stop_iteration: int | None = None
        self._no_improvement_reports = 0
        self._patience = config.training.early_stopping_patience
        self._threshold = config.training.early_stopping_threshold
        self._total_steps = config.training.max_steps

    def _log(self, event: str, info: dict) -> None:
        if self.memory_log is None:
            return
        if "iteration" in info:
            self.memory_log.step = int(info["iteration"])
        fields = {k: v for k, v in info.items() if isinstance(v, int | float)}
        try:
            self.memory_log.record(event, **fields)
        except Exception:
            pass  # Debug logging must never stop training.

    def on_train_loss_report(self, info: dict) -> None:
        self._log("train_report", info)
        if "train_loss" in info and "iteration" in info:
            self.loss_history["train_losses"].append(float(info["train_loss"]))
            self.loss_history["train_iterations"].append(int(info["iteration"]))

        # Map mlx-lm info keys to loss_history keys
        key_map = {
            "learning_rate": "learning_rates",
            "iterations_per_second": "iterations_per_second",
            "tokens_per_second": "tokens_per_second",
            "peak_memory": "peak_memory",
        }
        for info_key, history_key in key_map.items():
            if info_key in info:
                self.loss_history[history_key].append(float(info[info_key]))

        # Emit JSON progress for Rust to parse
        if "iteration" in info:
            step = int(info["iteration"])
            progress = min(step / max(self._total_steps, 1), 1.0)
            progress_data: dict = {
                "type": "training_progress",
                "phase": "training",
                "step": step,
                "total_steps": self._total_steps,
                "progress": round(progress, 4),
            }
            if "train_loss" in info:
                progress_data["loss"] = round(float(info["train_loss"]), 6)
            if "tokens_per_second" in info:
                progress_data["tokens_per_sec"] = round(float(info["tokens_per_second"]), 1)
            if "peak_memory" in info:
                progress_data["peak_memory_gb"] = round(float(info["peak_memory"]), 2)
            progress_data["message"] = (
                f"Step {step}/{self._total_steps} — loss: {progress_data.get('loss', 'N/A')}"
            )
            send_response(progress_data)

    def on_val_loss_report(self, info: dict) -> None:
        if "val_loss" not in info or "iteration" not in info:
            return

        self._log("val_report", info)
        val_loss = float(info["val_loss"])
        iteration = int(info["iteration"])
        self.loss_history["val_losses"].append(val_loss)
        self.loss_history["val_iterations"].append(iteration)

        # Emit validation progress
        send_response(
            {
                "type": "training_progress",
                "phase": "validating",
                "step": iteration,
                "total_steps": self._total_steps,
                "progress": round(min(iteration / max(self._total_steps, 1), 1.0), 4),
                "val_loss": round(val_loss, 6),
                "best_val_loss": round(self.best_val_loss, 6)
                if self.best_val_loss != float("inf")
                else None,
                "message": f"Validation at step {iteration} — val_loss: {val_loss:.6f}",
            }
        )

        patience_enabled = self._patience is not None and self._patience > 0

        if self.best_val_iteration is None:
            self.best_val_loss = val_loss
            self.best_val_iteration = iteration
            self._no_improvement_reports = 0
            return

        improvement = self.best_val_loss - val_loss
        if patience_enabled:
            if improvement >= self._threshold:
                self._no_improvement_reports = 0
            else:
                self._no_improvement_reports += 1

            if self._patience is not None and self._no_improvement_reports >= self._patience:
                self.stopped_early = True
                self.stop_iteration = iteration
                raise StopIteration("early stopping triggered")

        if val_loss < self.best_val_loss:
            self.best_val_loss = val_loss
            self.best_val_iteration = iteration
