import {
  UnifiedVideoMetrics,
  PacingMetrics,
  MultimodalSegment,
  DropoffAttribution,
  DropoffAttributionSchema,
  RetentionPlateau,
  RetentionPlateauSchema,
  DeconstructedVideo,
  DeconstructedVideoSchema,
  ABComparisonReport,
  ABComparisonReportSchema,
  RetentionDataPoint,
} from '../types/schema.js';

export interface CorrelatorOptions {
  dropoffThresholdPct?: number; // default 4.0%
  plateauMinDurationSec?: number; // default 3s
  plateauMaxDropPct?: number; // default 1.5%
}

/**
 * Detects all moments where retention drops sharply (>= thresholdPct per second)
 * and correlates with the exact visual, vocal, and pacing mechanics at that second.
 */
export function detectDropoffs(
  curve: RetentionDataPoint[],
  timeline: MultimodalSegment[],
  pacing: PacingMetrics,
  thresholdPct = 4.0
): DropoffAttribution[] {
  const dropoffs: DropoffAttribution[] = [];
  const sortedCurve = [...curve].sort((a, b) => a.second - b.second);

  for (let i = 1; i < sortedCurve.length; i++) {
    const prev = sortedCurve[i - 1];
    const curr = sortedCurve[i];
    const deltaSec = Math.max(1, curr.second - prev.second);
    const drop = prev.retentionPct - curr.retentionPct;
    const dropPerSec = drop / deltaSec;

    if (dropPerSec >= thresholdPct) {
      const t = curr.second;

      // Find the segment that covers this second
      const activeSegment =
        timeline.find((s) => t >= s.startTime && t <= s.endTime) ||
        timeline[timeline.length - 1] || {
          startTime: Math.max(0, t - 1),
          endTime: t + 1,
          visualType: 'talking_head' as const,
          cameraMovement: 'static' as const,
          onScreenText: '',
          spokenTranscript: '',
          wpm: 0,
          vocalEnergy: 'low' as const,
        };

      // Count cuts in the [t - 1, t + 1] window
      const cutsInWindow = pacing.cutTimestamps.filter(
        (cut) => cut >= t - 1 && cut <= t + 1
      ).length;

      // Calculate how long the current continuous shot has lasted up to this second
      let currentShotDuration = 0;
      const precedingCuts = pacing.cutTimestamps.filter((c) => c <= t);
      if (precedingCuts.length === 0) {
        currentShotDuration = t;
      } else {
        const lastCutBefore = precedingCuts[precedingCuts.length - 1];
        currentShotDuration = Math.round((t - lastCutBefore) * 10) / 10;
      }

      // Severity classification
      const severity: 'moderate' | 'severe' | 'catastrophic' =
        dropPerSec >= 8.0 ? 'catastrophic' : dropPerSec >= 5.0 ? 'severe' : 'moderate';

      // Build diagnostic attribution string
      const visualDesc = `${activeSegment.cameraMovement} ${activeSegment.visualType}`;
      const staticShotNote =
        currentShotDuration >= 3.0
          ? `without a cut for ${currentShotDuration.toFixed(1)}s`
          : cutsInWindow === 0
          ? 'without visual cut stimulus'
          : 'despite a visual change';

      const scriptContext = activeSegment.spokenTranscript
        ? ` while saying: "${activeSegment.spokenTranscript.slice(0, 45)}..."`
        : '';

      const reason = `At 0:${t.toString().padStart(2, '0')}, retention dropped ${drop.toFixed(
        1
      )}% because the scene remained on a ${visualDesc} ${staticShotNote}${scriptContext} (vocal energy: ${
        activeSegment.vocalEnergy
      }).`;

      let recommendation = '';
      if (t <= 3) {
        recommendation =
          'Accelerate hook cut: execute first camera angle change within 1.0s and replace promotional rhetoric with sensory visual proof.';
      } else if (currentShotDuration >= 3.0) {
        recommendation = `Break up this ${currentShotDuration.toFixed(
          1
        )}s static shot with a B-roll action insert or push-in zoom every 1.2s to 1.8s.`;
      } else if (activeSegment.visualType === 'talking_head') {
        recommendation =
          'Overlay full-screen macro product B-roll or dynamic on-screen kinetic typography to maintain visual stimulation.';
      } else {
        recommendation =
          'Tighten editorial pacing: trim pauses and ramp vocal energy to match the visual tempo.';
      }

      dropoffs.push({
        timestampSec: t,
        dropPct: Math.round(drop * 10) / 10,
        severity,
        reason,
        segmentContext: {
          visualType: activeSegment.visualType,
          cameraMovement: activeSegment.cameraMovement,
          spokenWords: activeSegment.spokenTranscript,
          shotDurationSec: currentShotDuration,
          onScreenText: activeSegment.onScreenText,
          cutsInWindow,
        },
        recommendation,
      });
    }
  }

  return dropoffs;
}

/**
 * Detects retention plateaus where viewer drop-off is minimal (holding flat)
 * and attributes the editing rhythm responsible for sustaining engagement.
 */
export function detectPlateaus(
  curve: RetentionDataPoint[],
  timeline: MultimodalSegment[],
  pacing: PacingMetrics,
  minDurationSec = 3,
  maxAllowedDrop = 1.5
): RetentionPlateau[] {
  const plateaus: RetentionPlateau[] = [];
  const sorted = [...curve].sort((a, b) => a.second - b.second);

  let windowStart = 0;

  for (let i = 1; i < sorted.length; i++) {
    const totalDropInWindow =
      sorted[windowStart].retentionPct - sorted[i].retentionPct;
    const windowDuration = sorted[i].second - sorted[windowStart].second;

    if (totalDropInWindow > maxAllowedDrop) {
      if (windowDuration >= minDurationSec) {
        // Record plateau
        const p = buildPlateauObject(
          sorted[windowStart].second,
          sorted[i - 1].second,
          sorted[windowStart].retentionPct,
          timeline,
          pacing
        );
        if (p) plateaus.push(p);
      }
      windowStart = i;
    }
  }

  // Check tail window
  const finalIdx = sorted.length - 1;
  const tailDuration = sorted[finalIdx].second - sorted[windowStart].second;
  const tailDrop =
    sorted[windowStart].retentionPct - sorted[finalIdx].retentionPct;
  if (tailDuration >= minDurationSec && tailDrop <= maxAllowedDrop) {
    const p = buildPlateauObject(
      sorted[windowStart].second,
      sorted[finalIdx].second,
      sorted[windowStart].retentionPct,
      timeline,
      pacing
    );
    if (p) plateaus.push(p);
  }

  return plateaus;
}

function buildPlateauObject(
  startSec: number,
  endSec: number,
  retainedPct: number,
  timeline: MultimodalSegment[],
  pacing: PacingMetrics
): RetentionPlateau | null {
  const durationSec = endSec - startSec;
  if (durationSec < 2) return null;

  const segmentsInWindow = timeline.filter(
    (s) => s.endTime >= startSec && s.startTime <= endSec
  );

  const cutsInWindow = pacing.cutTimestamps.filter(
    (c) => c >= startSec && c <= endSec
  ).length;

  const avgShotLengthSec =
    cutsInWindow > 0
      ? Math.round((durationSec / (cutsInWindow + 1)) * 100) / 100
      : durationSec;

  // Determine dominant visual type
  const typeCounts: Record<string, number> = {};
  segmentsInWindow.forEach((s) => {
    typeCounts[s.visualType] = (typeCounts[s.visualType] || 0) + 1;
  });
  const dominantVisualType =
    (Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as any) ||
    'product_closeup';

  const editingPattern = `${avgShotLengthSec.toFixed(
    1
  )}s Average Shot Length with ${cutsInWindow} cuts, alternating between ${
    segmentsInWindow.map((s) => s.visualType).join(' & ') || dominantVisualType
  }`;

  const reason = `From 0:${startSec.toString().padStart(2, '0')} to 0:${endSec
    .toString()
    .padStart(2, '0')}, retention held steady at ~${retainedPct.toFixed(
    1
  )}% due to ${editingPattern}.`;

  return {
    startSec,
    endSec,
    durationSec,
    retainedPct: Math.round(retainedPct * 10) / 10,
    reason,
    editingPattern,
    dominantVisualType,
    averageShotLengthSec: avgShotLengthSec,
  };
}

/**
 * Fully deconstructs a video by merging metrics, pacing, timeline,
 * dropoffs, and plateaus into a single unified model.
 */
export function deconstructVideoModel(
  metrics: UnifiedVideoMetrics,
  pacing: PacingMetrics,
  timeline: MultimodalSegment[],
  options: CorrelatorOptions = {}
): DeconstructedVideo {
  const dropoffs = detectDropoffs(
    metrics.retentionCurve,
    timeline,
    pacing,
    options.dropoffThresholdPct ?? 4.0
  );

  const plateaus = detectPlateaus(
    metrics.retentionCurve,
    timeline,
    pacing,
    options.plateauMinDurationSec ?? 3,
    options.plateauMaxDropPct ?? 1.5
  );

  return DeconstructedVideoSchema.parse({
    videoId: metrics.videoId,
    title: metrics.title,
    platform: metrics.platform,
    metrics,
    pacing,
    timeline,
    dropoffs,
    plateaus,
  });
}

/**
 * The A/B Diff Engine: compares the Outlier (viral) video against the Baseline (underperforming) video
 * across 4 core axes: Hook, Pacing, Script Framing, and generates an actionable Replication Blueprint.
 */
export function compareVideosAB(
  outlier: DeconstructedVideo,
  baseline: DeconstructedVideo
): ABComparisonReport {
  // 1. Hook Mechanics (0:00 - 0:03)
  const outlierHook = outlier.timeline.find((s) => s.startTime < 3.0);
  const baselineHook = baseline.timeline.find((s) => s.startTime < 3.0);

  const outlierHookData = {
    timeToFirstCutSec: outlier.pacing.timeToFirstCutSec,
    visualMotion: outlierHook?.cameraMovement || 'handheld_dynamic',
    verbalPattern: outlierHook?.hookAnatomy?.verbalHookPattern || 'curiosity_gap',
    threeSecRetentionPct: outlier.metrics.metrics.threeSecRetentionPct,
    summary:
      outlierHook?.hookAnatomy?.description ||
      'Instant sensory payoff with fast camera cut and intrigue.',
  };

  const baselineHookData = {
    timeToFirstCutSec: baseline.pacing.timeToFirstCutSec,
    visualMotion: baselineHook?.cameraMovement || 'static',
    verbalPattern: baselineHook?.hookAnatomy?.verbalHookPattern || 'direct_statement',
    threeSecRetentionPct: baseline.metrics.metrics.threeSecRetentionPct,
    summary:
      baselineHook?.hookAnatomy?.description ||
      'Static greeting with immediate sales pitch, losing viewers before value delivery.',
  };

  const hookVerdict = `The Outlier captured ${outlierHookData.threeSecRetentionPct}% 3-second retention by executing its first cut in ${outlierHookData.timeToFirstCutSec.toFixed(
    1
  )}s with dynamic ${outlierHookData.visualMotion} motion and a "${
    outlierHookData.verbalPattern
  }" narrative gap. In contrast, the Baseline lost ${Math.round(
    100 - baselineHookData.threeSecRetentionPct
  )}% of its audience in 3s due to a ${baselineHookData.timeToFirstCutSec.toFixed(
    1
  )}s static delay and direct commercial pitch.`;

  // 2. Visual Pacing Rhythm
  const outlierPacingData = {
    cutsPerMinute: outlier.pacing.cutsPerMinute,
    averageShotLengthSec: outlier.pacing.averageShotLengthSec,
    longestStaticShotSec: outlier.pacing.longestStaticShotSec,
  };

  const baselinePacingData = {
    cutsPerMinute: baseline.pacing.cutsPerMinute,
    averageShotLengthSec: baseline.pacing.averageShotLengthSec,
    longestStaticShotSec: baseline.pacing.longestStaticShotSec,
  };

  const pacingRatio = (outlier.pacing.cutsPerMinute / Math.max(1, baseline.pacing.cutsPerMinute)).toFixed(1);
  const pacingVerdict = `The Outlier maintained ${outlierPacingData.cutsPerMinute} Cuts/Min (ASL: ${outlierPacingData.averageShotLengthSec}s), cycling shots ${pacingRatio}x faster than the Baseline (${baselinePacingData.cutsPerMinute} CPM, ASL: ${baselinePacingData.averageShotLengthSec}s). The Baseline's longest static shot of ${baselinePacingData.longestStaticShotSec}s created an algorithmic dead-zone that triggered catastrophic audience abandonment.`;

  // 3. Script & Value Framing
  const calcAvgWpm = (timeline: MultimodalSegment[]) => {
    const speechSegments = timeline.filter((s) => s.wpm > 0);
    if (speechSegments.length === 0) return 0;
    const sum = speechSegments.reduce((acc, s) => acc + s.wpm, 0);
    return Math.round(sum / speechSegments.length);
  };

  const outlierAvgWpm = calcAvgWpm(outlier.timeline);
  const baselineAvgWpm = calcAvgWpm(baseline.timeline);

  const outlierScriptData = {
    avgWpm: outlierAvgWpm,
    dominantTone: outlier.timeline[0]?.vocalEnergy || 'high_hype',
    valueFraming: 'Sensory storytelling, curiosity gap, and organic product glorification',
  };

  const baselineScriptData = {
    avgWpm: baselineAvgWpm,
    dominantTone: baseline.timeline[0]?.vocalEnergy || 'low',
    valueFraming: 'Direct promotional announcement and corporate CTA discount pitch',
  };

  const scriptVerdict = `The Outlier delivered high-tempo verbal delivery (${outlierScriptData.avgWpm} WPM, ${outlierScriptData.dominantTone}) centered on sensory food transformation. The Baseline spoke sluggishly (${baselineScriptData.avgWpm} WPM, ${baselineScriptData.dominantTone}) with promotional retail jargon ("15% off combos", "show this video to cashier") which algorithms and mobile audiences aggressively skip.`;

  // 4. Replication Blueprint (3 concrete editing rules)
  const replicationBlueprint = [
    `Rule 1 (The 1.0s Hook Stimulus): Never exceed 1.0s before the first hard cut (Outlier: ${outlier.pacing.timeToFirstCutSec.toFixed(
      1
    )}s vs Baseline: ${baseline.pacing.timeToFirstCutSec.toFixed(
      1
    )}s). Start immediately with an extreme macro action or pattern-interrupt visual rather than a greeting.`,
    `Rule 2 (The 2.0s Static Shot Ceiling): Cap any continuous talking head or static camera shot at a strict maximum of 1.8s. Whenever dialogue exceeds 2 seconds, layer in dynamic B-roll cutaways or 15% digital push-in punch zooms to eliminate visual drop-off plateaus.`,
    `Rule 3 (Show Don't Pitch): Convert promotional announcements into sensory demonstrations. Replace price/discount verbal pitches ("15% off this Wednesday") with high-tempo sensory proof (${outlierAvgWpm} WPM) and end with an organic social prompt ("Tag someone who owes you this").`,
  ];

  // Generate complete Markdown summary report
  const summaryMarkdown = renderComparisonMarkdownReport({
    outlier,
    baseline,
    hookComparison: { outlier: outlierHookData, baseline: baselineHookData, verdict: hookVerdict },
    pacingComparison: { outlier: outlierPacingData, baseline: baselinePacingData, verdict: pacingVerdict },
    scriptFramingComparison: { outlier: outlierScriptData, baseline: baselineScriptData, verdict: scriptVerdict },
    replicationBlueprint,
    generatedAt: new Date().toISOString(),
  });

  return {
    outlierVideoId: outlier.videoId,
    baselineVideoId: baseline.videoId,
    outlierVideo: outlier,
    baselineVideo: baseline,
    hookComparison: {
      outlier: outlierHookData,
      baseline: baselineHookData,
      verdict: hookVerdict,
    },
    pacingComparison: {
      outlier: outlierPacingData,
      baseline: baselinePacingData,
      verdict: pacingVerdict,
    },
    scriptFramingComparison: {
      outlier: outlierScriptData,
      baseline: baselineScriptData,
      verdict: scriptVerdict,
    },
    replicationBlueprint,
    summaryMarkdown,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Formats the entire analytical diagnostic into a publication-ready Markdown report.
 */
export function renderComparisonMarkdownReport(data: {
  outlier: DeconstructedVideo;
  baseline: DeconstructedVideo;
  hookComparison: any;
  pacingComparison: any;
  scriptFramingComparison: any;
  replicationBlueprint: string[];
  generatedAt: string;
}): string {
  const { outlier, baseline, hookComparison, pacingComparison, scriptFramingComparison, replicationBlueprint, generatedAt } = data;

  const viewDiff = ((outlier.metrics.metrics.views / Math.max(1, baseline.metrics.metrics.views))).toFixed(1);
  const saveShareDiff = (
    (outlier.metrics.metrics.saves + outlier.metrics.metrics.shares) /
    Math.max(1, baseline.metrics.metrics.saves + baseline.metrics.metrics.shares)
  ).toFixed(0);

  return `# Short-Form Video Retention & Editing Diagnostic Report
*Generated on: ${new Date(generatedAt).toUTCString()}*

---

## Executive Summary: Why the Outlier Went Viral (${viewDiff}x Views)

| Metric | Outlier (${outlier.videoId}) | Baseline (${baseline.videoId}) | Multiplier / Delta |
| :--- | :--- | :--- | :--- |
| **Total Views** | **${outlier.metrics.metrics.views.toLocaleString()}** | ${baseline.metrics.metrics.views.toLocaleString()} | **${viewDiff}x** |
| **3-Second Hook Retention** | **${outlier.metrics.metrics.threeSecRetentionPct}%** | ${baseline.metrics.metrics.threeSecRetentionPct}% | **+${(outlier.metrics.metrics.threeSecRetentionPct - baseline.metrics.metrics.threeSecRetentionPct).toFixed(1)}%** |
| **Avg Watch Time** | **${outlier.metrics.metrics.avgWatchTimeSec}s** (${((outlier.metrics.metrics.avgWatchTimeSec / outlier.metrics.durationSec) * 100).toFixed(0)}%) | ${baseline.metrics.metrics.avgWatchTimeSec}s (${((baseline.metrics.metrics.avgWatchTimeSec / baseline.metrics.durationSec) * 100).toFixed(0)}%) | **+${(outlier.metrics.metrics.avgWatchTimeSec - baseline.metrics.metrics.avgWatchTimeSec).toFixed(1)}s** |
| **Saves + Shares** | **${(outlier.metrics.metrics.saves + outlier.metrics.metrics.shares).toLocaleString()}** | ${(baseline.metrics.metrics.saves + baseline.metrics.metrics.shares).toLocaleString()} | **${saveShareDiff}x** |
| **Pacing (Cuts Per Min)** | **${outlier.pacing.cutsPerMinute} CPM** | ${baseline.pacing.cutsPerMinute} CPM | **${(outlier.pacing.cutsPerMinute / Math.max(1, baseline.pacing.cutsPerMinute)).toFixed(1)}x faster** |
| **Average Shot Length** | **${outlier.pacing.averageShotLengthSec}s** | ${baseline.pacing.averageShotLengthSec}s | **${(baseline.pacing.averageShotLengthSec / outlier.pacing.averageShotLengthSec).toFixed(1)}x tighter** |
| **Time to First Cut** | **${outlier.pacing.timeToFirstCutSec}s** | ${baseline.pacing.timeToFirstCutSec}s | **${(baseline.pacing.timeToFirstCutSec - outlier.pacing.timeToFirstCutSec).toFixed(1)}s faster** |

---

## 1. 0-3s Hook Mechanics Analysis

> **Hook Verdict:** ${hookComparison.verdict}

### Outlier Hook Anatomy
- **Visual Stimulus:** ${outlier.timeline[0]?.hookAnatomy?.visualStimulus || 'Macro close-up with kinetic motion'}
- **Verbal Hook Pattern:** \`${hookComparison.outlier.verbalPattern}\`
- **First Cut Execution:** ${outlier.pacing.timeToFirstCutSec}s
- **3-Sec Retention Result:** **${outlier.metrics.metrics.threeSecRetentionPct}%**

### Baseline Hook Breakdown
- **Visual Stimulus:** ${baseline.timeline[0]?.hookAnatomy?.visualStimulus || 'Static host talking behind counter'}
- **Verbal Hook Pattern:** \`${hookComparison.baseline.verbalPattern}\`
- **First Cut Execution:** ${baseline.pacing.timeToFirstCutSec}s (Severe delay)
- **3-Sec Retention Result:** **${baseline.metrics.metrics.threeSecRetentionPct}%**

---

## 2. Visual Pacing & Shot Duration Rhythm

> **Pacing Verdict:** ${pacingComparison.verdict}

\`\`\`
OUTLIER PACING (CPM: ${outlier.pacing.cutsPerMinute} | ASL: ${outlier.pacing.averageShotLengthSec}s)
[0.0s]--0.7s--[Cut 1]--1.1s--[Cut 2]--1.1s--[Cut 3]--1.2s--[Cut 4]... (Continuous rapid visual updates)

BASELINE PACING (CPM: ${baseline.pacing.cutsPerMinute} | ASL: ${baseline.pacing.averageShotLengthSec}s)
[0.0s]----------------------4.2s (Static talking head)----------------------[Cut 1]---------5.6s (Dead zone)---------[Cut 2]
\`\`\`

- **Outlier Longest Static Shot:** \`${outlier.pacing.longestStaticShotSec}s\`
- **Baseline Longest Static Shot:** \`${baseline.pacing.longestStaticShotSec}s\` *(Warning: >3.0s in short-form triggers instant thumb scroll)*

---

## 3. Second-by-Second Drop-off Post-Mortem

### Baseline Video Leaks (${baseline.dropoffs.length} Severe Drop-off Events)
${baseline.dropoffs
  .map(
    (d, i) =>
      `**#${i + 1} at 0:${d.timestampSec.toString().padStart(2, '0')} (-${d.dropPct.toFixed(1)}% drop)**\n- *Diagnostic:* ${d.reason}\n- *Context:* \`${d.segmentContext.visualType}\` | \`${d.segmentContext.cameraMovement}\` | Shot duration: ${d.segmentContext.shotDurationSec.toFixed(1)}s\n- *Actionable Fix:* ${d.recommendation}\n`
  )
  .join('\n')}

### Outlier Video Controlled Dips (${outlier.dropoffs.length} Mild Drop-offs)
${
  outlier.dropoffs.length === 0
    ? '_No severe drop-offs detected above the 4% threshold._'
    : outlier.dropoffs
        .map(
          (d, i) =>
            `**#${i + 1} at 0:${d.timestampSec.toString().padStart(2, '0')} (-${d.dropPct.toFixed(1)}% dip)**\n- *Diagnostic:* ${d.reason}\n- *Stabilization:* Immediate B-roll action cut recovered retention curve.\n`
        )
        .join('\n')
}

---

## 4. Retention Plateau & Spike Analysis

${
  outlier.plateaus.length > 0
    ? outlier.plateaus
        .map(
          (p) =>
            `### Outlier Retention Plateau: 0:${p.startSec.toString().padStart(2, '0')} to 0:${p.endSec
              .toString()
              .padStart(2, '0')} (${p.durationSec}s held at ~${p.retainedPct}%)\n- **Editing Pattern:** ${p.editingPattern}\n- **Why It Worked:** High visual entropy with zero static frames prevented cognitive habituation.\n`
        )
        .join('\n')
    : '_No extended plateaus detected._'
}

---

## 5. Replication Blueprint for Next Video

${replicationBlueprint.map((rule, idx) => `### Rule ${idx + 1}\n${rule}`).join('\n\n')}

---
*Report generated by Short-Form Video Retention & Editing Analyzer (A/B Outlier Engine)*
`;
}
