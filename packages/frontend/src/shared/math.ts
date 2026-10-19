/** Clamp to [0, 1]. NaN maps to 0 so a single poisoned frame cannot stick a channel. */
export function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}