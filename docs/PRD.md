# Product Requirements Document: Be Right Back

**Version:** 1.0
**Status:** Planning
**Last Updated:** [Pre-Development]
**Author:** Product Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Product Vision](#product-vision)
4. [Target Users](#target-users)
5. [User Stories](#user-stories)
6. [Product Features](#product-features)
7. [Functional Requirements](#functional-requirements)
8. [Non-Functional Requirements](#non-functional-requirements)
9. [Privacy & Security Requirements](#privacy--security-requirements)
10. [User Experience Requirements](#user-experience-requirements)
11. [Technical Constraints](#technical-constraints)
12. [Success Metrics](#success-metrics)
13. [Risks & Mitigations](#risks--mitigations)
14. [Out of Scope](#out-of-scope)
15. [Open Questions](#open-questions)
16. [Appendix](#appendix)

---

## Executive Summary

**Be Right Back** is a local-first macOS application that transforms your iMessage history into an intelligent, searchable knowledge base with AI-powered features. The core innovation is the "Digital You" — a fine-tuned AI persona trained exclusively on your own sent messages that captures your unique texting style and personality.

Unlike cloud-based AI assistants, Be Right Back processes everything on-device. Your conversations never leave your Mac. This privacy-first approach addresses growing concerns about AI companies harvesting personal data while delivering genuinely useful AI capabilities.

### Key Value Propositions

1. **Create a "Digital You"**: An AI that texts like you, trained only on messages you've written
2. **Search Your Memory**: Natural language search across years of conversations
3. **Understand Your Relationships**: Analytics and insights about your communication patterns
4. **Complete Privacy**: All processing happens locally — your data never leaves your device

---

## Problem Statement

### The Privacy Paradox

Modern AI assistants offer powerful capabilities but require surrendering personal data to cloud services. Users face a difficult choice:

- **Option A**: Share intimate conversations with AI companies for convenience
- **Option B**: Maintain privacy but miss out on AI-powered insights

This creates significant friction:

- Privacy-conscious users avoid AI tools entirely
- Users who do engage often feel uneasy about data collection
- Highly personal data (like text messages) remains largely untapped for AI applications

### The Lost Context Problem

Our iMessage history represents years of relationships, shared experiences, and personal growth. Yet this data sits dormant:

- **No intelligent search**: Apple's native search is basic keyword matching
- **No cross-conversation insights**: Can't easily see patterns across contacts
- **No style analysis**: No way to understand how your communication has evolved
- **Fragmented memory**: Important details are buried in years of messages

### The "Clone" Compliance Issue

Existing "clone your friend" AI apps raise ethical and legal concerns:

- Training on someone else's messages without consent
- Creating digital representations of people who haven't agreed
- Potential for misuse or deception

---

## Product Vision

### Core Philosophy

**"Your messages, your AI, your device."**

Be Right Back reimagines what personal AI can be when privacy is the foundation, not an afterthought. We believe:

1. **Personal data should remain personal** — no cloud, no exceptions
2. **AI should amplify you, not replace others** — train on YOUR style, not theirs
3. **Memory is precious** — your conversations deserve better than full-text search
4. **Insights should be actionable** — understand your relationships, don't just archive them

### Product Pillars

#### 1. Digital You (AI Persona)

Create an AI that texts exactly like you do. Fine-tuned on your sent messages only, it captures:
- Your vocabulary and slang
- Your emoji usage patterns
- Your sentence structure and rhythm
- Your tone across different contexts

Use cases:
- Practice difficult conversations before having them
- Generate draft responses when you're busy
- See yourself from the outside — how do you come across?
- Experiment with different communication styles

#### 2. Conversation Search (RAG-Powered Q&A)

Ask questions about your conversation history in natural language:
- "When did Sarah mention her new job?"
- "What restaurant did Mike recommend last summer?"
- "Show me all the times we talked about moving to Austin"

The system uses semantic search and retrieval-augmented generation to find relevant context and synthesize answers.

#### 3. Insights Dashboard

Understand your communication patterns:
- Message frequency over time
- Response time patterns
- Conversation density by contact
- Vocabulary evolution
- Sentiment analysis
- Relationship health indicators

---

## Target Users

### Primary Persona: The Privacy-Conscious Power User

**Profile:**
- Age: 25-45
- Occupation: Tech-savvy professional (developer, designer, product manager)
- Platform: macOS (Apple Silicon Mac)
- Privacy stance: Actively avoids cloud AI, uses privacy-focused tools
- Tech comfort: High — comfortable with beta software, terminal commands

**Goals:**
- Leverage AI without compromising privacy
- Better organize and search their digital life
- Understand their communication patterns
- Experiment with AI in a safe, contained environment

**Frustrations:**
- AI tools require cloud upload of sensitive data
- Native message search is inadequate
- No good way to analyze years of conversation history
- Concerned about "clone" apps that train on others' data

### Secondary Persona: The Self-Improvement Enthusiast

**Profile:**
- Age: 20-35
- Interested in personal growth, communication skills
- Uses journaling apps, therapy, or coaching
- Wants to understand themselves better

**Goals:**
- Improve communication skills
- Understand how they come across to others
- Track relationship health over time
- Practice difficult conversations

**Frustrations:**
- Hard to see patterns in their own communication
- No objective way to evaluate their texting style
- Want to improve but lack feedback

### Anti-Personas (Who This Is NOT For)

1. **The Casual User**: People who want a simple, polished app with no setup
2. **Windows/Linux Users**: macOS-only due to iMessage access
3. **Cloud-First Users**: People who prefer cloud sync and multi-device access
4. **The Impersonator**: Anyone wanting to clone friends/family without consent

---

## User Stories

### Epic 1: Getting Started

| ID | User Story | Acceptance Criteria | Priority |
|----|------------|---------------------|----------|
| US-1.1 | As a user, I want to grant the app access to my Messages database so I can use my conversation history | - App detects permission status<br>- Guides user through Full Disk Access setup<br>- Confirms successful access | P0 |
| US-1.2 | As a user, I want to see a list of my contacts sorted by message count so I can choose who to analyze | - Displays contacts with message counts<br>- Sorts by most messages by default<br>- Shows last message date | P0 |
| US-1.3 | As a user, I want to understand what data will be used before training so I can make an informed decision | - Clear explanation of "sent messages only"<br>- Preview of data that will be used<br>- Option to exclude specific conversations | P1 |

### Epic 2: Digital You Persona

| ID | User Story | Acceptance Criteria | Priority |
|----|------------|---------------------|----------|
| US-2.1 | As a user, I want to train an AI on my sent messages so I can create a "Digital You" | - Training uses only my sent messages<br>- Progress indicator with time estimate<br>- Completes within 90 minutes on M1 | P0 |
| US-2.2 | As a user, I want to chat with my Digital You so I can see how I come across | - Chat interface loads the trained persona<br>- Responses reflect my texting style<br>- Latency under 3 seconds per response | P0 |
| US-2.3 | As a user, I want to see my persona's characteristics so I can verify it captured my style | - Shows vocabulary stats<br>- Displays common phrases/emoji<br>- Indicates confidence level | P1 |
| US-2.4 | As a user, I want to retrain my persona with updated messages so it stays current | - Can trigger retraining<br>- Incremental training option<br>- Previous version backed up | P2 |

### Epic 3: Conversation Search

| ID | User Story | Acceptance Criteria | Priority |
|----|------------|---------------------|----------|
| US-3.1 | As a user, I want to search my messages using natural language so I can find specific information | - Semantic search across all messages<br>- Results show relevant snippets<br>- Can click to view full context | P0 |
| US-3.2 | As a user, I want to @mention a contact to scope my search so I can find conversation-specific info | - @name filters to that conversation<br>- Autocomplete for contact names<br>- Can combine with natural language | P1 |
| US-3.3 | As a user, I want to ask questions and get synthesized answers so I don't have to read raw messages | - RAG-powered answer generation<br>- Citations to source messages<br>- "Show me the messages" option | P1 |

### Epic 4: Insights Dashboard

| ID | User Story | Acceptance Criteria | Priority |
|----|------------|---------------------|----------|
| US-4.1 | As a user, I want to see my overall messaging statistics so I can understand my patterns | - Total messages sent/received<br>- Messages per day/week/month<br>- Most active contacts | P1 |
| US-4.2 | As a user, I want to see per-contact analytics so I can understand individual relationships | - Message frequency over time<br>- Response time patterns<br>- Conversation density | P1 |
| US-4.3 | As a user, I want to see my vocabulary evolution so I can understand how my style changed | - Unique words over time<br>- Common phrases by era<br>- Emoji usage trends | P2 |

### Epic 5: Privacy & Data Management

| ID | User Story | Acceptance Criteria | Priority |
|----|------------|---------------------|----------|
| US-5.1 | As a user, I want confirmation that my data stays local so I can trust the app | - Clear privacy indicators in UI<br>- No network requests for user data<br>- Offline mode works fully | P0 |
| US-5.2 | As a user, I want to delete all app data so I can remove any traces if needed | - One-click data deletion<br>- Removes models, embeddings, and cache<br>- Confirms deletion | P1 |
| US-5.3 | As a user, I want to exclude specific contacts from analysis so I can maintain boundaries | - Blacklist specific contacts<br>- Excluded data never processed<br>- Can modify exclusions later | P1 |

---

## Product Features

### Feature 1: Digital You Persona

**Description:** Train a small language model (LoRA fine-tuning) on the user's own sent messages to create an AI that mimics their texting style.

**Key Capabilities:**
- Uses only sent messages (compliance-friendly)
- LoRA fine-tuning on Qwen3.5-9B (~9B parameters)
- Training completes in 15-90 minutes on Apple Silicon
- Generates responses in the user's voice
- Supports multiple personas (e.g., different eras of yourself)

**User Flow:**
1. User grants Full Disk Access
2. App scans Messages database
3. User sees list of contacts with message counts
4. User selects "Create Digital You"
5. App shows preview of sent messages to be used
6. User confirms and training begins
7. Progress indicator shows estimated time remaining
8. Training completes, persona is ready
9. User can chat with their Digital You

### Feature 2: Semantic Conversation Search

**Description:** Natural language search across all conversations using vector embeddings and retrieval-augmented generation.

**Key Capabilities:**
- Semantic search (not just keyword matching)
- @mention to scope to specific contacts
- Question answering with cited sources
- Fast retrieval (<200ms query time)

**User Flow:**
1. User types query in search bar
2. Optionally @mentions a contact to scope
3. Results show relevant message snippets
4. User can click to expand context
5. User can ask follow-up questions
6. RAG generates synthesized answers with citations

### Feature 3: Insights Dashboard

**Description:** Visual analytics about messaging patterns across all conversations.

**Key Capabilities:**
- Global statistics (all messages)
- Per-contact breakdowns
- Time-series visualizations
- Vocabulary and sentiment analysis

**Metrics Tracked:**
- Message count (sent/received)
- Response time distribution
- Conversation density
- Active hours/days
- Top words and emoji
- Message length trends
- Sentiment over time

### Feature 4: Privacy Controls

**Description:** User controls for data management and privacy.

**Key Capabilities:**
- Contact exclusion list
- Data export/deletion
- Offline-only operation
- Local storage only

---

## Functional Requirements

### FR-1: Data Ingestion

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | System shall read iMessage database from `~/Library/Messages/chat.db` | P0 |
| FR-1.2 | System shall decode both plain text and NSAttributedString message formats | P0 |
| FR-1.3 | System shall extract sender, recipient, timestamp, and message text | P0 |
| FR-1.4 | System shall handle group chats (extract 1:1 portions) | P1 |
| FR-1.5 | System shall detect and skip system messages (reactions, etc.) | P0 |
| FR-1.6 | System shall handle attachments gracefully (placeholder text) | P1 |

### FR-2: Training Pipeline

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | System shall fine-tune using LoRA on Qwen3.5-9B base model | P0 |
| FR-2.2 | System shall use only user's sent messages for training | P0 |
| FR-2.3 | System shall format training data as supervised fine-tuning JSONL | P0 |
| FR-2.4 | System shall provide progress updates during training | P0 |
| FR-2.5 | System shall save LoRA adapter to local storage | P0 |
| FR-2.6 | System shall support training cancellation | P1 |

### FR-3: Inference Pipeline

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | System shall load base model and LoRA adapter for inference | P0 |
| FR-3.2 | System shall generate streaming token responses | P0 |
| FR-3.3 | System shall support context window of at least 4096 tokens | P0 |
| FR-3.4 | System shall maintain conversation history within session | P0 |
| FR-3.5 | System shall allow persona switching without restart | P1 |

### FR-4: Retrieval-Augmented Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | System shall generate embeddings for all messages | P0 |
| FR-4.2 | System shall store embeddings in DuckDB with VSS extension | P0 |
| FR-4.3 | System shall retrieve top-k relevant messages for query | P0 |
| FR-4.4 | System shall inject retrieved context into LLM prompt | P0 |
| FR-4.5 | System shall support @mention filtering by contact | P1 |

### FR-5: Analytics

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | System shall compute message counts by contact | P1 |
| FR-5.2 | System shall compute response time statistics | P1 |
| FR-5.3 | System shall compute message frequency over time | P1 |
| FR-5.4 | System shall identify top words and emoji per contact | P2 |
| FR-5.5 | System shall compute conversation density metrics | P2 |

### FR-6: User Interface

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | System shall provide chat interface for persona conversations | P0 |
| FR-6.2 | System shall provide search interface with results | P0 |
| FR-6.3 | System shall provide analytics dashboard with visualizations | P1 |
| FR-6.4 | System shall provide persona management (create/delete) | P0 |
| FR-6.5 | System shall provide onboarding flow for permissions | P0 |

---

## Non-Functional Requirements

### NFR-1: Performance

| ID | Requirement | Target | Priority |
|----|-------------|--------|----------|
| NFR-1.1 | Training time for "Digital You" persona | < 90 min on M1 | P0 |
| NFR-1.2 | Inference speed | 10-20 tokens/sec | P0 |
| NFR-1.3 | Search query latency | < 200ms | P0 |
| NFR-1.4 | App startup time | < 5 seconds | P1 |
| NFR-1.5 | Message database scan time | < 30 seconds for 100k messages | P1 |

### NFR-2: Resource Constraints

| ID | Requirement | Target | Priority |
|----|-------------|--------|----------|
| NFR-2.1 | Minimum RAM for operation | 8 GB | P0 |
| NFR-2.2 | RAM usage during normal operation | < 4 GB | P0 |
| NFR-2.3 | RAM usage during training | < 12 GB | P0 |
| NFR-2.4 | Disk space for base model | < 4 GB | P0 |
| NFR-2.5 | Disk space per persona (adapter) | < 500 MB | P1 |
| NFR-2.6 | Disk space for embeddings | < 1 GB per 100k messages | P1 |

### NFR-3: Compatibility

| ID | Requirement | Target | Priority |
|----|-------------|--------|----------|
| NFR-3.1 | macOS version support | macOS 12 (Monterey)+ | P0 |
| NFR-3.2 | Apple Silicon support | M1, M2, M3 families | P0 |
| NFR-3.3 | Intel Mac support | Unsupported initially | P2 |

### NFR-4: Reliability

| ID | Requirement | Target | Priority |
|----|-------------|--------|----------|
| NFR-4.1 | Graceful handling of missing permissions | Clear error messaging | P0 |
| NFR-4.2 | Recovery from training interruption | Resume or restart cleanly | P1 |
| NFR-4.3 | Data integrity on crash | No corruption of user data | P0 |

### NFR-5: Usability

| ID | Requirement | Target | Priority |
|----|-------------|--------|----------|
| NFR-5.1 | Time to first persona creation | < 10 minutes (excluding training) | P0 |
| NFR-5.2 | Steps to grant permissions | Guided flow with < 5 clicks | P0 |
| NFR-5.3 | Learning curve | No documentation required for basic use | P1 |

---

## Privacy & Security Requirements

### PSR-1: Data Locality

| ID | Requirement | Priority |
|----|-------------|----------|
| PSR-1.1 | All user data SHALL remain on the local device | P0 |
| PSR-1.2 | App SHALL NOT make network requests containing user data | P0 |
| PSR-1.3 | App SHALL function fully offline after initial setup | P0 |
| PSR-1.4 | Models and embeddings SHALL be stored locally only | P0 |

### PSR-2: Data Minimization

| ID | Requirement | Priority |
|----|-------------|----------|
| PSR-2.1 | Training SHALL use only user's own sent messages | P0 |
| PSR-2.2 | Received messages used only for context, not training | P0 |
| PSR-2.3 | User CAN exclude specific contacts from processing | P1 |
| PSR-2.4 | User CAN delete all app data with single action | P0 |

### PSR-3: Transparency

| ID | Requirement | Priority |
|----|-------------|----------|
| PSR-3.1 | App SHALL clearly indicate what data is being used | P0 |
| PSR-3.2 | App SHALL show preview before training | P1 |
| PSR-3.3 | Privacy policy SHALL be accessible within app | P1 |

### PSR-4: Storage Security

| ID | Requirement | Priority |
|----|-------------|----------|
| PSR-4.1 | App data SHALL be stored in user's home directory | P0 |
| PSR-4.2 | File permissions SHALL prevent other users from accessing | P0 |
| PSR-4.3 | App SHALL NOT store data in world-readable locations | P0 |

---

## User Experience Requirements

### UXR-1: Visual Design

**Design Direction:** Distinctive aesthetic that sets the app apart from generic AI interfaces.

**Initial Concept:** "CRT Terminal" aesthetic
- Dark background with subtle scanlines
- Green/amber phosphor glow effects
- Retro-tech typography
- Ominous, mysterious atmosphere
- "Ghost" motifs for the Digital You concept

**Rationale:** The "Digital You" concept is inherently uncanny — seeing yourself from the outside. The UI should lean into this rather than mask it with friendly cartoon aesthetics.

### UXR-2: Information Architecture

```
┌─────────────────────────────────────────────────────┐
│  Be Right Back                                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐  ┌──────────────────────────────────┐│
│  │ Personas │  │                                  ││
│  │ ────────│  │     Main Content Area            ││
│  │ You (AI) │  │                                  ││
│  │          │  │     - Chat                       ││
│  │          │  │     - Search                     ││
│  ├──────────┤  │     - Insights                   ││
│  │ Search   │  │                                  ││
│  │ ────────│  │                                  ││
│  │          │  │                                  ││
│  ├──────────┤  │                                  ││
│  │ Insights │  │                                  ││
│  │ ────────│  │                                  ││
│  │          │  │                                  ││
│  └──────────┘  └──────────────────────────────────┘│
│                                                     │
└─────────────────────────────────────────────────────┘
```

### UXR-3: Key User Flows

**Flow 1: First-Time Setup**
1. Welcome screen explaining app purpose
2. Privacy explanation (all local)
3. Permission request for Full Disk Access
4. System Settings opens for user to grant
5. Confirmation of successful access
6. Message database scan begins
7. Contact list displayed
8. Prompt to create first Digital You

**Flow 2: Creating Digital You**
1. User selects "Create Digital You" from main screen
2. App shows explanation: "Train an AI on YOUR sent messages"
3. Preview of messages that will be used
4. "Start Training" button with time estimate
5. Training progress screen with:
   - Progress bar
   - Estimated time remaining
   - Fun facts about their messaging style
6. Completion notification
7. Chat interface opens

**Flow 3: Chatting with Digital You**
1. Select persona from sidebar
2. Chat interface appears (messaging app style)
3. Type message in input field
4. Send button or Enter to submit
5. Typing indicator while generating
6. Response streams in token by token
7. Conversation history persists in session
8. "New Chat" to clear context

### UXR-4: Error States

| State | User Message | Recovery Action |
|-------|--------------|-----------------|
| No FDA | "Full Disk Access required to read your messages" | "Open System Settings" button |
| No Messages | "No messages found in your Messages database" | Check FDA, iMessage setup |
| Training Failed | "Training was interrupted. Your data is safe." | "Try Again" or "Contact Support" |
| Low Memory | "Not enough memory available for training" | "Close other apps and try again" |
| Low Disk | "Need X GB free space for training" | "Free up space" guidance |

---

## Technical Constraints

### TC-1: Platform

| Constraint | Rationale |
|------------|-----------|
| macOS only | iMessage database only available on macOS |
| Apple Silicon required | MLX training requires Apple GPU |
| macOS 12+ | Metal 3 features for GPU acceleration |

### TC-2: iMessage Access

| Constraint | Rationale |
|------------|-----------|
| Requires Full Disk Access | `~/Library/Messages/chat.db` is protected |
| Read-only access | Never modify Messages database |
| Not available on iOS | iMessage database not accessible on iOS |

### TC-3: Distribution

| Constraint | Rationale |
|------------|-----------|
| Cannot use Mac App Store | Sandbox prevents FDA access |
| Notarization required | Gatekeeper on modern macOS |
| Must be signed | User security expectations |

### TC-4: Model Constraints

| Constraint | Rationale |
|------------|-----------|
| 3-4B parameter models only | 8-16GB RAM target |
| LoRA fine-tuning only | Full fine-tuning too resource-intensive |
| GGUF format for inference | llama.cpp compatibility |
| MLX format for training | Apple GPU optimization |

---

## Success Metrics

### Launch Metrics (First 90 Days)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Downloads | 1,000+ | Distribution channel analytics |
| Persona creations | 500+ | In-app analytics (opt-in) |
| DAU | 100+ | In-app analytics (opt-in) |
| User satisfaction | 4.0+ stars | Feedback surveys |

### Engagement Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Chat sessions per user per week | 5+ | Local analytics |
| Searches per user per week | 10+ | Local analytics |
| Average session duration | 10+ minutes | Local analytics |
| Persona retention (30-day) | 60%+ | Local analytics |

### Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Training completion rate | 95%+ | Local analytics |
| Average training time | < 45 min | Local analytics |
| Inference latency (p50) | < 2s | Local analytics |
| Search latency (p50) | < 100ms | Local analytics |
| Crash-free sessions | 99%+ | Local crash reporting |

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| User-reported style accuracy | "Sounds like me" 80%+ | In-app survey |
| Search relevance | Top-3 hit rate 70%+ | User feedback |
| NPS score | 40+ | Periodic surveys |

---

## Risks & Mitigations

### Risk 1: Privacy Concerns Despite Local Processing

**Risk:** Users may not believe data truly stays local; skepticism about AI apps.

**Likelihood:** Medium
**Impact:** High

**Mitigations:**
- Clear, prominent privacy messaging throughout app
- Open-source core components for auditability
- Network activity indicator showing no data transfer
- Third-party privacy audit (future)

### Risk 2: Training Quality on Small Datasets

**Risk:** Users with few messages may get poor persona quality.

**Likelihood:** Medium
**Impact:** Medium

**Mitigations:**
- Minimum message threshold warning (e.g., 500+ messages recommended)
- Quality indicators after training
- Guidance on what makes a good persona

### Risk 3: Resource Exhaustion on Older Hardware

**Risk:** Training may fail or be extremely slow on base M1 with 8GB.

**Likelihood:** Medium
**Impact:** High

**Mitigations:**
- Clear hardware requirements in app description
- Resource check before training begins
- Smaller model option for constrained hardware
- Memory-efficient training settings

### Risk 4: Apple Silicon Exclusivity

**Risk:** Excluding Intel Macs limits addressable market.

**Likelihood:** Certain
**Impact:** Medium

**Mitigations:**
- Accept initial limitation for Apple Silicon
- Evaluate CPU-only inference for Intel (slower)
- Market specifically to Apple Silicon users initially

### Risk 5: iMessage Schema Changes

**Risk:** Apple updates Messages database schema, breaking parsing.

**Likelihood:** Low
**Impact:** High

**Mitigations:**
- Schema version detection
- Graceful degradation for unknown fields
- Quick update release process
- User reporting mechanism for parsing issues

### Risk 6: Misuse for Impersonation

**Risk:** Users create personas to impersonate others or deceive.

**Likelihood:** Low (mitigated by design)
**Impact:** High (reputational)

**Mitigations:**
- Design only allows training on sent messages
- No way to create persona of someone else
- Clear terms of service
- "This is an AI" watermarking in exports (if any)

---

## Out of Scope

### Version 1.0 Excludes:

1. **Multi-device sync** — No cloud, no sync between devices
2. **Intel Mac support** — Apple Silicon only for training
3. **iOS version** — iMessage database not accessible on iOS
4. **Training on received messages** — Privacy/compliance concern
5. **Group chat personas** — Individual persona only
6. **Voice messages** — Text only
7. **Image understanding** — No multimodal analysis
8. **Real-time iMessage integration** — No actual message sending
9. **Export to other platforms** — Local use only
10. **API for third-party apps** — Standalone application only

### Future Considerations (Post V1):

1. **Multiple persona versions** — Train on messages from different time periods
2. **Sentiment analysis** — Deeper emotional pattern recognition
3. **Contact personas** — Train on contact's style (with opt-in for their messages)
4. **Conversation simulation** — Two personas talking to each other
5. **Writing style coach** — Suggestions based on persona analysis
6. **Integration with other data sources** — Notes, emails, etc.

---

## Open Questions

### Product Questions

1. **Pricing model?** Free, freemium, or paid?
2. **Beta program structure?** Waitlist, open beta, or invite-only?
3. **Analytics opt-in?** What telemetry (if any) for product improvement?
4. **Persona sharing?** Should users be able to export/share their persona?

### Technical Questions

1. **Base model selection?** Qwen3.5-9B selected as primary model, with 4B/2B/0.8B tiers by available VRAM (resolved)
2. **Embedding model?** BGE-small vs nomic-embed — trade-offs?
3. **DuckDB VSS stability?** Ready for production or need fallback?
4. **llama.cpp server vs library?** HTTP subprocess or native bindings?

### Legal Questions

1. **Model license review?** Qwen3.5 uses Apache 2.0 (resolved — commercial-friendly)
2. **Terms of service scope?** What usage restrictions?
3. **Privacy policy requirements?** CCPA/GDPR considerations for local-only?

---

## Appendix

### A. Competitive Analysis

| Product | Approach | Differentiator vs. BRB |
|---------|----------|------------------------|
| Character.AI | Cloud-based character chat | BRB: Local, train on YOUR data |
| Replika | Cloud AI companion | BRB: Privacy-first, your real style |
| Personal AI | Cloud-based personal AI | BRB: No cloud, no subscription |
| Rewind | Local screen recording/search | BRB: Focuses on messages, creates persona |

### B. User Research Insights

*To be populated with findings from user interviews during development*

Key questions to explore:
- How do users currently search their messages?
- What insights would be most valuable?
- Privacy sensitivity around AI and messages
- Willingness to wait for training
- Interest in "Digital You" concept

### C. Technical Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Desktop App (Tauri)                      │
├───────────────────────┬─────────────────────────────────────────┤
│   React Frontend      │         Rust Backend                    │
│   - Chat UI           │   ┌─────────────────────────────────┐   │
│   - Search UI         │   │         Core Crates             │   │
│   - Insights UI       │   │  ┌──────────┐ ┌──────────────┐  │   │
│   - Settings          │   │  │messages- │ │   training   │  │   │
│                       │   │  │   db     │ │              │  │   │
│                       │   │  └──────────┘ └──────────────┘  │   │
│                       │   │  ┌──────────┐ ┌──────────────┐  │   │
│                       │   │  │ personas │ │  inference   │  │   │
│                       │   │  └──────────┘ └──────────────┘  │   │
│                       │   └─────────────────────────────────┘   │
└───────────────────────┴─────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ MLX Training  │    │  llama.cpp    │    │    DuckDB     │
│   (Python)    │    │   (Rust/C++)  │    │   (Vector)    │
└───────────────┘    └───────────────┘    └───────────────┘
```

### D. Glossary

| Term | Definition |
|------|------------|
| Digital You | AI persona trained on user's own sent messages |
| LoRA | Low-Rank Adaptation — efficient fine-tuning method |
| RAG | Retrieval-Augmented Generation — enhancing LLM with retrieved context |
| FDA | Full Disk Access — macOS permission level |
| GGUF | Model format for llama.cpp inference |
| MLX | Apple's ML framework for Apple Silicon |
| VSS | Vector Similarity Search — DuckDB extension |

---

*Document End*
