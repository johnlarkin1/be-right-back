from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import seaborn as sns


def plot_training_losses(
    loss_data: dict[str, list[Any]], output_path: Path, show: bool = False
) -> None:
    sns.set_theme(style="darkgrid", palette="muted")

    has_loss = bool(loss_data.get("train_iterations"))
    has_lr = bool(loss_data.get("learning_rates"))
    has_throughput = bool(loss_data.get("iterations_per_second"))
    has_memory = bool(loss_data.get("peak_memory"))

    panels = [has_loss, has_lr, has_throughput, has_memory]
    num_panels = sum(panels)
    if num_panels == 0:
        print("  warning: no data to plot")
        return

    fig, axes = plt.subplots(num_panels, 1, figsize=(14, 4 * num_panels), sharex=True)
    if num_panels == 1:
        axes = [axes]

    panel_idx = 0

    if has_loss:
        ax = axes[panel_idx]
        panel_idx += 1

        if loss_data.get("train_iterations") and loss_data.get("train_losses"):
            sns.lineplot(
                x=loss_data["train_iterations"],
                y=loss_data["train_losses"],
                label="Training Loss",
                color="#3b82f6",
                linewidth=2,
                alpha=0.8,
                ax=ax,
            )

        if loss_data.get("val_iterations") and loss_data.get("val_losses"):
            sns.lineplot(
                x=loss_data["val_iterations"],
                y=loss_data["val_losses"],
                label="Validation Loss",
                color="#ef4444",
                linewidth=2.5,
                marker="o",
                markersize=6,
                alpha=0.9,
                ax=ax,
            )

        ax.set_ylabel("Loss", fontsize=13)
        ax.set_title("Training and Validation Loss", fontsize=15, fontweight="bold", pad=15)
        ax.legend(fontsize=11, loc="upper right", frameon=True, shadow=True)

    if has_lr:
        ax = axes[panel_idx]
        panel_idx += 1
        sns.lineplot(
            x=loss_data["train_iterations"],
            y=loss_data["learning_rates"],
            label="Learning Rate",
            color="#8b5cf6",
            linewidth=2,
            alpha=0.8,
            ax=ax,
        )
        ax.set_ylabel("Learning Rate", fontsize=13)
        ax.set_title("Learning Rate Schedule", fontsize=15, fontweight="bold", pad=15)
        ax.legend(fontsize=11, loc="upper right", frameon=True, shadow=True)
        ax.ticklabel_format(style="scientific", axis="y", scilimits=(0, 0))

    if has_throughput:
        ax = axes[panel_idx]
        panel_idx += 1
        sns.lineplot(
            x=loss_data["train_iterations"],
            y=loss_data["iterations_per_second"],
            label="Iterations/sec",
            color="#10b981",
            linewidth=2,
            alpha=0.8,
            ax=ax,
        )
        if loss_data.get("tokens_per_second"):
            ax2 = ax.twinx()
            sns.lineplot(
                x=loss_data["train_iterations"],
                y=loss_data["tokens_per_second"],
                label="Tokens/sec",
                color="#f59e0b",
                linewidth=2,
                alpha=0.8,
                ax=ax2,
            )
            ax2.set_ylabel("Tokens/sec", fontsize=13, color="#f59e0b")
            ax2.tick_params(axis="y", labelcolor="#f59e0b")
            lines1, labels1 = ax.get_legend_handles_labels()
            lines2, labels2 = ax2.get_legend_handles_labels()
            ax.legend(
                lines1 + lines2,
                labels1 + labels2,
                fontsize=11,
                loc="upper right",
                frameon=True,
                shadow=True,
            )
        else:
            ax.legend(fontsize=11, loc="upper right", frameon=True, shadow=True)

        ax.set_ylabel("Iterations/sec", fontsize=13, color="#10b981")
        ax.set_title("Training Throughput", fontsize=15, fontweight="bold", pad=15)
        ax.tick_params(axis="y", labelcolor="#10b981")

    if has_memory:
        ax = axes[panel_idx]
        panel_idx += 1
        sns.lineplot(
            x=loss_data["train_iterations"],
            y=loss_data["peak_memory"],
            label="Peak Memory (GB)",
            color="#ec4899",
            linewidth=2,
            alpha=0.8,
            ax=ax,
        )
        ax.set_ylabel("Memory (GB)", fontsize=13)
        ax.set_title("Peak Memory Usage", fontsize=15, fontweight="bold", pad=15)
        ax.legend(fontsize=11, loc="upper right", frameon=True, shadow=True)

    axes[-1].set_xlabel("Iteration", fontsize=13)
    fig.suptitle("Training Metrics Overview", fontsize=17, fontweight="bold", y=0.995)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"  plot saved to {output_path}")
    print(f"  panels: {num_panels} (loss, lr, throughput, memory)")
    print(f"  training points: {len(loss_data.get('train_iterations', []))}")
    if loss_data.get("val_iterations"):
        print(f"  validation points: {len(loss_data['val_iterations'])}")

    if show:
        print("  displaying plot...")
        plt.show()
    else:
        plt.close()
