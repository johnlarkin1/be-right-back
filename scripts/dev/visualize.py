#!/usr/bin/env python3
"""
Visualization script for Be Right Back iMessage conversation analytics.

Generates:
1. Timeline scatter plot showing message activity over time
2. Histogram showing message length distribution
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import pandas as pd
import numpy as np
import seaborn as sns

# Set style
sns.set_style("whitegrid")
plt.rcParams["figure.figsize"] = (14, 6)
plt.rcParams["font.size"] = 10
plt.rcParams["axes.labelsize"] = 12
plt.rcParams["axes.titlesize"] = 14
plt.rcParams["xtick.labelsize"] = 10
plt.rcParams["ytick.labelsize"] = 10


def load_distribution_data(json_path: Path) -> dict:
    """Load distribution JSON file."""
    with open(json_path, "r") as f:
        return json.load(f)


def create_timeline_plot(data: dict, output_path: Path):
    """
    Create timeline scatter plot showing daily message counts.

    X-axis: Date
    Y-axis: Stacked dots or scatter with size representing message count
    """
    daily_counts = data["daily_message_counts"]

    if not daily_counts:
        print("No daily message counts found in data")
        return

    # Convert to DataFrame
    df = pd.DataFrame(daily_counts)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")

    # Create figure with two subplots
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), height_ratios=[2, 1])

    # Plot 1: Scatter plot with size representing message count
    scatter_size = df["total"] * 5  # Scale for visibility
    scatter = ax1.scatter(
        df["date"],
        np.ones(len(df)),
        s=scatter_size,
        c=df["total"],
        cmap="viridis",
        alpha=0.6,
        edgecolors="black",
        linewidth=0.5,
    )

    # Add colorbar
    cbar = plt.colorbar(scatter, ax=ax1)
    cbar.set_label("Messages per Day", rotation=270, labelpad=20)

    # Format x-axis
    ax1.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45, ha="right")

    # Remove y-axis (not meaningful for this viz)
    ax1.set_yticks([])
    ax1.set_ylabel("")

    contact_name = data.get("contact_name", data.get("contact_id", "Unknown"))
    ax1.set_title(
        f"Message Activity Timeline - {contact_name}", fontsize=16, fontweight="bold"
    )
    ax1.set_xlabel("Date", fontsize=12)
    ax1.grid(True, alpha=0.3)

    # Plot 2: Line plot showing 7-day rolling average
    df["rolling_avg"] = df["total"].rolling(window=7, center=True).mean()
    df["rolling_from_me"] = df["from_me"].rolling(window=7, center=True).mean()
    df["rolling_from_them"] = df["from_them"].rolling(window=7, center=True).mean()

    ax2.plot(
        df["date"],
        df["rolling_avg"],
        label="Total (7-day avg)",
        linewidth=2,
        color="purple",
    )
    ax2.plot(
        df["date"],
        df["rolling_from_me"],
        label="From Me (7-day avg)",
        linewidth=1.5,
        color="blue",
        alpha=0.7,
    )
    ax2.plot(
        df["date"],
        df["rolling_from_them"],
        label="From Them (7-day avg)",
        linewidth=1.5,
        color="orange",
        alpha=0.7,
    )

    # Format x-axis
    ax2.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45, ha="right")

    ax2.set_ylabel("Messages per Day", fontsize=12)
    ax2.set_xlabel("Date", fontsize=12)
    ax2.legend(loc="best")
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"Timeline plot saved to: {output_path}")
    plt.close()


def create_histogram_plot(data: dict, output_path: Path):
    """
    Create histogram showing message length distribution.

    Shows overall distribution plus separate distributions for messages
    from user vs contact.
    """
    dist_data = data["message_length_distribution"]

    # Extract histogram data
    overall_hist = dist_data["overall"]["histogram"]
    from_me_hist = dist_data["from_me"]["histogram"]
    from_them_hist = dist_data["from_them"]["histogram"]

    # Extract percentiles
    overall_percentiles = dist_data["overall"]["percentiles"]

    # Create figure with subplots
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))

    # Plot 1: Overall distribution with percentiles
    ranges = [h["range"] for h in overall_hist]
    counts = [h["count"] for h in overall_hist]
    percentages = [h["percentage"] for h in overall_hist]

    bars = ax1.bar(
        ranges,
        percentages,
        alpha=0.7,
        color="steelblue",
        edgecolor="black",
        linewidth=1.5,
    )

    # Add value labels on bars
    for bar in bars:
        height = bar.get_height()
        ax1.text(
            bar.get_x() + bar.get_width() / 2.0,
            height,
            f"{height:.1f}%",
            ha="center",
            va="bottom",
            fontsize=10,
            fontweight="bold",
        )

    contact_name = data.get("contact_name", data.get("contact_id", "Unknown"))
    ax1.set_title(
        f"Message Length Distribution - {contact_name}", fontsize=14, fontweight="bold"
    )
    ax1.set_xlabel("Message Length (characters)", fontsize=12)
    ax1.set_ylabel("Percentage of Messages", fontsize=12)
    ax1.set_ylim(0, max(percentages) * 1.2)
    ax1.grid(True, alpha=0.3, axis="y")

    # Add percentile information as text
    percentile_text = "Percentiles:\n"
    for p in overall_percentiles:
        percentile_text += f"{p['percentile']}th: {p['value']} chars\n"
    ax1.text(
        0.98,
        0.98,
        percentile_text,
        transform=ax1.transAxes,
        verticalalignment="top",
        horizontalalignment="right",
        bbox=dict(boxstyle="round", facecolor="wheat", alpha=0.5),
        fontsize=9,
        family="monospace",
    )

    # Plot 2: Comparison between "from me" vs "from them"
    x = np.arange(len(ranges))
    width = 0.35

    from_me_pct = [h["percentage"] for h in from_me_hist]
    from_them_pct = [h["percentage"] for h in from_them_hist]

    bars1 = ax2.bar(
        x - width / 2,
        from_me_pct,
        width,
        label="From Me",
        alpha=0.8,
        color="cornflowerblue",
        edgecolor="black",
        linewidth=1,
    )
    bars2 = ax2.bar(
        x + width / 2,
        from_them_pct,
        width,
        label="From Them",
        alpha=0.8,
        color="coral",
        edgecolor="black",
        linewidth=1,
    )

    ax2.set_title(
        "Message Length Distribution by Sender", fontsize=14, fontweight="bold"
    )
    ax2.set_xlabel("Message Length (characters)", fontsize=12)
    ax2.set_ylabel("Percentage of Messages", fontsize=12)
    ax2.set_xticks(x)
    ax2.set_xticklabels(ranges, rotation=0)
    ax2.legend(loc="best", fontsize=11)
    ax2.grid(True, alpha=0.3, axis="y")

    plt.tight_layout()
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    print(f"Histogram plot saved to: {output_path}")
    plt.close()


def main():
    parser = argparse.ArgumentParser(
        description="Generate visualizations for iMessage conversation analytics"
    )
    parser.add_argument(
        "--stats-json",
        type=Path,
        required=True,
        help="Path to the distribution JSON file",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Directory to save output PNG files",
    )
    parser.add_argument(
        "--contact-id",
        type=str,
        required=True,
        help="Contact ID for filename generation",
    )

    args = parser.parse_args()

    # Validate input file exists
    if not args.stats_json.exists():
        print(f"Error: Stats JSON file not found: {args.stats_json}", file=sys.stderr)
        sys.exit(1)

    # Create output directory if it doesn't exist
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Load data
    print(f"Loading data from: {args.stats_json}")
    data = load_distribution_data(args.stats_json)

    # Generate output filenames (no prefix needed since files are in per-contact directory)
    timeline_path = args.output_dir / "timeline.png"
    histogram_path = args.output_dir / "histogram.png"

    # Create plots
    print("Generating timeline plot...")
    create_timeline_plot(data, timeline_path)

    print("Generating histogram plot...")
    create_histogram_plot(data, histogram_path)

    print("\nVisualization complete!")
    print(f"Timeline: {timeline_path}")
    print(f"Histogram: {histogram_path}")


if __name__ == "__main__":
    main()
