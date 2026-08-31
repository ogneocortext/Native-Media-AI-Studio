import type { AudioAnalysisData } from "./types";

export interface TrackFeatures {
  energy: number;
  onset: number;
  section: string;
  sectionProgress: number;
  brightness: number;
  rolloff: number;
  noisiness: number;
  beatPhase: number;
  sectionIndex: number;
  totalSections: number;
}

const DEFAULT_FEATURES: TrackFeatures = {
  energy: 0.5,
  onset: 0,
  section: "unknown",
  sectionProgress: 0,
  brightness: 0.5,
  rolloff: 0.5,
  noisiness: 0.5,
  beatPhase: 0.5,
  sectionIndex: 0,
  totalSections: 0,
};

// Singleton state - updated once per frame, read by all visualizations
let cachedData: AudioAnalysisData | null = null;
let cachedEnergy: Float32Array | null = null;
let cachedOnsetSet: Set<number> | null = null;
let cachedCentroid: Float32Array | null = null;
let cachedRolloff: Float32Array | null = null;
let cachedZCR: Float32Array | null = null;
let lastUpdateTime = -1;
let cachedFeatures: TrackFeatures = DEFAULT_FEATURES;
let cachedProgress = -1;

function ensureCached(analysisData: AudioAnalysisData | null | undefined): boolean {
  if (analysisData === cachedData) return cachedData !== null;
  if (!analysisData) {
    cachedData = null;
    cachedFeatures = DEFAULT_FEATURES;
    return false;
  }
  cachedData = analysisData;
  cachedEnergy = new Float32Array(analysisData.energy_curve);
  cachedCentroid = new Float32Array(analysisData.spectral_centroid ?? []);
  cachedRolloff = new Float32Array(analysisData.spectral_rolloff ?? []);
  cachedZCR = new Float32Array(analysisData.zero_crossing_rate ?? []);
  cachedOnsetSet = new Set();
  for (const t of analysisData.onset_times) {
    cachedOnsetSet.add(Math.round(t * 100));
  }
  return true;
}

/**
 * Binary search to find the beat index closest to time t
 */
function findBeatIndex(beatTimes: number[], t: number): number {
  let lo = 0, hi = beatTimes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Updates track features once per frame. Call this from a single place
 * (e.g., the main Visualizer component) and read featuresRef in visualizations.
 */
export function updateTrackFeatures(
  analysisData: AudioAnalysisData | null | undefined,
  elapsed: number,
): TrackFeatures {
  if (!ensureCached(analysisData)) return DEFAULT_FEATURES;

  // Throttle: only recalculate if time changed by at least 16ms (~60fps)
  const elapsedRounded = Math.round(elapsed * 60);
  if (elapsedRounded === lastUpdateTime) return cachedFeatures;
  lastUpdateTime = elapsedRounded;

  const duration = cachedData!.duration_seconds;
  const t = Math.max(0, Math.min(elapsed, duration));
  const progress = t / duration;

  // Skip recalculation if progress hasn't changed meaningfully
  const progressRounded = Math.round(progress * 1000);
  if (progressRounded === cachedProgress && cachedData) return cachedFeatures;
  cachedProgress = progressRounded;

  // Energy from curve
  const energyIdx = Math.min(
    Math.floor(progress * cachedEnergy!.length),
    cachedEnergy!.length - 1,
  );
  const energy = energyIdx >= 0 ? cachedEnergy![energyIdx] : 0.5;

  // Onset detection (within 80ms window)
  const onsetT = Math.round(t * 100);
  let onset = 0;
  for (let delta = 0; delta <= 8; delta++) {
    if (cachedOnsetSet!.has(onsetT - delta) || cachedOnsetSet!.has(onsetT + delta)) {
      onset = Math.max(onset, 1 - delta / 8);
      if (onset >= 1) break;
    }
  }

  // Current section (sections are usually < 20, linear search is fine)
  let section = "unknown";
  let sectionProgress = 0;
  let sectionIndex = 0;
  const sections = cachedData!.sections;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (t >= s.start && t < s.end) {
      section = s.type;
      sectionProgress = (t - s.start) / (s.end - s.start);
      sectionIndex = i;
      break;
    }
  }

  // Spectral features
  const specIdx = Math.min(
    Math.floor(progress * cachedCentroid!.length),
    cachedCentroid!.length - 1,
  );
  const brightness = specIdx >= 0 && cachedCentroid![specIdx]
    ? Math.min(1, cachedCentroid![specIdx] / 8000)
    : 0.5;
  const rolloff = specIdx >= 0 && cachedRolloff![specIdx]
    ? Math.min(1, cachedRolloff![specIdx] / 12000)
    : 0.5;
  const noisiness = specIdx >= 0 && cachedZCR![specIdx]
    ? Math.min(1, cachedZCR![specIdx] / 0.5)
    : 0.5;

  // Beat phase using binary search
  let beatPhase = 0.5;
  const beatTimes = cachedData!.beat_times;
  if (beatTimes.length > 1) {
    const idx = findBeatIndex(beatTimes, t);
    if (idx > 0 && idx < beatTimes.length) {
      const beatDuration = beatTimes[idx] - beatTimes[idx - 1];
      beatPhase = beatDuration > 0 ? (t - beatTimes[idx - 1]) / beatDuration : 0.5;
    }
  }

  cachedFeatures = {
    energy,
    onset,
    section,
    sectionProgress,
    brightness,
    rolloff,
    noisiness,
    beatPhase,
    sectionIndex,
    totalSections: sections.length,
  };
  return cachedFeatures;
}

/**
 * Get the last computed features (for visualizations to read in useFrame)
 */
export function getTrackFeatures(): TrackFeatures {
  return cachedFeatures;
}
