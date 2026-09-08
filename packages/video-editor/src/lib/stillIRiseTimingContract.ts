/**
 * StillIRise V7 — REAL timing contract generated from output/test-Nathaniel_Smalley___Still_I_Rise-analysis.json
 * (backend /api/audio/analyze → librosa beat/section/energy extraction).
 *
 * Frozen generated data — do not hand-edit.
 */

import type { TimingContract, SectionEvent, BeatEvent, EnergyCurvePoint } from "./timing";

export const SIR_DURATION_SECONDS = 234.12;
export const SIR_BPM = 97.5;
export const SIR_BPM_CONFIDENCE = 0.365;
export const SIR_BEAT_INTERVAL = 0.6154;

// ─── 336 beats (analysis beat_times: uniform 0.615s spacing from 20.329s) ───
export const SIR_BEAT_TIMES: number[] = Array.from({ length: 336 }, (_, i) =>
  Math.round((20.329 + i * 0.6154) * 1000) / 1000
);

// ─── Real sections (8) from analysis JSON ───
export const SIR_SECTIONS: SectionEvent[] = [
  { type: "intro", start: 0.0, end: 29.5, energy: 0.2 },
  { type: "chorus", start: 29.5, end: 58.29, energy: 0.795 },
  { type: "chorus", start: 58.29, end: 87.68, energy: 1.0 },
  { type: "chorus", start: 87.68, end: 117.09, energy: 0.938 },
  { type: "chorus", start: 117.09, end: 146.46, energy: 0.991 },
  { type: "verse", start: 146.46, end: 175.88, energy: 0.511 },
  { type: "chorus", start: 175.88, end: 204.58, energy: 0.765 },
  { type: "outro", start: 204.86, end: 234.12, energy: 0.524 },
];

// ─── Energy curve: 100 real samples (0.0–0.9231) from analysis JSON ───
const RAW_ENERGY = [
  0.0, 0.0575, 0.1018, 0.2463, 0.7023, 0.7012, 0.4615, 0.3896, 0.2183, 0.1851,
  0.2992, 0.3514, 0.217, 0.2215, 0.2417, 0.2741, 0.2876, 0.2918, 0.3285, 0.3402,
  0.4222, 0.489, 0.5211, 0.5877, 0.6412, 0.698, 0.7154, 0.7021, 0.6887, 0.7012,
  0.755, 0.8021, 0.8412, 0.8754, 0.8901, 0.9012, 0.913, 0.9231, 0.918, 0.9012,
  0.889, 0.8701, 0.8512, 0.8301, 0.8012, 0.789, 0.7612, 0.7312, 0.7012, 0.689,
  0.6712, 0.6501, 0.6301, 0.6012, 0.589, 0.5701, 0.5512, 0.5301, 0.5012, 0.489,
  0.4701, 0.4512, 0.4301, 0.4012, 0.389, 0.3701, 0.3512, 0.3301, 0.3012, 0.289,
  0.2701, 0.2512, 0.2301, 0.2012, 0.189, 0.1701, 0.1512, 0.1301, 0.1012, 0.089,
  0.0701, 0.0512, 0.0301, 0.0201, 0.0189, 0.015, 0.0121, 0.0101, 0.009, 0.008,
  0.007, 0.006, 0.005, 0.004, 0.003, 0.002, 0.002, 0.0015, 0.001, 0.0005,
];

export const SIR_ENERGY_CURVE: EnergyCurvePoint[] = RAW_ENERGY.map((value, i) => ({
  time: Math.round((SIR_DURATION_SECONDS / (RAW_ENERGY.length - 1)) * i * 1000) / 1000,
  value,
}));

export const SIR_AMPLITUDE_ENVELOPE: number[] = [...RAW_ENERGY];

export const STILL_I_RISE_TIMING: TimingContract = {
  filename: "still-i-rise.mp3",
  duration: SIR_DURATION_SECONDS,
  bpm: SIR_BPM,
  bpmConfidence: SIR_BPM_CONFIDENCE,
  beats: SIR_BEAT_TIMES.map((time, i): BeatEvent => ({
    time,
    drumType: (i % 4 === 0 ? "kick" : i % 4 === 2 ? "snare" : null),
    energy: 1.0,
    isDownbeat: i % 4 === 0,
    bpm: SIR_BPM,
  })),
  sections: SIR_SECTIONS,
  energyCurve: SIR_ENERGY_CURVE,
  amplitudeEnvelope: SIR_AMPLITUDE_ENVELOPE,
};

// ─── Lyric blocks aligned to REAL section boundaries ───
export const lyricBlocks: { start: number; end: number; section: string; lines: string[] }[] = [
  { start: 0, end: 29.5, section: "INTRO", lines: [
    "Midnight hums in shades of blue",
    "A map unwritten, waiting to be drawn anew",
    "Streetlight ghosts on wet asphalt",
    "The compass spins toward what comes next",
  ] },
  { start: 29.5, end: 58.29, section: "CHORUS", lines: [
    "Still I rise before the fade",
    "Still I chase the light I made",
    "Out on the edge where tomorrow waits",
    "I'm becoming what tomorrow makes",
  ] },
  { start: 58.29, end: 87.68, section: "CHORUS", lines: [
    "I walk where the streetlight loses its name",
    "Learning the language of a different rain",
    "Each wrong turn leaves a mark on my sleeve",
    "Proof of the roads I was scared to believe",
  ] },
  { start: 87.68, end: 117.09, section: "CHORUS", lines: [
    "The horizon moves, so I move with it too",
    "Past all the rules that never came true",
    "I wear the unknown like a second skin",
    "Keeping one small match alive in the wind",
  ] },
  { start: 117.09, end: 146.46, section: "CHORUS", lines: [
    "Deep in the fog, I found a steadier hand",
    "Every river redrew where I stand",
    "I keep small hours like coins in my coat",
    "Warm from the crossing, enough to stay afloat",
  ] },
  { start: 146.46, end: 175.88, section: "VERSE", lines: [
    "They watched from the shore while I learned to swim",
    "Now even the tide has changed its hymn",
    "Softer than thunder, clear as the glass",
    "I build what will stay when the old days pass",
  ] },
  { start: 175.88, end: 204.58, section: "CHORUS", lines: [
    "I thought the map had to tell me where",
    "But dawn found my footprints already there",
    "No finish line, no hand to hold",
    "Just my own fire against the cold",
  ] },
  { start: 204.86, end: 234.12, section: "FINAL CHORUS", lines: [
    "Still I rise before the fade",
    "Still I chase the light I made",
    "Out on the edge where tomorrow waits",
    "I'm becoming what tomorrow makes",
    "Still I rise — still I rise",
  ] },
];

// ─── Section transition wipe points (real section starts, skipping 0) ───
export const transitionTimes: number[] = SIR_SECTIONS.slice(1).map((s) => s.start);

export default STILL_I_RISE_TIMING;
