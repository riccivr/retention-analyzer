import {
  UnifiedVideoMetrics,
  UnifiedVideoMetricsSchema,
  RawTikTokMetricsInput,
  RawTikTokMetricsInputSchema,
  RawInstagramMetricsInput,
  RawInstagramMetricsInputSchema,
  RetentionDataPoint,
  Platform,
} from '../types/schema.js';

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return isNaN(value) ? fallback : value;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase().replace(/,/g, '');
    if (cleaned.endsWith('k')) {
      const num = parseFloat(cleaned.slice(0, -1));
      return isNaN(num) ? fallback : Math.round(num * 1000);
    }
    if (cleaned.endsWith('m')) {
      const num = parseFloat(cleaned.slice(0, -1));
      return isNaN(num) ? fallback : Math.round(num * 1000000);
    }
    if (cleaned.endsWith('%')) {
      const num = parseFloat(cleaned.slice(0, -1));
      return isNaN(num) ? fallback : num;
    }
    if (cleaned.endsWith('s')) {
      const num = parseFloat(cleaned.slice(0, -1));
      return isNaN(num) ? fallback : num;
    }
    const num = parseFloat(cleaned);
    return isNaN(num) ? fallback : num;
  }
  return fallback;
}

/**
 * Generates an estimated realistic retention curve if raw curve is missing,
 * anchoring on 100% at t=0, threeSecRetentionPct at t=3, and trailing smoothly.
 */
export function estimateRetentionCurve(
  durationSec: number,
  threeSecRetentionPct: number,
  avgWatchTimeSec: number
): RetentionDataPoint[] {
  const curve: RetentionDataPoint[] = [];
  const effectiveDuration = Math.max(1, Math.round(durationSec));

  for (let sec = 0; sec <= effectiveDuration; sec++) {
    if (sec === 0) {
      curve.push({ second: 0, retentionPct: 100 });
      continue;
    }

    if (sec <= 3) {
      // Linear interpolation from 100 to 3s retention
      const dropPerSec = (100 - threeSecRetentionPct) / 3;
      const val = Math.max(0, 100 - dropPerSec * sec);
      curve.push({ second: sec, retentionPct: Math.round(val * 10) / 10 });
      continue;
    }

    // Decay model based on avg watch time
    const decayFactor = Math.max(0.1, avgWatchTimeSec / effectiveDuration);
    const prev = curve[sec - 1].retentionPct;
    const decay = (prev / (effectiveDuration - 3)) * (1.2 - decayFactor * 0.5);
    const current = Math.max(2, prev - decay);
    curve.push({ second: sec, retentionPct: Math.round(current * 10) / 10 });
  }

  return curve;
}

/**
 * Normalizes TikTok Studio raw data exports (JSON or parsed CSV row).
 */
export function normalizeTikTokMetrics(
  raw: RawTikTokMetricsInput | Record<string, unknown>
): UnifiedVideoMetrics {
  const parsed = RawTikTokMetricsInputSchema.partial().parse(raw);

  const durationSec = Math.max(
    1,
    Math.round(parseNumber(parsed.videoDuration ?? (raw as any)['Video duration'] ?? 30))
  );

  const views = parseNumber(parsed.totalViews ?? (raw as any)['Total Views'] ?? (raw as any)['views'] ?? 0);
  const likes = parseNumber(parsed.likes ?? (raw as any)['Total Likes'] ?? (raw as any)['likes'] ?? 0);
  const comments = parseNumber(parsed.comments ?? (raw as any)['Total Comments'] ?? (raw as any)['comments'] ?? 0);
  const shares = parseNumber(parsed.shares ?? (raw as any)['Total Shares'] ?? (raw as any)['shares'] ?? 0);
  const saves = parseNumber(
    parsed.bookmarks ?? (raw as any)['Total Saves'] ?? (raw as any)['bookmarks'] ?? (raw as any)['saves'] ?? 0
  );
  const avgWatchTimeSec = parseNumber(
    parsed.averageWatchTime ?? (raw as any)['Average watch time'] ?? (raw as any)['avgWatchTime'] ?? durationSec * 0.4
  );

  const fullVideoWatchedPct = parsed.watchedFullVideoPct !== undefined
    ? parseNumber(parsed.watchedFullVideoPct)
    : (raw as any)['Watched full video (%)']
    ? parseNumber((raw as any)['Watched full video (%)'])
    : undefined;

  let threeSecRetentionPct = parsed.threeSecondRetentionPct !== undefined
    ? parseNumber(parsed.threeSecondRetentionPct)
    : (raw as any)['3s Retention']
    ? parseNumber((raw as any)['3s Retention'])
    : undefined;

  let retentionCurve: RetentionDataPoint[] = [];
  if (Array.isArray(parsed.retentionCurve) && parsed.retentionCurve.length > 0) {
    retentionCurve = parsed.retentionCurve.map((dp) => ({
      second: dp.second,
      retentionPct: Math.min(100, Math.max(0, dp.retentionPct)),
    }));
  }

  if (threeSecRetentionPct === undefined) {
    const point3 = retentionCurve.find((p) => p.second === 3);
    threeSecRetentionPct = point3 ? point3.retentionPct : 60;
  }

  if (retentionCurve.length === 0) {
    retentionCurve = estimateRetentionCurve(durationSec, threeSecRetentionPct, avgWatchTimeSec);
  }

  const unified: UnifiedVideoMetrics = {
    videoId: parsed.videoId || (raw as any)['Video ID'] || `tiktok_${Date.now()}`,
    title: parsed.title || (raw as any)['Video Title'] || 'Untitled TikTok',
    platform: 'tiktok',
    durationSec,
    metrics: {
      views,
      reach: views, // on TikTok views ~ impressions/reach proxy
      likes,
      comments,
      shares,
      saves,
      avgWatchTimeSec,
      fullVideoWatchedPct,
      threeSecRetentionPct,
    },
    retentionCurve,
  };

  return UnifiedVideoMetricsSchema.parse(unified);
}

/**
 * Normalizes Meta Business Suite / Instagram Insights raw data exports.
 */
export function normalizeInstagramMetrics(
  raw: RawInstagramMetricsInput | Record<string, unknown>
): UnifiedVideoMetrics {
  const parsed = RawInstagramMetricsInputSchema.partial().parse(raw);

  const durationSec = Math.max(
    1,
    Math.round(parseNumber(parsed.duration ?? (raw as any)['video_duration'] ?? (raw as any)['Duration'] ?? 30))
  );

  const views = parseNumber(parsed.plays ?? (raw as any)['Plays'] ?? (raw as any)['plays'] ?? (raw as any)['views'] ?? 0);
  const reach = parseNumber(parsed.reach ?? (raw as any)['Reach'] ?? views);
  const likes = parseNumber(parsed.likes ?? (raw as any)['Likes'] ?? 0);
  const comments = parseNumber(parsed.comments ?? (raw as any)['Comments'] ?? 0);
  const shares = parseNumber(parsed.shares ?? (raw as any)['Shares'] ?? 0);
  const saves = parseNumber(parsed.saved ?? (raw as any)['Saves'] ?? (raw as any)['saved'] ?? 0);
  const avgWatchTimeSec = parseNumber(
    parsed.avgWatchTime ?? (raw as any)['Average Watch Time'] ?? durationSec * 0.4
  );

  const skipRatePct = parsed.skipRatePct !== undefined
    ? parseNumber(parsed.skipRatePct)
    : (raw as any)['Skip Rate (%)']
    ? parseNumber((raw as any)['Skip Rate (%)'])
    : undefined;

  let threeSecRetentionPct = parsed.threeSecRetentionPct !== undefined
    ? parseNumber(parsed.threeSecRetentionPct)
    : (raw as any)['3-Sec Retention (%)']
    ? parseNumber((raw as any)['3-Sec Retention (%)'])
    : undefined;

  let retentionCurve: RetentionDataPoint[] = [];
  if (Array.isArray(parsed.retentionCurve) && parsed.retentionCurve.length > 0) {
    retentionCurve = parsed.retentionCurve.map((dp) => ({
      second: dp.second,
      retentionPct: Math.min(100, Math.max(0, dp.retentionPct)),
    }));
  }

  if (threeSecRetentionPct === undefined) {
    const point3 = retentionCurve.find((p) => p.second === 3);
    threeSecRetentionPct = point3 ? point3.retentionPct : 50;
  }

  if (retentionCurve.length === 0) {
    retentionCurve = estimateRetentionCurve(durationSec, threeSecRetentionPct, avgWatchTimeSec);
  }

  const unified: UnifiedVideoMetrics = {
    videoId: parsed.mediaId || (raw as any)['Media ID'] || `instagram_${Date.now()}`,
    title: parsed.caption || (raw as any)['Caption'] || 'Untitled Reel',
    platform: 'instagram',
    durationSec,
    metrics: {
      views,
      reach,
      likes,
      comments,
      shares,
      saves,
      avgWatchTimeSec,
      threeSecRetentionPct,
      skipRatePct,
    },
    retentionCurve,
  };

  return UnifiedVideoMetricsSchema.parse(unified);
}

/**
 * Universal dispatcher from raw object or platform string.
 */
export function normalizeVideoMetrics(
  platform: Platform,
  raw: Record<string, unknown>
): UnifiedVideoMetrics {
  return platform === 'tiktok'
    ? normalizeTikTokMetrics(raw)
    : normalizeInstagramMetrics(raw);
}

/**
 * Parses a simple CSV string representing video metrics or retention points.
 */
export function parseCsvRows(csvContent: string): Record<string, string>[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}
