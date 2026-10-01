/**
 * Professional mixing system types.
 *
 * Signal flow (per stem):
 *   source → inputGain → EQ → compressor → fader → pan → [dry → bus gain] + [sends → FX returns] → bus → master → destination
 *
 * Buses:
 *   vocals  - vocal-focused bus
 *   drums   - rhythm bus (drums + percussion)
 *   bass    - low-frequency bus
 *   other   - harmonic/ambient bus (guitars, synths, pads)
 *   master  - final output bus
 */

import type { EQBand } from "../audioEQ";
import type { StemName } from "../components/StemMixer";
export type { StemName };
import type { CompressorState } from "./stemCompressor";

export const STEM_NAMES: StemName[] = ["vocals", "drums", "bass", "other"];

/** Named buses in the mixer. */
export type BusName = "vocals" | "drums" | "bass" | "other" | "master";

/** Routing map: which bus each stem feeds. */
export interface StemRouting {
  [stem: string]: BusName;
}

/** Default routing: each stem → its namesake bus. */
export const DEFAULT_STEM_ROUTING: StemRouting = {
  vocals: "vocals",
  drums: "drums",
  bass: "bass",
  other: "other",
};

// ─── Channel strip state ────────────────────────────────────────────────────

export interface ChannelStripState {
  /** Fader level 0–1 (linear; UI renders as dB). */
  volume: number;
  /** Stereo pan: -1 = hard left, 1 = hard right, 0 = center. */
  pan: number;
  /** Mute flag. */
  muted: boolean;
  /** Solo flag (solo logic lives in the hook). */
  solo: boolean;
  /** Per-channel EQ bands. */
  eqBands: EQBand[];
  /** Compressor threshold in dB (-60…0). */
  compressorThreshold: number;
  /** Compressor ratio (1…20). */
  compressorRatio: number;
  /** Compressor attack in ms (0…100). */
  compressorAttack: number;
  /** Compressor release in ms (10…1000). */
  compressorRelease: number;
  /** Send level to reverb bus (0–1). */
  reverbSend: number;
  /** Send level to delay bus (0–1). */
  delaySend: number;
}

export const DEFAULT_STRIP_STATE: ChannelStripState = {
  volume: 0.85,
  pan: 0,
  muted: false,
  solo: false,
  eqBands: [],
  compressorThreshold: -24,
  compressorRatio: 4,
  compressorAttack: 10,
  compressorRelease: 120,
  reverbSend: 0,
  delaySend: 0,
};

// ─── Bus channel state ──────────────────────────────────────────────────────

export interface BusChannelState {
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  eqBands: EQBand[];
  compressorThreshold: number;
  compressorRatio: number;
  compressorAttack: number;
  compressorRelease: number;
}

export const DEFAULT_BUS_STATE: Record<BusName, BusChannelState> = {
  vocals: { volume: 0.9, pan: 0, muted: false, solo: false, eqBands: [], compressorThreshold: -18, compressorRatio: 3, compressorAttack: 15, compressorRelease: 150 },
  drums: { volume: 0.85, pan: 0, muted: false, solo: false, eqBands: [], compressorThreshold: -16, compressorRatio: 6, compressorAttack: 2, compressorRelease: 80 },
  bass: { volume: 0.9, pan: 0, muted: false, solo: false, eqBands: [], compressorThreshold: -14, compressorRatio: 4, compressorAttack: 15, compressorRelease: 150 },
  other: { volume: 0.75, pan: 0, muted: false, solo: false, eqBands: [], compressorThreshold: -18, compressorRatio: 3, compressorAttack: 15, compressorRelease: 150 },
  master: { volume: 0.85, pan: 0, muted: false, solo: false, eqBands: [], compressorThreshold: -6, compressorRatio: 2, compressorAttack: 5, compressorRelease: 120 },
};

// ─── Meter readings ─────────────────────────────────────────────────────────

export interface ChannelMeters {
  /** Linear RMS level 0–1. */
  rms: number;
  /** Peak hold level 0–1. */
  peak: number;
  /** True-peak in dBFS. */
  dBFS: number;
}

// ─── Compressor preset ──────────────────────────────────────────────────────

export interface CompressorPreset {
  label: string;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
}

export const COMPRESSOR_PRESETS: Record<string, CompressorPreset> = {
  gentle: { label: "Gentle", threshold: -18, ratio: 2, attack: 20, release: 200 },
  vocal: { label: "Vocal", threshold: -20, ratio: 3, attack: 8, release: 100 },
  drum: { label: "Drum", threshold: -16, ratio: 6, attack: 2, release: 80 },
  bass: { label: "Bass", threshold: -14, ratio: 4, attack: 15, release: 150 },
  master: { label: "Master Bus", threshold: -6, ratio: 3, attack: 5, release: 120 },
  limiter: { label: "Limiter", threshold: -1, ratio: 20, attack: 0.5, release: 50 },
};

// ─── FX send returns ────────────────────────────────────────────────────────

export interface FxReturns {
  reverb: GainNode;
  delay: GainNode;
}

// ─── Master section state ───────────────────────────────────────────────────

export interface MasterSectionState {
  volume: number;
  eqBands: EQBand[];
  compressorThreshold: number;
  compressorRatio: number;
  compressorAttack: number;
  compressorRelease: number;
}

export const DEFAULT_MASTER_STATE: MasterSectionState = {
  volume: 0.85,
  eqBands: [],
  compressorThreshold: -6,
  compressorRatio: 2,
  compressorAttack: 5,
  compressorRelease: 120,
};

// ─── Mixer snapshot (persistable) ───────────────────────────────────────────

export interface MixerSnapshot {
  stemRouting: StemRouting;
  strips: Record<StemName, ChannelStripState>;
  buses: Record<BusName, BusChannelState>;
  master: MasterSectionState;
}

export const DEFAULT_MIXER_SNAPSHOT: MixerSnapshot = {
  stemRouting: { ...DEFAULT_STEM_ROUTING },
  strips: {
    vocals: { ...DEFAULT_STRIP_STATE, reverbSend: 0.18, delaySend: 0.08 },
    drums: { ...DEFAULT_STRIP_STATE, reverbSend: 0.1, delaySend: 0.12 },
    bass: { ...DEFAULT_STRIP_STATE, reverbSend: 0.06 },
    other: { ...DEFAULT_STRIP_STATE, reverbSend: 0.22, delaySend: 0.15 },
  },
  buses: { ...DEFAULT_BUS_STATE },
  master: { ...DEFAULT_MASTER_STATE },
};

// ─── Hook return type ───────────────────────────────────────────────────────

export interface StemChannel {
  name: StemName;
  source: MediaElementAudioSourceNode | null;
  input: GainNode | null;
  eq: { input: GainNode; output: GainNode; filters: BiquadFilterNode[]; setBands: (b: EQBand[]) => void; dispose: () => void } | null;
  compressor: DynamicsCompressorNode | null;
  fader: GainNode | null;
  pan: StereoPannerNode | null;
  meters: ChannelMeters;
  analyser: AnalyserNode | null;
  element: HTMLAudioElement | null;
}

export interface BusChannel {
  name: BusName;
  input: GainNode | null;
  eq: { input: GainNode; output: GainNode; filters: BiquadFilterNode[]; setBands: (b: EQBand[]) => void; dispose: () => void } | null;
  compressor: DynamicsCompressorNode | null;
  fader: GainNode | null;
  pan: StereoPannerNode | null;
  meters: ChannelMeters;
  analyser: AnalyserNode | null;
}

export interface ProfessionalMixerState {
  strips: Record<StemName, ChannelStripState>;
  buses: Record<BusName, BusChannelState>;
  master: MasterSectionState;
  routing: StemRouting;
  meters: Record<StemName, ChannelMeters> & Record<string, ChannelMeters>;
  /** Current solo count (if > 0, only soloed channels pass). */
  soloCount: number;
}

export interface ProfessionalMixerActions {
  setStripVolume: (name: StemName, v: number) => void;
  setStripPan: (name: StemName, p: number) => void;
  toggleStripMute: (name: StemName) => void;
  toggleStripSolo: (name: StemName) => void;
  setStripEQ: (name: StemName, bands: EQBand[]) => void;
  setStripCompressor: (name: StemName, params: Partial<CompressorState>) => void;
  setStripSend: (name: StemName, send: "reverbSend" | "delaySend", v: number) => void;
  setRouting: (stem: StemName, bus: BusName) => void;
  setBusVolume: (name: BusName, v: number) => void;
  setBusPan: (name: BusName, p: number) => void;
  toggleBusMute: (name: BusName) => void;
  toggleBusSolo: (name: BusName) => void;
  setBusEQ: (name: BusName, bands: EQBand[]) => void;
  setBusCompressor: (name: BusName, params: Partial<CompressorState>) => void;
  setMasterVolume: (v: number) => void;
  setMasterEQ: (bands: EQBand[]) => void;
  setMasterCompressor: (params: Partial<CompressorState>) => void;
  resetToDefaults: () => void;
  /** Rebuild the audio graph when stems reload (new track). */
  rebuild: () => void;
}

export type ProfessionalMixerReturn = ProfessionalMixerState & ProfessionalMixerActions;
