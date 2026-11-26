# Bundled Resources

This directory contains resources that are bundled into the Tauri application.

## Structure

```
resources/
├── binaries/
│   ├── python/         # Standalone Python 3.13 runtime (~50MB)
│   └── uv              # uv package installer (~10MB)
└── mlx/                # Python MLX scripts (copied from ../../mlx/)
    ├── src/
    ├── pyproject.toml
    └── uv.lock
```

## How It Works

### Build Time
1. `build.rs` runs shell scripts to prepare resources:
   - `scripts/download-python.sh` - Downloads Python 3.13 for arm64
   - `scripts/download-uv.sh` - Downloads uv binary
   - `scripts/copy-mlx.sh` - Copies MLX scripts from repo root

2. Tauri bundles `resources/**` into the .app via `tauri.conf.json`

### Runtime (First Launch)
1. App checks if `~/.be-right-back/mlx/venv/` exists
2. If not, `python_setup.rs` extracts bundled resources to `~/.be-right-back/mlx/`:
   - Copies Python to `bin/python/`
   - Copies uv to `bin/uv`
   - Copies MLX scripts to `src/`
3. Creates venv: `uv venv venv --python bin/python/bin/python3`
4. Installs dependencies: `uv pip install -e .`
5. Subsequent launches skip setup (venv already exists)

## File Sizes

| Component | Size |
|-----------|------|
| Python runtime | ~50MB |
| uv binary | ~10MB |
| MLX scripts | ~1MB |
| **Total** | **~61MB** |

After installation (in ~/.be-right-back/):
- venv with MLX + dependencies: ~400MB

## Updating Resources

To update Python or uv versions:
1. Edit version numbers in `scripts/download-*.sh`
2. Delete `resources/binaries/`
3. Run `make prepare-bundle`

To update MLX scripts:
1. Edit files in `mlx/` at repo root
2. Run `sh scripts/copy-mlx.sh` or `make prepare-bundle`

## .gitignore

The downloaded binaries are large and should not be committed to git:
- `resources/binaries/python/` - Ignored
- `resources/binaries/uv` - Ignored
- `resources/mlx/` - Ignored (copied during build)

These are regenerated during `make build-desktop` or CI builds.
