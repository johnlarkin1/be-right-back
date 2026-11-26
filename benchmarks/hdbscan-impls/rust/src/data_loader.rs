//! Data loading utilities for HDBSCAN benchmarks.

use duckdb::Connection;
use rand::prelude::*;
use rand_distr::Normal;
use std::path::Path;

/// Default path to the Be Right Back DuckDB database.
pub fn default_db_path() -> std::path::PathBuf {
    dirs::home_dir()
        .expect("Could not find home directory")
        .join(".be-right-back")
        .join("data")
        .join("db")
        .join("brb.duckdb")
}

/// Load embeddings from the Be Right Back DuckDB database.
///
/// # Arguments
/// * `db_path` - Path to the DuckDB database
/// * `limit` - Maximum number of embeddings to load (None for all)
///
/// # Returns
/// Vector of embeddings, each embedding is a Vec<f32> of length 768
pub fn load_real_embeddings(
    db_path: &Path,
    limit: Option<usize>,
) -> Result<Vec<Vec<f32>>, Box<dyn std::error::Error>> {
    if !db_path.exists() {
        return Err(format!(
            "Database not found at {}. Run ingestion first or use synthetic data.",
            db_path.display()
        )
        .into());
    }

    let conn = Connection::open(db_path)?;

    // Cast embedding array to JSON for easier extraction
    let query = if let Some(n) = limit {
        format!(
            "SELECT embedding::JSON FROM message_chunks LIMIT {}",
            n
        )
    } else {
        "SELECT embedding::JSON FROM message_chunks".to_string()
    };

    let mut stmt = conn.prepare(&query)?;
    let mut embeddings: Vec<Vec<f32>> = Vec::new();

    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let json_str: String = row.get(0)?;
        let embedding: Vec<f32> = serde_json::from_str(&json_str)?;
        embeddings.push(embedding);
    }

    if embeddings.is_empty() {
        return Err("No embeddings found in database".into());
    }

    Ok(embeddings)
}

/// Generate synthetic clustered embeddings for reproducible benchmarking.
///
/// Creates blob-like clusters in high-dimensional space, then normalizes
/// to unit sphere (like real embeddings from embedding models).
///
/// # Arguments
/// * `n_samples` - Number of samples to generate
/// * `n_dims` - Number of dimensions (default 768)
/// * `n_clusters` - Number of clusters to generate
/// * `cluster_std` - Standard deviation of clusters
/// * `seed` - Random seed for reproducibility
///
/// # Returns
/// Tuple of (embeddings, ground_truth_labels)
pub fn generate_synthetic_embeddings(
    n_samples: usize,
    n_dims: usize,
    n_clusters: usize,
    cluster_std: f64,
    seed: u64,
) -> (Vec<Vec<f32>>, Vec<i32>) {
    let mut rng = StdRng::seed_from_u64(seed);

    // Generate cluster centers
    let normal = Normal::new(0.0, 1.0).unwrap();
    let mut centers: Vec<Vec<f64>> = Vec::with_capacity(n_clusters);
    for _ in 0..n_clusters {
        let center: Vec<f64> = (0..n_dims).map(|_| normal.sample(&mut rng) * 5.0).collect();
        centers.push(center);
    }

    // Generate samples around cluster centers
    let samples_per_cluster = n_samples / n_clusters;
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(n_samples);
    let mut labels: Vec<i32> = Vec::with_capacity(n_samples);

    let cluster_normal = Normal::new(0.0, cluster_std).unwrap();

    for (cluster_idx, center) in centers.iter().enumerate() {
        let n = if cluster_idx == n_clusters - 1 {
            n_samples - embeddings.len() // Handle remainder
        } else {
            samples_per_cluster
        };

        for _ in 0..n {
            let sample: Vec<f64> = center
                .iter()
                .map(|&c| c + cluster_normal.sample(&mut rng))
                .collect();

            // Normalize to unit sphere
            let norm: f64 = sample.iter().map(|x| x * x).sum::<f64>().sqrt();
            let normalized: Vec<f32> = sample.iter().map(|&x| (x / norm) as f32).collect();

            embeddings.push(normalized);
            labels.push(cluster_idx as i32);
        }
    }

    // Shuffle to mix clusters
    let mut indices: Vec<usize> = (0..n_samples).collect();
    indices.shuffle(&mut rng);

    let shuffled_embeddings: Vec<Vec<f32>> = indices.iter().map(|&i| embeddings[i].clone()).collect();
    let shuffled_labels: Vec<i32> = indices.iter().map(|&i| labels[i]).collect();

    (shuffled_embeddings, shuffled_labels)
}

/// Count the number of embeddings in the database.
pub fn count_real_embeddings(db_path: &Path) -> Result<usize, Box<dyn std::error::Error>> {
    if !db_path.exists() {
        return Ok(0);
    }

    let conn = Connection::open(db_path)?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM message_chunks", [], |row| row.get(0))?;
    Ok(count as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synthetic_embeddings() {
        let (embeddings, labels) = generate_synthetic_embeddings(100, 768, 5, 0.5, 42);

        assert_eq!(embeddings.len(), 100);
        assert_eq!(labels.len(), 100);
        assert_eq!(embeddings[0].len(), 768);

        // Check normalization
        for emb in &embeddings {
            let norm: f32 = emb.iter().map(|x| x * x).sum::<f32>().sqrt();
            assert!((norm - 1.0).abs() < 0.001);
        }
    }
}
