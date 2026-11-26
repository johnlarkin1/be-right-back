# Be Right Back - Development Progress

**Last Updated:** 2025-12-07
**Current Branch:** feature-insights-page
**Project Timeline:** 8 phases (November 2025 - January 2026)

This document tracks all work items across all development phases and marks completion status.

## Legend
- ✅ Completed
- 🚧 In Progress
- ⏳ Not Started
- ⚠️ Blocked/Issues

---

## Product Constraints & Features

### Core Philosophy
**"Digital You"** - The app creates an AI persona that mimics how YOU text, trained entirely on your own sent messages. This is a compliance-friendly, privacy-first approach that doesn't require consent from others.

### Privacy & Compliance Constraints
- **Train on YOUR messages only**: Users can only train on their own sent iMessages, not messages from others
- **Local-first**: All data processing, training, and inference happens on-device
- **No cloud dependencies**: The app works entirely offline after initial model download
- **User data never leaves device**: No telemetry, no uploads, no external APIs

### Three Main Features

#### 1. "Digital You" Chat
Train a persona on YOUR sent messages → chat with your digital self
- Uses LoRA fine-tuning on Qwen3-4B (or TinyLlama for fast iteration)
- Captures your texting style, vocabulary, and personality
- Chat interface with terminal/CRT aesthetic

#### 2. Conversation Search (RAG-powered)
Generic chatbot with @mentions → answer questions about specific contacts
- "@Alice when did we last talk about dinner?"
- "@Bob what did he say about the project?"
- Uses vector embeddings + DuckDB for semantic search
- Filters to specific contact's conversation history

#### 3. Insights Dashboard
Analytics about your messaging patterns
- **Global view**: Total messages, most active contacts, trends over time
- **Per-contact deep-dive**: Message frequency, response times, conversation patterns
- Visualizations and exportable stats

### Design Aesthetic
- **CRT Terminal Theme**: Ominous, retro-tech feel
- **Color palette**: `#0a0e0a` (dark), `#00ff41` (green text), `#ffb000` (amber accent)
- **Typography**: VT323 (pixel font), IBM Plex Mono (body)
- **Visual elements**: Scanlines, phosphor glow, pixel art ghosts

---

## Next Steps (Priority Order)

### 🚨 CRITICAL: Fine-Tuning Quality Improvement

**Problem:** Current fine-tuned models do not capture the persona's tone, style, or personality. Responses sound generic and don't reflect the training data.

**Investigation Areas:**
- [ ] **Data quality review** - Analyze JSONL training data format and content
  - Are we including enough conversational context?
  - Is the system prompt effective?
  - Should we filter/curate training examples more aggressively?
- [ ] **Hyperparameter tuning** - Current settings may not be optimal
  - Try different learning rates (1e-5 to 5e-4)
  - Experiment with LoRA rank (4, 8, 16, 32, 64)
  - Adjust LoRA alpha scaling
  - Test different batch sizes and gradient accumulation
- [ ] **Training data format** - May need to restructure
  - Consider chat-ml format vs current format
  - Add more examples per conversation turn
  - Include personality descriptors in system prompt
- [ ] **Model selection** - Qwen3-4B is the current default
  - Test with different base models (Llama 3.2, Gemma 3)
  - Consider if 3-4B params is sufficient for style capture
- [ ] **Training duration** - May be under/overfitting
  - Monitor loss curves more carefully
  - Implement proper validation set
  - Test with more/fewer training steps
- [ ] **Inference settings** - Generation parameters may be off
  - Temperature, top-p, repetition penalty
  - System prompt at inference time

**Experiments to Run:**
1. [ ] Create small benchmark dataset with clear persona traits
2. [ ] A/B test different hyperparameter configurations
3. [ ] Compare outputs at different training checkpoints
4. [ ] Try few-shot prompting vs fine-tuning quality

---

### Immediate (Next 1-2 weeks)

1. **🔴 Fix Fine-Tuning Quality (BLOCKING)**
   - See investigation areas above
   - This must be resolved before MVP is viable

2. **Complete Phase 2 - Training Pipeline Progress Streaming**
   - [ ] Parse training stdout in real-time from Python subprocess
   - [ ] Stream progress events to Tauri frontend (`training-progress` event)
   - [ ] Handle training cancellation
   - [ ] Add proper error handling for training failures
   - [ ] Test end-to-end training via desktop app

3. **Decision: Inference Strategy**
   - [ ] **Option A:** Use MLX-LM for inference (simpler, stays in Python)
     - Pros: No GGUF conversion needed, already have MLX environment
     - Cons: Requires Python runtime for inference
   - [ ] **Option B:** Use llama.cpp (more complex, native)
     - Pros: Pure Rust/C++, better performance
     - Cons: Requires GGUF conversion, more integration work

   **Recommendation:** Start with MLX-LM (Option A) for faster MVP, migrate to llama.cpp later if needed

3. **Start Phase 3 - Inference Pipeline (MLX-LM path)**
   - [ ] Implement MLX-LM inference script (`training/mlx/src/infer.py`)
   - [ ] Load base model + LoRA adapter
   - [ ] Generate streaming responses
   - [ ] Create Tauri command for chat (`generate_response`)
   - [ ] Test chat with trained persona

4. **Continue Phase 5 - Tauri Integration**
   - [ ] Wire up contact list command
   - [ ] Wire up export command
   - [ ] Connect training progress to React UI
   - [ ] Add persona selection/deletion commands

### Medium Term (2-4 weeks)

5. **Marketing Website Analytics** (Phase 5.5 - can be done in parallel)
   - [ ] Choose analytics platform (PostHog recommended)
   - [ ] Set up PostHog account and install SDK
   - [ ] Implement event tracking for downloads and page views
   - [ ] Create download and engagement funnels
   - [ ] Deploy to production with analytics enabled
   - [ ] Monitor conversion metrics weekly

6. **Basic Desktop App UI Implementation** (Phase 6)
   - [ ] Contact selection screen
   - [ ] Training setup screen
   - [ ] Training progress display
   - [ ] Simple chat interface
   - [ ] Persona management UI

7. **Begin Phase 4 - RAG** (optional for MVP)
   - [ ] Evaluate if RAG is needed for initial release
   - [ ] If yes: Choose embedding model
   - [ ] Set up DuckDB with VSS
   - [ ] Implement similarity search

### Long Term (1-2 months)

8. **Polish and Testing** (Phase 7)
   - [ ] End-to-end testing
   - [ ] Performance optimization
   - [ ] Error handling improvements
   - [ ] UI polish

9. **Distribution Prep** (Phase 8)
   - [ ] Code signing setup
   - [ ] DMG creation
   - [ ] Documentation
   - [ ] Website launch with download links

---

## Phase 1: Data Ingestion CLI ✅ **COMPLETED**

**Goal:** Build a working CLI tool that parses iMessage database and generates training data
**Status:** ✅ Complete
**Duration:** ~2 weeks

### Task 1: Set up data structures in `crates/common` ✅
- [x] Types defined with proper serialization (serde)
- [x] Common error types using thiserror
- [x] Unit tests for serialization/deserialization

### Task 2: Implement iMessage database access ✅
- [x] Successfully connects to Messages database
- [x] Returns error with helpful message if Full Disk Access denied
- [x] Parses both `text` and `attributedBody` fields correctly
- [x] Handles Unicode/emoji without corruption
- [x] Filters out system messages

### Task 3: Build CLI interface ✅
- [x] CLI compiles and runs on macOS
- [x] `list` command shows all contacts with counts
- [x] `export` command generates valid JSONL
- [x] Help text is clear and useful
- [x] Errors are user-friendly

### Task 4: Implement JSONL export for training ✅
- [x] Generates valid JSONL (one JSON object per line)
- [x] Includes conversational context in examples
- [x] Filters out low-quality training examples
- [x] Output file is readable by MLX-LM
- [x] Includes metadata

### Task 5: Add tests and documentation ✅
- [x] README in `crates/ingest/` explaining usage
- [x] Inline code comments for complex logic
- [x] Examples in doc comments

### Milestones
- [x] **Milestone 1:** Basic parsing works
- [x] **Milestone 2:** Handle attributedBody
- [x] **Milestone 3:** JSONL export
- [x] **Milestone 4:** Polish and test

### Testing Checkpoints
- [x] CLI successfully lists contacts from Messages database
- [x] Export generates valid JSONL for a real contact
- [x] Messages are in chronological order
- [x] Emoji and special characters render correctly
- [x] Graceful error handling

---

## Phase 2: Model Training Pipeline 🚧 **IN PROGRESS**

**Goal:** Implement LoRA fine-tuning using MLX-LM on Apple Silicon
**Status:** 🚧 90% Complete
**Duration:** ~2 weeks

### Task 1: Set up MLX-LM Python environment ✅
- [x] Virtual environment created in `~/.be-right-back/mlx-venv/`
- [x] MLX-LM installed and importable
- [x] Can load base model from Hugging Face

### Task 2: Implement LoRA training script ✅
- [x] Successfully fine-tunes base model on sample JSONL
- [x] Training completes within time/memory constraints
- [x] Uses <8GB RAM during training
- [x] Outputs progress to stdout in parseable format
- [x] Saves adapter in MLX format
- [x] Supports TinyLlama for fast iteration
- [x] Dynamic system prompts
- [x] Early stopping tracking
- [x] Reads metadata.json from data directory
- [x] Infers output directory from contact_id

### Task 3: Implement Rust subprocess wrapper 🚧
- [x] Successfully spawns Python subprocess (in `apps/desktop/src-tauri/src/commands/training.rs`)
- [x] Basic training command implemented via Tauri
- [x] Python environment setup automation (in `crates/common/src/python_env.rs`)
- [x] Bundled Python/uv binaries for desktop app
- [ ] Parses training progress from stdout in real-time
- [ ] Streams progress events to frontend
- [ ] Cleans up subprocess on cancel/error

**Note:** Basic Rust wrapper exists but needs progress streaming implementation

### Task 4: Implement GGUF conversion ⏳
- [ ] Converts MLX adapter to GGUF format
- [ ] Output is loadable by llama.cpp
- [ ] Preserves adapter quality
- [ ] Handles conversion errors gracefully

**Note:** This may not be needed if using MLX-LM for inference instead of llama.cpp

### Task 5: Implement training metadata and logging ✅
- [x] Metadata saved after training completes
- [x] Training logs are human-readable
- [x] Persona metadata structure implemented (in `crates/personas/`)
- [x] Export metadata includes stats and system prompt

### Task 6: Add configuration management ✅
- [x] Config loaded from Python
- [x] Supports overrides via CLI args
- [x] Validates config before training

### Task 7: Refactor crate structure ✅
- [x] Split `ingest` crate into `messages-db` and `training`
- [x] Created unified `brb` CLI binary
- [x] Created `personas` crate for model lifecycle management
- [x] Added Python bundling for desktop app

### Milestones
- [x] **Milestone 1:** MLX-LM environment working
- [x] **Milestone 2:** Basic training works
- [x] **Milestone 3:** Rust integration (partial)
- [ ] **Milestone 4:** GGUF conversion (may skip)
- [ ] **Milestone 5:** Testing and polish

### Testing Checkpoints
- [x] Can train LoRA adapter from JSONL
- [x] Training completes in reasonable time (15-90 min)
- [x] Memory usage stays under 8GB
- [x] Rust successfully invokes Python (basic)
- [ ] Progress updates work in real-time

---

## Phase 3: Inference Pipeline ⏳ **NOT STARTED**

**Goal:** Integrate llama.cpp for on-device inference with LoRA adapters
**Status:** ⏳ Not Started
**Dependencies:** Phase 2 (LoRA adapters)

### Task 1: Set up llama.cpp ⏳
- [ ] llama.cpp installed with Metal support
- [ ] llama-server binary accessible
- [ ] Base model downloaded and verified

### Task 2: Implement llama-server lifecycle management ⏳
- [ ] Can start llama-server subprocess
- [ ] Waits for server to be ready before returning
- [ ] Shuts down cleanly on drop
- [ ] Handles startup failures gracefully

### Task 3: Implement HTTP client for llama.cpp API ⏳
- [ ] Can send chat completion requests
- [ ] Parses responses correctly
- [ ] Handles API errors gracefully
- [ ] Health check works

### Task 4: Implement LoRA adapter loading ⏳
- [ ] Can load LoRA adapter via API
- [ ] Can unload adapter
- [ ] Can swap between multiple personas
- [ ] Handles missing adapters gracefully

### Task 5: Implement streaming text generation ⏳
- [ ] Streaming works end-to-end
- [ ] Tokens arrive in real-time
- [ ] Handles connection errors
- [ ] Properly signals completion

### Task 6: Implement high-level inference API ⏳
- [ ] Simple, ergonomic API for chat
- [ ] Supports both streaming and non-streaming
- [ ] Handles persona switching automatically
- [ ] Proper error handling

### Milestones
- [ ] **Milestone 1:** llama-server integration (2-3 days)
- [ ] **Milestone 2:** Basic inference works (2-3 days)
- [ ] **Milestone 3:** LoRA adapter loading (2-3 days)
- [ ] **Milestone 4:** Streaming support (1-2 days)
- [ ] **Milestone 5:** Testing and polish (1-2 days)

### Testing Checkpoints
- [ ] Can generate chat responses
- [ ] LoRA adapters load correctly
- [ ] Responses match persona style
- [ ] Inference runs at 10-20 tokens/sec on M1/M2
- [ ] Streaming works smoothly

---

## Phase 4: RAG Implementation ⏳ **NOT STARTED**

**Goal:** Add retrieval-augmented generation for contextual memory
**Status:** ⏳ Not Started
**Dependencies:** Phase 3 (inference pipeline)

### Task 1: Choose and integrate embedding model ⏳
- [ ] Can load embedding model from disk
- [ ] Generates 256 or 384-dim embeddings
- [ ] Batch processing works
- [ ] Fast enough (<100ms for batch of 32)

### Task 2: Set up DuckDB with VSS extension ⏳
- [ ] DuckDB database created successfully
- [ ] VSS extension loads without errors
- [ ] Can insert embeddings in batches
- [ ] HNSW index builds correctly

### Task 3: Implement similarity search ⏳
- [ ] Similarity search returns relevant messages
- [ ] Results are ranked by similarity
- [ ] Filters work correctly
- [ ] Query performance is fast (<100ms for 10K messages)

### Task 4: Implement context retrieval and formatting ⏳
- [ ] Context retrieval works end-to-end
- [ ] Retrieved messages are relevant to query
- [ ] Context fits within token budget
- [ ] Formatting is correct for LLM input

### Task 5: Integrate RAG into inference pipeline ⏳
- [ ] RAG integrated into inference pipeline
- [ ] Retrieved context improves response quality
- [ ] Performance acceptable (retrieval <100ms)
- [ ] No token budget overflows

### Task 6: Build embedding pipeline ⏳
- [ ] Can embed entire conversation in batch
- [ ] Progress reporting during embedding
- [ ] Handles large conversations (10K+ messages)
- [ ] Embeddings stored correctly in DuckDB

### Milestones
- [ ] **Milestone 1:** Embedding model working (2-3 days)
- [ ] **Milestone 2:** DuckDB VSS setup (1-2 days)
- [ ] **Milestone 3:** Similarity search (2-3 days)
- [ ] **Milestone 4:** Integration with inference (1-2 days)
- [ ] **Milestone 5:** End-to-end testing (1-2 days)

---

## Phase 5: Tauri Integration 🚧 **IN PROGRESS**

**Goal:** Connect Rust backend to React frontend via Tauri commands
**Status:** 🚧 40% Complete
**Dependencies:** Phases 1-4

### Task 1: Set up Tauri commands for ingestion 🚧
- [x] Desktop app structure exists in `apps/desktop`
- [x] Build scripts for Python bundling (`apps/desktop/src-tauri/build.rs`)
- [x] Resource bundling configured (Python, uv, training scripts)
- [ ] Commands exposed to frontend
- [ ] React can invoke and receive results
- [ ] Errors propagate correctly

### Task 2: Set up Tauri commands for training 🚧
- [x] Basic training command implemented (`train_persona`)
- [x] List personas command implemented (`list_personas`)
- [x] Python environment setup automation
- [ ] Progress events stream to React in real-time
- [ ] Training errors are handled properly
- [ ] Can cancel training mid-process

### Task 3: Set up Tauri commands for chat/inference ⏳
- [ ] Chat messages can be sent from frontend
- [ ] Responses stream token-by-token
- [ ] Conversation history is maintained
- [ ] Multiple personas can be chatted with

### Task 4: Set up Tauri commands for persona management 🚧
- [x] Can list all trained personas (basic)
- [x] Persona metadata crate created
- [ ] Can select a persona
- [ ] Can delete a persona
- [ ] State updates reactively in UI

### Task 5: Implement error handling and user feedback ⏳
- [ ] Errors display user-friendly messages
- [ ] Loading states shown for async operations
- [ ] Success/failure feedback via toasts
- [ ] Error boundary catches React errors

### Task 6: Configure Tauri app settings 🚧
- [x] App builds and runs
- [x] Resource bundling configured
- [x] Build scripts for Python/uv extraction
- [ ] File system access configured correctly
- [ ] Window settings are appropriate
- [ ] Icons load properly
- [ ] Fix the copy everywhere so it doesn't sound AI generated

### Milestones
- [x] **Milestone 1:** Basic Tauri setup (2-3 days)
- [ ] **Milestone 2:** Ingestion integrated (2-3 days)
- [x] **Milestone 3:** Training integrated (partial - 2-3 days)
- [ ] **Milestone 4:** Chat integrated (2-3 days)
- [ ] **Milestone 5:** Persona management (1-2 days)

---

## Phase 5.5: Marketing Website ⏳ **NOT STARTED**

**Goal:** Launch professional marketing website with analytics and conversion tracking
**Status:** ⏳ Not Started
**Dependencies:** None (can be done in parallel)
**Timeline:** 1-2 weeks

### Task 1: Core Website Pages ⏳
- [ ] Homepage with hero, features, CTAs
- [ ] Download page with installation instructions
- [ ] About page with project background
- [ ] Documentation landing page
- [ ] Privacy policy page

### Task 2: Analytics and Observability ⏳
- [ ] **Choose analytics platform**
  - PostHog (recommended - privacy-first, feature-rich)
  - Plausible (alternative - simpler, paid)
  - Vercel Analytics (baseline - free, limited)
- [ ] Set up PostHog account and get API keys
- [ ] Install analytics packages (`posthog-js` or `next-plausible`)
- [ ] Create analytics provider component
- [ ] Add provider to root layout (`apps/website/src/app/layout.tsx`)
- [ ] Configure environment variables (`NEXT_PUBLIC_POSTHOG_KEY`)

### Task 3: Event Tracking Implementation ⏳
- [ ] Download button clicks with location tracking (hero, nav, footer)
- [ ] Page views with custom properties
- [ ] External link clicks (GitHub, docs, support)
- [ ] Feature section scroll/view tracking
- [ ] Email signup tracking (if newsletter added)
- [ ] Create reusable `useAnalytics()` hook

### Task 4: Funnels and Dashboards ⏳
- [ ] Set up download funnel (landing → download click → download complete)
- [ ] Set up engagement funnel (landing → features → docs → download)
- [ ] Configure retention tracking (returning visitors)
- [ ] Set up alerts for conversion rate drops

### Task 5: Metrics to Track ⏳
**Traffic Metrics:**
- [ ] Unique visitors per day/week/month
- [ ] Page views and bounce rate
- [ ] Traffic sources (direct, search, social, referral)
- [ ] Geographic distribution

**Conversion Metrics:**
- [ ] Download conversion rate (visitors → downloads)
- [ ] Download CTR by button location
- [ ] Time from landing to download
- [ ] Return visitor download rate

**Engagement Metrics:**
- [ ] Average session duration
- [ ] Pages per session
- [ ] Scroll depth on homepage
- [ ] Feature section engagement
- [ ] Documentation page views

**Technical Metrics:**
- [ ] Core Web Vitals (LCP, FID, CLS)
- [ ] Page load times
- [ ] Mobile vs desktop usage

### Task 6: Privacy and Compliance ⏳
- [ ] Configure privacy-first tracking (no PII collection)
- [ ] Use first-party cookies only
- [ ] Add opt-out mechanism for analytics
- [ ] Document tracked events in privacy policy
- [ ] Consider EU-hosted PostHog instance for GDPR
- [ ] Add cookie banner if required

### Task 7: SEO and Performance ⏳
- [ ] Add metadata to all pages
- [ ] Create sitemap.xml
- [ ] Optimize images with Next.js Image
- [ ] Configure Open Graph tags
- [ ] Set up Twitter/social cards
- [ ] Test mobile responsiveness
- [ ] Verify Core Web Vitals scores

### Task 8: Deployment and Monitoring ⏳
- [ ] Deploy to Vercel production
- [ ] Configure custom domain (be-right-back.com)
- [ ] Set up automatic deployments from main branch
- [ ] Monitor analytics dashboard regularly
- [ ] Set up uptime monitoring

### Milestones
- [ ] **Milestone 1:** Basic pages and content (2-3 days)
- [ ] **Milestone 2:** Analytics implementation (1-2 days)
- [ ] **Milestone 3:** Event tracking and funnels (1-2 days)
- [ ] **Milestone 4:** SEO and polish (1-2 days)
- [ ] **Milestone 5:** Production deployment (1 day)

### Testing Checkpoints
- [ ] Analytics events fire correctly in dev environment
- [ ] PostHog dashboard shows real-time events
- [ ] Download funnel captures all steps
- [ ] Mobile experience is smooth
- [ ] Page load time < 2 seconds
- [ ] All CTAs tracked properly

---

## Phase 6: Desktop App UI Polish & Features 🚧 **IN PROGRESS**

**Goal:** Build a polished, intuitive user interface for the desktop app
**Status:** 🚧 In Progress (~40% complete)
**Dependencies:** Phase 5 (Tauri integration)

### Task 0: TypeScript Conversion ✅
- [x] Add TypeScript dependencies and configuration
- [x] Convert all components from .jsx to .tsx
- [x] Add shared type definitions (`src/types.ts`)
- [x] Configure tsconfig.json for React + Vite

### Task 1: Design System Implementation ✅
- [x] CRT terminal theme ported from website
- [x] Tailwind CSS v4 with custom configuration
- [x] Color palette: `#0a0e0a` (dark), `#00ff41` (green), `#ffb000` (amber)
- [x] Typography: VT323 (pixel font), IBM Plex Mono (body)
- [x] CSS utilities for glow effects, scanlines, animations
- [x] Framer Motion for animations

### Task 2: Core Layout Components ✅
- [x] `CRTEffect` - Scanlines, vignette, phosphor glow overlays
- [x] `Ghost` - Pixel art ghost mascot with multiple emotions
- [x] `WanderingGhost` - Animated ghost that floats around screen
- [x] `Header` - App title bar with ghost mascot
- [x] `Navigation` - Terminal-style tab navigation (chat/search/insights)
- [x] `AppShell` - Main layout wrapper combining all elements

### Feature 1: Chat Interface ("Digital You") 🚧
- [x] `ChatLayout` - Main chat container with status bar
- [x] `MessageBubble` - Terminal-styled message display with animations
- [x] `ChatInput` - Input with blinking cursor effect
- [x] Empty state when no persona trained
- [x] Training in progress state
- [x] Auto-scroll to latest messages
- [ ] Streaming token display (backend integration needed)
- [ ] Demo mode for testing without trained persona

### Feature 2: Conversation Search (RAG) ⏳
- [x] `SearchLayout` - Placeholder component created
- [ ] @mention input for contact filtering
- [ ] Vector search integration with DuckDB
- [ ] Search results display
- [ ] Query-answer conversation view

### Feature 3: Insights Dashboard 🚧
- [x] `InsightsLayout` - Main container with date range state management
- [x] `InsightsHeader` - Pulsing status dot + gradient title
- [x] `StatsRow` - 4 stat cards (messages, response time, active days, topics)
- [x] `MessageTimeline` - Recharts BarChart with Brush for Datadog-style filtering
- [x] `WordCloud` - 2D spiral layout, responds to brush selection
- [x] `ActivityHeatmap` - 7×24 grid (day of week × hour)
- [x] `SemanticSpace` - Plotly.js 3D scatter plot with cluster filtering
- [x] `useInsightsData` - Data fetching hook (currently mock data)
- [x] `mockData.ts` - Mock data generators for all components
- [x] CSS styles in globals.css (~700 lines)
- [ ] Backend Tauri commands (see `src-tauri/src/commands/insights.rs` TODOs)
- [ ] t-SNE + HDBSCAN clustering (see `scripts/compute_viz_clusters.py` TODOs)
- [ ] Wire frontend to real backend data
- [ ] Per-contact deep-dive view
- [ ] Export stats to CSV/JSON

### Feature 4: Persona Management ⏳
- [ ] Persona list/grid view
- [ ] Create persona wizard
- [ ] Delete confirmation
- [ ] Search and filter

### Feature 5: Settings & Preferences ⏳
- [ ] Settings UI with categories
- [ ] Persist preferences to disk
- [ ] Apply settings in real-time

### Feature 6: Onboarding & Help ⏳
- [ ] Welcome flow
- [ ] Full Disk Access permission prompts
- [ ] Tooltips and help text

### Tauri Integration (Backend Commands) 🚧
- [x] `chat_with_persona` command implemented (calls chat.py)
- [x] Demo mode fallback when no persona available
- [ ] Real-time streaming responses
- [ ] Training progress events
- [ ] Contact list command
- [ ] Export command integration

### Implementation Progress
- [x] **Task 1:** Design system and theming ✅
- [x] **Task 2:** Core layout components ✅
- [x] **Task 3:** TypeScript conversion ✅
- [x] **Task 4:** Chat interface (UI complete, backend partial) 🚧
- [ ] **Task 5:** Search interface
- [x] **Task 6:** Insights dashboard (frontend complete, backend TODO) 🚧
- [ ] **Task 7:** Persona management
- [ ] **Task 8:** Settings panel
- [ ] **Task 9:** Onboarding flow

---

## Phase 7: Optimization & Testing ⏳ **NOT STARTED**

**Goal:** Performance optimization, comprehensive testing, bug fixes
**Status:** ⏳ Not Started
**Dependencies:** Phases 1-6

### Task 1: Performance Profiling ⏳
- [ ] Identified top 3 performance bottlenecks
- [ ] Documented baseline metrics
- [ ] Created optimization plan

### Task 2: Memory Optimization ⏳
- [ ] App runs comfortably on 8GB M1 Mac
- [ ] No memory leaks during extended use
- [ ] Memory usage documented

### Task 3: Inference Optimization ⏳
- [ ] Inference meets latency targets
- [ ] No stuttering during streaming
- [ ] Can handle 3-4 concurrent chats

### Task 4: Database Optimization ⏳
- [ ] Similarity search <100ms for 10K messages
- [ ] Database file size reasonable
- [ ] No query timeouts

### Task 5: UI Performance ⏳
- [ ] UI feels snappy (no lag)
- [ ] Smooth scrolling with 1000+ messages
- [ ] Fast initial load (<2s)

### Testing Strategy
- [ ] Unit tests (>70% coverage)
- [ ] Integration tests (end-to-end workflows)
- [ ] Manual testing on M1/M2/M3 Macs
- [ ] Bug fixes and regression tests

---

## Phase 8: Distribution ⏳ **NOT STARTED**

**Goal:** Package and distribute application for end users
**Status:** ⏳ Not Started
**Dependencies:** Phase 7 (stable, tested app)

### Task 1: Apple Developer Setup ⏳
- [ ] Developer account active
- [ ] Certificates created and installed
- [ ] Credentials stored securely

### Task 2: Code Signing ⏳
- [ ] App is signed with Developer ID
- [ ] Signature verified successfully
- [ ] Hardened runtime enabled

### Task 3: Notarization ⏳
- [ ] App successfully notarized
- [ ] Notarization ticket stapled
- [ ] App opens without warnings on fresh Mac

### Task 4: DMG Creation ⏳
- [ ] DMG created successfully
- [ ] Drag-to-install works
- [ ] DMG background looks professional

### Task 5: Documentation ⏳
- [ ] Clear installation instructions
- [ ] Common questions answered
- [ ] Troubleshooting guide available

### Task 6: Beta Testing ⏳
- [ ] Beta program launched
- [ ] 10+ testers onboarded
- [ ] Feedback collected and triaged

### Task 7: Release Preparation ⏳
- [ ] App version bumped
- [ ] CHANGELOG.md updated
- [ ] README.md finalized
- [ ] All critical bugs fixed
- [ ] Release assets prepared

---

## Overall Progress Summary

### By Phase
| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Data Ingestion CLI | ✅ Complete | 100% |
| Phase 2: Model Training Pipeline | 🚧 In Progress | 90% |
| Phase 3: Inference Pipeline | ⏳ Not Started | 0% |
| Phase 4: RAG Implementation | ⏳ Not Started | 0% |
| Phase 5: Tauri Integration | 🚧 In Progress | 40% |
| **Phase 5.5: Marketing Website** | ⏳ Not Started | 0% |
| Phase 6: Desktop App UI Polish | 🚧 In Progress | 60% |
| Phase 7: Optimization & Testing | ⏳ Not Started | 0% |
| Phase 8: Distribution | ⏳ Not Started | 0% |

### Overall Project Completion: ~40%

**Note:** Phase 5.5 (Marketing Website) can be completed in parallel with other phases and is independent of desktop app development.

---

## Recent Accomplishments (Based on Git History)

### Latest (feature-insights-page branch)

#### Insights Dashboard Implementation (Phase 6)
- ✅ **Complete Frontend Implementation** - All Insights page components built with mock data
  - `InsightsLayout` - Main container with date range state management
  - `InsightsHeader` - Pulsing status indicator + gradient title
  - `StatsRow` - 4 stat cards (messages, response time, active days, topics)
  - `MessageTimeline` - Recharts BarChart with Brush for Datadog-style date filtering
  - `WordCloud` - 2D spiral layout algorithm, responds to brush selection
  - `ActivityHeatmap` - 7×24 grid (day of week × hour of day)
  - `SemanticSpace` - Plotly.js 3D scatter plot with cluster filtering
  - `useInsightsData` - Data fetching hook with mock data generators
  - ~700 lines of CSS for CRT terminal aesthetic
- ✅ **Backend Command Stubs** - Tauri commands with detailed implementation TODOs
  - `get_insights_data` - Timeline, word frequencies, heatmap, stats
  - `get_word_frequencies_for_range` - Filtered words for brush selection
  - `get_embeddings_for_viz` - 3D coordinates + cluster labels
- ✅ **Clustering Pipeline Design**
  - Decided on HDBSCAN over k-means (auto-determines cluster count)
  - Python script skeleton for t-SNE + HDBSCAN (`scripts/compute_viz_clusters.py`)
  - Post-ingestion hook location identified in `run_ingestion`
- ✅ **TypeScript Types** - Added all Insights-related interfaces to `src/types.ts`

### Previous (feat/john/fine-tuning-with-system-prompt branch)

#### Desktop App UI Implementation (Phase 6)
- ✅ **TypeScript conversion** - Converted entire React app from JavaScript to TypeScript
  - Added TypeScript dependencies and configuration
  - Created shared type definitions (`src/types.ts`)
  - Converted all components: App, main, CRTEffect, Ghost, Header, Navigation, AppShell
  - Converted all feature components: ChatLayout, MessageBubble, ChatInput, SearchLayout, InsightsLayout
- ✅ **CRT Design System** - Ported terminal aesthetic from website
  - Tailwind CSS v4 with custom theme
  - Color palette: dark (#0a0e0a), green (#00ff41), amber (#ffb000)
  - Typography: VT323 (pixel), IBM Plex Mono (body)
  - Scanlines, vignette, phosphor glow effects
- ✅ **Core UI Components**
  - `CRTEffect` - Visual overlay effects
  - `Ghost` / `WanderingGhost` - Animated pixel art mascot with 10 emotion variants
  - `Header` / `Navigation` / `AppShell` - Layout structure
- ✅ **Chat Interface UI**
  - `ChatLayout` with empty state, training state, and chat views
  - `MessageBubble` with terminal styling and animations
  - `ChatInput` with blinking cursor effect
- ✅ **Tauri inference command** - `chat_with_persona` calls chat.py with demo fallback

#### Previous Work
- ✅ **Major crate refactoring** - Split monolithic `ingest` crate into:
  - `messages-db` - iMessage database access
  - `training` - Training pipeline and export
  - `personas` - Model lifecycle management
  - `common` - Shared types and utilities
- ✅ **Unified CLI** - Created single `brb` binary replacing separate commands
- ✅ **Python environment bundling** - Desktop app now bundles Python + uv
- ✅ **Tauri training commands** - Basic training invocation from desktop app
- ✅ **Export improvements** - Metadata includes stats and LLM-generated system prompt
- ✅ **Better constants management** - Centralized configuration

### Older
- ✅ Dynamic system prompt for training
- ✅ Website updates
- ✅ Training progress tracking
- ✅ Early stopping tracking for MLX training
- ✅ Fine-tuning pipeline improvements
- ✅ TinyLlama support for fast iteration

---

## Blocked Items / Issues

### Active Issues
- ⚠️ **Fine-tuning quality is poor** - Trained models are not capturing persona tone/style effectively. Generated responses don't sound like the person being trained on. This is a **critical blocker** for MVP quality.
- **Training progress streaming** - Need to implement real-time stdout parsing from Python subprocess to show progress in UI
- **Inference strategy decision** - Need to choose between MLX-LM (simpler) vs llama.cpp (faster) for chat inference

---

## Steps to Fix / Debugging Guide

### Onboarding State Stuck on "All Done" After Data Deletion

**Problem:** When user deletes `~/.be-right-back/data/` directory, the app still shows "All Done!" because localStorage remembers the completed state.

**Root Cause:** The onboarding state was stored in localStorage but didn't sync with backend filesystem state on startup.

**Fix Applied:** `apps/desktop/src/hooks/useOnboarding.ts` - `updateFromStatus()` now treats backend as source of truth:
- If backend has `brb.db` → "complete"
- Else if backend has snapshot → "ingestion_ready"
- Else if backend has FDA → "first_snapshot"
- Else → "permissions" (or preserve welcome/privacy screens)

**To Debug:** Open browser devtools (right-click → Inspect in dev mode), check console for:
```
[useOnboarding] updateFromStatus: { backend: {...}, prev: {...}, newStep: "..." }
```

**If Still Stuck:**
1. Restart the dev server (`make dev` or `npm run tauri dev`)
2. Clear localStorage manually: In devtools console run `localStorage.removeItem('brb-onboarding-state')`
3. Check backend response: In devtools console check what `get_initialization_status` returns

### Auto-Created Files on Startup

**Note:** Some backend commands call `get_or_create_snapshot()` which auto-creates snapshot files. This is intentional for normal flow but can cause confusion during debugging.

Files that may be auto-created:
- `~/.be-right-back/data/snapshot/messages.db` - copy of iMessage database
- `~/.be-right-back/data/snapshot/addressbook.db` - copy of address book

Files that require explicit ingestion:
- `~/.be-right-back/data/db/brb.db` - processed SQLite database (determines `has_sqlite_db`)
- `~/.be-right-back/data/db/brb.duckdb` - vector database for RAG

### Technical Debt
- No tests for Tauri commands yet
- Python subprocess cleanup on cancellation not implemented
- GGUF conversion path unclear (may not be needed if using MLX-LM)
- Streaming response integration between chat.py and frontend not implemented

### Future Optimizations: Embedding Pipeline
The embedding pipeline (`mlx/src/embed.py`) has been optimized for throughput but additional improvements are possible:

- **Incremental processing**: Currently re-embeds all messages on each run. Future work should track last processed message ID and only embed new/changed messages to avoid redundant work.
- **Checkpointing**: Add resume capability for long-running embedding jobs that fail mid-way.
- **Contact-level parallelism**: For machines with 32GB+ RAM, consider processing contacts in parallel using multiprocessing.

No hard blockers currently. Development can proceed with either inference approach.

---

## Notes

- **Training Pipeline:** Functional via Python CLI and basic Rust wrapper. Progress streaming is next priority.
- **Inference:** Ready to start. Recommend MLX-LM approach for MVP (skip GGUF conversion).
- **Desktop App:** TypeScript React frontend with CRT terminal theme. Core UI components complete. Chat interface UI complete, needs backend integration for streaming. Search and Insights are placeholders.
- **Architecture:** Major refactoring completed - codebase now has clean separation of concerns.
- **Website:** Separate app exists for project website (not in main codebase).

## Key Architecture Decisions

1. **Crate Structure** - Split into `messages-db`, `training`, `personas`, `common` for better modularity
2. **CLI** - Unified `brb` binary instead of separate binaries per command
3. **Python Bundling** - Desktop app bundles Python + uv for self-contained distribution
4. **Training** - MLX-LM with LoRA adapters, supports Qwen3-4B and TinyLlama
5. **Export** - JSONL format with metadata including stats and LLM-generated system prompts
6. **Frontend Stack** - TypeScript + React 19 + Vite + Tailwind CSS v4 + Framer Motion + Zustand
7. **Design System** - CRT terminal aesthetic with VT323/IBM Plex Mono fonts, scanline/glow effects

---

**For detailed task breakdowns, see individual phase documents in `claude/` directory.**
