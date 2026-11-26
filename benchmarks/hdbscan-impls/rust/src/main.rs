//! HDBSCAN Clustering Pipeline Benchmark (Rust)
//!
//! Benchmarks the full clustering pipeline:
//!     Load embeddings → PCA (768D→50D) → HDBSCAN → UMAP (50D→3D)
//!
//! Usage:
//!     cargo run --release -- --scales 10000,50000 --synthetic
//!     cargo run --release -- --scales 10000,50000,100000 --real

mod data_loader;

use chrono::{DateTime, Utc};
use clap::Parser;
use hdbscan::{Hdbscan, HdbscanHyperParams};
use nalgebra::{DMatrix, DVector};
use pyo3::prelude::*;
use pyo3::types::{PyList, PyModule};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Instant;
use sysinfo::System;

use data_loader::{count_real_embeddings, default_db_path, generate_synthetic_embeddings, load_real_embeddings};

/// Benchmark configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BenchmarkConfig {
    pca_dims: usize,
    min_cluster_size: usize,
    min_samples: usize,
    umap_n_components: usize,
    umap_n_neighbors: usize,
    umap_min_dist: f64,
    random_state: u64,
}

impl Default for BenchmarkConfig {
    fn default() -> Self {
        Self {
            pca_dims: 50,
            min_cluster_size: 100,
            min_samples: 10,
            umap_n_components: 3,
            umap_n_neighbors: 15,
            umap_min_dist: 0.1,
            random_state: 42,
        }
    }
}

/// Results from a single benchmark run
#[derive(Debug, Serialize, Deserialize)]
struct BenchmarkResult {
    n_points: usize,
    pca_time_sec: f64,
    hdbscan_time_sec: f64,
    umap_time_sec: f64,
    total_time_sec: f64,
    peak_memory_mb: f64,
    n_clusters: usize,
    noise_ratio: f64,
    config: BenchmarkConfig,
}

/// System information for the benchmark report
#[derive(Debug, Serialize, Deserialize)]
struct SystemInfo {
    platform: String,
    cpu_count: usize,
    ram_gb: f64,
    rust_version: String,
}

/// Full benchmark report
#[derive(Debug, Serialize, Deserialize)]
struct BenchmarkReport {
    language: String,
    timestamp: DateTime<Utc>,
    system: SystemInfo,
    results: Vec<BenchmarkResult>,
}

/// CLI arguments
#[derive(Parser, Debug)]
#[command(name = "hdbscan-benchmark")]
#[command(about = "Benchmark HDBSCAN clustering pipeline (Rust implementation)")]
struct Args {
    /// Comma-separated list of sample sizes to benchmark
    #[arg(long, default_value = "10000,50000,100000")]
    scales: String,

    /// Use synthetic data
    #[arg(long, default_value = "true")]
    synthetic: bool,

    /// Use real embeddings from DuckDB
    #[arg(long)]
    real: bool,

    /// Path to DuckDB database (for real data)
    #[arg(long)]
    db_path: Option<PathBuf>,

    /// PCA dimensions
    #[arg(long, default_value = "50")]
    pca_dims: usize,

    /// HDBSCAN min_cluster_size
    #[arg(long, default_value = "100")]
    min_cluster_size: usize,

    /// HDBSCAN min_samples
    #[arg(long, default_value = "10")]
    min_samples: usize,

    /// Output path for JSON results
    #[arg(long)]
    output: Option<PathBuf>,
}

fn get_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    SystemInfo {
        platform: std::env::consts::OS.to_string(),
        cpu_count: sys.cpus().len(),
        ram_gb: (sys.total_memory() as f64) / (1024.0 * 1024.0 * 1024.0),
        rust_version: env!("CARGO_PKG_RUST_VERSION").to_string(),
    }
}

/// Perform PCA dimensionality reduction using nalgebra SVD.
///
/// This is a simplified implementation - for production use, consider
/// using a dedicated library like linfa-reduction.
fn pca_reduce(data: &[Vec<f32>], n_components: usize) -> Vec<Vec<f32>> {
    let n_samples = data.len();
    let n_features = data[0].len();

    // Convert to nalgebra matrix
    let flat: Vec<f64> = data.iter().flatten().map(|&x| x as f64).collect();
    let matrix = DMatrix::from_row_slice(n_samples, n_features, &flat);

    // Center the data
    let mean: DVector<f64> = matrix.row_mean().transpose();
    let centered = DMatrix::from_fn(n_samples, n_features, |i, j| matrix[(i, j)] - mean[j]);

    // Compute SVD (truncated to n_components)
    // Note: This computes full SVD which is inefficient for large matrices
    // For production, use randomized SVD or incremental PCA
    let svd = centered.svd(true, false);

    let u = svd.u.expect("SVD failed to compute U");

    // Take first n_components columns of U * S
    let s = svd.singular_values;
    let mut reduced: Vec<Vec<f32>> = Vec::with_capacity(n_samples);

    for i in 0..n_samples {
        let mut row: Vec<f32> = Vec::with_capacity(n_components);
        for j in 0..n_components.min(s.len()) {
            row.push((u[(i, j)] * s[j]) as f32);
        }
        // Pad with zeros if needed
        while row.len() < n_components {
            row.push(0.0);
        }
        reduced.push(row);
    }

    reduced
}

/// Call Python UMAP via PyO3 (no good Rust UMAP implementation exists)
fn umap_via_python(data: &[Vec<f32>], n_components: usize, n_neighbors: usize, min_dist: f64) -> PyResult<Vec<Vec<f32>>> {
    Python::with_gil(|py| {
        // Import numpy and umap
        let np = PyModule::import(py, "numpy")?;
        let umap_mod = PyModule::import(py, "umap")?;

        // Convert Rust data to numpy array
        let py_data: Vec<&PyList> = data
            .iter()
            .map(|row| PyList::new(py, row.iter()))
            .collect();
        let py_array = PyList::new(py, py_data);
        let np_array = np.call_method1("array", (py_array,))?;

        // Create UMAP reducer
        let umap_class = umap_mod.getattr("UMAP")?;
        let kwargs = pyo3::types::PyDict::new(py);
        kwargs.set_item("n_components", n_components)?;
        kwargs.set_item("n_neighbors", n_neighbors)?;
        kwargs.set_item("min_dist", min_dist)?;
        kwargs.set_item("metric", "euclidean")?;
        kwargs.set_item("random_state", 42)?;

        let reducer = umap_class.call((), Some(kwargs))?;

        // Fit and transform
        let coords = reducer.call_method1("fit_transform", (np_array,))?;

        // Convert back to Rust
        let coords_list = coords.call_method0("tolist")?;
        let result: Vec<Vec<f32>> = coords_list.extract()?;

        Ok(result)
    })
}

/// Run the full clustering pipeline and measure performance.
fn benchmark_pipeline(embeddings: &[Vec<f32>], config: &BenchmarkConfig) -> BenchmarkResult {
    let n_points = embeddings.len();

    // Get initial memory (approximate)
    let sys = System::new_all();
    let mem_before = sys.used_memory();

    // Stage 1: PCA (768D → 50D)
    println!("  PCA ({} points)...", n_points);
    let t0 = Instant::now();
    let x_reduced = pca_reduce(embeddings, config.pca_dims);
    let pca_time = t0.elapsed().as_secs_f64();
    println!("    PCA completed in {:.2}s", pca_time);

    // Stage 2: HDBSCAN clustering
    println!("  HDBSCAN ({} points)...", n_points);
    let t0 = Instant::now();

    // Convert to format expected by hdbscan crate
    let data_for_hdbscan: Vec<Vec<f64>> = x_reduced
        .iter()
        .map(|row| row.iter().map(|&x| x as f64).collect())
        .collect();

    let params = HdbscanHyperParams::builder()
        .min_cluster_size(config.min_cluster_size)
        .min_samples(config.min_samples)
        .build();

    let clusterer = Hdbscan::new(&data_for_hdbscan, params);
    let labels: Vec<i32> = clusterer.cluster().unwrap_or_else(|e| {
        eprintln!("    HDBSCAN clustering failed: {}", e);
        vec![-1; n_points]  // Assign all to noise
    });
    let hdbscan_time = t0.elapsed().as_secs_f64();
    println!("    HDBSCAN completed in {:.2}s", hdbscan_time);

    // Stage 3: UMAP (50D → 3D) via Python
    println!("  UMAP ({} points)...", n_points);
    let t0 = Instant::now();
    let _coords_3d = match umap_via_python(&x_reduced, config.umap_n_components, config.umap_n_neighbors, config.umap_min_dist) {
        Ok(coords) => coords,
        Err(e) => {
            eprintln!("    UMAP failed (Python error): {}", e);
            eprintln!("    Make sure umap-learn is installed: pip install umap-learn");
            vec![vec![0.0; config.umap_n_components]; n_points]
        }
    };
    let umap_time = t0.elapsed().as_secs_f64();
    println!("    UMAP completed in {:.2}s", umap_time);

    // Compute metrics
    let sys_after = System::new_all();
    let mem_after = sys_after.used_memory();
    let peak_memory_mb = (mem_after.saturating_sub(mem_before)) as f64 / (1024.0 * 1024.0);

    // Count clusters (excluding noise label -1)
    let unique_labels: HashSet<i32> = labels.iter().copied().collect();
    let n_clusters = unique_labels.len() - if unique_labels.contains(&-1) { 1 } else { 0 };

    // Calculate noise ratio
    let noise_count = labels.iter().filter(|&&l| l == -1).count();
    let noise_ratio = noise_count as f64 / n_points as f64;

    let total_time = pca_time + hdbscan_time + umap_time;

    println!(
        "  Done: {:.2}s total | {} clusters, {:.1}% noise",
        total_time,
        n_clusters,
        noise_ratio * 100.0
    );

    BenchmarkResult {
        n_points,
        pca_time_sec: (pca_time * 1000.0).round() / 1000.0,
        hdbscan_time_sec: (hdbscan_time * 1000.0).round() / 1000.0,
        umap_time_sec: (umap_time * 1000.0).round() / 1000.0,
        total_time_sec: (total_time * 1000.0).round() / 1000.0,
        peak_memory_mb: (peak_memory_mb * 10.0).round() / 10.0,
        n_clusters,
        noise_ratio: (noise_ratio * 10000.0).round() / 10000.0,
        config: config.clone(),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    // Parse scales
    let scales: Vec<usize> = args
        .scales
        .split(',')
        .map(|s| s.trim().parse().expect("Invalid scale"))
        .collect();

    // Determine data source
    let use_synthetic = !args.real;

    // Create config
    let config = BenchmarkConfig {
        pca_dims: args.pca_dims,
        min_cluster_size: args.min_cluster_size,
        min_samples: args.min_samples,
        ..Default::default()
    };

    // Print header
    println!("\nHDBSCAN Clustering Pipeline Benchmark (Rust)");
    println!("{}", "=".repeat(60));

    let system_info = get_system_info();
    println!("Platform: {}", system_info.platform);
    println!("CPU cores: {}", system_info.cpu_count);
    println!("RAM: {:.1} GB", system_info.ram_gb);

    if use_synthetic {
        println!("\nData source: Synthetic embeddings (768D)");
    } else {
        let db_path = args.db_path.clone().unwrap_or_else(default_db_path);
        let n_available = count_real_embeddings(&db_path).unwrap_or(0);
        println!("\nData source: Real embeddings from {}", db_path.display());
        println!("Available: {} embeddings", n_available);
    }

    println!("\nScales: {:?}", scales);
    println!(
        "Config: PCA dims={}, min_cluster_size={}, min_samples={}",
        config.pca_dims, config.min_cluster_size, config.min_samples
    );
    println!();

    // Run benchmarks
    let mut results = Vec::new();

    for &scale in &scales {
        println!("Benchmarking {} points...", scale);

        // Load or generate data
        let embeddings = if use_synthetic {
            let (emb, _) = generate_synthetic_embeddings(scale, 768, 20, 0.5, config.random_state);
            emb
        } else {
            let db_path = args.db_path.clone().unwrap_or_else(default_db_path);
            load_real_embeddings(&db_path, Some(scale))?
        };

        // Run benchmark
        let result = benchmark_pipeline(&embeddings, &config);
        results.push(result);
    }

    // Print summary table
    println!("\n{}", "=".repeat(80));
    println!("Results Summary");
    println!("{}", "=".repeat(80));
    println!(
        "{:>10} {:>10} {:>12} {:>10} {:>10} {:>10} {:>10} {:>10}",
        "Points", "PCA (s)", "HDBSCAN (s)", "UMAP (s)", "Total (s)", "Mem (MB)", "Clusters", "Noise %"
    );
    println!("{}", "-".repeat(80));

    for r in &results {
        println!(
            "{:>10} {:>10.2} {:>12.2} {:>10.2} {:>10.2} {:>10.0} {:>10} {:>10.1}%",
            r.n_points,
            r.pca_time_sec,
            r.hdbscan_time_sec,
            r.umap_time_sec,
            r.total_time_sec,
            r.peak_memory_mb,
            r.n_clusters,
            r.noise_ratio * 100.0
        );
    }

    // Save results
    let output_path = args.output.unwrap_or_else(|| {
        PathBuf::from(format!(
            "results/benchmark_{}.json",
            Utc::now().format("%Y%m%d_%H%M%S")
        ))
    });

    // Ensure parent directory exists
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let report = BenchmarkReport {
        language: "rust".to_string(),
        timestamp: Utc::now(),
        system: system_info,
        results,
    };

    let json = serde_json::to_string_pretty(&report)?;
    std::fs::write(&output_path, json)?;
    println!("\nResults saved to: {}", output_path.display());

    Ok(())
}
