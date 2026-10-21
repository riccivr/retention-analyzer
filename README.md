# Short-Form Video Retention & Editing Analyzer (A/B Outlier Engine)

> Mathematically and visually correlate second-by-second retention drop-offs, watch times, and virality against deterministic video editing mechanics (cut frequency, visual pacing, B-roll timing, hook patterns, and spoken scripts) across TikTok and Instagram Reels.
> **100% Local Tier-3 WSL2 Stack: Ollama (`gemma4:12b` / `qwen3.5:27b`) + Whisper (`large-v3`) + High-Res FFmpeg Contact Sheets.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-green.svg)](https://nodejs.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-8.0-orange.svg)](https://ffmpeg.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_Tier--3-white.svg)](https://ollama.com/)
[![Whisper](https://img.shields.io/badge/Whisper-Large--v3-green.svg)](https://github.com/SYSTRAN/faster-whisper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 1. Overview & Objective

Why does an organic food combo showcase generate **53,600 views** with an 82% 3-second hook retention, while a seemingly similar promotional announcement stalls at **1,450 views** with a 41% hook retention?

The **A/B Outlier Engine** runs **100% locally inside WSL2** on Tier-3 hardware (16GB+ VRAM / 32GB+ RAM) with zero cloud API dependencies:
1. **Deterministic Pacing (FFmpeg):** Extracts frame-accurate hard cuts (`select='gt(scene,0.3)'`), Cuts Per Minute (CPM), Average Shot Length (ASL), and time-to-first-cut.
2. **High-Res Contact Sheet Generator (FFmpeg):** Generates composite timestamped $4\times 4$ keyframe grids ($T=0:00, 0:02, \dots$) for efficient local vision model inspection.
3. **Local Audio Transcription (Whisper `large-v3` / `faster-whisper`):** Transcribes audio tracks with word-level timestamps, speech density, and words-per-minute (WPM) calculations.
4. **Local Multimodal Deconstruction (Ollama `gemma4:12b` / `qwen3.5:27b`):** Analyzes the contact sheet + transcript in 1-to-3s segments to classify visual shot types, camera dynamics, on-screen text, and hook anatomy.
5. **Correlation Engine:** Correlates every retention drop $\ge 4\%$ at $[t-1\text{s}, t+1\text{s}]$, identifies plateaus, and synthesizes a concrete 3-rule Replication Blueprint for video editors.

---

## 2. Architecture & Modules

```
retention-analyzer/
├── src/
│   ├── types/
│   │   └── schema.ts            # Unified Zod schemas for metrics, pacing, timeline & reports
│   ├── ingest/
│   │   ├── normalizer.ts        # TikTok & Meta Business Suite metric normalizer & CSV parser
│   │   └── visionGraphParser.ts # Local Ollama Vision parser for retention graph screenshots
│   ├── video/
│   │   ├── ffmpegPacing.ts      # Deterministic FFmpeg scene-cut detection, CPM & ASL engine
│   │   └── contactSheet.ts      # High-res timestamped contact sheet grid generator (FFmpeg)
│   ├── audio/
│   │   ├── transcriber.ts       # Local Whisper large-v3 video audio transcription wrapper
│   │   └── transcribe_helper.py # Python faster-whisper runner with word-level timestamps
│   ├── analyzer/
│   │   └── multimodalAnalyzer.ts# Local Tier-3 multimodal deconstructor (Ollama + Whisper + Contact Sheets)
│   ├── correlator/
│   │   └── engine.ts            # Drop-off attribution, plateau detector & A/B diff engine
│   ├── mocks/
│   │   └── generateMocks.ts     # Synthetic generator for Brosty A/B benchmark dataset
│   └── index.ts                 # CLI runner and entry point
├── mocks/
│   └── brosty_comparison.json   # Complete realistic A/B dataset (53.6k viral vs 1.4k baseline)
├── reports/
│   └── ab_comparison_report.md  # Generated publication-ready Markdown diagnostic report
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

---

## 4. Configuration (`.env`)

Tier-3 local defaults are configured in `.env`:

```env
# Local Ollama Host & Tier-3 Models
OLLAMA_HOST=http://127.0.0.1:11434

# Tier 3 Vision Model (gemma4:12b for fast native vision, or qwen3.5:27b for max precision)
# Fallback support: qwen-vision-investigator:latest, huihui_ai/qwen2.5-vl-abliterated:7b
OLLAMA_VISION_MODEL=gemma4:12b

# Tier 3 Deep Reasoning & A/B Correlator Model
OLLAMA_REASONING_MODEL=qwen3.5:27b

# Local Whisper Large-v3 configuration
WHISPER_BIN=faster-whisper
WHISPER_MODEL=large-v3
WHISPER_LANG=es

# Optional: Path to python binary with faster-whisper installed
PYTHON_BIN=/mnt/c/Users/ricci/Desktop/code/autodub/.venv/bin/python

# Pacing & Attribution Defaults
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
DROPOFF_THRESHOLD_PCT=4.0
```

---

## 5. Quickstart & CLI Commands

### Prerequisites
- **Node.js** v20+ (Node v24 LTS recommended)
- **FFmpeg & FFprobe** in PATH (`sudo apt install ffmpeg`)
- **Ollama** running locally in WSL2 (`ollama serve`)
- Python 3.10+ with `faster-whisper` installed

### Run Dry-Run Benchmark

```bash
npm run dryrun
```

Outputs the complete A/B comparative report to `reports/ab_comparison_report.md`.

### CLI Utilities

```bash
# 1. Deterministic FFmpeg scene-cut and pacing detection
npx tsx src/index.ts --extract-pacing ./path/to/video.mp4

# 2. High-res timestamped contact sheet grid generation
npx tsx src/index.ts --contact-sheet ./path/to/video.mp4

# 3. Audio transcription with local Whisper Large-v3
npx tsx src/index.ts --transcribe ./path/to/video.mp4 --whisper-lang es

# 4. Retention graph screenshot extraction with local Ollama Vision
npx tsx src/index.ts --parse-graph ./path/to/retention_graph.png

# 5. Full local A/B real-video comparison
npx tsx src/index.ts \
  --video-a ./outlier.mp4 \
  --video-b ./baseline.mp4 \
  --vision-model gemma4:12b \
  --reasoning-model qwen3.5:27b \
  --output ./reports/custom_report.md
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

MIT License. Copyright (c) 2026 riccivr.
