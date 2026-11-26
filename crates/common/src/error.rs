use thiserror::Error;

/// Common error types used across the Be Right Back application
#[derive(Error, Debug)]
pub enum BrbError {
    #[error("SQLite error: {0}")]
    DatabaseSqliteError(#[from] rusqlite::Error),

    /// Database error that preserves the source error chain.
    /// Use `BrbError::database("context", source_error)` to construct.
    #[error("Database error: {context}")]
    DatabaseSource {
        context: String,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Parsing error: {0}")]
    Parse(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid data: {0}")]
    InvalidData(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    /// JSON serialization/deserialization error with preserved source chain.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Date/time parse error: {0}")]
    DateTimeParse(String),

    #[error("Template error: {0}")]
    Template(String),

    #[error("Python error: {0}")]
    PythonError(String),

    #[error("Cancelled: {0}")]
    Cancelled(String),

    /// A resource is held by another task; retry later.
    #[error("Busy: {0}")]
    Busy(String),
}

impl BrbError {
    /// Create a database error that preserves the source error chain.
    pub fn database(context: impl Into<String>, source: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> Self {
        BrbError::DatabaseSource {
            context: context.into(),
            source: source.into(),
        }
    }
}

/// Result type alias for convenience
pub type Result<T> = std::result::Result<T, BrbError>;
