/**
 * Pure drum-type classifier for frequency-band energy triples.
 *
 * Used by both the analyzed-grid and fallback beat-detector paths in
 * `audioAnalysis.worker.ts` and `audioHooks.ts`.
 */

export function classifyDrumType(
  bass: number,
  mid: number,
  treble: number,
): "kick" | "snare" | "hat" | null {
  if (bass <= 0.01 && mid <= 0.01 && treble <= 0.01) return null;

  const bassToMid = bass / (mid || 0.001);
  const trebleToMid = treble / (mid || 0.001);

  if (bassToMid > 1.8) return "kick";
  if (trebleToMid > 1.5) return "hat";
  if (mid > bass && mid > treble) return "snare";

  if (bass > mid && bass > treble) return "kick";
  if (treble > mid && treble > bass) return "hat";

  return null;
}
