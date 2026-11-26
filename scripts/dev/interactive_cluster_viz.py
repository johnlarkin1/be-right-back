#!/usr/bin/env python3
"""
Interactive 2D/3D cluster visualization for Be Right Back message embeddings.

Creates an interactive HTML visualization using Plotly that shows:
- UMAP-projected message clusters in 2D and 3D
- Topic cluster colors and labels
- Hover tooltips with message previews
- Filter by contact, cluster, or date range

Usage:
    python scripts/interactive_cluster_viz.py
    python scripts/interactive_cluster_viz.py --db-path /path/to/brb.duckdb
    python scripts/interactive_cluster_viz.py --contact "John Doe"
    python scripts/interactive_cluster_viz.py --output viz.html

Dependencies:
    pip install duckdb plotly pandas numpy
"""

import argparse
from datetime import datetime
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots


def get_default_db_path() -> Path:
    """Get default DuckDB database path."""
    return Path.home() / ".be-right-back" / "data" / "db" / "brb.duckdb"


def load_cluster_data(
    db_path: Path,
    contact_filter: str | None = None,
    cluster_filter: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    sample_size: int | None = None,
) -> pd.DataFrame:
    """Load cluster projection data from DuckDB.

    Args:
        db_path: Path to brb.duckdb
        contact_filter: Filter by contact name (substring match)
        cluster_filter: Filter to specific cluster ID
        start_date: Filter to dates after this (YYYY-MM-DD)
        end_date: Filter to dates before this (YYYY-MM-DD)
        sample_size: Randomly sample N points (for large datasets)

    Returns:
        DataFrame with columns: chunk_id, x_2d, y_2d, x_3d, y_3d, z_3d,
                                cluster_id, cluster_label, cluster_color,
                                contact_id, contact_name, message_preview, chunk_date
    """
    print(f"Loading data from: {db_path}")

    conn = duckdb.connect(str(db_path), read_only=True)

    # Build query with optional filters
    query = """
        SELECT
            chunk_id,
            x_2d,
            y_2d,
            x_3d,
            y_3d,
            z_3d,
            cluster_id,
            cluster_label,
            cluster_color,
            contact_id,
            COALESCE(contact_name, contact_id) as contact_name,
            message_preview,
            chunk_date
        FROM chunk_projections
        WHERE 1=1
    """

    params = []

    if contact_filter:
        query += " AND (LOWER(contact_name) LIKE ? OR LOWER(contact_id) LIKE ?)"
        pattern = f"%{contact_filter.lower()}%"
        params.extend([pattern, pattern])

    if cluster_filter is not None:
        query += " AND cluster_id = ?"
        params.append(cluster_filter)

    if start_date:
        query += " AND chunk_date >= ?"
        params.append(start_date)

    if end_date:
        query += " AND chunk_date <= ?"
        params.append(end_date)

    if sample_size:
        query += f" USING SAMPLE {sample_size}"

    query += " ORDER BY cluster_id, chunk_date"

    df = conn.execute(query, params).fetchdf()
    conn.close()

    if df.empty:
        print("Warning: No data found. Make sure analytics pipeline has been run.")
        return df

    print(f"Loaded {len(df):,} points")
    print(
        f"  Clusters: {df['cluster_id'].nunique()} ({sorted(df['cluster_id'].unique())})"
    )
    print(f"  Contacts: {df['contact_name'].nunique()}")

    if df["chunk_date"].notna().any():
        min_date = df["chunk_date"].min()
        max_date = df["chunk_date"].max()
        print(f"  Date range: {min_date} to {max_date}")

    return df


def truncate_text(text: str, max_len: int = 100) -> str:
    """Truncate text for hover display."""
    if not text:
        return "(no preview)"
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def create_2d_scatter(
    df: pd.DataFrame, title: str = "Message Clusters (2D)"
) -> go.Figure:
    """Create interactive 2D scatter plot with hover tooltips."""

    # Prepare hover text
    df = df.copy()
    df["hover_text"] = df.apply(
        lambda row: (
            f"<b>{row['contact_name']}</b><br>"
            f"<b>Topic:</b> {row['cluster_label']}<br>"
            f"<b>Date:</b> {str(row['chunk_date'])[:10] if pd.notna(row['chunk_date']) else 'N/A'}<br>"
            f"<br><i>{truncate_text(row['message_preview'], 150)}</i>"
        ),
        axis=1,
    )

    # Get unique clusters for legend ordering
    cluster_order = sorted(df["cluster_id"].unique())

    fig = go.Figure()

    # Add each cluster as a separate trace for legend control
    for cluster_id in cluster_order:
        cluster_df = df[df["cluster_id"] == cluster_id]

        if cluster_df.empty:
            continue

        # Get cluster info
        cluster_label = cluster_df["cluster_label"].iloc[0]
        cluster_color = cluster_df["cluster_color"].iloc[0]

        # Handle noise cluster differently
        if cluster_id == -1:
            marker_props = dict(
                size=5,
                color="rgba(128, 128, 128, 0.3)",
                symbol="circle",
            )
            name = f"Uncategorized ({len(cluster_df):,})"
        else:
            marker_props = dict(
                size=7,
                color=cluster_color,
                opacity=0.7,
                line=dict(width=0.5, color="white"),
            )
            name = f"{cluster_label} ({len(cluster_df):,})"

        fig.add_trace(
            go.Scatter(
                x=cluster_df["x_2d"],
                y=cluster_df["y_2d"],
                mode="markers",
                marker=marker_props,
                name=name,
                text=cluster_df["hover_text"],
                hoverinfo="text",
                hoverlabel=dict(
                    bgcolor="rgba(0, 0, 0, 0.8)",
                    font_size=12,
                    font_family="monospace",
                ),
            )
        )

    fig.update_layout(
        title=dict(
            text=title,
            font=dict(size=20, color="#00ff41"),
        ),
        showlegend=True,
        legend=dict(
            yanchor="top",
            y=0.99,
            xanchor="left",
            x=1.02,
            bgcolor="rgba(0, 0, 0, 0.8)",
            bordercolor="#00ff41",
            borderwidth=1,
            font=dict(size=10, color="#00ff41"),
        ),
        xaxis=dict(
            title="UMAP 1",
            showgrid=True,
            gridcolor="rgba(0, 255, 65, 0.1)",
            zeroline=False,
            color="#00ff41",
        ),
        yaxis=dict(
            title="UMAP 2",
            showgrid=True,
            gridcolor="rgba(0, 255, 65, 0.1)",
            zeroline=False,
            color="#00ff41",
        ),
        paper_bgcolor="#0a0a0a",
        plot_bgcolor="#0a0a0a",
        hovermode="closest",
        margin=dict(r=250),  # Space for legend
    )

    return fig


def create_3d_scatter(
    df: pd.DataFrame, title: str = "Message Clusters (3D)"
) -> go.Figure:
    """Create interactive 3D scatter plot with hover tooltips."""

    # Prepare hover text
    df = df.copy()
    df["hover_text"] = df.apply(
        lambda row: (
            f"<b>{row['contact_name']}</b><br>"
            f"<b>Topic:</b> {row['cluster_label']}<br>"
            f"<b>Date:</b> {str(row['chunk_date'])[:10] if pd.notna(row['chunk_date']) else 'N/A'}<br>"
            f"<br><i>{truncate_text(row['message_preview'], 150)}</i>"
        ),
        axis=1,
    )

    # Get unique clusters for legend ordering
    cluster_order = sorted(df["cluster_id"].unique())

    fig = go.Figure()

    # Add each cluster as a separate trace
    for cluster_id in cluster_order:
        cluster_df = df[df["cluster_id"] == cluster_id]

        if cluster_df.empty:
            continue

        cluster_label = cluster_df["cluster_label"].iloc[0]
        cluster_color = cluster_df["cluster_color"].iloc[0]

        if cluster_id == -1:
            marker_props = dict(
                size=3,
                color="rgba(128, 128, 128, 0.2)",
            )
            name = f"Uncategorized ({len(cluster_df):,})"
        else:
            marker_props = dict(
                size=4,
                color=cluster_color,
                opacity=0.8,
                line=dict(width=0.3, color="white"),
            )
            name = f"{cluster_label} ({len(cluster_df):,})"

        fig.add_trace(
            go.Scatter3d(
                x=cluster_df["x_3d"],
                y=cluster_df["y_3d"],
                z=cluster_df["z_3d"],
                mode="markers",
                marker=marker_props,
                name=name,
                text=cluster_df["hover_text"],
                hoverinfo="text",
                hoverlabel=dict(
                    bgcolor="rgba(0, 0, 0, 0.9)",
                    font_size=11,
                    font_family="monospace",
                ),
            )
        )

    fig.update_layout(
        title=dict(
            text=title,
            font=dict(size=20, color="#00ff41"),
        ),
        showlegend=True,
        legend=dict(
            yanchor="top",
            y=0.99,
            xanchor="left",
            x=1.02,
            bgcolor="rgba(0, 0, 0, 0.8)",
            bordercolor="#00ff41",
            borderwidth=1,
            font=dict(size=10, color="#00ff41"),
        ),
        scene=dict(
            xaxis=dict(
                title="UMAP 1",
                backgroundcolor="#0a0a0a",
                gridcolor="rgba(0, 255, 65, 0.1)",
                showbackground=True,
                color="#00ff41",
            ),
            yaxis=dict(
                title="UMAP 2",
                backgroundcolor="#0a0a0a",
                gridcolor="rgba(0, 255, 65, 0.1)",
                showbackground=True,
                color="#00ff41",
            ),
            zaxis=dict(
                title="UMAP 3",
                backgroundcolor="#0a0a0a",
                gridcolor="rgba(0, 255, 65, 0.1)",
                showbackground=True,
                color="#00ff41",
            ),
        ),
        paper_bgcolor="#0a0a0a",
        hovermode="closest",
        margin=dict(r=250),
    )

    return fig


def create_combined_view(
    df: pd.DataFrame, title_prefix: str = "Message Clusters"
) -> go.Figure:
    """Create a combined view with 2D on left and 3D on right using subplots."""

    # Prepare hover text
    df = df.copy()
    df["hover_text"] = df.apply(
        lambda row: (
            f"<b>{row['contact_name']}</b><br>"
            f"<b>Topic:</b> {row['cluster_label']}<br>"
            f"<b>Date:</b> {str(row['chunk_date'])[:10] if pd.notna(row['chunk_date']) else 'N/A'}<br>"
            f"<br><i>{truncate_text(row['message_preview'], 120)}</i>"
        ),
        axis=1,
    )

    # Create subplots: 2D on left, 3D on right
    fig = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=("2D Projection", "3D Projection"),
        specs=[[{"type": "scatter"}, {"type": "scatter3d"}]],
        horizontal_spacing=0.08,
    )

    cluster_order = sorted(df["cluster_id"].unique())

    for cluster_id in cluster_order:
        cluster_df = df[df["cluster_id"] == cluster_id]

        if cluster_df.empty:
            continue

        cluster_label = cluster_df["cluster_label"].iloc[0]
        cluster_color = cluster_df["cluster_color"].iloc[0]

        if cluster_id == -1:
            marker_2d = dict(size=4, color="rgba(128, 128, 128, 0.3)")
            marker_3d = dict(size=2, color="rgba(128, 128, 128, 0.2)")
            name = f"Uncategorized ({len(cluster_df):,})"
        else:
            marker_2d = dict(size=6, color=cluster_color, opacity=0.7)
            marker_3d = dict(size=3, color=cluster_color, opacity=0.8)
            name = f"{cluster_label} ({len(cluster_df):,})"

        # 2D scatter (left)
        fig.add_trace(
            go.Scatter(
                x=cluster_df["x_2d"],
                y=cluster_df["y_2d"],
                mode="markers",
                marker=marker_2d,
                name=name,
                text=cluster_df["hover_text"],
                hoverinfo="text",
                legendgroup=f"cluster_{cluster_id}",
                showlegend=True,
            ),
            row=1,
            col=1,
        )

        # 3D scatter (right)
        fig.add_trace(
            go.Scatter3d(
                x=cluster_df["x_3d"],
                y=cluster_df["y_3d"],
                z=cluster_df["z_3d"],
                mode="markers",
                marker=marker_3d,
                name=name,
                text=cluster_df["hover_text"],
                hoverinfo="text",
                legendgroup=f"cluster_{cluster_id}",
                showlegend=False,  # Don't duplicate legend
            ),
            row=1,
            col=2,
        )

    # Calculate cluster stats for title
    n_clusters = len([c for c in cluster_order if c >= 0])
    noise_count = len(df[df["cluster_id"] == -1])
    noise_pct = noise_count / len(df) * 100 if len(df) > 0 else 0

    fig.update_layout(
        title=dict(
            text=f"{title_prefix} - {len(df):,} messages, {n_clusters} topics ({noise_pct:.1f}% uncategorized)",
            font=dict(size=18, color="#00ff41"),
            x=0.5,
        ),
        showlegend=True,
        legend=dict(
            yanchor="top",
            y=0.99,
            xanchor="left",
            x=1.02,
            bgcolor="rgba(0, 0, 0, 0.8)",
            bordercolor="#00ff41",
            borderwidth=1,
            font=dict(size=9, color="#00ff41"),
        ),
        paper_bgcolor="#0a0a0a",
        plot_bgcolor="#0a0a0a",
        hovermode="closest",
        height=700,
        margin=dict(r=300, t=80),
    )

    # Update 2D axes
    fig.update_xaxes(
        title_text="UMAP 1",
        showgrid=True,
        gridcolor="rgba(0, 255, 65, 0.1)",
        zeroline=False,
        color="#00ff41",
        row=1,
        col=1,
    )
    fig.update_yaxes(
        title_text="UMAP 2",
        showgrid=True,
        gridcolor="rgba(0, 255, 65, 0.1)",
        zeroline=False,
        color="#00ff41",
        row=1,
        col=1,
    )

    # Update 3D scene
    fig.update_scenes(
        xaxis=dict(
            title="UMAP 1",
            backgroundcolor="#0a0a0a",
            gridcolor="rgba(0, 255, 65, 0.1)",
            color="#00ff41",
        ),
        yaxis=dict(
            title="UMAP 2",
            backgroundcolor="#0a0a0a",
            gridcolor="rgba(0, 255, 65, 0.1)",
            color="#00ff41",
        ),
        zaxis=dict(
            title="UMAP 3",
            backgroundcolor="#0a0a0a",
            gridcolor="rgba(0, 255, 65, 0.1)",
            color="#00ff41",
        ),
    )

    # Update subplot titles color
    for annotation in fig["layout"]["annotations"]:
        annotation["font"] = dict(size=14, color="#00ff41")

    return fig


def create_contact_comparison(df: pd.DataFrame, top_n: int = 10) -> go.Figure:
    """Create a visualization comparing top N contacts by message volume."""

    # Get top N contacts by message count
    contact_counts = df["contact_name"].value_counts().head(top_n)
    top_contacts = contact_counts.index.tolist()

    df_filtered = df[df["contact_name"].isin(top_contacts)].copy()

    # Create hover text
    df_filtered["hover_text"] = df_filtered.apply(
        lambda row: (
            f"<b>{row['contact_name']}</b><br>"
            f"<b>Topic:</b> {row['cluster_label']}<br>"
            f"<br><i>{truncate_text(row['message_preview'], 100)}</i>"
        ),
        axis=1,
    )

    # Use Plotly Express for easy color-by-contact
    fig = px.scatter(
        df_filtered,
        x="x_2d",
        y="y_2d",
        color="contact_name",
        hover_data={"x_2d": False, "y_2d": False, "contact_name": False},
        custom_data=["hover_text"],
        title=f"Message Distribution by Contact (Top {top_n})",
    )

    # Update hover template
    fig.update_traces(
        hovertemplate="%{customdata[0]}<extra></extra>",
        marker=dict(size=6, opacity=0.7),
    )

    fig.update_layout(
        title=dict(font=dict(size=18, color="#00ff41")),
        legend_title="Contact",
        legend=dict(
            bgcolor="rgba(0, 0, 0, 0.8)",
            bordercolor="#00ff41",
            borderwidth=1,
            font=dict(size=10, color="#00ff41"),
        ),
        xaxis=dict(
            title="UMAP 1",
            showgrid=True,
            gridcolor="rgba(0, 255, 65, 0.1)",
            zeroline=False,
            color="#00ff41",
        ),
        yaxis=dict(
            title="UMAP 2",
            showgrid=True,
            gridcolor="rgba(0, 255, 65, 0.1)",
            zeroline=False,
            color="#00ff41",
        ),
        paper_bgcolor="#0a0a0a",
        plot_bgcolor="#0a0a0a",
        hovermode="closest",
    )

    return fig


def main():
    parser = argparse.ArgumentParser(
        description="Interactive 2D/3D cluster visualization for message embeddings"
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=get_default_db_path(),
        help="Path to brb.duckdb database",
    )
    parser.add_argument(
        "--contact",
        type=str,
        default=None,
        help="Filter to messages from/to this contact (substring match)",
    )
    parser.add_argument(
        "--cluster",
        type=int,
        default=None,
        help="Filter to specific cluster ID",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        default=None,
        help="Filter to messages after this date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default=None,
        help="Filter to messages before this date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=None,
        help="Randomly sample N points (for large datasets)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output HTML file path (default: opens in browser)",
    )
    parser.add_argument(
        "--view",
        choices=["2d", "3d", "combined", "contacts"],
        default="combined",
        help="Visualization type: 2d, 3d, combined (default), or contacts",
    )
    parser.add_argument(
        "--top-contacts",
        type=int,
        default=10,
        help="Number of top contacts to show in 'contacts' view (default: 10)",
    )

    args = parser.parse_args()

    # Validate database exists
    if not args.db_path.exists():
        print(f"Error: Database not found at {args.db_path}")
        print("Make sure you've run the ingestion and analytics pipelines first.")
        return 1

    # Load data
    df = load_cluster_data(
        args.db_path,
        contact_filter=args.contact,
        cluster_filter=args.cluster,
        start_date=args.start_date,
        end_date=args.end_date,
        sample_size=args.sample,
    )

    if df.empty:
        print("No data to visualize. Run the analytics pipeline first:")
        print("  python mlx/src/analytics.py --db-path /path/to/brb.duckdb")
        return 1

    # Build title based on filters
    title_parts = ["Message Clusters"]
    if args.contact:
        title_parts.append(f"({args.contact})")
    if args.start_date or args.end_date:
        date_range = f"{args.start_date or 'start'} to {args.end_date or 'now'}"
        title_parts.append(f"[{date_range}]")
    title = " ".join(title_parts)

    # Create visualization
    print(f"\nCreating {args.view} visualization...")

    if args.view == "2d":
        fig = create_2d_scatter(df, title=f"{title} (2D)")
    elif args.view == "3d":
        fig = create_3d_scatter(df, title=f"{title} (3D)")
    elif args.view == "contacts":
        fig = create_contact_comparison(df, top_n=args.top_contacts)
    else:  # combined
        fig = create_combined_view(df, title_prefix=title)

    # Output
    if args.output:
        output_path = args.output.expanduser()
        fig.write_html(
            str(output_path),
            include_plotlyjs=True,
            full_html=True,
            config={
                "displayModeBar": True,
                "displaylogo": False,
                "modeBarButtonsToRemove": ["lasso2d", "select2d"],
            },
        )
        print(f"Saved to: {output_path}")
    else:
        print("Opening in browser...")
        fig.show(
            config={
                "displayModeBar": True,
                "displaylogo": False,
            }
        )

    return 0


if __name__ == "__main__":
    exit(main())
