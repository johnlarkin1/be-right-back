# Be Right Back — Onboarding & First-Run Experience Design Brief

**Document Version:** 1.0
**Date:** November 2025
**For:** Graphic Designers / Creative Agents
**Goal:** Design a memorable, cinematic onboarding experience that feels like booting up a retro terminal from the future

---

## Executive Summary

When a user downloads Be Right Back and launches it for the first time, they should feel like they're initializing a powerful, mysterious system. Think: the boot sequence in *The Matrix*, the terminal aesthetics of *Blade Runner*, or the UI in *Alien: Isolation*—but friendly and inviting.

The onboarding flow guides users through:
1. **System Boot** — Animated terminal initialization
2. **Permission Grant** — Request Full Disk Access
3. **Data Ingestion** — Copy/snapshot Messages database + Address Book
4. **Index Creation** — Build vector database with visual feedback
5. **Ready State** — Transition to main dashboard

---

## Brand & Visual Foundation

### Color Palette

```
┌─────────────────────────────────────────────────────────────┐
│  PRIMARY                                                     │
├─────────────────────────────────────────────────────────────┤
│  CRT Background      #0a0e0a   ████████  Deep black-green   │
│  CRT Background Lt   #0f150f   ████████  Elevated surfaces  │
│  Terminal Green      #00ff41   ████████  Primary text/glow  │
│  Amber/Orange        #ffb000   ████████  Warnings/accents   │
├─────────────────────────────────────────────────────────────┤
│  GHOST PALETTE (Mascot Colors)                              │
├─────────────────────────────────────────────────────────────┤
│  Ghost Green         #00ff41   ████████  Main ghost         │
│  Casper Pink         #ff69b4   ████████  Helper ghost       │
│  Ghost Purple        #8b5cf6   ████████  Accent             │
│  Ghost Cyan          #00ffff   ████████  Accent             │
├─────────────────────────────────────────────────────────────┤
│  UTILITY                                                     │
├─────────────────────────────────────────────────────────────┤
│  Dim Text            #00ff41 @ 60%       Secondary info     │
│  Borders             #00ff41 @ 20%       Subtle lines       │
│  Error Red           #ff4141             Failures           │
│  Success Green       #00ff88             Completions        │
└─────────────────────────────────────────────────────────────┘
```

### Typography

| Usage | Font | Characteristics |
|-------|------|-----------------|
| **Headlines / UI Labels** | VT323 | Pixelated, retro CRT feel |
| **Body / Code / Data** | IBM Plex Mono | Clean, readable monospace |

**Text Effects:**
- Primary text: Subtle glow `0 0 8px currentColor`
- Headlines: Strong glow `0 0 4px, 0 0 8px, 0 0 16px`
- Cursor blink animation: 0.8s linear infinite

### CRT Screen Effects

Apply these as subtle overlays to maintain the retro terminal aesthetic:

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │  ← Scanlines
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │    (horizontal)
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│                                                                │
│                    ┌──────────────┐                            │
│                    │   CONTENT    │                            │  ← Phosphor glow
│                    │              │                            │    (radial green)
│                    └──────────────┘                            │
│                                                                │
│  ▓▓                                                        ▓▓  │  ← Vignette
│  ▓▓▓▓                                                    ▓▓▓▓  │    (dark corners)
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
└────────────────────────────────────────────────────────────────┘
```

- **Scanlines:** Horizontal lines every 2px, 15% black opacity
- **Vignette:** Radial gradient, dark at edges
- **Flicker:** Very subtle opacity variation (97-100%), every ~4 seconds
- **Phosphor Glow:** Soft green radial at center, 3% opacity

---

## The Mascot: Ghost

Our mascot is a pixel-art ghost with various emotional states. Two main characters:

### Main Ghost (Green)
- Terminal green (#00ff41)
- Represents the system / "Digital You"
- Floats with subtle bobbing animation

### Casper (Pink)
- Hot pink (#ff69b4)
- The friendly helper ghost
- Guides users through onboarding

**Ghost Emotional States:**
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   STANDARD   │    HAPPY     │   EXCITED    │   WORRIED    │
│              │              │              │              │
│    ████      │    ████      │    ████      │    ████      │
│   ██  ██     │   ██  ██     │  ███  ███    │   ██  ██     │
│   ██  ██     │   ██  ██     │  ███  ███    │   ██  ██     │
│              │    ────      │    ─────     │   ~  ~  ~    │
│   ▀▄▀▄▀▄     │   ▀▄▀▄▀▄     │   ▀▄▀▄▀▄     │   ▀▄▀▄▀▄     │
├──────────────┼──────────────┼──────────────┼──────────────┤
│   SLEEPY     │  SURPRISED   │ MISCHIEVOUS  │   BORED      │
│              │              │              │              │
│    ████      │    ████      │    ████      │    ████      │
│   ──  ──     │  ███  ███    │   ──  ──     │   ──  ──     │
│              │  ███  ███    │         ─    │      ─       │
│              │     ██       │              │              │
│   ▀▄▀▄▀▄     │   ▀▄▀▄▀▄     │   ▀▄▀▄▀▄     │   ▀▄▀▄▀▄     │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

---

## Screen-by-Screen Design Specifications

---

### SCREEN 1: System Boot Sequence

**Duration:** 3-5 seconds
**Purpose:** Create anticipation, establish the retro-futuristic mood
**Ghost State:** None yet (pure system aesthetic)

**Visual Concept:**

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                                                                │
│                                                                │
│                                                                │
│        ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄           │
│        █                                         █           │
│        █   BE RIGHT BACK v0.1.0                  █           │
│        █   ─────────────────────────────────     █           │
│        █                                         █           │
│        █   > BIOS CHECK............... [OK]      █           │
│        █   > MEMORY TEST.............. [OK]      █           │
│        █   > NEURAL CORES............. [OK]      █           │
│        █   > GHOST PROTOCOL........... [OK]      █           │
│        █   > LOADING KERNEL........... [██░░]    █           │
│        █                                         █           │
│        █   INITIALIZING SYSTEM...                █           │
│        █   _                                     █           │
│        █                                         █           │
│        ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀           │
│                                                                │
│                                                                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Animation Sequence:**
1. **Frame 0-500ms:** Black screen, then CRT "turn on" effect (horizontal line expanding, slight jitter)
2. **Frame 500-1000ms:** Text appears letter by letter, typewriter style
3. **Frame 1000-2500ms:** System checks appear sequentially with slight delays
4. **Frame 2500-3500ms:** Progress bar fills for "LOADING KERNEL"
5. **Frame 3500-4000ms:** "INITIALIZING SYSTEM..." with blinking cursor
6. **Frame 4000-5000ms:** Fade/transition to next screen

**Design Details:**
- Use a "terminal window" container with slightly rounded corners
- Add very subtle screen curve distortion at edges
- ASCII art logo could appear at top (optional)
- Each `[OK]` should flash briefly before settling
- Progress bar should have blocky segments, not smooth fill

**Sound Design Notes (for future):**
- Soft electronic hum
- Subtle beep for each [OK]
- Satisfying "whoosh" on completion

---

### SCREEN 2: Permission Request (Full Disk Access)

**Duration:** User-controlled (waiting for action)
**Purpose:** Explain why we need access, make it feel safe
**Ghost State:** Casper (pink ghost) appears, looking helpful/encouraging

**Visual Concept:**

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                         ████                                   │
│                        ██  ██     ← Casper floats here        │
│                        ██  ██       (pink, happy face)         │
│                         ────                                   │
│                        ▀▄▀▄▀▄                                  │
│                                                                │
│     ┌──────────────────────────────────────────────────┐      │
│     │                                                  │      │
│     │   PERMISSION REQUIRED                            │      │
│     │   ════════════════════                           │      │
│     │                                                  │      │
│     │   To create your Digital Twin, I need to read:   │      │
│     │                                                  │      │
│     │   📱  iMessage Database                          │      │
│     │       ~/Library/Messages/chat.db                 │      │
│     │       Your conversation history                  │      │
│     │                                                  │      │
│     │   📇  Address Book                               │      │
│     │       ~/Library/Application Support/AddressBook  │      │
│     │       Contact names for display                  │      │
│     │                                                  │      │
│     │   ──────────────────────────────────────────     │      │
│     │                                                  │      │
│     │   🔒 YOUR DATA NEVER LEAVES THIS MAC             │      │
│     │      All processing happens locally              │      │
│     │                                                  │      │
│     │         ┌─────────────────────────────┐          │      │
│     │         │   GRANT FULL DISK ACCESS    │          │      │
│     │         └─────────────────────────────┘          │      │
│     │                                                  │      │
│     │   [ ] Don't show this again                      │      │
│     │                                                  │      │
│     └──────────────────────────────────────────────────┘      │
│                                                                │
│   $ Waiting for user authorization...  _                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Interaction Flow:**
1. Casper ghost floats in from side (or fades in)
2. Permission panel slides up or fades in
3. Button has glow effect on hover
4. On click: Opens System Settings via Tauri API
5. Show "Waiting for authorization..." at bottom
6. When granted: Casper does happy animation, proceed

**Button States:**
- **Default:** Border with subtle glow
- **Hover:** Fill with green at 10%, stronger glow, text shadow
- **Active/Pressed:** Fill at 20%, inset shadow
- **Loading:** Pulsing border animation

**Alternative Flow (if denied):**
- Show amber/orange warning message
- Casper looks worried
- Explain that app won't work without permission
- Provide "Try Again" button

---

### SCREEN 3: Data Ingestion Animation

**Duration:** 2-10 seconds (depending on database size)
**Purpose:** Show progress, make waiting feel interesting
**Ghost State:** Main ghost (green) appears, actively "working"

**Visual Concept — Dual Panel Layout:**

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   INGESTING DATA                                               │
│   ══════════════                                               │
│                                                                │
│   ┌─────────────────────────┐  ┌─────────────────────────┐    │
│   │                         │  │                         │    │
│   │   📱 MESSAGES           │  │   📇 CONTACTS           │    │
│   │   ─────────────         │  │   ──────────            │    │
│   │                         │  │                         │    │
│   │   ████████████░░░░      │  │   ████████████████      │    │
│   │          73%            │  │         100% ✓          │    │
│   │                         │  │                         │    │
│   │   Reading chat.db...    │  │   847 contacts found    │    │
│   │   127,482 messages      │  │                         │    │
│   │                         │  │                         │    │
│   └─────────────────────────┘  └─────────────────────────┘    │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  LIVE FEED                                           │    │
│   │  ─────────────────────────────────────────────────   │    │
│   │  > Snapshotting ~/Library/Messages/chat.db          │    │
│   │  > Found 847 unique contacts                         │    │
│   │  > Decoding NSAttributedString blobs...              │    │
│   │  > Processing conversation: Mom (4,521 messages)     │    │
│   │  > Processing conversation: Best Friend (3,892)      │    │
│   │  > _                                                 │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                │
│   [████████████████████████████████████████░░░░░░]  73%       │
│   Estimated time remaining: 12 seconds                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Animation Details:**

1. **Progress Bars:**
   - Blocky, terminal-style segments
   - Glow effect that intensifies as progress increases
   - Subtle "fill" animation (not instant jumps)

2. **Live Feed Terminal:**
   - Scrolling text log showing real operations
   - New lines appear with typewriter effect
   - Blinking cursor at end
   - Auto-scroll as new content appears

3. **Data Visualization (Optional Enhancement):**
   - Small particle effect: dots flowing from left panel to center
   - Represents data being "absorbed" into the system

4. **Ghost Behavior:**
   - Small ghost in corner, looking busy/focused
   - Could show ghost "carrying" data packets (playful)

---

### SCREEN 4: Vector Database & Index Creation

**Duration:** 30-120 seconds (varies by data size)
**Purpose:** This is the longest wait—make it visually captivating
**Ghost State:** Ghost actively "building" something

**Visual Concept — Neural Network / Connection Visualization:**

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   BUILDING YOUR DIGITAL MEMORY                                 │
│   ════════════════════════════                                 │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │                                                      │    │
│   │                    ●───────●                         │    │
│   │                   /│       │\                        │    │
│   │                  / │       │ \                       │    │
│   │                 ●──●───────●──●                      │    │
│   │                /│\ │       │ /│\                     │    │
│   │               / │ \│       │/ │ \                    │    │
│   │              ●──●──●───────●──●──●                   │    │
│   │             /│  │  │   ████│  │  │\                  │    │
│   │            / │  │  │  ██  ██  │  │ \                 │    │
│   │           ●──●──●──●──██  ██──●──●──●                │    │
│   │                       ▀▄▀▄▀▄                         │    │
│   │                    ↑ Ghost here                      │    │
│   │                                                      │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                │
│   Creating embeddings for 32,456 messages...                   │
│                                                                │
│   ┌─────────────────────────────────────────────────────┐     │
│   │  INDEXING                          EMBEDDING        │     │
│   │  ██████████████░░░░░░░░  67%      ████████████ 89%  │     │
│   └─────────────────────────────────────────────────────┘     │
│                                                                │
│   Current: Building semantic connections for "work" cluster    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Animation Details:**

1. **Neural Network Visualization:**
   - Nodes (●) represent message clusters or contacts
   - Lines connecting nodes pulse with light traveling along them
   - New connections form as indexing progresses
   - Ghost sits at center, "orchestrating" the connections
   - Nodes glow when being processed

2. **Alternative Visualization — Data Constellation:**
   ```
   ┌──────────────────────────────────────────────┐
   │                 ·  ·                         │
   │            · ·  ·    · ·                     │
   │          ·    ·   ████  ·   ·                │
   │         · ·  ·   ██  ██  · ·                 │
   │        ·   ·  ·  ██  ██ ·  ·  ·              │
   │         · ·   ·  ▀▄▀▄▀▄·  · ·                │
   │          ·  ·  · ·    · · ·                  │
   │            · ·  ·  · ·  ·                    │
   │                · ·  ·                        │
   └──────────────────────────────────────────────┘
   ```
   - Dots drift inward toward the ghost
   - Ghost "consumes" them, growing slightly brighter
   - Each dot represents a processed message

3. **Progress Indicators:**
   - Dual progress bars (indexing + embedding)
   - Current operation text updates
   - Optional: Show speed (messages/second)

4. **Fun Stats (scrolling at bottom):**
   - "Most used emoji: 😂 (847 times)"
   - "Longest conversation: Mom (4,521 messages)"
   - "Average response time: 3.2 minutes"

---

### SCREEN 5: Stats Calculation & Cache Building

**Duration:** 5-15 seconds
**Purpose:** Final step, build excitement for what's coming
**Ghost State:** Ghost looking excited/happy

**Visual Concept — Stats Dashboard Preview:**

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   ANALYZING YOUR COMMUNICATION PATTERNS                        │
│   ══════════════════════════════════════                       │
│                                                                │
│   ┌─────────────────────┐  ┌─────────────────────┐            │
│   │   MESSAGES          │  │   CONTACTS          │            │
│   │   ════════          │  │   ════════          │            │
│   │                     │  │                     │            │
│   │    ▄█████▄          │  │    ███              │            │
│   │   ████████          │  │    ██████           │            │
│   │   █████████         │  │    █████████        │            │
│   │   ██████████        │  │    ████████████     │            │
│   │   ███████████       │  │    ███████████████  │            │
│   │   ────────────      │  │    ───────────────  │            │
│   │   32,456 total      │  │   127 people        │            │
│   │   ↑ Counting...     │  │   ✓ Complete        │            │
│   └─────────────────────┘  └─────────────────────┘            │
│                                                                │
│   ┌──────────────────────────────────────────────────────┐    │
│   │  GENERATING INSIGHTS...                              │    │
│   │  ────────────────────────────────────────────────    │    │
│   │  ✓ Response time patterns                            │    │
│   │  ✓ Message frequency analysis                        │    │
│   │  ✓ Conversation volume trends                        │    │
│   │  ● Keyword extraction...                             │    │
│   │  ○ Sentiment analysis                                │    │
│   │  ○ Contact ranking                                   │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                                │
│   ████████████████████████████████████░░░░░░░░░  78%          │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Animation Details:**

1. **Mini Charts:**
   - Bars animate upward as data is counted
   - Numbers tick up in real-time
   - Satisfying "settle" animation when complete

2. **Checklist:**
   - Items check off sequentially
   - ○ = pending, ● = in progress, ✓ = complete
   - Each completion has subtle flash/glow

3. **Final Flourish:**
   - When 100%: All elements pulse once
   - Ghost does celebration animation (excited face, little bounce)
   - "READY" appears with strong glow

---

### SCREEN 6: Completion & Transition to Dashboard

**Duration:** 2-3 seconds
**Purpose:** Celebration moment, smooth handoff to main app
**Ghost State:** Excited/happy, then transition to standard

**Visual Concept:**

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                                                                │
│                                                                │
│                                                                │
│                                                                │
│                          ████                                  │
│                         ███████                                │
│                        ██  ██  ██                              │
│                        ██  ██  ██                              │
│                         ───────                                │
│                         ▀▄▀▄▀▄▀                                │
│                                                                │
│                   SYSTEM READY                                 │
│                                                                │
│                  ┌──────────────┐                              │
│                  │  ENTER BRB   │                              │
│                  └──────────────┘                              │
│                                                                │
│           Your digital twin is ready to meet you               │
│                                                                │
│                                                                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Animation Details:**

1. **Ghost Entrance:**
   - Ghost grows from center, glowing strongly
   - Particles emanate outward
   - "SYSTEM READY" types out with glow

2. **Button:**
   - Pulses gently to draw attention
   - Strong glow on hover
   - On click: Screen dissolves/transitions to dashboard

3. **Transition:**
   - Could use: fade, wipe from center, "zoom in" effect
   - Scanlines intensify briefly during transition
   - Dashboard elements animate in (staggered, as currently implemented)

---

## Micro-Interactions & Transitions

### Button States (All Buttons)

```css
/* Pseudo-code for reference */

Default:
  - Border: 1px solid rgba(0, 255, 65, 0.2)
  - Background: transparent
  - Text: Terminal green
  - Text-shadow: none

Hover:
  - Border: 1px solid rgba(0, 255, 65, 0.6)
  - Background: rgba(0, 255, 65, 0.1)
  - Text-shadow: 0 0 8px currentColor
  - Cursor: pointer (custom terminal cursor if possible)

Active/Pressed:
  - Background: rgba(0, 255, 65, 0.2)
  - Transform: scale(0.98)

Disabled:
  - Opacity: 0.5
  - Cursor: not-allowed
  - No glow effects
```

### Progress Bar Styles

```
INDETERMINATE (waiting):
  ▓░░▓░░▓░░▓░░▓░░▓░░▓░░▓░░   (sliding pattern)

DETERMINATE (known progress):
  ████████████████░░░░░░░░░   (filling left to right)

COMPLETE:
  ████████████████████████   (brief pulse, then settle)
```

### Text Animations

- **Typewriter:** Characters appear one by one, 30-50ms per char
- **Fade In:** Opacity 0→1 over 200-400ms
- **Slide Up:** translateY(20px) + opacity, 300ms ease-out
- **Glitch (sparingly):** Brief horizontal offset + color split on errors

---

## State Diagram

```
                    ┌─────────────┐
                    │   LAUNCH    │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   BOOT      │
                    │  SEQUENCE   │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
              ┌────►│ PERMISSION  │◄────┐
              │     │   REQUEST   │     │
              │     └──────┬──────┘     │
              │            │            │
        [Denied]           │       [Not Yet]
              │      [Granted]          │
              │            │            │
              │            ▼            │
              │     ┌─────────────┐     │
              │     │    DATA     │     │
              │     │  INGESTION  │     │
              │     └──────┬──────┘     │
              │            │            │
              │            ▼            │
              │     ┌─────────────┐     │
              │     │   INDEX     │     │
              │     │  CREATION   │     │
              │     └──────┬──────┘     │
              │            │            │
              │            ▼            │
              │     ┌─────────────┐     │
              │     │   STATS     │     │
              │     │   BUILD     │     │
              │     └──────┬──────┘     │
              │            │            │
              │            ▼            │
              │     ┌─────────────┐     │
              └─────│   READY     │─────┘
                    │ (Dashboard) │
                    └─────────────┘
```

---

## Reference & Inspiration

### Visual References

| Reference | What to Take From It |
|-----------|---------------------|
| **The Matrix** boot sequences | Terminal green on black, streaming text |
| **Fallout Pip-Boy** | CRT phosphor glow, retro-futurism |
| **Alien: Isolation** terminals | Scanlines, amber warnings, chunky UI |
| **Stranger Things** titles | Red glow, VHS aesthetic |
| **Blade Runner** interfaces | Data visualization, blue/orange contrast |
| **TRON** | Glowing lines, network visualizations |
| **Synthwave aesthetic** | Neon grids, dark backgrounds, glow |
| **Old Mac boot screens** | Happy Mac face, system checks |

### Motion References

- Gentle floating (think jellyfish, not bouncy ball)
- Satisfying "settle" after animations complete
- Subtle parallax on large containers
- Text that feels typed, not revealed

### Sound Design Direction (For Future)

- Low electronic hum
- Soft beeps and clicks
- Whoosh for transitions
- Gentle chime for completions
- Keep it subtle—not arcade-y

---

## Technical Notes for Implementation

### Animation Library
Currently using **Framer Motion** — continue with this. It handles:
- Staggered children animations
- Layout transitions
- Gesture handling

### Fonts to Load
```html
<link href="https://fonts.googleapis.com/css2?family=VT323&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### CRT Effects (CSS)
Already implemented in `globals.css`:
- `.crt-scanlines` — Horizontal line overlay
- `.crt-vignette` — Dark corners
- `.crt-glow` — Center phosphor effect
- `.animate-flicker` — Subtle screen flicker

### Ghost Component
Already implemented in `Ghost.tsx`:
- Supports variants: standard, happy, excited, worried, etc.
- Supports colors: green, pink, purple, cyan, amber
- Floating animation built-in
- `<Casper />` component for pink helper ghost

---

## Deliverables Requested

1. **High-fidelity mockups** for each screen (Figma, Sketch, or similar)
2. **Animation specifications** (timing, easing curves, keyframes)
3. **Interaction prototypes** (optional but helpful)
4. **Asset exports** (any new graphics, SVGs, or illustrations)
5. **Style guide additions** (if any new patterns emerge)

---

## Questions for Discussion

1. Should the boot sequence be skippable after first run?
2. Do we want ambient background animation (floating particles, etc.)?
3. Should we show actual message previews during ingestion (privacy implications)?
4. How prominent should Casper be during onboarding vs. subtle?
5. Do we want sound design, or keep it silent for MVP?

---

**Document prepared by:** Claude Code
**For:** Be Right Back Desktop Application
**Contact:** [Your contact info here]
