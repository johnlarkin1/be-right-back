"""Generate visualizations for benchmark results."""

from dataclasses import asdict
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from rich.console import Console

from .benchmark import BenchmarkResult, SystemInfo

console = Console()

# Set style for all plots
plt.style.use("seaborn-v0_8-darkgrid")
sns.set_palette("husl")

# Custom color palette for write methods
WRITE_METHOD_COLORS = {
    "pandas_insert": "#4C72B0",
    "parquet_bulk": "#55A868",
    "parquet_buffered": "#C44E52",
    "direct_executemany": "#8172B3",
}


def generate_visualizations(
    results: list[BenchmarkResult],
    sys_info: SystemInfo,
    output_dir: Path,
) -> None:
    """Generate all visualization charts."""
    charts_dir = output_dir / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)

    console.print("\n[bold blue]Generating visualizations...[/bold blue]")

    # Convert to DataFrame for easier plotting
    df = pd.DataFrame([asdict(r) for r in results])
    df["batch_size"] = df["config"].apply(lambda x: x["batch_size"])
    df["write_method"] = df["config"].apply(lambda x: x["write_method"])
    df["strategy"] = df.apply(lambda row: f"{row['batch_size']}_{row['write_method']}", axis=1)

    # Generate each chart
    _plot_throughput_comparison(df, charts_dir)
    _plot_batch_size_scaling(df, charts_dir)
    _plot_memory_vs_throughput(df, charts_dir)
    _plot_heatmap(df, charts_dir)
    _plot_time_breakdown(df, charts_dir)
    _generate_html_report(results, sys_info, df, charts_dir, output_dir)

    console.print(f"[bold green]✓ Visualizations saved to: {charts_dir}[/bold green]")


def _plot_throughput_comparison(df: pd.DataFrame, charts_dir: Path) -> None:
    """Generate throughput comparison bar chart."""
    fig, ax = plt.subplots(figsize=(14, 8))

    # Sort by throughput
    df_sorted = df.sort_values("chunks_per_sec", ascending=True)

    # Create horizontal bar chart
    colors = [WRITE_METHOD_COLORS.get(m, "#666666") for m in df_sorted["write_method"]]
    bars = ax.barh(
        range(len(df_sorted)),
        df_sorted["chunks_per_sec"],
        color=colors,
        edgecolor="white",
        linewidth=0.5,
    )

    # Add value labels
    for bar, val in zip(bars, df_sorted["chunks_per_sec"]):
        ax.text(
            val + 5,
            bar.get_y() + bar.get_height() / 2,
            f"{val:.0f}",
            va="center",
            fontsize=10,
        )

    # Labels
    ax.set_yticks(range(len(df_sorted)))
    ax.set_yticklabels(
        [f"batch={r['batch_size']}, {r['write_method']}" for _, r in df_sorted.iterrows()]
    )
    ax.set_xlabel("Chunks per Second", fontsize=12)
    ax.set_title("Embedding Throughput Comparison", fontsize=14, fontweight="bold")

    # Add legend
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in WRITE_METHOD_COLORS.values()]
    ax.legend(
        handles,
        WRITE_METHOD_COLORS.keys(),
        title="Write Method",
        loc="lower right",
    )

    plt.tight_layout()
    plt.savefig(charts_dir / "throughput_comparison.png", dpi=150, bbox_inches="tight")
    plt.close()
    console.print("  ✓ throughput_comparison.png")


def _plot_batch_size_scaling(df: pd.DataFrame, charts_dir: Path) -> None:
    """Generate batch size scaling line chart."""
    fig, ax = plt.subplots(figsize=(10, 6))

    # Plot line for each write method
    for write_method in df["write_method"].unique():
        method_df = df[df["write_method"] == write_method].sort_values("batch_size")
        ax.plot(
            method_df["batch_size"],
            method_df["chunks_per_sec"],
            marker="o",
            markersize=8,
            linewidth=2,
            label=write_method,
            color=WRITE_METHOD_COLORS.get(write_method, "#666666"),
        )

    ax.set_xlabel("Batch Size", fontsize=12)
    ax.set_ylabel("Chunks per Second", fontsize=12)
    ax.set_title("Throughput vs Batch Size", fontsize=14, fontweight="bold")
    ax.set_xticks(df["batch_size"].unique())
    ax.legend(title="Write Method")
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(charts_dir / "batch_size_scaling.png", dpi=150, bbox_inches="tight")
    plt.close()
    console.print("  ✓ batch_size_scaling.png")


def _plot_memory_vs_throughput(df: pd.DataFrame, charts_dir: Path) -> None:
    """Generate memory vs throughput scatter plot."""
    fig, ax = plt.subplots(figsize=(10, 8))

    for write_method in df["write_method"].unique():
        method_df = df[df["write_method"] == write_method]
        ax.scatter(
            method_df["peak_memory_mb"],
            method_df["chunks_per_sec"],
            s=method_df["batch_size"] * 2,  # Size by batch size
            label=write_method,
            color=WRITE_METHOD_COLORS.get(write_method, "#666666"),
            alpha=0.7,
            edgecolor="white",
            linewidth=1,
        )

    # Add annotations for top performers
    top_3 = df.nlargest(3, "chunks_per_sec")
    for _, row in top_3.iterrows():
        ax.annotate(
            f"batch={row['batch_size']}",
            (row["peak_memory_mb"], row["chunks_per_sec"]),
            xytext=(5, 5),
            textcoords="offset points",
            fontsize=9,
        )

    ax.set_xlabel("Peak Memory Usage (MB)", fontsize=12)
    ax.set_ylabel("Chunks per Second", fontsize=12)
    ax.set_title("Memory vs Throughput Trade-off", fontsize=14, fontweight="bold")
    ax.legend(title="Write Method")
    ax.grid(True, alpha=0.3)

    # Add size legend
    sizes = [32, 128, 256]
    for size in sizes:
        ax.scatter([], [], s=size * 2, c="gray", alpha=0.5, label=f"batch={size}")

    plt.tight_layout()
    plt.savefig(charts_dir / "memory_vs_throughput.png", dpi=150, bbox_inches="tight")
    plt.close()
    console.print("  ✓ memory_vs_throughput.png")


def _plot_heatmap(df: pd.DataFrame, charts_dir: Path) -> None:
    """Generate strategy heatmap matrix."""
    # Pivot data for heatmap
    pivot = df.pivot(index="batch_size", columns="write_method", values="chunks_per_sec")

    fig, ax = plt.subplots(figsize=(10, 6))

    # Create heatmap
    sns.heatmap(
        pivot,
        annot=True,
        fmt=".0f",
        cmap="RdYlGn",
        ax=ax,
        cbar_kws={"label": "Chunks/sec"},
        linewidths=0.5,
    )

    ax.set_xlabel("Write Method", fontsize=12)
    ax.set_ylabel("Batch Size", fontsize=12)
    ax.set_title("Strategy Performance Matrix", fontsize=14, fontweight="bold")

    plt.tight_layout()
    plt.savefig(charts_dir / "strategy_heatmap.png", dpi=150, bbox_inches="tight")
    plt.close()
    console.print("  ✓ strategy_heatmap.png")


def _plot_time_breakdown(df: pd.DataFrame, charts_dir: Path) -> None:
    """Generate time breakdown stacked bar chart."""
    fig, ax = plt.subplots(figsize=(14, 8))

    # Sort by total time
    df_sorted = df.sort_values("total_time_sec", ascending=True)

    y_pos = range(len(df_sorted))

    # Stacked bars
    ax.barh(
        y_pos,
        df_sorted["embedding_time_sec"],
        label="Embedding",
        color="#4C72B0",
        edgecolor="white",
    )
    ax.barh(
        y_pos,
        df_sorted["write_time_sec"],
        left=df_sorted["embedding_time_sec"],
        label="Writing",
        color="#55A868",
        edgecolor="white",
    )

    # Labels
    ax.set_yticks(y_pos)
    ax.set_yticklabels(
        [f"batch={r['batch_size']}, {r['write_method']}" for _, r in df_sorted.iterrows()]
    )
    ax.set_xlabel("Time (seconds)", fontsize=12)
    ax.set_title("Time Breakdown: Embedding vs Writing", fontsize=14, fontweight="bold")
    ax.legend(loc="lower right")

    plt.tight_layout()
    plt.savefig(charts_dir / "time_breakdown.png", dpi=150, bbox_inches="tight")
    plt.close()
    console.print("  ✓ time_breakdown.png")


def _generate_html_report(
    results: list[BenchmarkResult],
    sys_info: SystemInfo,
    df: pd.DataFrame,
    charts_dir: Path,
    output_dir: Path,
) -> None:
    """Generate HTML summary report."""
    winner = results[0]  # Already sorted by chunks_per_sec

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Embedding Benchmark Report</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #1a1a2e;
            color: #eee;
        }}
        h1 {{
            color: #00ff41;
            border-bottom: 2px solid #00ff41;
            padding-bottom: 10px;
        }}
        h2 {{
            color: #ffb000;
            margin-top: 30px;
        }}
        .system-info {{
            background: #16213e;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }}
        .winner {{
            background: linear-gradient(135deg, #0a3d2e 0%, #1a5a4a 100%);
            padding: 20px;
            border-radius: 8px;
            border: 2px solid #00ff41;
            margin-bottom: 30px;
        }}
        .winner h2 {{
            color: #00ff41;
            margin-top: 0;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #333;
        }}
        th {{
            background: #16213e;
            color: #00ff41;
        }}
        tr:hover {{
            background: #16213e;
        }}
        .chart-grid {{
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin: 20px 0;
        }}
        .chart-container {{
            background: #16213e;
            padding: 15px;
            border-radius: 8px;
        }}
        .chart-container img {{
            width: 100%;
            height: auto;
            border-radius: 4px;
        }}
        .chart-container h3 {{
            color: #ffb000;
            margin-top: 0;
            font-size: 14px;
        }}
        .metric {{
            display: inline-block;
            background: #16213e;
            padding: 10px 20px;
            border-radius: 8px;
            margin: 5px;
        }}
        .metric-value {{
            font-size: 24px;
            font-weight: bold;
            color: #00ff41;
        }}
        .metric-label {{
            font-size: 12px;
            color: #888;
        }}
    </style>
</head>
<body>
    <h1>🏁 Embedding Benchmark Report</h1>
    <p>Generated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}</p>

    <div class="system-info">
        <h2>System Information</h2>
        <p><strong>Platform:</strong> {sys_info.platform}</p>
        <p><strong>Processor:</strong> {sys_info.processor}</p>
        <p><strong>RAM:</strong> {sys_info.total_ram_gb:.1f} GB</p>
        <p><strong>MLX Device:</strong> {sys_info.mlx_device}</p>
        <p><strong>Python:</strong> {sys_info.python_version}</p>
    </div>

    <div class="winner">
        <h2>🏆 Winning Strategy</h2>
        <div class="metric">
            <div class="metric-value">{winner.chunks_per_sec:.0f}</div>
            <div class="metric-label">chunks/sec</div>
        </div>
        <div class="metric">
            <div class="metric-value">{winner.config.batch_size}</div>
            <div class="metric-label">batch size</div>
        </div>
        <div class="metric">
            <div class="metric-value">{winner.config.write_method}</div>
            <div class="metric-label">write method</div>
        </div>
        <div class="metric">
            <div class="metric-value">{winner.total_time_sec:.1f}s</div>
            <div class="metric-label">total time</div>
        </div>
    </div>

    <h2>Visualizations</h2>
    <div class="chart-grid">
        <div class="chart-container">
            <h3>Throughput Comparison</h3>
            <img src="charts/throughput_comparison.png" alt="Throughput Comparison">
        </div>
        <div class="chart-container">
            <h3>Batch Size Scaling</h3>
            <img src="charts/batch_size_scaling.png" alt="Batch Size Scaling">
        </div>
        <div class="chart-container">
            <h3>Strategy Heatmap</h3>
            <img src="charts/strategy_heatmap.png" alt="Strategy Heatmap">
        </div>
        <div class="chart-container">
            <h3>Memory vs Throughput</h3>
            <img src="charts/memory_vs_throughput.png" alt="Memory vs Throughput">
        </div>
        <div class="chart-container">
            <h3>Time Breakdown</h3>
            <img src="charts/time_breakdown.png" alt="Time Breakdown">
        </div>
    </div>

    <h2>Full Results</h2>
    <table>
        <thead>
            <tr>
                <th>Rank</th>
                <th>Batch Size</th>
                <th>Write Method</th>
                <th>Chunks/sec</th>
                <th>Total Time</th>
                <th>Embed Time</th>
                <th>Write Time</th>
                <th>Memory</th>
            </tr>
        </thead>
        <tbody>
"""

    for i, r in enumerate(results):
        rank = "🏆" if i == 0 else str(i + 1)
        html += f"""            <tr>
                <td>{rank}</td>
                <td>{r.config.batch_size}</td>
                <td>{r.config.write_method}</td>
                <td>{r.chunks_per_sec:.0f}</td>
                <td>{r.total_time_sec:.1f}s</td>
                <td>{r.embedding_time_sec:.1f}s</td>
                <td>{r.write_time_sec:.1f}s</td>
                <td>{r.peak_memory_mb:.0f} MB</td>
            </tr>
"""

    html += """        </tbody>
    </table>

    <h2>Recommendations</h2>
    <ul>
        <li><strong>For maximum throughput:</strong> Use the winning strategy above.</li>
        <li><strong>For low-memory systems:</strong> Consider smaller batch sizes with pandas_insert.</li>
        <li><strong>At scale:</strong> Test winning strategy on full dataset before deploying.</li>
    </ul>
</body>
</html>
"""

    report_path = output_dir / "benchmark_report.html"
    with open(report_path, "w") as f:
        f.write(html)

    console.print(f"  ✓ benchmark_report.html")


if __name__ == "__main__":
    console.print("Run this via: python -m src.benchmark --visualize")
