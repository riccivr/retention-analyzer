import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type, createPartFromUri, createUserContent } from '@google/genai';
import {
  MultimodalSegment,
  MultimodalSegmentSchema,
  PacingMetrics,
} from '../types/schema.js';
import { z } from 'zod';

export interface MultimodalAnalyzerOptions {
  apiKey?: string;
  model?: string;
  fallbackToMock?: boolean;
}

/**
 * Analyzes video with Gemini Multimodal to extract a detailed visual, vocal,
 * and typographic timeline broken down into 1-to-3 second segments.
 */
export async function deconstructVideoMultimodal(
  videoPath: string,
  pacing: PacingMetrics,
  options: MultimodalAnalyzerOptions = {}
): Promise<MultimodalSegment[]> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const modelName = options.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found at: ${videoPath}`);
  }

  if (!apiKey) {
    if (options.fallbackToMock ?? true) {
      console.warn(
        `[MultimodalAnalyzer] GEMINI_API_KEY is not set. Generating synthetic deconstructed timeline for ${path.basename(
          videoPath
        )} based on FFmpeg pacing.`
      );
      return generateSyntheticTimeline(pacing, videoPath);
    }
    throw new Error('GEMINI_API_KEY is required for Multimodal Video Analysis.');
  }

  const ai = new GoogleGenAI({ apiKey });
  let uploadedFile: any = null;

  try {
    console.log(`[MultimodalAnalyzer] Uploading video to Gemini File API: ${videoPath}...`);
    uploadedFile = await ai.files.upload({
      file: videoPath,
      config: {
        mimeType: 'video/mp4',
        displayName: path.basename(videoPath),
      },
    });

    // Wait for processing to complete
    let fileState = uploadedFile.state;
    let attempts = 0;
    while (fileState === 'PROCESSING' && attempts < 30) {
      console.log(`[MultimodalAnalyzer] Processing video... (poll ${attempts + 1})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const current = await ai.files.get({ name: uploadedFile.name });
      fileState = current.state;
      attempts++;
    }

    if (fileState === 'FAILED') {
      throw new Error(`Gemini video processing failed for: ${videoPath}`);
    }

    const cutList = pacing.cutTimestamps.map((c) => `${c.toFixed(2)}s`).join(', ');

    const promptText = `You are a world-class viral video editor and algorithmic retention specialist.
Deconstruct this vertical short-form video (duration: ${pacing.durationSec}s).
FFmpeg detected frame-accurate scene cuts at timestamps: [${cutList || 'none'}].

Break down the video into chronological 1-to-3 second segments (aligning closely with the scene cuts).
For EVERY segment, provide:
1. startTime and endTime (in seconds).
2. visualType: strictly one of ["talking_head", "product_closeup", "b_roll_action", "text_graphic"].
3. cameraMovement: strictly one of ["static", "zoom_in", "pan", "handheld_dynamic"].
4. onScreenText: exact visual text, stickers, or subtitles visible on screen (or empty string if none).
5. spokenTranscript: exact spoken dialogue during this segment (or empty string if non-verbal).
6. wpm: estimated words per minute spoken in this window (0 if silent).
7. vocalEnergy: strictly one of ["low", "conversational", "high_hype"].
8. hookAnatomy (for segments covering 0:00 to 0:03):
   - visualStimulus: description of the visual hook action
   - verbalHookPattern: strictly one of ["curiosity_gap", "direct_statement", "pattern_interrupt", "question", "urgency_fomo", "relatable_struggle"]
   - description: explanation of why this hook works or fails.
9. summary: brief 1-sentence note of what occurs.

Cover the entire video from 0.0s to ${pacing.durationSec}s without gaps.`;

    console.log(`[MultimodalAnalyzer] Calling ${modelName} for structured multimodal deconstruction...`);

    const response = await ai.models.generateContent({
      model: modelName,
      contents: createUserContent([
        createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || 'video/mp4'),
        promptText,
      ]),
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: Type.ARRAY,
          description: 'Chronological timeline of video editing segments',
          items: {
            type: Type.OBJECT,
            properties: {
              startTime: { type: Type.NUMBER },
              endTime: { type: Type.NUMBER },
              visualType: {
                type: Type.STRING,
                enum: ['talking_head', 'product_closeup', 'b_roll_action', 'text_graphic'],
              },
              cameraMovement: {
                type: Type.STRING,
                enum: ['static', 'zoom_in', 'pan', 'handheld_dynamic'],
              },
              onScreenText: { type: Type.STRING },
              spokenTranscript: { type: Type.STRING },
              wpm: { type: Type.NUMBER },
              vocalEnergy: {
                type: Type.STRING,
                enum: ['low', 'conversational', 'high_hype'],
              },
              hookAnatomy: {
                type: Type.OBJECT,
                properties: {
                  visualStimulus: { type: Type.STRING },
                  verbalHookPattern: {
                    type: Type.STRING,
                    enum: [
                      'curiosity_gap',
                      'direct_statement',
                      'pattern_interrupt',
                      'question',
                      'urgency_fomo',
                      'relatable_struggle',
                    ],
                  },
                  description: { type: Type.STRING },
                },
                required: ['visualStimulus', 'verbalHookPattern', 'description'],
              },
              summary: { type: Type.STRING },
            },
            required: [
              'startTime',
              'endTime',
              'visualType',
              'cameraMovement',
              'onScreenText',
              'spokenTranscript',
              'wpm',
              'vocalEnergy',
            ],
          },
        },
      },
    });

    const rawJson = response.text;
    if (!rawJson) {
      throw new Error('Empty response received from Gemini Multimodal Analyzer.');
    }

    const parsed = JSON.parse(rawJson);
    return z.array(MultimodalSegmentSchema).parse(parsed);
  } finally {
    if (uploadedFile?.name) {
      try {
        await ai.files.delete({ name: uploadedFile.name });
        console.log(`[MultimodalAnalyzer] Cleaned up temporary Gemini file: ${uploadedFile.name}`);
      } catch (err: any) {
        console.warn(`[MultimodalAnalyzer] Could not delete remote file: ${err.message}`);
      }
    }
  }
}

/**
 * Creates a synthetic timeline mapped directly to the detected cut boundaries
 * for offline dry-runs and automated CI tests.
 */
export function generateSyntheticTimeline(
  pacing: PacingMetrics,
  videoPath: string
): MultimodalSegment[] {
  const isOutlier =
    videoPath.toLowerCase().includes('outlier') ||
    videoPath.toLowerCase().includes('combo') ||
    pacing.cutsPerMinute > 30;

  const segments: MultimodalSegment[] = [];
  const boundaries = [0, ...pacing.cutTimestamps];
  if (boundaries[boundaries.length - 1] < pacing.durationSec) {
    boundaries.push(pacing.durationSec);
  }

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startTime = boundaries[i];
    const endTime = boundaries[i + 1];
    const isHook = startTime < 3.0;

    if (isOutlier) {
      const visualTypes: Array<'talking_head' | 'product_closeup' | 'b_roll_action'> = [
        'product_closeup',
        'b_roll_action',
        'product_closeup',
      ];
      const movements: Array<'handheld_dynamic' | 'zoom_in' | 'pan'> = [
        'handheld_dynamic',
        'zoom_in',
        'handheld_dynamic',
      ];

      const visualType = isHook
        ? 'product_closeup'
        : startTime > 10 && startTime < 13
        ? 'talking_head'
        : visualTypes[i % visualTypes.length];

      const cameraMovement =
        startTime > 10 && startTime < 13 ? 'static' : movements[i % movements.length];

      segments.push({
        startTime: Math.round(startTime * 100) / 100,
        endTime: Math.round(endTime * 100) / 100,
        visualType,
        cameraMovement,
        onScreenText: isHook
          ? 'WAIT TILL THE FLIP 💥'
          : `KEY STEP #${i + 1} SIZZLE`,
        spokenTranscript: isHook
          ? 'Wait until you hear this crunch.'
          : 'Look at the crisp crust and melted cheddar.',
        wpm: isHook ? 170 : 155,
        vocalEnergy: isHook ? 'high_hype' : 'conversational',
        hookAnatomy: isHook
          ? {
              visualStimulus: 'High speed macro camera pushing into bubbling cheddar',
              verbalHookPattern: 'curiosity_gap',
              description: 'Instant visual curiosity gap before commercial intent is revealed.',
            }
          : undefined,
        summary: `Dynamic short-form shot showcasing product engagement.`,
      });
    } else {
      // Baseline underperforming style: mostly static talking head, low energy
      const visualType =
        startTime > 12 && startTime < 20 ? 'product_closeup' : 'talking_head';
      const cameraMovement = 'static';

      segments.push({
        startTime: Math.round(startTime * 100) / 100,
        endTime: Math.round(endTime * 100) / 100,
        visualType,
        cameraMovement,
        onScreenText: isHook ? 'WEEKLY PROMOTION' : 'Visit our shop',
        spokenTranscript: isHook
          ? 'Hey guys, check out our new promo discount this week.'
          : 'We have 15 percent off all orders downtown.',
        wpm: 105,
        vocalEnergy: 'low',
        hookAnatomy: isHook
          ? {
              visualStimulus: 'Static medium shot of host with no movement',
              verbalHookPattern: 'direct_statement',
              description: 'Standard promotional broadcast without hook or emotional tension.',
            }
          : undefined,
        summary: `Static single-camera shot with minimal visual progression.`,
      });
    }
  }

  return segments;
}
