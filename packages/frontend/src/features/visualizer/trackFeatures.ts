import type { AudioAnalysisData } from "./types";

export interface TrackFeatures {
  /** Normalized energy at current time (0-1) */
  energy: number;
  /** Whether an onset (new sound) is happening right now (0-1) */
  onset: number;
  /** Current song section type */
  section: string;
  /** Progress within current section (0-1) */
  sectionProgress: number;
  /** Spectral brightness (0=dark/warm, 1=bright/cool) */
  brightness: number;
  /** Spectral rolloff (0=low, 1=high) */
  rolloff: number;
  /** Noisiness/percussiveness (0=clean, 1=noisy) */
  noisiness: number;
  /** Beat phase (0=just beat, 1=between beats) */
  beatPhase: number;
  /** Current section index */
  sectionIndex: number;
  /** Total sections */
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

// Cache for processed data
let cachedData: AudioAnalysisData | null = null
let cachedEnergy: Float32Array | null = null
let cachedOnsetSet: Set<number> | null = null
let cachedCentroid: Float32Array | null = null
let cachedRolloff: Float32Array | null = null
let cachedZCR: Float32Array | null = null

function ensureCached(analysisData: AudioAnalysisData | null | undefined) {
  if (analysisData === cachedData) return
  if (!analysisData) {
    cachedData = null
    cachedEnergy = null
    cachedOnsetSet = null
    cachedCentroid = null
    cachedRolloff = null
    cachedZCR = null
    return
  }
  cachedData = analysisData
  cachedEnergy = new Float32Array(analysisData.energy_curve)
  cachedCentroid = new Float32Array(analysisData.spectral_centroid ?? [])
  cachedRolloff = new Float32Array(analysisData.spectral_rolloff ?? [])
  cachedZCR = new Float32Array(analysisData.zero_crossing_rate ?? [])
  // Build onset set (rounded to 10ms precision)
  cachedOnsetSet = new Set()
  for (const t of analysisData.onset_times) {
    cachedOnsetSet.add(Math.round(t * 100))
  }
}

/**
 * Extracts track-specific features from CUDA audio analysis data
 * based on current playback time. Call this inside useFrame.
 */
export function getTrackFeatures(
  analysisData: AudioAnalysisData | null | undefined,
  elapsed: number,
): TrackFeatures {
  ensureCached(analysisData)
  if (!cachedData || cachedData.duration_seconds <= 0) {
    return DEFAULT_FEATURES
  }

  const t = Math.max(0, Math.min(elapsed, cachedData.duration_seconds))
  const progress = t / cachedData.duration_seconds

  // Energy from curve
  const energyIdx = Math.min(
    Math.floor(progress * cachedEnergy!.length),
    cachedEnergy!.length - 1,
  )
  const energy = energyIdx >= 0 ? cachedEnergy![energyIdx] : 0.5

  // Onset detection (within 80ms window)
  const onsetT = Math.round(t * 100)
  let onset = 0
  for (let delta = 0; delta <= 8; delta++) {
    if (cachedOnsetSet!.has(onsetT - delta) || cachedOnsetSet!.has(onsetT + delta)) {
      onset = Math.max(onset, 1 - delta / 8)
    }
  }

  // Current section
  let section = "unknown"
  let sectionProgress = 0
  let sectionIndex = 0
  for (let i = 0; i < cachedData.sections.length; i++) {
    const s = cachedData.sections[i]
    if (t >= s.start && t < s.end) {
      section = s.type
      sectionProgress = (t - s.start) / (s.end - s.start)
      sectionIndex = i
      break
    }
  }

  // Spectral features
  const specIdx = Math.min(
    Math.floor(progress * cachedCentroid!.length),
    cachedCentroid!.length - 1,
  )
  const brightness = specIdx >= 0 && cachedCentroid![specIdx]
    ? Math.min(1, cachedCentroid![specIdx] / 8000)
    : 0.5
  const rolloff = specIdx >= 0 && cachedRolloff![specIdx]
    ? Math.min(1, cachedRolloff![specIdx] / 12000)
    : 0.5
  const noisiness = specIdx >= 0 && cachedZCR![specIdx]
    ? Math.min(1, cachedZCR![specIdx] / 0.5)
    : 0.5

  // Beat phase
  let beatPhase = 0.5
  const beatTimes = cachedData.beat_times
  if (beatTimes.length > 1) {
    for (let i = 0; i < beatTimes.length - 1; i++) {
      if (t >= beatTimes[i] && t < beatTimes[i + 1]) {
        const beatDuration = beatTimes[i + 1] - beatTimes[i]
        beatPhase = beatDuration > 0 ? (t - beatTimes[i]) / beatDuration : 0.5
        break
      }
    }
  }

  return {
    energy,
    onset,
    section,
    sectionProgress,
    brightness,
    rolloff,
    noisiness,
    beatPhase,
    sectionIndex,
    totalSections: cachedData.sections.length,
  }
}
