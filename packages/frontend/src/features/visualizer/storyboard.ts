/**
 * LRC-driven storyboard: turns a track's lyric sections + analysis energy into
 * a time-indexed shot list (narrative acts) that guides visual storytelling.
 *
 * Storytelling grammar (applied by consumers):
 * - ACTS: contiguous LRC sections become narrative beats with roman-numeral
 *   titles ("ACT II — THE BUILD") shown as cinematic cards on entry.
 * - MOTIFS: keyword analysis of each beat's lines picks a story motif
 *   (solitude → assembly → payoff → triumph) instead of a generic intensity.
 * - MOOD: mean CUDA energy over the beat's span scales motion/bloom.
 * - CAMERA: normalized dolly/orbit/lift hints give each act a distinct move.
 * - CINEMATIC: drop/payoff/triumph beats trigger letterbox bars — aspect
 *   change as act-shift punctuation.
 *
 * LRC section tags are treated as authored truth; CUDA `sections` are only a
 * fallback when no LRC sections exist (they frequently disagree in labeling).
 */
import type { LyricLine } from "./components/LyricOverlay";
import type { AudioAnalysisData } from "./types";

export type StoryMotif =
  | "establishing"
  | "solitude"
  | "struggle"
  | "assembly"
  | "build"
  | "payoff"
  | "triumph"
  | "reflection"
  | "outro";

export interface StoryPalette {
  base: string;
  primary: string;
  accent: string;
}

export interface StoryCamera {
  /** Push-in (+) / pull-back (−), -1..1 */
  dolly: number;
  /** Orbital drift speed/direction, -1..1 */
  orbit: number;
  /** Crane lift (+) / descent (−), -1..1 */
  lift: number;
}

export interface StoryBeat {
  id: string;
  index: number;
  act: number;
  actTitle: string;
  section: string;
  start: number;
  end: number;
  mood: number;
  palette: StoryPalette;
  camera: StoryCamera;
  motif: StoryMotif;
  /** Representative lyric line (title-card subtitle) */
  hook: string;
  lineCount: number;
  /** Letterbox bars on — reserved for drops/payoffs/triumphs */
  cinematic: boolean;
}

export interface Storyboard {
  track: string;
  duration: number;
  beats: StoryBeat[];
}

export interface StoryState {
  beat: StoryBeat | null;
  index: number;
  /** 0..1 progress through the current beat */
  shotProgress: number;
  next: StoryBeat | null;
  timeToNext: number;
}

export const EMPTY_STORYBOARD: Storyboard = Object.freeze({
  track: "",
  duration: 0,
  beats: [],
} as Storyboard);

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

const MOTIF_META: Record<StoryMotif, { title: string; palette: StoryPalette; camera: StoryCamera; cinematic: boolean }> = {
  establishing: { title: "ESTABLISHING", palette: { base: "#050510", primary: "#3b82f6", accent: "#93c5fd" }, camera: { dolly: 0.3, orbit: 0.1, lift: 0.1 }, cinematic: false },
  solitude: { title: "ISOLATION", palette: { base: "#070714", primary: "#6366f1", accent: "#a5b4fc" }, camera: { dolly: 0.15, orbit: -0.2, lift: 0 }, cinematic: false },
  struggle: { title: "FRICTION", palette: { base: "#0a0a12", primary: "#f59e0b", accent: "#fbbf24" }, camera: { dolly: -0.2, orbit: 0.5, lift: -0.1 }, cinematic: false },
  assembly: { title: "THE BUILD", palette: { base: "#061014", primary: "#06b6d4", accent: "#67e8f9" }, camera: { dolly: 0.5, orbit: 0.3, lift: 0.2 }, cinematic: false },
  build: { title: "ASCENT", palette: { base: "#0d0a14", primary: "#eab308", accent: "#fde047" }, camera: { dolly: 0.6, orbit: 0.2, lift: 0.4 }, cinematic: false },
  payoff: { title: "IGNITION", palette: { base: "#12060a", primary: "#ef4444", accent: "#fca5a5" }, camera: { dolly: 0.85, orbit: 0.4, lift: 0.3 }, cinematic: true },
  triumph: { title: "ARRIVAL", palette: { base: "#0a0f1e", primary: "#f97316", accent: "#fdba74" }, camera: { dolly: 0.4, orbit: 0.6, lift: 0.6 }, cinematic: true },
  reflection: { title: "AFTERMATH", palette: { base: "#0b0b10", primary: "#a855f7", accent: "#d8b4fe" }, camera: { dolly: -0.4, orbit: -0.3, lift: 0.1 }, cinematic: false },
  outro: { title: "CODA", palette: { base: "#050505", primary: "#6b7280", accent: "#d1d5db" }, camera: { dolly: -0.6, orbit: 0.1, lift: -0.2 }, cinematic: false },
};

const KEYWORDS: Array<{ motif: StoryMotif; words: string[] }> = [
  { motif: "triumph", words: ["worth it", "finally works", "crown", "rise", "arrived", "triumph", "victory", "worth"] },
  { motif: "payoff", words: ["watch it grow", "it runs", "it holds", "click", "works right", "come alive", "glow", "ignite"] },
  { motif: "assembly", words: ["build", "rebuild", "piece by piece", "fix", "machine", "thread", "evidence", "break it down", "start again"] },
  { motif: "struggle", words: ["doubt", "fail", "broke", "stuck", "half-built", "gives out", "mess", "stubborn", "quietly"] },
  { motif: "solitude", words: ["alone", "night", "sleep", "quiet hour", "nobody", "2 in the morning", "late night", "home"] },
  { motif: "build", words: ["again", "higher", "climb", "more", "till it's clean", "then i know"] },
  { motif: "reflection", words: ["remember", "used to", "cost", "year", "maybe", "meant"] },
];

/** Setup → confrontation → resolution: which motifs a generic section may take by track position. */
function allowedByPosition(position01: number): StoryMotif[] {
  if (position01 < 0.33) return ["solitude", "struggle", "assembly"];
  if (position01 < 0.66) return ["struggle", "assembly", "build"];
  return ["build", "payoff", "triumph"];
}

/** Intensification when a section repeats back-to-back (verse → verse). */
const ESCALATION: Partial<Record<StoryMotif, StoryMotif>> = {
  solitude: "struggle",
  struggle: "assembly",
  assembly: "build",
  build: "payoff",
  payoff: "triumph",
};

function inferMotif(section: string, lines: LyricLine[], isLast: boolean, position01: number): StoryMotif {
  const s = (section || "").toUpperCase();
  const text = lines.map((l) => l.text.toLowerCase()).join(" \n ");
  const has = (words: string[]) => words.some((w) => text.includes(w));

  if (s.includes("FINAL")) return isLast ? "triumph" : "payoff";
  if (s.includes("DROP")) return "payoff";
  if (s.includes("OUTRO")) return "outro";
  if (s.includes("INTRO")) return has(KEYWORDS[4].words) ? "solitude" : "establishing";
  if (s.includes("BRIDGE")) return "build";
  if (s.includes("CHORUS")) return has(KEYWORDS[0].words) ? "triumph" : "payoff";

  // VERSE and anything else: keyword vote restricted to the narrative arc
  // position, so background refrains can't trigger a premature climax.
  const allowed = allowedByPosition(position01);
  for (const { motif, words } of KEYWORDS) {
    if (allowed.includes(motif) && has(words)) return motif;
  }
  return allowed[Math.min(1, allowed.length - 1)];
}

function meanEnergy(energy: number[] | undefined, start: number, end: number, duration: number): number {
  if (!energy?.length || !(duration > 0)) return 0.5;
  const n = energy.length;
  const i0 = Math.max(0, Math.floor((start / duration) * n));
  const i1 = Math.min(n, Math.ceil((end / duration) * n));
  if (i1 <= i0) return 0.5;
  let sum = 0;
  for (let i = i0; i < i1; i++) sum += energy[i];
  const avg = sum / (i1 - i0);
  return Math.max(0, Math.min(1, avg));
}

function longestLine(lines: LyricLine[]): string {
  let best = "";
  for (const l of lines) {
    const t = (l.text || "").trim();
    if (t.length > best.length && t.length < 90 && !/^\[.*\]$/.test(t)) best = t;
  }
  return best;
}

/**
 * Build a storyboard: one beat per contiguous LRC-section run (authored truth),
 * falling back to CUDA sections, then to a single-arc fallback.
 */
export function buildStoryboard(
  trackName: string,
  lyrics: LyricLine[],
  analysis: AudioAnalysisData | null,
): Storyboard {
  const duration = analysis?.duration_seconds ?? (lyrics.length ? lyrics[lyrics.length - 1].end + 5 : 0);
  const energy = analysis?.energy_curve;

  type Run = { section: string; lines: LyricLine[]; start: number; end: number };
  const runs: Run[] = [];

  if (lyrics.length) {
    let cur: Run | null = null;
    let prevEnd = -Infinity;
    for (const line of lyrics) {
      const sec = (line.section || "VERSE").toUpperCase();
      const gap = line.start - prevEnd;
      // New shot on section change, or on long instrumental gaps inside long
      // runs (a 10 s+ hole is an editorial cut in disguise — e.g. verse 1 →
      // verse 2 across a breakdown, even when the tag repeats).
      const gapSplit = cur !== null && cur.lines.length > 0 && gap > 8 && cur.end - cur.start > 30;
      if (!cur || cur.section !== sec || gapSplit) {
        if (cur) runs.push(cur);
        cur = { section: sec, lines: [], start: line.start, end: line.end };
      }
      cur.lines.push(line);
      cur.end = Math.max(cur.end, line.end);
      prevEnd = line.end;
    }
    if (cur) runs.push(cur);
  } else if (analysis?.sections?.length) {
    for (const s of analysis.sections) {
      runs.push({ section: (s.type || "VERSE").toUpperCase(), lines: [], start: s.start, end: s.end });
    }
  }

  if (!runs.length) return { track: trackName, duration, beats: [] };

  // Extend the last beat to the track end so the outro/coda holds the frame.
  runs[runs.length - 1].end = Math.max(runs[runs.length - 1].end, duration);

  const beats: StoryBeat[] = [];
  let prevMotif: StoryMotif | null = null;
  const rawMoods: number[] = [];
  const pending: Array<Omit<StoryBeat, "mood"> & { rawMood: number }> = [];
  runs.forEach((run, i) => {
    const isLast = i === runs.length - 1;
    const position01 = duration > 0 ? run.start / duration : 0;
    let motif = inferMotif(run.section, run.lines, isLast, position01);
    // Back-to-back repeats of the same motif intensify instead of stalling.
    if (motif === prevMotif) {
      const up = ESCALATION[motif];
      if (up) motif = up;
    }
    prevMotif = motif;
    const meta = MOTIF_META[motif];
    const rawMood = energy?.length
      ? meanEnergy(energy, run.start, run.end, duration || run.end)
      : 0.35 + (0.5 * i) / Math.max(1, runs.length - 1);
    rawMoods.push(rawMood);
    pending.push({
      id: `act-${i + 1}`,
      index: i,
      act: i + 1,
      actTitle: `${ROMAN[Math.min(i, ROMAN.length - 1)]}. ${meta.title}`,
      section: run.section,
      start: run.start,
      end: run.end,
      rawMood,
      palette: meta.palette,
      camera: meta.camera,
      motif,
      hook: longestLine(run.lines),
      lineCount: run.lines.length,
      cinematic: meta.cinematic,
    });
  });

  // Per-track contrast stretch: raw analysis energy is often compressed
  // (this track: 0.15–0.39 across the whole arc), which would leave every act
  // at the same intensity. Normalize beat moods across the track's own range.
  const lo = Math.min(...rawMoods);
  const hi = Math.max(...rawMoods);
  const span = hi - lo;
  for (const p of pending) {
    const mood = span > 1e-3 ? 0.05 + 0.9 * ((p.rawMood - lo) / span) : p.rawMood;
    beats.push({
      id: p.id,
      index: p.index,
      act: p.act,
      actTitle: p.actTitle,
      section: p.section,
      start: p.start,
      end: p.end,
      mood,
      palette: p.palette,
      camera: p.camera,
      motif: p.motif,
      hook: p.hook,
      lineCount: p.lineCount,
      cinematic: p.cinematic,
    });
  }

  return { track: trackName, duration, beats };
}

/** Binary-search lookup of the active beat (O(log n)). Pure — safe per-frame. */
export function getStoryState(board: Storyboard | null, elapsed: number): StoryState {
  const empty: StoryState = { beat: null, index: -1, shotProgress: 0, next: null, timeToNext: 0 };
  if (!board || !board.beats.length) return empty;
  const beats = board.beats;
  if (elapsed < beats[0].start) {
    return { ...empty, next: beats[0], timeToNext: Math.max(0, beats[0].start - elapsed) };
  }
  let lo = 0, hi = beats.length - 1, found = beats.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (elapsed < beats[mid].start) hi = mid - 1;
    else if (mid + 1 < beats.length && elapsed >= beats[mid + 1].start) lo = mid + 1;
    else { found = mid; break; }
  }
  const beat = beats[found];
  const span = beat.end - beat.start;
  const shotProgress = span > 1e-6 ? Math.max(0, Math.min(1, (elapsed - beat.start) / span)) : 0;
  const next = found + 1 < beats.length ? beats[found + 1] : null;
  return { beat, index: found, shotProgress, next, timeToNext: next ? Math.max(0, next.start - elapsed) : Math.max(0, beat.end - elapsed) };
}
