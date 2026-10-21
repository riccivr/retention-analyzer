# Short-Form Video Retention & Editing Analyzer (A/B Outlier Engine)

> Mathematically and visually correlate second-by-second retention drop-offs, watch times, and virality against deterministic video editing mechanics (cut frequency, visual pacing, B-roll timing, hook patterns, and spoken scripts) across TikTok and Instagram Reels.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green.svg)](https://nodejs.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-8.0-orange.svg)](https://ffmpeg.org/)
[![Gemini](https://img.shields.io/badge/Gemini-3.8--flash-purple.svg)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 1. Overview & Objective

Why does an organic food combo showcase generate **53,600 views** with an 82% 3-second hook retention, while a seemingly similar promotional announcement stalls at **1,450 views** with a 41% hook retention?

The **A/B Outlier Engine** solves this question deterministically:
1. **Deterministic Pacing (FFmpeg):** Extracts frame-accurate hard cuts (`select='gt(scene,0.3)'`), Cuts Per Minute (CPM), Average Shot Length (ASL), and time-to-first-cut without LLM hallucination.
2. **Multimodal Deconstruction (Gemini 3.8 Flash):** Analyzes video + audio + screen text in chronological 1-to-3s windows to classify visual shot types, camera dynamics, on-screen text, spoken dialogue, and hook anatomy.
3. **Correlation Engine:** Pinpoints every retention drop $\ge 4\%$ in a single second and correlates it with the exact editorial state at $[t-1\text{s}, t+1\text{s}]$, identifying algorithmic dead zones and retention plateaus.
4. **Replication Blueprint:** Synthesizes actionable, quantitative rules for video editors to apply to the next edit.

---

## 2. Architecture & Modules

```
retention-analyzer/
├── src/
│   ├── types/
│   │   └── schema.ts           # Unified Zod schemas for metrics, pacing, multimodal timeline & reports
│   ├── ingest/
│   │   ├── normalizer.ts       # TikTok & Meta Business Suite metric normalizer & CSV parser
│   │   └── visionGraphParser.ts# Gemini Multimodal Vision parser for retention graph screenshots
│   ├── video/
│   │   └── ffmpegPacing.ts     # Deterministic FFmpeg scene-cut detection, CPM & ASL engine
│   ├── analyzer/
│   │   └── multimodalAnalyzer.ts # Gemini File API structured video deconstructor
│   ├── correlator/
│   │   └── engine.ts           # Drop-off attribution, plateau detector & A/B diff engine
│   ├── mocks/
│   │   └── generateMocks.ts    # Synthetic generator for Brosty A/B benchmark dataset
│   └── index.ts                # CLI runner and entry point
├── mocks/
│   └── brosty_comparison.json  # Complete realistic A/B dataset (53.6k viral vs 1.4k baseline)
├── reports/
│   └── ab_comparison_report.md # Generated publication-ready Markdown diagnostic report
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 3. Mathematical Foundations

### Pacing Metrics
- **Cuts Per Minute (CPM):**
  $$\text{CPM} = \frac{\text{Cut Count}}{\text{Duration (s)}} \times 60$$
- **Average Shot Length (ASL):**
  $$\text{ASL} = \frac{\text{Duration (s)}}{\text{Total Shots}}$$
- **Time to First Cut ($T_{\text{cut1}}$):** Elapsed time from 0.0s to the first hard camera cut or angle switch.

### Retention Drop-off Attribution
For any consecutive second $t \ge 1$:
$$\Delta R_t = R_{t-1} - R_t$$
If $\Delta R_t \ge 4.0\%$:
- An attribution record is generated referencing the active visual shot type, camera movement, continuous shot duration without a cut, and spoken dialogue at $[t-1\text{s}, t+1\text{s}]$.
- Severity is classified as `moderate` ($4\text{--}5\%$), `severe` ($5\text{--}8\%$), or `catastrophic` ($>8\%$).

### Retention Plateau
Contiguous windows $[t_{\text{start}}, t_{\text{end}}]$ where:
$$(R_{t_{\text{start}}} - R_{t_{\text{end}}}) \le 1.5\% \quad \text{and} \quad (t_{\text{end}} - t_{\text{start}}) \ge 3.0\text{s}$$
The engine attributes the plateau to the alternating shot pacing and visual entropy sustaining viewer focus.

---

## 4. Quickstart

### Prerequisites
- **Node.js** v20+ (Node v24 LTS recommended)
- **FFmpeg & FFprobe** installed and available in PATH (e.g. `sudo apt install ffmpeg` in WSL/Ubuntu)
- (Optional) **Google Gemini API Key** for real video and screenshot analysis

### Installation

```bash
git clone https://github.com/riccivr/retention-analyzer.git
cd retention-analyzer
npm install
cp .env.example .env
```

### Run Dry-Run Benchmark

Run the full end-to-end A/B correlation on the synthetic Brosty dataset:

```bash
npm run dryrun
```

This immediately parses the data, runs drop-off attribution, computes CPM and ASL, and writes a detailed markdown report to `reports/ab_comparison_report.md`.

---

## 5. CLI Usage & Commands

```bash
# Run the synthetic A/B comparison dry-run
npx tsx src/index.ts --dry-run

# Run deterministic FFmpeg cut detection and pacing analysis on any .mp4 file
npx tsx src/index.ts --extract-pacing ./path/to/video.mp4

# Extract second-by-second retention curve from a screenshot using Gemini Vision
npx tsx src/index.ts --parse-graph ./path/to/retention_screenshot.png

# Compare two real video files with automated multimodal deconstruction
npx tsx src/index.ts \
  --video-a ./path/to/outlier.mp4 \
  --video-b ./path/to/baseline.mp4 \
  --output ./reports/custom_ab_report.md

# Regenerate synthetic mock test cases
npm run mocks
```

---

## 6. A/B Benchmark Case Study: Brosty Burgers

| Dimension | Outlier Viral Combo (`53,600` views) | Baseline Promo (`1,450` views) |
| :--- | :--- | :--- |
| **3s Hook Retention** | **82%** | **41%** |
| **Avg Watch Time** | **22.4s** (80% duration) | **6.1s** (20% duration) |
| **Saves + Shares** | **2,060** | **6** |
| **Cuts Per Minute** | **47.1 CPM** | **10.0 CPM** |
| **Average Shot Length** | **1.22s** | **4.28s** |
| **Time to First Cut** | **0.7s** | **4.2s** |
| **Longest Static Shot**| **2.1s** | **7.5s** *(catastrophic abandonment)* |
| **Hook Pattern** | Sensory macro action + `curiosity_gap` | Static greeting + `direct_statement` pitch |

### 3 Replication Blueprint Rules for Editors
1. **The 1.0s Hook Stimulus:** Never exceed 1.0s before the first hard cut. Start immediately with an extreme macro action or pattern-interrupt visual rather than a greeting.
2. **The 2.0s Static Shot Ceiling:** Cap any continuous talking head or static camera shot at a strict maximum of 1.8s. Whenever dialogue exceeds 2 seconds, layer in dynamic B-roll cutaways or 15% digital push-in punch zooms.
3. **Show Don't Pitch:** Convert promotional announcements into sensory demonstrations. Replace price/discount verbal pitches ("15% off this Wednesday") with high-tempo sensory proof (156 WPM) and end with an organic social prompt ("Tag someone who owes you this").

---

## 7. License

MIT License. Crafted for high-growth short-form video editors and algorithmic content strategists.
