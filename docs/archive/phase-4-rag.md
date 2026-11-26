# Phase 4: RAG Implementation

**Timeline:** Week 4-5
**Status:** 🟡 ~85-90% Complete
**Dependencies:** Phase 3 (inference pipeline must be working) 🟡
**Priority:** High
**Last Updated:** January 2025
**Gap:** RAG not integrated into inference pipeline yet

---

## Overview

Implement Retrieval-Augmented Generation (RAG) to give the AI personas contextual memory. When responding to a prompt, the system retrieves relevant past messages and includes them in the context, making conversations more grounded and realistic.

### Goals

1. Generate embeddings for all messages in a conversation
2. Store embeddings in DuckDB with vector similarity search (VSS)
3. Implement retrieval: given a query, find relevant past messages
4. Inject retrieved context into LLM prompts
5. Manage context window efficiently (8K tokens max)

### Non-Goals (for this phase)

- No semantic chunking (messages are atomic units)
- No hybrid search (just vector similarity for now)
- No re-ranking or advanced retrieval techniques
- No embedding fine-tuning

---

## Architecture

### Components (Planned → Actual)

```
# ACTUAL IMPLEMENTATION:
mlx/src/
├── entry/
│   └── embed.py                # ✅ CLI entry point for embedding
├── ml/
│   └── embeddings.py           # ✅ MLX embedding model wrapper
├── pipelines/
│   └── embedding.py            # ✅ Batch embedding pipeline
└── config/
    └── embedding.py            # ✅ Embedding configuration

crates/ingestion/               # (not crates/rag/ as planned)
├── src/
│   ├── lib.rs                  # ✅ Pipeline orchestration
│   ├── vectordb.rs             # ✅ DuckDB VSS integration
│   ├── search.rs               # ✅ Similarity search with deduplication
│   ├── metadata.rs             # ✅ SQLite ingestion_meta tracking
│   ├── queries.rs              # ✅ Search query building
│   └── stats.rs                # ✅ Contact statistics
└── sql/
    └── duckdb_schema.sql       # ✅ Schema with HNSW indexes

apps/cli/src/commands/
└── ingest.rs                   # ✅ Full ingestion CLI command

~/.be-right-back/
├── data/
│   ├── db/
│   │   ├── brb.db              # ✅ SQLite metadata
│   │   └── brb.duckdb          # ✅ Single DuckDB for all contacts
│   ├── raw/                    # ✅ Message database snapshots
│   └── processed/              # ✅ Processed training data
└── models/                     # ✅ Base models + persona adapters
```

**Model:** `mlx-community/nomicai-modernbert-embed-base-8bit` (768-dim)

### Data Flow

```
Messages (from Phase 1)
    ↓
[Generate embeddings] → nomic-embed-text-v1.5 (256-dim)
    ↓
[Store in DuckDB] → HNSW index for fast similarity search
    ↓
User query
    ↓
[Embed query] → Same embedding model
    ↓
[Similarity search] → Retrieve top-K similar messages
    ↓
[Build context] → Format as conversation history
    ↓
[Inject into prompt] → Send to LLM (Phase 3)
```

---

## Implementation Tasks

### Task 1: Choose and integrate embedding model

**Model selection:**

**Option 1: nomic-embed-text-v1.5 (recommended)**
- Dimensions: 256 (Matryoshka, can truncate from 768)
- Size: ~138MB
- Pros: Compact, fast, high quality
- License: Apache 2.0

**Option 2: BGE-small-en-v1.5**
- Dimensions: 384
- Size: ~133MB
- Pros: Strong performance on semantic similarity
- License: MIT

**Integration approach:**

Use `fastembed` or `ort` (ONNX Runtime) for fast, local inference without Python dependencies.

**Files:** `crates/rag/src/embeddings.rs`

```rust
use ort::{Session, Value};
use ndarray::Array;

pub struct EmbeddingModel {
    session: Session,
    tokenizer: Tokenizer,
}

impl EmbeddingModel {
    pub fn new(model_path: PathBuf) -> Result<Self> {
        let session = Session::builder()?
            .with_model_from_file(model_path)?;

        let tokenizer = Tokenizer::from_pretrained("nomic-ai/nomic-embed-text-v1.5", None)?;

        Ok(Self { session, tokenizer })
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        // Tokenize
        let encoding = self.tokenizer.encode(text, true)?;
        let input_ids = encoding.get_ids();

        // Run inference
        let inputs = vec![Value::from_array(
            Array::from_shape_vec((1, input_ids.len()), input_ids.to_vec())?
        )?];

        let outputs = self.session.run(inputs)?;
        let embeddings = outputs[0].extract_tensor::<f32>()?;

        // Pool (mean pooling)
        let embedding_vec = mean_pool(embeddings);

        // Normalize (L2 norm)
        let normalized = normalize(&embedding_vec);

        Ok(normalized)
    }

    pub fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        texts.iter().map(|t| self.embed(t)).collect()
    }
}

fn mean_pool(embeddings: &Tensor) -> Vec<f32> {
    // Average across sequence dimension
    todo!()
}

fn normalize(vec: &[f32]) -> Vec<f32> {
    let norm = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    vec.iter().map(|x| x / norm).collect()
}
```

**Acceptance criteria:**
- [x] Can load embedding model from disk
- [x] Generates 768-dim embeddings (using ModernBERT instead of nomic-embed)
- [x] Batch processing works (auto-tuned 32-128 based on RAM)
- [x] Fast enough (~366 chunks/sec with batch_size=128)

**Implementation notes:**
- Uses MLX Python instead of ONNX Runtime (better Apple Silicon performance)
- Non-overlapping message chunking (window_size=5, stride=5)
- Conversation-aware chunking (splits on 4-hour gaps)
- Prefix injection for search semantics (`search_document:` / `search_query:`)
- Pipelined embedding with 5000-chunk write buffer

---

### Task 2: Set up DuckDB with VSS extension

**Files:** `crates/rag/src/db/schema.rs`, `crates/rag/src/db/mod.rs`

**DuckDB VSS extension:**

```sql
-- Install VSS extension
INSTALL vss;
LOAD vss;

-- Create table for message embeddings
CREATE TABLE message_embeddings (
    message_id BIGINT PRIMARY KEY,
    text TEXT NOT NULL,
    embedding FLOAT[256] NOT NULL,  -- or FLOAT[384] for BGE
    is_from_me BOOLEAN NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    metadata JSON
);

-- Create HNSW index for fast similarity search
CREATE INDEX message_embeddings_hnsw_idx
ON message_embeddings
USING HNSW(embedding)
WITH (metric = 'cosine');
```

**Rust integration:**

```rust
use duckdb::{Connection, Result};

pub struct VectorDatabase {
    conn: Connection,
}

impl VectorDatabase {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // Load VSS extension
        conn.execute_batch("INSTALL vss; LOAD vss;")?;

        Ok(Self { conn })
    }

    pub fn create_schema(&self, embedding_dim: usize) -> Result<()> {
        self.conn.execute(
            &format!(
                "CREATE TABLE IF NOT EXISTS message_embeddings (
                    message_id BIGINT PRIMARY KEY,
                    text TEXT NOT NULL,
                    embedding FLOAT[{}] NOT NULL,
                    is_from_me BOOLEAN NOT NULL,
                    timestamp TIMESTAMP NOT NULL,
                    metadata JSON
                )",
                embedding_dim
            ),
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS message_embeddings_hnsw_idx
             ON message_embeddings
             USING HNSW(embedding)
             WITH (metric = 'cosine')",
            [],
        )?;

        Ok(())
    }

    pub fn insert_embeddings(
        &self,
        messages: Vec<MessageWithEmbedding>,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;

        for msg in messages {
            tx.execute(
                "INSERT INTO message_embeddings VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    msg.id,
                    msg.text,
                    msg.embedding,
                    msg.is_from_me,
                    msg.timestamp,
                    msg.metadata,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }
}

pub struct MessageWithEmbedding {
    pub id: i64,
    pub text: String,
    pub embedding: Vec<f32>,
    pub is_from_me: bool,
    pub timestamp: DateTime<Utc>,
    pub metadata: serde_json::Value,
}
```

**Note:** DuckDB VSS persistence is experimental. If indexes don't persist, rebuild on startup.

**Acceptance criteria:**
- [x] DuckDB database created successfully
- [x] VSS extension loads without errors
- [x] Can insert embeddings in batches (via Parquet for efficiency)
- [x] HNSW index builds correctly

**Implementation notes:**
- Schema in `crates/ingestion/sql/duckdb_schema.sql`
- `message_chunks` table: 768-dim embeddings, contact info, timestamps
- `analytics_chunks` table: Non-overlapping chunks for clustering
- HNSW indexes with `hnsw_enable_experimental_persistence`
- VSS extension auto-loaded on connection

---

### Task 3: Implement similarity search

**Files:** `crates/rag/src/db/queries.rs`

**Similarity search query:**

```sql
-- Find top K most similar messages
SELECT
    message_id,
    text,
    is_from_me,
    timestamp,
    array_cosine_similarity(embedding, ?1) AS similarity
FROM message_embeddings
ORDER BY similarity DESC
LIMIT ?2;
```

**Rust wrapper:**

```rust
impl VectorDatabase {
    pub fn search_similar(
        &self,
        query_embedding: Vec<f32>,
        top_k: usize,
    ) -> Result<Vec<RetrievedMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT
                message_id,
                text,
                is_from_me,
                timestamp,
                array_cosine_similarity(embedding, ?1) AS similarity
             FROM message_embeddings
             ORDER BY similarity DESC
             LIMIT ?2"
        )?;

        let results = stmt.query_map(
            params![query_embedding, top_k],
            |row| {
                Ok(RetrievedMessage {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    is_from_me: row.get(2)?,
                    timestamp: row.get(3)?,
                    similarity: row.get(4)?,
                })
            },
        )?;

        results.collect()
    }
}

pub struct RetrievedMessage {
    pub id: i64,
    pub text: String,
    pub is_from_me: bool,
    pub timestamp: DateTime<Utc>,
    pub similarity: f32,
}
```

**Filtering options:**

1. **Date range:** Only retrieve messages from past N days
2. **Min similarity:** Filter out low-relevance results (e.g., similarity < 0.5)
3. **Speaker filter:** Only retrieve messages from contact (not user)

```rust
pub fn search_similar_with_filters(
    &self,
    query_embedding: Vec<f32>,
    top_k: usize,
    filters: SearchFilters,
) -> Result<Vec<RetrievedMessage>> {
    let mut query = String::from(
        "SELECT message_id, text, is_from_me, timestamp,
                array_cosine_similarity(embedding, ?1) AS similarity
         FROM message_embeddings
         WHERE 1=1"
    );

    if let Some(min_date) = filters.min_date {
        query.push_str(&format!(" AND timestamp >= '{}'", min_date));
    }

    if let Some(is_from_me) = filters.is_from_me {
        query.push_str(&format!(" AND is_from_me = {}", is_from_me));
    }

    query.push_str(" ORDER BY similarity DESC LIMIT ?2");

    // Execute query...
}

pub struct SearchFilters {
    pub min_date: Option<DateTime<Utc>>,
    pub is_from_me: Option<bool>,
    pub min_similarity: Option<f32>,
}
```

**Acceptance criteria:**
- [x] Similarity search returns relevant messages
- [x] Results are ranked by similarity
- [x] Filters work correctly (contact_id, date range, min_similarity)
- [x] Query performance is fast (<100ms for 10K messages)

**Implementation notes:**
- `crates/ingestion/src/search.rs` implements search with deduplication
- 50% novelty threshold prevents overlapping results
- Dynamic filter building for flexible queries
- 4 deduplication tests in test suite

---

### Task 4: Implement context retrieval and formatting

**Files:** `crates/rag/src/retrieval.rs`, `crates/rag/src/context.rs`

**Retrieval strategy:**

1. Embed the user's current query
2. Search for top-K similar past messages (K = 5-10)
3. Optionally expand context (include messages before/after retrieved messages)
4. Format as conversation history
5. Inject into LLM prompt

**Context expansion:**

```rust
pub fn expand_context(
    &self,
    retrieved: Vec<RetrievedMessage>,
    window_size: usize,  // Messages before/after to include
) -> Result<Vec<Message>> {
    let mut expanded = Vec::new();

    for msg in retrieved {
        // Get surrounding messages
        let context_messages = self.get_messages_around(
            msg.id,
            window_size,
        )?;

        expanded.extend(context_messages);
    }

    // Deduplicate and sort by timestamp
    expanded.sort_by_key(|m| m.timestamp);
    expanded.dedup_by_key(|m| m.id);

    Ok(expanded)
}
```

**Context window management:**

LLMs have limited context windows (8K tokens typical working window for Qwen3-4B). We need to fit:
- System prompt (~100 tokens)
- Retrieved context (~2000 tokens)
- Recent conversation history (~1000 tokens)
- User's current message (~100 tokens)
- Room for response (~1000 tokens)

Total budget: ~4000-5000 tokens used, leaving 3000+ for response.

```rust
pub fn build_context(
    &self,
    query: &str,
    retrieved_messages: Vec<Message>,
    recent_messages: Vec<Message>,
    max_tokens: usize,
) -> Result<Vec<ChatMessage>> {
    let mut context = Vec::new();

    // System prompt
    context.push(ChatMessage {
        role: "system".to_string(),
        content: format!(
            "You are mimicking the texting style of {}. \
             Use the provided conversation history as reference.",
            self.contact_name
        ),
    });

    // Add retrieved context
    let retrieved_tokens = self.estimate_tokens(&retrieved_messages);
    if retrieved_tokens < max_tokens / 2 {
        context.extend(format_messages(retrieved_messages));
    } else {
        // Truncate if too long
        let truncated = self.truncate_to_fit(
            retrieved_messages,
            max_tokens / 2,
        );
        context.extend(format_messages(truncated));
    }

    // Add recent conversation
    context.extend(format_messages(recent_messages));

    // Add current query
    context.push(ChatMessage {
        role: "user".to_string(),
        content: query.to_string(),
    });

    Ok(context)
}

fn format_messages(messages: Vec<Message>) -> Vec<ChatMessage> {
    messages.into_iter().map(|m| ChatMessage {
        role: if m.is_from_me { "user" } else { "assistant" },
        content: m.text,
    }).collect()
}
```

**Acceptance criteria:**
- [x] Context retrieval works end-to-end
- [x] Retrieved messages are relevant to query
- [ ] Context fits within token budget (token counting not implemented)
- [ ] Formatting is correct for LLM input (not integrated with inference)

**Implementation notes:**
- Search functionality complete in `crates/ingestion/src/search.rs`
- Missing: token counter, context builder, truncation strategies
- Missing: context expansion (messages before/after retrieved chunks)

---

### Task 5: Integrate RAG into inference pipeline

**Files:** `crates/rag/src/lib.rs`, update `crates/inference/src/generation.rs`

**Public RAG API:**

```rust
pub struct RAGEngine {
    embedding_model: EmbeddingModel,
    vector_db: VectorDatabase,
}

impl RAGEngine {
    pub fn new(contact_id: &str) -> Result<Self> {
        let model_path = get_embedding_model_path();
        let db_path = get_db_path(contact_id);

        let embedding_model = EmbeddingModel::new(model_path)?;
        let vector_db = VectorDatabase::new(db_path)?;

        Ok(Self {
            embedding_model,
            vector_db,
        })
    }

    pub fn retrieve_context(
        &self,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<Message>> {
        // Embed query
        let query_embedding = self.embedding_model.embed(query)?;

        // Search for similar messages
        let retrieved = self.vector_db.search_similar(
            query_embedding,
            top_k,
        )?;

        // Optionally expand context
        let expanded = self.expand_context(retrieved, 2)?;

        Ok(expanded)
    }
}
```

**Update inference to use RAG:**

```rust
// In crates/inference/src/generation.rs

impl InferenceEngine {
    pub async fn chat_with_rag(
        &mut self,
        persona_id: &str,
        query: &str,
        recent_messages: Vec<ChatMessage>,
    ) -> Result<String> {
        // Load persona's adapter
        self.persona_manager.activate_persona(persona_id).await?;

        // Retrieve relevant context
        let rag_engine = RAGEngine::new(persona_id)?;
        let retrieved = rag_engine.retrieve_context(query, 5)?;

        // Build full context
        let context = build_context(query, retrieved, recent_messages, 4000)?;

        // Generate response
        let config = GenerationConfig::default();
        self.client.chat_completion(context, config).await
    }
}
```

**Acceptance criteria:**
- [ ] RAG integrated into inference pipeline (NOT DONE - critical gap)
- [ ] Retrieved context improves response quality (untested)
- [x] Performance acceptable (retrieval <100ms)
- [ ] No token budget overflows (token counting not implemented)

**Implementation notes:**
- Backend search works but NOT integrated into `chat_with_persona()`
- No `chat_with_rag()` command exists
- No Tauri commands for search
- This is the main gap preventing Phase 4 completion

---

### Task 6: Build embedding pipeline for existing conversations

**Files:** `crates/rag/src/pipeline.rs`

**Purpose:** Batch process all messages for a contact and store embeddings in DuckDB.

```rust
pub fn embed_conversation(
    contact_id: &str,
    messages: Vec<Message>,
) -> Result<()> {
    let embedding_model = EmbeddingModel::new(get_embedding_model_path())?;
    let vector_db = VectorDatabase::new(get_db_path(contact_id))?;

    // Create schema if needed
    vector_db.create_schema(256)?;

    // Batch embed
    let batch_size = 32;
    for chunk in messages.chunks(batch_size) {
        let texts: Vec<String> = chunk.iter().map(|m| m.text.clone()).collect();
        let embeddings = embedding_model.embed_batch(&texts)?;

        let messages_with_embeddings: Vec<MessageWithEmbedding> =
            chunk.iter().zip(embeddings).map(|(msg, emb)| {
                MessageWithEmbedding {
                    id: msg.id,
                    text: msg.text.clone(),
                    embedding: emb,
                    is_from_me: msg.is_from_me,
                    timestamp: msg.timestamp,
                    metadata: serde_json::json!({}),
                }
            }).collect();

        vector_db.insert_embeddings(messages_with_embeddings)?;
    }

    Ok(())
}
```

**CLI integration:**

```bash
# Add to brb-ingest CLI
brb-ingest embed +1234567890

# Or auto-embed after export
brb-ingest export +1234567890 --embed
```

**Acceptance criteria:**
- [x] Can embed entire conversation in batch
- [x] Progress reporting during embedding
- [x] Handles large conversations (10K+ messages)
- [x] Embeddings stored correctly in DuckDB

**Implementation notes:**
- Full pipeline in `mlx/src/pipelines/embedding.py`
- CLI: `brb ingest` runs complete pipeline (snapshot → embed → store)
- Progress callbacks for UI integration
- Parquet intermediate format for efficient bulk loading

---

## Milestones

### Milestone 1: Embedding model working (2-3 days)
- [x] Load and run embedding model
- [x] Generate embeddings for sample messages
- [x] Performance is acceptable (~366 chunks/sec)

### Milestone 2: DuckDB VSS setup (1-2 days)
- [x] DuckDB database created
- [x] VSS extension loaded
- [x] Can store and query embeddings

### Milestone 3: Similarity search (2-3 days)
- [x] Search returns relevant messages
- [x] Performance is fast (<100ms)
- [x] Filters work correctly

### Milestone 4: Integration with inference (1-2 days)
- [ ] RAG improves response quality (NOT INTEGRATED)
- [ ] Context window managed correctly (NOT IMPLEMENTED)
- [ ] No performance regression (untested)

### Milestone 5: End-to-end testing (1-2 days)
- [x] Test with real conversations
- [x] Verify retrieval quality
- [ ] Fix bugs and edge cases (ongoing)

---

## Testing Checkpoints

Before moving to Phase 5, verify:

1. **Retrieval quality:**
   - [x] Retrieved messages are relevant to query
   - [x] Diversity in retrieved results (50% novelty deduplication)
   - [ ] Context expansion works logically (not implemented)

2. **Performance:**
   - [x] Embedding generation <100ms for batch of 32 (~2.7ms per chunk)
   - [x] Similarity search <100ms for 10K messages
   - [x] End-to-end retrieval <200ms

3. **Integration:**
   - [ ] RAG improves LLM responses (NOT INTEGRATED)
   - [ ] No token budget overflows (token counting missing)
   - [ ] Streaming still works with RAG (untested)

4. **Robustness:**
   - [x] Handles empty search results
   - [x] Handles very long messages (chunking)
   - [x] Handles missing embeddings gracefully

---

## Dependencies

### Rust Crates

```toml
[dependencies]
duckdb = "1.1"
ort = "2.0"  # ONNX Runtime
tokenizers = "0.15"
ndarray = "0.16"
```

### External Models

Download and store in `~/.be-right-back/embeddings/model/`:

```bash
# nomic-embed-text-v1.5 (ONNX format)
huggingface-cli download \
  nomic-ai/nomic-embed-text-v1.5 \
  onnx/model.onnx \
  --local-dir ~/.be-right-back/embeddings/model/nomic-embed-text-v1.5/
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Embedding batch (32 msgs) | <100ms |
| Similarity search (10K msgs) | <100ms |
| End-to-end retrieval | <200ms |
| Memory overhead | <500MB |
| Database size | ~10MB per 1K messages |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| VSS index doesn't persist | Medium | Rebuild index on startup (fast with HNSW) |
| Retrieval quality is poor | High | Tune top-K, add filters, experiment with models |
| Embedding model too slow | Medium | Use smaller model, batch aggressively |
| Context window overflow | Medium | Implement smart truncation |
| DuckDB version incompatibility | Low | Pin version, document requirements |

---

## Success Criteria

Phase 4 is complete when:

1. ✅ Embeddings are generated and stored for conversations
2. ✅ Similarity search retrieves relevant messages quickly
3. ❌ RAG improves response quality (NOT INTEGRATED with inference)
4. ✅ Performance targets are met (<200ms end-to-end)
5. ❌ Integration with inference pipeline is seamless (MISSING)
6. ⚠️ Ready for Tauri integration in Phase 5 (backend ready, commands missing)

**Status: ~85-90% complete. Backend infrastructure is production-ready.**

## Remaining Work (~10-15%)

### Critical (to complete Phase 4)

1. **Create public RAG API**
   - Unified `RAGEngine` struct exposing search functionality
   - `retrieve_context(query, top_k)` method
   - Location: `crates/ingestion/src/lib.rs` or new `crates/rag/`

2. **Integrate RAG into inference**
   - Add `chat_with_rag()` to inference crate
   - Call vector search before LLM generation
   - Inject retrieved context into prompt

3. **Add Tauri search commands**
   - `search_messages(query, contact_id, options)`
   - Enable semantic search UI

4. **Context window management**
   - Token counter utility
   - Context builder with truncation
   - Budget checking before LLM call

### Nice-to-Have

- Streaming RAG (incremental retrieval)
- Reranking of search results
- Search history caching
- Context expansion (messages before/after)

**Effort estimate:** 1-2 days to complete integration

**Next phase:** [Phase 5: Tauri Integration](./phase-5-tauri-integration.md)
