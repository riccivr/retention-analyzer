import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface WhisperOptions {
  model?: string; // e.g. 'large-v3'
  lang?: string;  // e.g. 'es' or 'auto'
  device?: 'auto' | 'cuda' | 'cpu';
  pythonBin?: string;
  ffmpegPath?: string;
}

export interface WhisperWord {
  start: number;
  end: number;
  word: string;
  probability: number;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  wordCount: number;
  wpm: number;
  avgLogprob: number;
  words: WhisperWord[];
}

export interface WhisperTranscriptionResult {
  audioPath: string;
  language: string;
  languageProbability: number;
  duration: number;
  totalWords: number;
  segments: WhisperSegment[];
}

/**
 * Extracts a 16kHz mono WAV audio file from an MP4 video using FFmpeg.
 */
export async function extractAudioFromVideo(
  videoPath: string,
  outputPath?: string,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
): Promise<string> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const resolvedOutput =
    outputPath ||
    path.join(
      path.dirname(videoPath),
      `${path.basename(videoPath, path.extname(videoPath))}_audio.wav`
    );

  const args = [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    resolvedOutput,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        // If file has no audio stream, handle gracefully
        if (stderr.includes('does not contain any stream') || stderr.includes('Output file is empty')) {
          return resolve('');
        }
        return reject(new Error(`FFmpeg audio extraction failed (code ${code}): ${stderr}`));
      }
      resolve(resolvedOutput);
    });

    proc.on('error', (err) => reject(new Error(`Failed to start FFmpeg for audio extraction: ${err.message}`)));
  });
}

/**
 * Transcribes audio using local faster-whisper (Tier-3 setup).
 */
export async function transcribeAudio(
  audioPath: string,
  options: WhisperOptions = {}
): Promise<WhisperTranscriptionResult> {
  if (!audioPath || !fs.existsSync(audioPath)) {
    return {
      audioPath: '',
      language: options.lang || 'es',
      languageProbability: 1.0,
      duration: 0,
      totalWords: 0,
      segments: [],
    };
  }

  const pythonBin =
    options.pythonBin ||
    process.env.PYTHON_BIN ||
    '/mnt/c/Users/ricci/Desktop/code/autodub/.venv/bin/python';

  const scriptPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    'transcribe_helper.py'
  ).replace(/^\/([A-Z]:)/, '$1'); // normalize Windows drive letter if needed

  const model = options.model || process.env.WHISPER_MODEL || 'large-v3';
  const lang = options.lang || process.env.WHISPER_LANG || 'es';
  const device = options.device || 'auto';

  const args = [
    scriptPath,
    '--audio',
    audioPath,
    '--model',
    model,
    '--lang',
    lang,
    '--device',
    device,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[Whisper] Transcription process exited with code ${code}: ${stderr}`);
        // Return empty fallback instead of crashing
        return resolve({
          audioPath,
          language: lang,
          languageProbability: 0,
          duration: 0,
          totalWords: 0,
          segments: [],
        });
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (err: any) {
        console.warn(`[Whisper] Failed to parse JSON output: ${err.message}`);
        resolve({
          audioPath,
          language: lang,
          languageProbability: 0,
          duration: 0,
          totalWords: 0,
          segments: [],
        });
      }
    });

    proc.on('error', (err) => {
      console.warn(`[Whisper] Could not run python binary: ${err.message}`);
      resolve({
        audioPath,
        language: lang,
        languageProbability: 0,
        duration: 0,
        totalWords: 0,
        segments: [],
      });
    });
  });
}

/**
 * End-to-end video audio transcription wrapper.
 */
export async function transcribeVideo(
  videoPath: string,
  options: WhisperOptions = {}
): Promise<WhisperTranscriptionResult> {
  const wavPath = await extractAudioFromVideo(videoPath, undefined, options.ffmpegPath);
  if (!wavPath) {
    return {
      audioPath: '',
      language: options.lang || 'es',
      languageProbability: 0,
      duration: 0,
      totalWords: 0,
      segments: [],
    };
  }

  const result = await transcribeAudio(wavPath, options);

  // Clean up temporary wav file
  if (fs.existsSync(wavPath)) {
    try {
      fs.unlinkSync(wavPath);
    } catch {}
  }

  return result;
}
