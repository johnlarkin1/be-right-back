# Scripts

Developer workflow scripts for the Be Right Back project.

## Structure

```
scripts/
  dev/       # Dev/debug Python scripts (visualization, search testing, cluster analysis)
  release/   # Release pipeline (build, codesign, notarize for macOS distribution)
```

## dev/

Standalone Python tools for development and debugging. Uses its own `pyproject.toml` managed by `uv`.

See [dev/README.md](dev/README.md) for usage details.

## release/

Scripts for building, signing, and notarizing the macOS desktop app for distribution.
