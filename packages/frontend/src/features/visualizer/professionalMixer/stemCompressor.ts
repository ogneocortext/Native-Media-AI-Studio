/**
 * Per-channel dynamics compressor built on native Web Audio API `DynamicsCompressorNode`.
 *
 * Design:
 *   - One compressor per channel strip and per bus.
 *   - Threshold/ratio/attack/release mapped to musical ranges.
 *   - All parameter changes use `setTargetAtTime` to avoid clicks/pops.
 */

export interface CompressorState {
  threshold: number; // dB, -60…0
  ratio: number;      // 1…20
  attack: number;     // ms, 0…100
  release: number;    // ms, 10…1000
}

const DEFAULT_COMPRESSOR: CompressorState = {
  threshold: -24,
  ratio: 4,
  attack: 10,
  release: 120,
};

/**
 * Build a compressor channel strip.
 *
 * Audio graph fragment:
 *   input → compressor → output
 */
export function createCompressor(
  ctx: AudioContext,
  initialState: CompressorState = DEFAULT_COMPRESSOR,
): {
  input: GainNode;
  output: GainNode;
  node: DynamicsCompressorNode;
  setState: (next: Partial<CompressorState>) => void;
  getState: () => CompressorState;
  dispose: () => void;
} {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const node = ctx.createDynamicsCompressor();

  // Bridge the compressor through pass-through gains so we can
  // soft-start parameter changes without zipper noise.
  input.connect(node);
  node.connect(output);

  const state: CompressorState = { ...initialState };

  const applyState = (next: Partial<CompressorState>, immediate = false) => {
    Object.assign(state, next);
    const t = ctx.currentTime;
    const tau = immediate ? 0 : 0.02; // 20 ms soft-knee for control changes

    if (next.threshold !== undefined) {
      node.threshold.setTargetAtTime(state.threshold, t, tau);
    }
    if (next.ratio !== undefined) {
      node.ratio.setTargetAtTime(state.ratio, t, tau);
    }
    if (next.attack !== undefined) {
      // Web Audio uses seconds for attack; convert from ms.
      node.attack.setTargetAtTime(state.attack / 1000, t, tau);
    }
    if (next.release !== undefined) {
      // Web Audio uses seconds for release; convert from ms.
      node.release.setTargetAtTime(state.release / 1000, t, tau);
    }
  };

  applyState(initialState, true);

  return {
    input,
    output,
    node,
    setState: applyState,
    getState: () => ({ ...state }),
    dispose() {
      try { input.disconnect(); } catch { /* ignore */ }
      try { output.disconnect(); } catch { /* ignore */ }
      try { node.disconnect(); } catch { /* ignore */ }
    },
  };
}
