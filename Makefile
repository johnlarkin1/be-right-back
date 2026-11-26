.PHONY: bindings eval-recall eval-corpus eval-corpus-embed eval-stride synthetic-build synthetic-install synthetic-verify synthetic-uninstall help lint lint-py lint-python build test test-python eval-planner eval-persona persona-experiment test-desktop test-desktop-watch test-frontend test-e2e test-e2e-ui test-all fmt check clean dev install llm-docs run-desktop build-desktop update-icons unfurl-assets cloc prepare-bundle prepare-bundle-dev release publish-release check-release _guard-no-internal sync-public sync-public-dry design-system

# Default target
help:
	@echo "Available targets:"
	@echo "  make install      - Install all dependencies (Rust + npm + Python)"
	@echo "  make lint         - Run all linters (Rust + TypeScript + Python)"
	@echo "  make fmt          - Format all code (Rust + TypeScript + Python)"
	@echo "  make check        - Run cargo check on all workspace crates"
	@echo "  make build        - Build all workspace crates in release mode"
	@echo "  make test         - Run all tests"
	@echo "  make dev          - Run Tauri app in development mode"
	@echo "  make run-desktop  - Alias for 'make dev'"
	@echo "  make build-desktop - Build desktop app for distribution"
	@echo "  make prepare-bundle-dev - Set up local dev environment (MLX scripts + venv)"
	@echo "  make update-icons - Update website favicons and Tauri app icons"
	@echo "  make unfurl-assets - Generate social media unfurl assets (GIF, MP4, PNG, etc.)"
	@echo "  make release      - Build, sign, notarize DMG, tag + release on internal repo"
	@echo "  make publish-release - Ship it: sync to public repo + public GitHub release"
	@echo "  make check-release - Verify the public release for VERSION has the DMG"
	@echo "  make clean        - Clean all build artifacts"
	@echo "  make llm-docs     - Generate documentation for LLM context using repomix"
	@echo "  make cloc         - Count lines of code in the project"
	@echo "  make design-system - Build the design system files (design-system/dist)"

# Install dependencies
install:
	@echo "Installing Rust dependencies..."
	cargo fetch
	@echo "Installing npm dependencies..."
	cd apps/desktop && npm install

# Linting (all - Rust + TypeScript + Python + Website)
lint: lint-rust lint-desktop lint-python lint-website
	@echo "All linting complete!"

# Lint Rust only
lint-rust:
	@echo "Running cargo clippy..."
	cargo clippy --all-targets -- -D warnings
	@echo "Checking Rust formatting..."
	cargo fmt -- --check

# Lint desktop app (Prettier format check)
lint-desktop:
	@echo "Checking desktop TypeScript formatting..."
	cd apps/desktop && npm run format:check

lint-py: lint-python

lint-python:
	@echo "Running ruff check..."
	uv run --directory mlx ruff check .
	uv run --directory synthetic ruff check .
	@echo "Checking Python formatting..."
	uv run --directory mlx ruff format --check .
	uv run --directory synthetic ruff format --check .
	@echo "Running mypy..."
	uv run --directory mlx mypy src
	uv run --directory synthetic mypy src

# Lint website (ESLint)
lint-website:
	@echo "Running website ESLint..."
	cd apps/website && npm run lint

# Lint website with clean install (matches CI exactly)
lint-website-ci:
	@echo "Running website ESLint with clean install (matches CI)..."
	cd apps/website && rm -rf node_modules && npm ci && npm run lint

# Format code
fmt:
	@echo "Formatting Rust code..."
	cargo fmt
	@echo "Formatting TypeScript code..."
	cd apps/desktop && npm run format
	@echo "Formatting Python code..."
	uv run --directory mlx ruff format .
	uv run --directory mlx ruff check --fix .
	uv run --directory synthetic ruff format .
	uv run --directory synthetic ruff check --fix .

# Check compilation without building
check:
	@echo "Running cargo check..."
	cargo check --all-targets

# Build all crates
build:
	@echo "Building workspace in release mode..."
	cargo build --release

# Regenerate TypeScript bindings from Rust types (ts-rs writes them during tests)
bindings:
	@echo "Regenerating TypeScript bindings..."
	cargo test --workspace export_bindings_
	@cd apps/desktop && npx tsc --noEmit

# Run tests
test:
	@echo "Running all Rust tests..."
	cargo test

# Run Python tests
test-python:
	@echo "Running Python tests..."
	cd mlx && uv run pytest tests/
	cd synthetic && uv run pytest tests/

# Synthetic iMessage corpus: demo data + RAG eval gold, built from synthetic/world/.
# See synthetic/README.md. `install` drops a snapshot into ~/.be-right-back/data/raw/
# so the whole app runs on fake data; real snapshots are never deleted.
#
# The anchor is PINNED, not "today". Filler placement is weekday-weighted, so a
# corpus rebuilt on a different day of the week lands its messages differently,
# renumbers ROWIDs, and invalidates every gold key and committed eval rank.
# Override for a fresh-looking demo: make synthetic-install SYNTHETIC_ANCHOR=today
SYNTHETIC_ANCHOR ?= 2026-07-26

# Corpus size, measured rather than guessed. At the old 8k the same 19 gold
# queries scored hit@1 0.211 / MRR 0.421; at 80k they score 0.000 / 0.268, while
# hit@10 barely moves (0.632 -> 0.579). A small haystack was hiding a ranking
# failure, not a recall one. 80k is ~20k chunks against production's ~229k, so it
# still flatters -- but it costs 3s to build, 53s to embed and 38MB on disk,
# which is the point at which the artifact stays publishable. Raise it to probe
# further: make eval-corpus SYNTHETIC_TARGET=400000
SYNTHETIC_TARGET ?= 80000

synthetic-build:
	@echo "Building synthetic corpus ($(SYNTHETIC_TARGET) msgs, anchor $(SYNTHETIC_ANCHOR))..."
	uv run --directory synthetic python -m brb_synthetic.cli build \
		--anchor $(SYNTHETIC_ANCHOR) --target $(SYNTHETIC_TARGET)

synthetic-install:
	@echo "Building and installing synthetic corpus ($(SYNTHETIC_TARGET) msgs, anchor $(SYNTHETIC_ANCHOR))..."
	uv run --directory synthetic python -m brb_synthetic.cli build \
		--anchor $(SYNTHETIC_ANCHOR) --target $(SYNTHETIC_TARGET) --install

synthetic-verify:
	@echo "Verifying synthetic corpus against the app's own SQL..."
	uv run --directory synthetic python -m brb_synthetic.cli verify

synthetic-uninstall:
	@echo "Removing installed synthetic snapshots..."
	uv run --directory synthetic python -m brb_synthetic.cli uninstall

# Query-planner eval: regex baseline + LLM extraction + live hybrid, then score.
# See eval/planner/README.md. Override MODEL/TAG to benchmark a different tier.
MODEL ?= mlx-community/Qwen3.5-9B-4bit
TAG ?= 9b
eval-planner:
	@echo "1/4 regex baseline -> eval/planner/regex_out.json"
	cargo run -q -p ingestion --example plan_dump
	@echo "2/4 LLM extraction ($(MODEL)) -> eval/planner/llm_out_$(TAG).json"
	HF_HUB_OFFLINE=1 ~/.be-right-back/mlx-venv/bin/python eval/planner/run_llm_planner.py $(MODEL) $(TAG)
	@echo "3/4 live hybrid (Rust resolve_turn_plan) -> eval/planner/llm_out_hybrid_live_$(TAG).json"
	cargo run -q -p inference --example plan_eval -- $(MODEL) $(TAG)
	@echo "4/4 score -> eval/planner/REPORT.md"
	~/.be-right-back/mlx-venv/bin/python eval/planner/score.py \
		eval/planner/regex_out.json eval/planner/llm_out_$(TAG).json eval/planner/llm_out_hybrid_live_$(TAG).json

# Retrieval recall eval: the 19 authored gold queries against the real agent
# search surface, scored as message-coverage recall@k / MRR per stratum and
# diffed against eval/retrieval/baseline.json. Run `make eval-corpus` once first.
# Non-zero exit on regression; BRB_EVAL_BLESS=1 accepts the new ranks.
EVAL_DB ?= $(HOME)/.be-right-back/eval/synthetic.duckdb
eval-recall:
	cargo run -q -p inference --example eval_recall -- --db $(EVAL_DB)

# Build the eval corpus into its OWN DuckDB, beside the real one rather than over
# it -- a dev machine's brb.duckdb is hours of embedding that re-ingesting would
# destroy. The init step exists because the schema is defined in Rust only and
# embed.py assumes the tables are already there (in production, Rust opens the
# database first). Rebuild after any change to synthetic/world/.
# EMBED_ARGS passes chunking flags to embed.py, e.g. EMBED_ARGS="--stride 6".
EMBED_ARGS ?=
eval-corpus: synthetic-build eval-corpus-embed

eval-corpus-embed:
	@echo "Initializing $(EVAL_DB)..."
	@rm -f $(EVAL_DB)
	cargo run -q -p inference --example eval_recall -- --db $(EVAL_DB) --init
	@echo "Embedding synthetic corpus (real chunker + real ModernBERT)..."
	PYTHONPATH=$(HOME)/.be-right-back/mlx/src HF_HUB_OFFLINE=1 \
		$(HOME)/.be-right-back/mlx-venv/bin/python $(HOME)/.be-right-back/mlx/src/entry/embed.py \
		--snapshot-db synthetic/build/chat_snapshot.db \
		--addressbook-db synthetic/build/addressbook_snapshot.db \
		--output-db $(EVAL_DB) --ingestion-id 1 $(EMBED_ARGS) >/dev/null
	@echo "Eval corpus ready: $(EVAL_DB)"

# Chunk stride vs recall. Builds the synthetic corpus once, embeds it once per
# stride into its own DuckDB, and scores each. Window stays at the default 8.
# A regression against the baseline is expected output here, not a failure.
STRIDES ?= 4 6 8
eval-stride: synthetic-build
	@for s in $(STRIDES); do \
		db=$(HOME)/.be-right-back/eval/synthetic-stride$$s.duckdb; \
		echo "=== stride $$s ==="; \
		$(MAKE) --no-print-directory eval-corpus-embed EVAL_DB=$$db EMBED_ARGS="--stride $$s" || exit 1; \
		$(HOME)/.be-right-back/mlx-venv/bin/python -c "import duckdb, sys; print('chunks:', duckdb.connect(sys.argv[1], read_only=True).execute('SELECT COUNT(*) FROM message_chunks').fetchone()[0])" $$db; \
		$(MAKE) --no-print-directory eval-recall EVAL_DB=$$db || true; \
	done

# Persona fidelity eval: held-out perplexity and style, base model vs base + adapter.
# See eval/persona/README.md. PERSONA is a persona id or a persona directory.
# Pass extra flags with ARGS, e.g. ARGS="--generate 0 --max-examples 50".
PERSONA ?=
ARGS ?=
eval-persona:
	@test -n "$(PERSONA)" || { echo "usage: make eval-persona PERSONA=<id or dir> [ARGS=...]"; exit 1; }
	HF_HUB_OFFLINE=1 ~/.be-right-back/mlx-venv/bin/python mlx/src/entry/eval_persona.py \
		--persona-dir $(if $(wildcard $(PERSONA)/.),$(PERSONA),$(HOME)/.be-right-back/models/personas/$(PERSONA)) $(ARGS)

# Quick training experiment: retrain into a separate folder, then run a short eval.
# The real persona and the app's persona list stay untouched.
# Defaults match the 9B tier profile, with fewer steps and a smaller eval.
#   make persona-experiment                      # PERSONA=you STEPS=200
#   make persona-experiment STEPS=300 NAME=w3
EXP_PERSONA = $(or $(PERSONA),you)
STEPS ?= 200
NAME ?= break-weight
EXP_DIR = $(HOME)/.be-right-back/experiments/$(EXP_PERSONA)-$(NAME)
persona-experiment:
	@test -f $(HOME)/.be-right-back/data/processed/$(EXP_PERSONA)/train.jsonl || { echo "no export for $(EXP_PERSONA): train it once in the app first"; exit 1; }
	HF_HUB_OFFLINE=1 ~/.be-right-back/mlx-venv/bin/python mlx/src/entry/train.py \
		--data $(HOME)/.be-right-back/data/processed/$(EXP_PERSONA) \
		--output $(EXP_DIR) \
		--base-model mlx-community/Qwen3.5-9B-4bit \
		--max-steps $(STEPS) --lora-rank 16 --lora-alpha 32 --batch-size 1 \
		--grad-accum 4 --max-seq-length 1024 --num-layers 16 --eval-steps 50 \
		--no-early-stopping
	HF_HUB_OFFLINE=1 ~/.be-right-back/mlx-venv/bin/python mlx/src/entry/eval_persona.py \
		--persona-dir $(EXP_DIR) --max-examples 100 --generate 30

# Run desktop frontend tests
test-desktop:
	@echo "Running desktop frontend tests..."
	cd apps/desktop && npm test

# Alias for test-desktop
test-frontend: test-desktop

# Run desktop frontend tests in watch mode
test-desktop-watch:
	@echo "Running desktop frontend tests in watch mode..."
	cd apps/desktop && npm run test -- --watch

# Run Playwright E2E tests
test-e2e:
	@echo "Running Playwright E2E tests..."
	cd apps/desktop && npm run test:e2e

# Run Playwright E2E tests with UI
test-e2e-ui:
	@echo "Running Playwright E2E tests with UI..."
	cd apps/desktop && npm run test:e2e:ui

# Run all tests (Rust + Python + Desktop + E2E)
test-all: test test-python test-desktop test-e2e
	@echo "All tests complete!"

# Run development server
dev: install
	@echo "Starting Tauri development server..."
	cd apps/desktop && npm run tauri dev

# Alias for dev
run-desktop: dev

# Prepare bundled resources (Python, uv, MLX scripts)
prepare-bundle:
	@echo "preparing resources for bundling..."
	cd apps/desktop/src-tauri && sh scripts/download-python.sh
	cd apps/desktop/src-tauri && sh scripts/download-uv.sh
	cd apps/desktop/src-tauri && sh scripts/copy-mlx.sh
	@echo "resources ready for bundling"

# Prepare resources for local development (copies MLX to ~/.be-right-back/mlx and sets up venv)
prepare-bundle-dev:
	@echo "preparing resources for local development..."
	@mkdir -p ~/.be-right-back/mlx
	@echo "copying MLX scripts to ~/.be-right-back/mlx..."
	rsync -a --delete mlx/src/ ~/.be-right-back/mlx/src/
	cp mlx/pyproject.toml ~/.be-right-back/mlx/
	@if [ -f mlx/uv.lock ]; then cp mlx/uv.lock ~/.be-right-back/mlx/; fi
	@echo "MLX scripts copied for local development"
	@echo "   source: mlx/"
	@echo "   destination: ~/.be-right-back/mlx/"
	@ls -lh ~/.be-right-back/mlx/ | tail -n +2
	@echo ""
	@echo "setting up Python virtual environment..."
	@if [ ! -d ~/.be-right-back/mlx-venv ]; then \
		echo "creating venv at ~/.be-right-back/mlx-venv..."; \
		uv venv ~/.be-right-back/mlx-venv; \
	else \
		echo "venv already exists at ~/.be-right-back/mlx-venv"; \
	fi
	@echo "installing MLX dependencies..."
	uv pip install --python ~/.be-right-back/mlx-venv/bin/python -e mlx
	@echo ""
	@echo "verifying MLX installation..."
	@~/.be-right-back/mlx-venv/bin/python -c "import mlx; print('✓ MLX installed successfully')" || echo "✗ MLX installation failed"
	@echo ""
	@echo "local development environment ready!"
	@echo "   venv: ~/.be-right-back/mlx-venv/"
	@echo "   mlx:  ~/.be-right-back/mlx/"

# Build desktop app for distribution (with Python bundling)
build-desktop: prepare-bundle
	@echo "building desktop app with bundled Python..."
	cd apps/desktop && npm run tauri build
	@echo "build complete! Find app in apps/desktop/src-tauri/target/release/bundle/"

# Clean build artifacts
clean:
	@echo "cleaning Rust build artifacts..."
	cargo clean
	@echo "cleaning frontend build artifacts..."
	cd apps/desktop && rm -rf dist node_modules
	@echo "cleaning generated docs..."
	rm -f repomix-output.xml repomix-output.txt

# Build the design system files (tokens, stylesheet, component bundle)
design-system:
	./design-system/build.sh

# Generate LLM documentation
llm-docs:
	@echo "generating LLM documentation with repomix..."
	repomix --ignore docs/system-design-overview.md --include-empty-directories
	@echo "Documentation generated: repomix-output.xml"

# Update icons (favicons for website, app icons for Tauri)
# Icons source: ../../icons/ (relative to this Makefile)
ICONS_DIR ?= ../../icons
APPICONSET = $(ICONS_DIR)/Assets.xcassets/AppIcon.appiconset
TAURI_ICONS = apps/desktop/src-tauri/icons

update-icons:
	@echo "Updating website favicons..."
	cp $(ICONS_DIR)/favicon/favicon.ico apps/website/src/app/favicon.ico
	cp $(ICONS_DIR)/favicon/favicon.svg apps/website/src/app/icon.svg
	cp $(ICONS_DIR)/favicon/apple-touch-icon.png apps/website/src/app/apple-icon.png
	cp $(ICONS_DIR)/favicon/web-app-manifest-192x192.png apps/website/public/web-app-manifest-192x192.png
	cp $(ICONS_DIR)/favicon/web-app-manifest-512x512.png apps/website/public/web-app-manifest-512x512.png
	cp $(ICONS_DIR)/favicon/site.webmanifest apps/website/public/site.webmanifest
	@echo "Updating Tauri app icons from Assets.xcassets (converting WebP to PNG)..."
	magick $(APPICONSET)/32-mac.png $(TAURI_ICONS)/32x32.png
	magick $(APPICONSET)/128-mac.png $(TAURI_ICONS)/128x128.png
	magick $(APPICONSET)/256-mac.png $(TAURI_ICONS)/128x128@2x.png
	magick $(APPICONSET)/1024-mac.png $(TAURI_ICONS)/icon.png
	@echo "Generating icon.icns (converting WebP to PNG)..."
	rm -rf /tmp/AppIcon.iconset && mkdir -p /tmp/AppIcon.iconset
	magick $(APPICONSET)/16-mac.png /tmp/AppIcon.iconset/icon_16x16.png
	magick $(APPICONSET)/32-mac.png /tmp/AppIcon.iconset/icon_16x16@2x.png
	magick $(APPICONSET)/32-mac.png /tmp/AppIcon.iconset/icon_32x32.png
	magick $(APPICONSET)/64-mac.png /tmp/AppIcon.iconset/icon_32x32@2x.png
	magick $(APPICONSET)/128-mac.png /tmp/AppIcon.iconset/icon_128x128.png
	magick $(APPICONSET)/256-mac.png /tmp/AppIcon.iconset/icon_128x128@2x.png
	magick $(APPICONSET)/256-mac.png /tmp/AppIcon.iconset/icon_256x256.png
	magick $(APPICONSET)/512-mac.png /tmp/AppIcon.iconset/icon_256x256@2x.png
	magick $(APPICONSET)/512-mac.png /tmp/AppIcon.iconset/icon_512x512.png
	magick $(APPICONSET)/1024-mac.png /tmp/AppIcon.iconset/icon_512x512@2x.png
	iconutil -c icns /tmp/AppIcon.iconset -o $(TAURI_ICONS)/icon.icns
	@echo "Generating icon.ico..."
	magick $(APPICONSET)/256-mac.png -define icon:auto-resize=256,128,64,48,32,16 $(TAURI_ICONS)/icon.ico
	@echo "Icons updated successfully!"

unfurl-assets:
	@echo "Generating unfurl assets..."
	node apps/website/scripts/generate-unfurl-assets.js
	@echo "Done! Check apps/website/public/unfurls/"

# Run website dev server
dev-website:
	@echo "Starting website development server..."
	cd apps/website && npm run dev

# Sync public code to be-right-back-pub repository
sync-public: ## Sync public code to be-right-back-pub repository
	@bash scripts/sync-to-public.sh

# Preview what sync-public would do
sync-public-dry: ## Preview what sync-public would do
	@bash scripts/sync-to-public.sh --dry-run

# GitHub repo for public releases (override: make publish-release GH_REPO="org/repo")
GH_REPO ?= johnlarkin1/be-right-back

# Release: build, sign, notarize DMG, tag + GitHub release on the internal repo.
# Nothing here is public. Run it as often as you like before shipping.
release: ## Build, sign, notarize DMG, tag + release on internal repo
	GH_REPO="$(GH_REPO)" bash scripts/release/release.sh

# Publish: ship a built version to the public repo. This is the one-way step.
publish-release: _guard-no-internal ## Ship it: sync to public repo + public release
	GH_REPO="$(GH_REPO)" bash scripts/release/publish-release.sh

# Guards the PUBLIC step only. The internal repo gets its own releases from
# `make release`; what this stops is the public publish aimed at the wrong repo.
_guard-no-internal:
	@if echo "$(GH_REPO)" | grep -qi 'be-right-back-internal'; then \
		echo "ERROR: Refusing to publish release to internal repo. Set GH_REPO=johnlarkin1/be-right-back" >&2; \
		exit 1; \
	fi

# Verify the public GitHub release for the current VERSION has the DMG.
# Reads the VERSION file, not `git describe`: local tags can be ahead of what is
# published, and this target asks about the public repo, not this one.
check-release: ## Verify the public release for VERSION has the DMG asset
	@[ -f VERSION ] || { echo "ERROR: VERSION file not found." >&2; exit 1; }; \
	TAG="v$$(tr -d '[:space:]' < VERSION)"; \
	echo "Checking release $$TAG on $(GH_REPO)..."; \
	VERSION=$$(tr -d '[:space:]' < VERSION); \
	ASSETS=$$(gh release view "$$TAG" --repo "$(GH_REPO)" --json assets --jq '.assets[].name' 2>/dev/null) \
		|| { echo "ERROR: release $$TAG not found on $(GH_REPO). Run 'make publish-release' first." >&2; exit 1; }; \
	echo "$$ASSETS" | grep -qx 'BeRightBack\.dmg' \
		|| { echo "ERROR: release $$TAG on $(GH_REPO) has no BeRightBack.dmg asset -- the website download link resolves by that exact name." >&2; exit 1; }; \
	echo "$$ASSETS" | grep -qx "BeRightBack\..*\.$$VERSION\.dmg" \
		|| { echo "ERROR: release $$TAG on $(GH_REPO) has no dated DMG for $$VERSION. The stable asset may be a stale build." >&2; exit 1; }; \
	echo "OK: $$TAG has BeRightBack.dmg and a dated DMG for $$VERSION"

# Count lines of code (excludes build artifacts, dependencies, and bundled binaries)
cloc:
	@echo "Counting lines of code..."
	@cloc . --exclude-dir=target,node_modules,dist,.next,.git,__pycache__,.ruff_cache,.venv,venv,.uv,resources --exclude-ext=lock
