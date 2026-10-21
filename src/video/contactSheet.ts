import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ContactSheetOptions {
  ffmpegPath?: string;
  columns?: number;   // default 4
  rows?: number;      // default 4 (16 tiles)
  tileWidth?: number; // default 360 (for 9:16 vertical video)
  tileHeight?: number;// default 640
  outputPath?: string;
  fpsIntervalSec?: number; // interval between sampled frames (e.g. 1.8s for 30s video)
}

export interface ContactSheetResult {
  sheetPath: string;
  base64: string;
  columns: number;
  rows: number;
  totalTiles: number;
  sampleIntervalSec: number;
  timestamps: number[];
}

/**
 * Generates a high-resolution contact sheet image grid from a vertical video using FFmpeg.
 * Burns in timestamp indicators on each sampled frame so vision models can map shots chronologically.
 */
export async function generateVideoContactSheet(
  videoPath: string,
  durationSec = 30,
  options: ContactSheetOptions = {}
): Promise<ContactSheetResult> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const cols = options.columns || 4;
  const rows = options.rows || 4;
  const totalTiles = cols * rows;

  const tileWidth = options.tileWidth || 360;
  const tileHeight = options.tileHeight || 640;

  // Calculate sampling interval so totalTiles evenly spans the entire video
  const intervalSec =
    options.fpsIntervalSec ||
    Math.max(0.5, Math.round((durationSec / totalTiles) * 10) / 10);

  const outDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const resolvedOutput =
    options.outputPath ||
    path.join(
      outDir,
      `contact_sheet_${path.basename(videoPath, path.extname(videoPath))}_${Date.now()}.jpg`
    );

  // Compute timestamp labels for the tiles
  const timestamps: number[] = [];
  for (let i = 0; i < totalTiles; i++) {
    const t = Math.min(durationSec, Math.round(i * intervalSec * 10) / 10);
    timestamps.push(t);
  }

  // FFmpeg filter:
  // 1. Sample frames at 1/intervalSec fps
  // 2. Scale to vertical thumbnail
  // 3. Burn in timestamp text
  // 4. Tile into cols x rows grid
  const vfFilter = `fps=1/${intervalSec},scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2,drawtext=text='T\\=%{pts\\:hms}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.65:boxborderw=4:x=12:y=12,tile=${cols}x${rows}`;

  const args = [
    '-y',
    '-i',
    videoPath,
    '-vf',
    vfFilter,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    resolvedOutput,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(resolvedOutput)) {
        // Fallback without drawtext if fontconfig or fonts are missing
        const fallbackFilter = `fps=1/${intervalSec},scale=${tileWidth}:${tileHeight},tile=${cols}x${rows}`;
        const fallbackArgs = ['-y', '-i', videoPath, '-vf', fallbackFilter, '-frames:v', '1', resolvedOutput];

        const fallbackProc = spawn(ffmpegPath, fallbackArgs);
        fallbackProc.on('close', (fCode) => {
          if (fCode !== 0 || !fs.existsSync(resolvedOutput)) {
            return reject(new Error(`Failed to generate contact sheet with FFmpeg: ${stderr}`));
          }
          const base64 = fs.readFileSync(resolvedOutput).toString('base64');
          resolve({
            sheetPath: resolvedOutput,
            base64,
            columns: cols,
            rows,
            totalTiles,
            sampleIntervalSec: intervalSec,
            timestamps,
          });
        });
        return;
      }

      const base64 = fs.readFileSync(resolvedOutput).toString('base64');
      resolve({
        sheetPath: resolvedOutput,
        base64,
        columns: cols,
        rows,
        totalTiles,
        sampleIntervalSec: intervalSec,
        timestamps,
      });
    });

    proc.on('error', (err) => reject(new Error(`Failed to start FFmpeg: ${err.message}`)));
  });
}
