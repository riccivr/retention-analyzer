#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import dotenv from 'dotenv';
import {
  writeBrostyMockFile,
  generateBrostyComparisonData,
  BrostyComparisonDataset,
} from './mocks/generateMocks.js';
import { extractVideoPacing } from './video/ffmpegPacing.js';
import { generateVideoContactSheet } from './video/contactSheet.js';
import { transcribeVideo } from './audio/transcriber.js';
import { deconstructVideoMultimodal } from './analyzer/multimodalAnalyzer.js';
import {
  deconstructVideoModel,
  compareVideosAB,
} from './correlator/engine.js';
import { parseRetentionGraphScreenshot } from './ingest/visionGraphParser.js';
import { normalizeTikTokMetrics } from './ingest/normalizer.js';

dotenv.config();

const program = new Command();

program
  .name('retention-analyzer')
  .description(
    'Short-Form Video Retention & Editing Analyzer (A/B Outlier Engine) - Tier-3 Local WSL2 Stack (Ollama + Whisper Large-v3 + FFmpeg Contact Sheets)'
  )
  .version('1.1.0');

program
  .option('-d, --dry-run', 'Run full dry-run correlation on synthetic Brosty A/B dataset')
  .option('-o, --output <path>', 'Save generated Markdown report to specified path', 'reports/ab_comparison_report.md')
  .option('-p, --extract-pacing <videoPath>', 'Run deterministic FFmpeg cut detection and pacing extraction')
  .option('-c, --contact-sheet <videoPath>', 'Generate high-res timestamped contact sheet grid (FFmpeg)')
  .option('-t, --transcribe <videoPath>', 'Transcribe video audio using local Whisper (large-v3 / faster-whisper)')
  .option('-g, --parse-graph <imagePath>', 'Run local Ollama Vision parser on a retention graph screenshot')
  .option('-m, --generate-mocks', 'Generate synthetic mock data at mocks/brosty_comparison.json')
  .option('--ollama-host <url>', 'Ollama host endpoint', process.env.OLLAMA_HOST || 'http://127.0.0.1:11434')
  .option('--vision-model <model>', 'Local vision model', process.env.OLLAMA_VISION_MODEL || 'gemma4:12b')
  .option('--reasoning-model <model>', 'Local reasoning model', process.env.OLLAMA_REASONING_MODEL || 'qwen3.5:27b')
  .option('--whisper-model <model>', 'Whisper model', process.env.WHISPER_MODEL || 'large-v3')
  .option('--whisper-lang <lang>', 'Whisper language', process.env.WHISPER_LANG || 'es')
  .option('--video-a <path>', 'Path to Outlier video .mp4 file')
  .option('--video-b <path>', 'Path to Baseline video .mp4 file')
  .option('--metrics-a <path>', 'Path to JSON/CSV metrics for Outlier video')
  .option('--metrics-b <path>', 'Path to JSON/CSV metrics for Baseline video')
  .action(async (options) => {
    try {
      if (options.generateMocks) {
        const mockPath = writeBrostyMockFile();
        console.log(`[Success] Generated mock dataset at: ${mockPath}`);
        return;
      }

      if (options.extractPacing) {
        console.log(`[FFmpeg] Analyzing video pacing for: ${options.extractPacing}...`);
        const pacing = await extractVideoPacing(options.extractPacing);
        console.log(JSON.stringify(pacing, null, 2));
        return;
      }

      if (options.contactSheet) {
        console.log(`[FFmpeg] Generating contact sheet for: ${options.contactSheet}...`);
        const sheet = await generateVideoContactSheet(options.contactSheet);
        console.log(`[Success] Contact sheet generated at: ${sheet.sheetPath} (${sheet.totalTiles} tiles)`);
        return;
      }

      if (options.transcribe) {
        console.log(`[Whisper] Transcribing audio with local Whisper (${options.whisperModel}, lang: ${options.whisperLang})...`);
        const transcript = await transcribeVideo(options.transcribe, {
          model: options.whisperModel,
          lang: options.whisperLang,
        });
        console.log(JSON.stringify(transcript, null, 2));
        return;
      }

      if (options.parseGraph) {
        console.log(`[Local Vision] Extracting retention curve with Ollama (${options.visionModel}) from: ${options.parseGraph}...`);
        const points = await parseRetentionGraphScreenshot(options.parseGraph, {
          host: options.ollamaHost,
          model: options.visionModel,
        });
        console.log(JSON.stringify(points, null, 2));
        return;
      }

      if (options.videoA && options.videoB) {
        await runRealVideoComparison(options);
        return;
      }

      // Default or --dry-run: Run complete end-to-end correlation on mock data
      await runDryRunComparison(options.output);
    } catch (err: any) {
      console.error(`\n[Error] ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

async function runDryRunComparison(outputPath: string) {
  console.log('='.repeat(70));
  console.log(' SHORT-FORM VIDEO RETENTION & EDITING ANALYZER (A/B OUTLIER ENGINE)');
  console.log(' Tier-3 Local WSL2 Stack: Ollama (gemma4/qwen) + Whisper large-v3 + FFmpeg');
  console.log('='.repeat(70));
  console.log('Mode: Synthetic A/B Outlier Benchmark Dry-Run');

  const mockFile = path.resolve(process.cwd(), 'mocks', 'brosty_comparison.json');
  let data: BrostyComparisonDataset;

  if (fs.existsSync(mockFile)) {
    data = JSON.parse(fs.readFileSync(mockFile, 'utf-8'));
    console.log(`Loaded dataset from: ${mockFile}`);
  } else {
    console.log('Mock file not found. Generating fresh Brosty dataset...');
    writeBrostyMockFile(mockFile);
    data = generateBrostyComparisonData();
  }

  console.log('\n[1/4] Deconstructing Outlier Viral Video (53,600 views)...');
  const outlierDeconstructed = deconstructVideoModel(
    data.outlierVideo.metrics,
    data.outlierVideo.pacing,
    data.outlierVideo.timeline
  );

  console.log('[2/4] Deconstructing Baseline Promo Video (1,450 views)...');
  const baselineDeconstructed = deconstructVideoModel(
    data.baselineVideo.metrics,
    data.baselineVideo.pacing,
    data.baselineVideo.timeline
  );

  console.log('[3/4] Running Correlation & A/B Diff Engine...');
  const report = compareVideosAB(outlierDeconstructed, baselineDeconstructed);

  // Ensure output directory exists
  const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
  const dir = path.dirname(resolvedOutputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolvedOutputPath, report.summaryMarkdown, 'utf-8');
  console.log(`[4/4] Report written successfully to: ${resolvedOutputPath}\n`);

  printConsoleSummary(report);
}

async function runRealVideoComparison(options: any) {
  console.log('='.repeat(70));
  console.log(' Tier-3 Local WSL2 Stack: Real Video Multimodal & Deterministic A/B Comparison');
  console.log('='.repeat(70));

  console.log(`[1/6] Deterministic FFmpeg pacing analysis for Video A: ${options.videoA}...`);
  const pacingA = await extractVideoPacing(options.videoA);

  console.log(`[2/6] Deterministic FFmpeg pacing analysis for Video B: ${options.videoB}...`);
  const pacingB = await extractVideoPacing(options.videoB);

  console.log('[3/6] Local Multimodal deconstruction (Whisper + Contact Sheet + Ollama) for Video A...');
  const timelineA = await deconstructVideoMultimodal(options.videoA, pacingA, {
    host: options.ollamaHost,
    visionModel: options.visionModel,
    reasoningModel: options.reasoningModel,
    whisper: {
      model: options.whisperModel,
      lang: options.whisperLang,
    },
  });

  console.log('[4/6] Local Multimodal deconstruction (Whisper + Contact Sheet + Ollama) for Video B...');
  const timelineB = await deconstructVideoMultimodal(options.videoB, pacingB, {
    host: options.ollamaHost,
    visionModel: options.visionModel,
    reasoningModel: options.reasoningModel,
    whisper: {
      model: options.whisperModel,
      lang: options.whisperLang,
    },
  });

  let metricsA = options.metricsA
    ? JSON.parse(fs.readFileSync(options.metricsA, 'utf-8'))
    : normalizeTikTokMetrics({
        videoId: path.basename(options.videoA, path.extname(options.videoA)),
        videoDuration: pacingA.durationSec,
        totalViews: 50000,
        threeSecondRetentionPct: 75,
      });

  let metricsB = options.metricsB
    ? JSON.parse(fs.readFileSync(options.metricsB, 'utf-8'))
    : normalizeTikTokMetrics({
        videoId: path.basename(options.videoB, path.extname(options.videoB)),
        videoDuration: pacingB.durationSec,
        totalViews: 1500,
        threeSecondRetentionPct: 40,
      });

  const deconstructedA = deconstructVideoModel(metricsA, pacingA, timelineA);
  const deconstructedB = deconstructVideoModel(metricsB, pacingB, timelineB);

  console.log('[5/6] Correlating Retention Drop-offs and Generating A/B Diff...');
  const report = compareVideosAB(deconstructedA, deconstructedB);

  const resolvedOutputPath = path.resolve(process.cwd(), options.output);
  const dir = path.dirname(resolvedOutputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolvedOutputPath, report.summaryMarkdown, 'utf-8');

  console.log(`[6/6] Diagnostic report saved to: ${resolvedOutputPath}\n`);
  printConsoleSummary(report);
}

function printConsoleSummary(report: any) {
  const o = report.outlierVideo;
  const b = report.baselineVideo;

  console.log('-'.repeat(70));
  console.log(' EXECUTIVE A/B DIAGNOSTIC SUMMARY');
  console.log('-'.repeat(70));
  console.log(`• Outlier (${o.videoId}): ${o.metrics.metrics.views.toLocaleString()} views | 3s Retention: ${o.metrics.metrics.threeSecRetentionPct}% | Pacing: ${o.pacing.cutsPerMinute} CPM (ASL: ${o.pacing.averageShotLengthSec}s)`);
  console.log(`• Baseline (${b.videoId}): ${b.metrics.metrics.views.toLocaleString()} views | 3s Retention: ${b.metrics.metrics.threeSecRetentionPct}% | Pacing: ${b.pacing.cutsPerMinute} CPM (ASL: ${b.pacing.averageShotLengthSec}s)`);
  console.log(`• Hook Delta: Outlier first cut at ${o.pacing.timeToFirstCutSec}s vs Baseline delay of ${b.pacing.timeToFirstCutSec}s`);
  console.log(`• Dead-zone Risk: Baseline longest static shot was ${b.pacing.longestStaticShotSec}s (Outlier was only ${o.pacing.longestStaticShotSec}s)`);
  console.log(`• Drop-off Leaks: Baseline suffered ${b.dropoffs.length} severe drop-offs (Outlier had ${o.dropoffs.length})`);

  console.log('\n--- 3 REPLICATION BLUEPRINT RULES FOR EDITORS ---');
  report.replicationBlueprint.forEach((rule: string) => {
    console.log(`\n${rule}`);
  });
  console.log('\n' + '='.repeat(70));
}

program.parse(process.argv);
