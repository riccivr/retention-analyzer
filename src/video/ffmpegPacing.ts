import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { PacingMetrics, PacingMetricsSchema, VideoResolution } from '../types/schema.js';

export interface FFmpegPacingOptions {
  sceneThreshold?: number; // Default 0.3 (standard for short-form hard-cuts)
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface VideoMetadata {
  durationSec: number;
  fps: number;
  resolution: VideoResolution;
}

/**
 * Runs ffprobe to extract frame rate, duration, and resolution with high precision.
 */
export async function extractVideoMetadata(
  videoPath: string,
  ffprobePath = process.env.FFPROBE_PATH || 'ffprobe'
): Promise<VideoMetadata> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at: ${videoPath}`);
  }

  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate,duration,avg_frame_rate',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    videoPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(
          new Error(`ffprobe failed with exit code ${code}: ${stderr || stdout}`)
        );
      }

      try {
        const info = JSON.parse(stdout);
        const stream = info.streams?.[0] || {};
        const format = info.format || {};

        const width = stream.width ? parseInt(stream.width, 10) : 1080;
        const height = stream.height ? parseInt(stream.height, 10) : 1920;

        // FPS calculation from ratio "30/1" or "30000/1001"
        let fps = 30;
        const fpsStr = stream.r_frame_rate || stream.avg_frame_rate;
        if (fpsStr && fpsStr.includes('/')) {
          const [num, den] = fpsStr.split('/').map(Number);
          if (den > 0) fps = Math.round((num / den) * 100) / 100;
        } else if (fpsStr) {
          const parsedFps = parseFloat(fpsStr);
          if (!isNaN(parsedFps) && parsedFps > 0) fps = parsedFps;
        }

        let durationSec = parseFloat(stream.duration || format.duration || '0');
        if (isNaN(durationSec) || durationSec <= 0) {
          durationSec = 30; // fallback if container is missing metadata
        }

        resolve({
          durationSec: Math.round(durationSec * 100) / 100,
          fps,
          resolution: { width, height },
        });
      } catch (err: any) {
        reject(new Error(`Failed to parse ffprobe output: ${err.message}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`Failed to start ffprobe: ${err.message}`)));
  });
}

/**
 * Executes deterministic scene cut detection using FFmpeg's scene score filter.
 * Command: ffmpeg -i input.mp4 -filter:v "select='gt(scene,0.3)',showinfo" -f null -
 * Parses pts_time values from showinfo stderr lines.
 */
export async function detectSceneCutTimestamps(
  videoPath: string,
  options: FFmpegPacingOptions = {}
): Promise<number[]> {
  const threshold = options.sceneThreshold ?? 0.3;
  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at: ${videoPath}`);
  }

  const args = [
    '-hide_banner',
    '-nostats',
    '-i',
    videoPath,
    '-filter:v',
    `select='gt(scene,${threshold})',showinfo`,
    '-f',
    'null',
    '-',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      // FFmpeg outputs showinfo logs to stderr even upon success
      if (code !== 0 && !stderr.includes('Parsed_showinfo')) {
        return reject(
          new Error(`ffmpeg cut detection failed with exit code ${code}: ${stderr}`)
        );
      }

      const cutTimestamps: number[] = [];
      const ptsRegex = /pts_time:([0-9.]+)/g;
      let match: RegExpExecArray | null;

      while ((match = ptsRegex.exec(stderr)) !== null) {
        const timestamp = parseFloat(match[1]);
        if (!isNaN(timestamp) && timestamp > 0.05) {
          const rounded = Math.round(timestamp * 100) / 100;
          // Avoid duplicate triggers within 0.1s
          if (
            cutTimestamps.length === 0 ||
            rounded - cutTimestamps[cutTimestamps.length - 1] > 0.1
          ) {
            cutTimestamps.push(rounded);
          }
        }
      }

      cutTimestamps.sort((a, b) => a - b);
      resolve(cutTimestamps);
    });

    proc.on('error', (err) => reject(new Error(`Failed to start ffmpeg: ${err.message}`)));
  });
}

/**
 * Calculates mathematical pacing metrics from exact cut timestamps and total duration.
 */
export function computePacingMetrics(
  durationSec: number,
  fps: number,
  resolution: VideoResolution,
  cutTimestamps: number[]
): PacingMetrics {
  const cleanDuration = Math.max(0.1, durationSec);
  const validCuts = cutTimestamps.filter((c) => c > 0 && c < cleanDuration);
  validCuts.sort((a, b) => a - b);

  // Compute individual shot lengths
  const shotLengthsSec: number[] = [];
  if (validCuts.length === 0) {
    shotLengthsSec.push(cleanDuration);
  } else {
    // First shot from 0.0 to first cut
    shotLengthsSec.push(Math.round(validCuts[0] * 100) / 100);

    // Intermediate shots
    for (let i = 1; i < validCuts.length; i++) {
      const len = validCuts[i] - validCuts[i - 1];
      shotLengthsSec.push(Math.round(len * 100) / 100);
    }

    // Final shot from last cut to end of video
    const lastCut = validCuts[validCuts.length - 1];
    const tail = Math.max(0, cleanDuration - lastCut);
    if (tail > 0.05) {
      shotLengthsSec.push(Math.round(tail * 100) / 100);
    }
  }

  const cutsCount = validCuts.length;
  const cutsPerMinute =
    Math.round(((cutsCount / cleanDuration) * 60) * 10) / 10;

  const totalShotsCount = shotLengthsSec.length;
  const averageShotLengthSec =
    totalShotsCount > 0
      ? Math.round((cleanDuration / totalShotsCount) * 100) / 100
      : cleanDuration;

  const longestStaticShotSec =
    shotLengthsSec.length > 0
      ? Math.max(...shotLengthsSec)
      : cleanDuration;

  const timeToFirstCutSec =
    validCuts.length > 0
      ? validCuts[0]
      : cleanDuration;

  const metrics: PacingMetrics = {
    durationSec: cleanDuration,
    fps,
    resolution,
    cutTimestamps: validCuts,
    cutsCount,
    cutsPerMinute,
    averageShotLengthSec,
    longestStaticShotSec: Math.round(longestStaticShotSec * 100) / 100,
    timeToFirstCutSec: Math.round(timeToFirstCutSec * 100) / 100,
    shotLengthsSec,
  };

  return PacingMetricsSchema.parse(metrics);
}

/**
 * Full end-to-end deterministic pacing extractor for an .mp4 file.
 */
export async function extractVideoPacing(
  videoPath: string,
  options: FFmpegPacingOptions = {}
): Promise<PacingMetrics> {
  const metadata = await extractVideoMetadata(videoPath, options.ffprobePath);
  const cutTimestamps = await detectSceneCutTimestamps(videoPath, options);

  return computePacingMetrics(
    metadata.durationSec,
    metadata.fps,
    metadata.resolution,
    cutTimestamps
  );
}
