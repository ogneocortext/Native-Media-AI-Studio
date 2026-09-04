/** Shared utilities for health feature modules. */

export function getUsageColor(percent: number): string {
  if (percent < 50) return "#22c55e";
  if (percent < 75) return "#f59e0b";
  return "#ef4444";
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
