import { z } from 'zod';

// ==========================================
// Module A: Metric Normalizer Schemas
// ==========================================

export const PlatformSchema = z.enum(['tiktok', 'instagram']);
export type Platform = z.infer<typeof PlatformSchema>;

export const RetentionDataPointSchema = z.object({
  second: z.number().nonnegative(),
  retentionPct: z.number().min(0).max(100),
});
export type RetentionDataPoint = z.infer<typeof RetentionDataPointSchema>;

export const CoreMetricsSchema = z.object({
  views: z.number().nonnegative(),
  reach: z.number().nonnegative().optional(),
  likes: z.number().nonnegative(),
  comments: z.number().nonnegative(),
  shares: z.number().nonnegative(),
  saves: z.number().nonnegative(),
  avgWatchTimeSec: z.number().nonnegative(),
  fullVideoWatchedPct: z.number().min(0).max(100).optional(), // TikTok standard
  threeSecRetentionPct: z.number().min(0).max(100),           // Crucial 3s hook KPI
  skipRatePct: z.number().min(0).max(100).optional(),         // IG standard
});
export type CoreMetrics = z.infer<typeof CoreMetricsSchema>;

export const UnifiedVideoMetricsSchema = z.object({
  videoId: z.string(),
  title: z.string().optional(),
  platform: PlatformSchema,
  durationSec: z.number().positive(),
  metrics: CoreMetricsSchema,
  retentionCurve: z.array(RetentionDataPointSchema),
});
export type UnifiedVideoMetrics = z.infer<typeof UnifiedVideoMetricsSchema>;

// Raw Ingestion Inputs for TikTok & Instagram
export const RawTikTokMetricsInputSchema = z.object({
  videoId: z.string().optional(),
  title: z.string().optional(),
  videoDuration: z.union([z.number(), z.string()]), // could be "28s" or 28
  totalViews: z.union([z.number(), z.string()]),
  likes: z.union([z.number(), z.string()]).optional().default(0),
  comments: z.union([z.number(), z.string()]).optional().default(0),
  shares: z.union([z.number(), z.string()]).optional().default(0),
  bookmarks: z.union([z.number(), z.string()]).optional().default(0), // TikTok calls saves "bookmarks"
  averageWatchTime: z.union([z.number(), z.string()]).optional().default(0),
  watchedFullVideoPct: z.union([z.number(), z.string()]).optional(),
  threeSecondRetentionPct: z.union([z.number(), z.string()]).optional(),
  retentionCurve: z.array(z.object({
    second: z.number(),
    retentionPct: z.number(),
  })).optional(),
});
export type RawTikTokMetricsInput = z.infer<typeof RawTikTokMetricsInputSchema>;

export const RawInstagramMetricsInputSchema = z.object({
  mediaId: z.string().optional(),
  caption: z.string().optional(),
  duration: z.union([z.number(), z.string()]),
  plays: z.union([z.number(), z.string()]),
  reach: z.union([z.number(), z.string()]).optional(),
  likes: z.union([z.number(), z.string()]).optional().default(0),
  comments: z.union([z.number(), z.string()]).optional().default(0),
  shares: z.union([z.number(), z.string()]).optional().default(0),
  saved: z.union([z.number(), z.string()]).optional().default(0),
  avgWatchTime: z.union([z.number(), z.string()]).optional().default(0),
  threeSecRetentionPct: z.union([z.number(), z.string()]).optional(),
  skipRatePct: z.union([z.number(), z.string()]).optional(),
  retentionCurve: z.array(z.object({
    second: z.number(),
    retentionPct: z.number(),
  })).optional(),
});
export type RawInstagramMetricsInput = z.infer<typeof RawInstagramMetricsInputSchema>;

// ==========================================
// Module B: Deterministic FFmpeg Pacing Schemas
// ==========================================

export const VideoResolutionSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type VideoResolution = z.infer<typeof VideoResolutionSchema>;

export const PacingMetricsSchema = z.object({
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  resolution: VideoResolutionSchema,
  cutTimestamps: z.array(z.number().nonnegative()),
  cutsCount: z.number().int().nonnegative(),
  cutsPerMinute: z.number().nonnegative(),        // CPM
  averageShotLengthSec: z.number().nonnegative(), // ASL
  longestStaticShotSec: z.number().nonnegative(),
  timeToFirstCutSec: z.number().nonnegative(),
  shotLengthsSec: z.array(z.number().nonnegative()),
});
export type PacingMetrics = z.infer<typeof PacingMetricsSchema>;

// ==========================================
// Module C: Multimodal Content & Editing Deconstructor Schemas
// ==========================================

export const VisualTypeSchema = z.enum([
  'talking_head',
  'product_closeup',
  'b_roll_action',
  'text_graphic',
]);
export type VisualType = z.infer<typeof VisualTypeSchema>;

export const CameraMovementSchema = z.enum([
  'static',
  'zoom_in',
  'pan',
  'handheld_dynamic',
]);
export type CameraMovement = z.infer<typeof CameraMovementSchema>;

export const VocalEnergySchema = z.enum([
  'low',
  'conversational',
  'high_hype',
]);
export type VocalEnergy = z.infer<typeof VocalEnergySchema>;

export const HookPatternSchema = z.enum([
  'curiosity_gap',
  'direct_statement',
  'pattern_interrupt',
  'question',
  'urgency_fomo',
  'relatable_struggle',
]);
export type HookPattern = z.infer<typeof HookPatternSchema>;

export const HookAnatomySchema = z.object({
  visualStimulus: z.string(),
  verbalHookPattern: HookPatternSchema,
  description: z.string(),
});
export type HookAnatomy = z.infer<typeof HookAnatomySchema>;

export const MultimodalSegmentSchema = z.object({
  startTime: z.number().nonnegative(),
  endTime: z.number().nonnegative(),
  visualType: VisualTypeSchema,
  cameraMovement: CameraMovementSchema,
  onScreenText: z.string(),
  spokenTranscript: z.string(),
  wpm: z.number().nonnegative(),
  vocalEnergy: VocalEnergySchema,
  hookAnatomy: HookAnatomySchema.optional(),
  summary: z.string().optional(),
});
export type MultimodalSegment = z.infer<typeof MultimodalSegmentSchema>;

// ==========================================
// Module D: Correlation & A/B Diff Engine Schemas
// ==========================================

export const DropoffAttributionSchema = z.object({
  timestampSec: z.number().nonnegative(),
  dropPct: z.number().positive(),
  severity: z.enum(['moderate', 'severe', 'catastrophic']),
  reason: z.string(),
  segmentContext: z.object({
    visualType: VisualTypeSchema,
    cameraMovement: CameraMovementSchema,
    spokenWords: z.string(),
    shotDurationSec: z.number().nonnegative(),
    onScreenText: z.string(),
    cutsInWindow: z.number().int().nonnegative(),
  }),
  recommendation: z.string(),
});
export type DropoffAttribution = z.infer<typeof DropoffAttributionSchema>;

export const RetentionPlateauSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  retainedPct: z.number().min(0).max(100),
  reason: z.string(),
  editingPattern: z.string(),
  dominantVisualType: VisualTypeSchema,
  averageShotLengthSec: z.number().nonnegative(),
});
export type RetentionPlateau = z.infer<typeof RetentionPlateauSchema>;

export const DeconstructedVideoSchema = z.object({
  videoId: z.string(),
  title: z.string().optional(),
  platform: PlatformSchema,
  metrics: UnifiedVideoMetricsSchema,
  pacing: PacingMetricsSchema,
  timeline: z.array(MultimodalSegmentSchema),
  dropoffs: z.array(DropoffAttributionSchema),
  plateaus: z.array(RetentionPlateauSchema),
});
export type DeconstructedVideo = z.infer<typeof DeconstructedVideoSchema>;

export const HookComparisonSchema = z.object({
  outlier: z.object({
    timeToFirstCutSec: z.number(),
    visualMotion: stringOrMovement(),
    verbalPattern: z.string(),
    threeSecRetentionPct: z.number(),
    summary: z.string(),
  }),
  baseline: z.object({
    timeToFirstCutSec: z.number(),
    visualMotion: stringOrMovement(),
    verbalPattern: z.string(),
    threeSecRetentionPct: z.number(),
    summary: z.string(),
  }),
  verdict: z.string(),
});

function stringOrMovement() {
  return z.string();
}

export const PacingComparisonSchema = z.object({
  outlier: z.object({
    cutsPerMinute: z.number(),
    averageShotLengthSec: z.number(),
    longestStaticShotSec: z.number(),
  }),
  baseline: z.object({
    cutsPerMinute: z.number(),
    averageShotLengthSec: z.number(),
    longestStaticShotSec: z.number(),
  }),
  verdict: z.string(),
});

export const ScriptComparisonSchema = z.object({
  outlier: z.object({
    avgWpm: z.number(),
    dominantTone: z.string(),
    valueFraming: z.string(),
  }),
  baseline: z.object({
    avgWpm: z.number(),
    dominantTone: z.string(),
    valueFraming: z.string(),
  }),
  verdict: z.string(),
});

export const ABComparisonReportSchema = z.object({
  outlierVideoId: z.string(),
  baselineVideoId: z.string(),
  outlierVideo: DeconstructedVideoSchema,
  baselineVideo: DeconstructedVideoSchema,
  hookComparison: HookComparisonSchema,
  pacingComparison: PacingComparisonSchema,
  scriptFramingComparison: ScriptComparisonSchema,
  replicationBlueprint: z.array(z.string()).min(3),
  summaryMarkdown: z.string(),
  generatedAt: z.string(),
});
export type ABComparisonReport = z.infer<typeof ABComparisonReportSchema>;
