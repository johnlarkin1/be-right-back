# personas

CRUD operations and storage layout for trained persona metadata. The app trains one persona, "You" (see `AGENTS.md`).

## Dependency Graph

- **Depends on**: `common` (error types, shared utilities)
- **Depended on by**: `inference`, `cli`, `desktop` (src-tauri)

## Public API (re-exported from `lib.rs`)

### `PersonaRegistry` (unit struct, all methods are associated functions)

- `list() -> Result<Vec<PersonaMetadata>>` -- scans `~/.be-right-back/models/personas/*/metadata.json`, skips corrupt entries with a warning
- `load(persona_id) -> Result<PersonaMetadata>` -- loads a single persona's metadata
- `exists(persona_id) -> Result<bool>` -- checks if the persona directory exists (not whether it has an adapter)
- `register(&PersonaMetadata) -> Result<()>` -- creates persona dir + writes `metadata.json`
- `delete(persona_id) -> Result<()>` -- `remove_dir_all` on the persona directory; bails if it doesn't exist

### `PersonaMetadata` / `TrainingConfig` / `TrainingMetrics`

All `Serialize + Deserialize + Clone`. `PersonaMetadata` has `load(path)` / `save(path)` for JSON round-tripping.

### `storage`

`get_persona_dir` comes from `common::paths` and is re-exported from `lib.rs`. `get_base_models_dir` and `get_personas_dir` also live in `common::paths` — import them from `common` directly.

Not re-exported but pub: `get_metadata_path`, `ensure_directories`.

## Storage Layout

```
~/.be-right-back/models/
  base/                              # base LLM weights
  personas/{persona_id}/
    metadata.json                    # PersonaMetadata
    adapter/adapters.safetensors     # LoRA weights (nested)
    adapters.safetensors             # LoRA weights (flat, legacy)
```

## Gotchas

- **Dual adapter paths**: Adapters can live at either `{persona_id}/adapters.safetensors` or `{persona_id}/adapter/adapters.safetensors`. This crate does not resolve them. The callers check the files.
- **`exists()`**: It only checks if the directory is present. A persona can exist without a trained adapter.
- **Error types**: Functions return `common::Result` (aliased to `Result<T, BrbError>`) via `pub use common::*` in `lib.rs`.
- **`list()` calls `ensure_directories()`**: It creates the full directory tree as a side effect, so calling `list()` on a fresh install is safe.
