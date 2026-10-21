import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { RetentionDataPoint, RetentionDataPointSchema } from '../types/schema.js';
import { z } from 'zod';

export interface VisionParserOptions {
  apiKey?: string;
  model?: string;
  fallbackToMockOnMissingKey?: boolean;
}

/**
 * Extracts second-by-second retention curve from a screenshot of a TikTok or
 * Instagram Reels retention analytics chart using Gemini Multimodal Vision.
 */
export async function parseRetentionGraphScreenshot(
  imagePath: string,
  options: VisionParserOptions = {}
): Promise<RetentionDataPoint[]> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const modelName = options.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Screenshot file not found: ${imagePath}`);
  }

  // Graceful fallback for local dry-runs or test environments without an API key
  if (!apiKey) {
    if (options.fallbackToMockOnMissingKey ?? true) {
      console.warn(
        `[VisionGraphParser] GEMINI_API_KEY is not set. Simulating parsed retention curve for: ${path.basename(
          imagePath
        )}`
      );
      return generateSimulatedCurveFromScreenshot(imagePath);
    }
    throw new Error('GEMINI_API_KEY is required to parse retention screenshots with Gemini Vision.');
  }

  const fileBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';

  const client = new GoogleGenAI({ apiKey });

  const prompt = `You are an expert video analytics computer vision engineer.
Analyze this screenshot of a vertical short-form video retention graph (TikTok Studio or Instagram Reels Insights).
Inspect the horizontal axis (time in seconds) and vertical axis (retention percentage 0-100%).
Extract every second (starting at second 0 = 100%) until the end of the video.
For each integer second, output the corresponding retention percentage as a float or integer between 0 and 100.
Do not omit points; provide an accurate, monotonic or near-monotonic curve reflecting the chart line.`;

  const response = await client.models.generateContent({
    model: modelName,
    contents: [
      {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType,
        },
      },
      prompt,
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: Type.ARRAY,
        description: 'Array of second-by-second retention percentage points',
        items: {
          type: Type.OBJECT,
          properties: {
            second: {
              type: Type.INTEGER,
              description: 'Elapsed second of the video (0, 1, 2, ...)',
            },
            retentionPct: {
              type: Type.NUMBER,
              description: 'Percentage of viewers still watching at this second (0 to 100)',
            },
          },
          required: ['second', 'retentionPct'],
        },
      },
    },
  });

  const rawJson = response.text;
  if (!rawJson) {
    throw new Error('Empty response received from Gemini Vision parser.');
  }

  const parsed = JSON.parse(rawJson);
  const validated = z.array(RetentionDataPointSchema).parse(parsed);

  // Ensure sorted by second
  validated.sort((a, b) => a.second - b.second);

  return validated;
}

function generateSimulatedCurveFromScreenshot(imagePath: string): RetentionDataPoint[] {
  // Generates a representative 30-second retention curve for mock / offline testing
  const isOutlier = imagePath.toLowerCase().includes('outlier') || imagePath.toLowerCase().includes('combo');
  const duration = isOutlier ? 28 : 30;
  const curve: RetentionDataPoint[] = [];

  for (let sec = 0; sec <= duration; sec++) {
    if (sec === 0) {
      curve.push({ second: 0, retentionPct: 100 });
      continue;
    }
    if (isOutlier) {
      // Outlier: 82% at 3s, holds strong, slight dip at 11s, finishes around 54%
      if (sec === 1) curve.push({ second: 1, retentionPct: 93 });
      else if (sec === 2) curve.push({ second: 2, retentionPct: 87 });
      else if (sec === 3) curve.push({ second: 3, retentionPct: 82 });
      else if (sec >= 4 && sec <= 10) curve.push({ second: sec, retentionPct: Math.round(82 - (sec - 3) * 0.9) });
      else if (sec === 11) curve.push({ second: 11, retentionPct: 69 }); // slight dip
      else if (sec >= 12 && sec <= 20) curve.push({ second: sec, retentionPct: Math.round(69 - (sec - 11) * 0.8) });
      else curve.push({ second: sec, retentionPct: Math.max(50, Math.round(62 - (sec - 20) * 0.9)) });
    } else {
      // Baseline: steep drop 0:02 to 0:06
      if (sec === 1) curve.push({ second: 1, retentionPct: 75 });
      else if (sec === 2) curve.push({ second: 2, retentionPct: 58 });
      else if (sec === 3) curve.push({ second: 3, retentionPct: 41 }); // 41% 3-sec retention
      else if (sec === 4) curve.push({ second: 4, retentionPct: 32 });
      else if (sec === 5) curve.push({ second: 5, retentionPct: 27 });
      else if (sec === 6) curve.push({ second: 6, retentionPct: 24 });
      else curve.push({ second: sec, retentionPct: Math.max(10, Math.round(24 - (sec - 6) * 0.5)) });
    }
  }

  return curve;
}
