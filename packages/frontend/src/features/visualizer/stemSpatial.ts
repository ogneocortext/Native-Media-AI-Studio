/**
 * Per-stem spatial processing: stereo positioning, Haas widening, and reverb depth.
 *
 * Audio graph per stem:
 *   source → eq → spatial.input → [dry + delay + convolver] → spatial.output → gain → analyser → destination
 *
 * Design goals (2026 Fall best practices):
 *   - Vocals stay focused center but get subtle Haas + light reverb for presence.
 *   - Drums widen with a short delay so they feel wider than the master stereo field.
 *   - Bass stays dead-center mono (no Haas) with just enough reverb to feel deep.
 *   - "Other" gets the widest treatment: heavier Haas + longer reverb + gentle LPF to sit back.
 */

import type { StemName } from "./components/StemMixer";

export interface StemSpatialProcessor {
  /** Connect your post-EQ signal here. */
  input: GainNode;
  /** Connect this to the per-stem gain → analyser chain. */
  output: GainNode;
  /** Release every created node from the graph. */
  dispose(): void;
}

/** Haas / stereo-widen settings per stem. */
const SPATIAL_SETTINGS: Record<
  StemName,
  {
    /** Stereo position: -1 = hard left, 1 = hard right, 0 = center. */
    pan: number;
    /** Haas delay time in seconds (0 = disabled — used for bass). */
    delayTime: number;
    /** Wet level for the Haas path (0–1). */
    delayWet: number;
    /** Reverb impulse-response duration in seconds. */
    reverbDuration: number;
    /** Reverb IR decay curvature (higher = faster decay). */
    reverbDecay: number;
    /** Wet level for the reverb return (0–1). */
    reverbWet: number;
    /** Low-pass cutoff for depth (Hz). 0 = disabled. */
    lowpassHz: number;
  }
> = {
  vocals: {
    pan: 0,
    delayTime: 0.012,
    delayWet: 0.35,
    reverbDuration: 1.2,
    reverbDecay: 0.35,
    reverbWet: 0.18,
    lowpassHz: 0,
  },
  drums: {
    pan: -0.2,
    delayTime: 0.018,
    delayWet: 0.3,
    reverbDuration: 0.7,
    reverbDecay: 0.25,
    reverbWet: 0.12,
    lowpassHz: 0,
  },
  bass: {
    pan: 0,
    delayTime: 0,
    delayWet: 0,
    reverbDuration: 0.5,
    reverbDecay: 0.2,
    reverbWet: 0.1,
    lowpassHz: 0,
  },
  other: {
    pan: 0.25,
    delayTime: 0.022,
    delayWet: 0.4,
    reverbDuration: 1.8,
    reverbDecay: 0.4,
    reverbWet: 0.25,
    lowpassHz: 8000,
  },
};

/** Generate a stereo impulse-response buffer in-memory. */
function generateImpulseResponse(
  ctx: AudioContext,
  duration: number,
  decay: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const buffer = ctx.createBuffer(2, length, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    // Slightly different decay timing per channel avoids metallic correlation.
    const channelDecay = decay * (channel === 0 ? 1.0 : 0.92);
    for (let i = 0; i < length; i++) {
      data[i] =
        (Math.random() * 2 - 1) *
        Math.pow(1 - i / length, channelDecay * 10);
    }
  }

  return buffer;
}

/** Build a per-stem spatial processor. */
export function createStemSpatialProcessor(
  ctx: AudioContext,
  stemName: StemName,
): StemSpatialProcessor {
  const settings = SPATIAL_SETTINGS[stemName];

  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  dry.gain.value = 0.82;

  const panner = ctx.createStereoPanner();
  panner.pan.value = settings.pan;

  // Haas path — short delay + reduced level feeds the panner for width.
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = settings.delayTime;
  const delayGain = ctx.createGain();
  delayGain.gain.value = settings.delayWet;

  // Reverb path — convolver → return gain → output.
  const convolver = ctx.createConvolver();
  convolver.buffer = generateImpulseResponse(
    ctx,
    settings.reverbDuration,
    settings.reverbDecay,
  );
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = settings.reverbWet;

  // Optional low-pass to push a stem "back" in the mix.
  const lowpass = settings.lowpassHz > 0 ? ctx.createBiquadFilter() : null;
  if (lowpass) {
    lowpass.type = "lowpass";
    lowpass.frequency.value = settings.lowpassHz;
    lowpass.Q.value = 0.7;
  }

  // ---- Routing ----
  // Dry path
  input.connect(dry);
  dry.connect(panner);

  // Haas path (only if delayTime > 0)
  if (settings.delayTime > 0) {
    input.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(panner);
  }

  // Panner → reverb → output
  panner.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);

  // Panner → (optional lowpass) → output
  panner.connect(lowpass ?? output);
  if (lowpass) {
    lowpass.connect(output);
  }

  return {
    input,
    output,
    dispose() {
      const nodes = [input, output, dry, panner, delay, delayGain, convolver, reverbGain, lowpass];
      for (const node of nodes) {
        if (!node) continue;
        try {
          node.disconnect();
        } catch {
          // already disconnected
        }
      }
    },
  };
}
