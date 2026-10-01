/**
 * Per-track parametric EQ built on native Web Audio API `BiquadFilterNode`.
 *
 * AI-agent contract:
 *  - `createEQ(ctx, bands)` → `{ input, output, filters, setBands, applyPreset, dispose }`
 *  - `input` connects to the audio source; `output` connects to the analyser/gain chain
 *  - `setBands(bands)` and `applyPreset(name)` are safe to call from any agent/tool
 *  - Band config is plain JSON: `{ id, type, frequency, Q, gain }`
 *
 * Reference:
 *  - MDN BiquadFilterNode: https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode
 *  - Tone.js EQ3: https://tonejs.github.io/docs/14.7.39/EQ3
 */

export type EQBandType = "lowshelf" | "highshelf" | "peaking";

export interface EQBand {
  /** Stable id for React keys / agent patches. */
  id: string;
  /** Filter type. */
  type: EQBandType;
  /** Center / cutoff frequency in Hz. */
  frequency: number;
  /** Q factor. Ignored for shelf types, meaningful for peaking. */
  Q: number;
  /** Boost / cut in dB. */
  gain: number;
}

export interface EQInstance {
  /** Connect your source here. */
  input: GainNode;
  /** Connect this to the analyser or next effect. */
  output: GainNode;
  /** Ordered filter nodes. */
  filters: BiquadFilterNode[];
  /** Replace the active band set atomically. */
  setBands(bands: EQBand[]): void;
  /** Apply a named preset. */
  applyPreset(name: string): void;
  /** Release nodes from the graph. */
  dispose(): void;
}

export interface EQPresets {
  [name: string]: EQBand[];
}

/** Studio-friendly starting points. */
export const DEFAULT_EQ_PRESETS: EQPresets = {
  flat: [],

  warm: [
    { id: "low", type: "lowshelf", frequency: 80, Q: 0.7, gain: 3 },
    { id: "lowMid", type: "peaking", frequency: 250, Q: 0.8, gain: 2 },
    { id: "high", type: "highshelf", frequency: 12000, Q: 0.7, gain: -2 },
  ],

  bright: [
    { id: "low", type: "lowshelf", frequency: 80, Q: 0.7, gain: -2 },
    { id: "highMid", type: "peaking", frequency: 4000, Q: 1.0, gain: 3 },
    { id: "high", type: "highshelf", frequency: 12000, Q: 0.7, gain: 4 },
  ],

  vocalPresence: [
    { id: "low", type: "lowshelf", frequency: 100, Q: 0.7, gain: -3 },
    { id: "lowMid", type: "peaking", frequency: 250, Q: 1.2, gain: -2 },
    { id: "presence", type: "peaking", frequency: 3000, Q: 1.4, gain: 4 },
    { id: "air", type: "highshelf", frequency: 10000, Q: 0.7, gain: 2 },
  ],

  bassBoost: [
    { id: "sub", type: "lowshelf", frequency: 60, Q: 0.7, gain: 6 },
    { id: "low", type: "peaking", frequency: 120, Q: 0.9, gain: 4 },
    { id: "high", type: "highshelf", frequency: 10000, Q: 0.7, gain: -3 },
  ],

  aiStudio: [
    { id: "sub", type: "lowshelf", frequency: 60, Q: 0.7, gain: 2 },
    { id: "low", type: "peaking", frequency: 100, Q: 0.8, gain: 1 },
    { id: "lowMid", type: "peaking", frequency: 250, Q: 1.0, gain: -1 },
    { id: "presence", type: "peaking", frequency: 3000, Q: 1.2, gain: 2 },
    { id: "air", type: "highshelf", frequency: 10000, Q: 0.7, gain: 1.5 },
  ],
};

/** Safe dB range for UI controls. */
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
export const EQ_DEFAULT_FREQUENCIES = [80, 250, 1000, 4000, 12000] as const;
export type EQFrequency = (typeof EQ_DEFAULT_FREQUENCIES)[number];

/** Clamp a band gain into safe hearing / DSP range. */
export function clampGain(gain: number): number {
  return Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Number.isFinite(gain) ? gain : 0));
}

/** Create a per-track EQ chain.
 *
 *  Audio graph:
 *    input → filter1 → filter2 → … → output
 *
 *  Caller wiring:
 *    source.connect(eq.input)
 *    eq.output.connect(analyser)
 */
export function createEQ(ctx: AudioContext, bands: EQBand[] = []): EQInstance {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const filters: BiquadFilterNode[] = [];

  const syncFilters = (next: EQBand[]) => {
    // Remove excess filters
    while (filters.length > next.length) {
      const f = filters.pop()!;
      try {
        f.disconnect();
      } catch {
        // already disconnected
      }
    }

    // Reuse existing + add new
    for (let i = 0; i < next.length; i++) {
      const b = next[i];
      let filter = filters[i];
      if (!filter) {
        filter = new BiquadFilterNode(ctx, {
          type: b.type,
          frequency: b.frequency,
          Q: b.Q,
          gain: b.gain,
        });
        filters.push(filter);
      } else {
        filter.type = b.type;
        filter.frequency.value = b.frequency;
        filter.Q.value = b.Q;
        filter.gain.value = b.gain;
      }
    }

    // Rewire: input → filters… → output
    try {
      input.disconnect();
    } catch {
      // already disconnected
    }
    let prev = input;
    for (const f of filters) {
      prev.connect(f);
      prev = f;
    }
    prev.connect(output);
  };

  const setBands = (next: EQBand[]) => {
    syncFilters(
      next.map((b) => ({
        ...b,
        frequency: Number.isFinite(b.frequency) ? b.frequency : 1000,
        Q: Number.isFinite(b.Q) ? Math.max(0.0001, b.Q) : 1,
        gain: clampGain(b.gain),
      })),
    );
  };

  const applyPreset = (name: string) => {
    const preset = DEFAULT_EQ_PRESETS[name];
    if (!preset) return;
    setBands(
      preset.map((b) => ({
        ...b,
        frequency: Number.isFinite(b.frequency) ? b.frequency : 1000,
        Q: Number.isFinite(b.Q) ? Math.max(0.0001, b.Q) : 1,
        gain: clampGain(b.gain),
      })),
    );
  };

    const dispose = () => {
      try {
        input.disconnect();
      } catch {
        // ignore
      }
      try {
        output.disconnect();
      } catch {
        // ignore
      }
      for (const f of filters) {
        try {
          f.disconnect();
        } catch {
          // ignore
        }
      }
      filters.length = 0;
    };

  // Initialize with requested bands
  setBands(bands);

  return { input, output, filters, setBands, applyPreset, dispose };
}
