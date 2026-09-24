/** Shared utilities for health feature modules. */

export function getUsageColor(percent: number): string {
  if (percent < 50) return "#22c55e";
  if (percent < 75) return "#f59e0b";
  return "#ef4444";
}

/**
 * Text-safe variant of getUsageColor. The plain colors are used for progress
 * fills (non-text), but when the same hue is used as *text* on the matching
 * dark tinted badge background (e.g. `#ef444420` over the near-black card),
 * red-500 (#ef4444) only reaches ~4.4:1 — just under WCAG AA 4.5:1.
 * Red text is lightened to red-400 (#f87171, ~6:1) to pass AA.
 */
export function getUsageTextColor(percent: number): string {
  if (percent < 50) return "#22c55e";
  if (percent < 75) return "#f59e0b";
  return "#f87171";
}

export function getUsageLabel(percent: number): string {
  if (percent < 50) return "Good";
  if (percent < 75) return "Moderate";
  return "High";
}

/** Extract VRAM info from the raw status response with safe defaults */
export function parseVRAMStatus(
  vramStatus: Record<string, unknown> | null,
): { percent: number; free_mb: number } | null {
  const vram = (vramStatus as unknown as { vram?: { percent?: number; free_mb?: number } })?.vram;
  if (!vram || typeof vram.percent !== "number") return null;
  return { percent: vram.percent, free_mb: vram.free_mb || 0 };
}
