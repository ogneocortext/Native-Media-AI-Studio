/**
 * Stem bus definitions and routing helpers.
 *
 * A bus is a submix: multiple stems feed one bus channel, which then feeds
 * the master bus. This lets the user treat, e.g., drums+other as a "rhythm"
 * section with one fader, while keeping the stems individually routable.
 */

import type { StemName } from "./types";

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

/** Every stem that can be individually routed. */
export const ROUTABLE_STEMS: StemName[] = ["vocals", "drums", "bass", "other"];

/** Preset routings the user can pick from. */
export const ROUTING_PRESETS: Record<string, StemRouting> = {
  standard: {
    vocals: "vocals",
    drums: "drums",
    bass: "bass",
    other: "other",
  } as StemRouting,
  rhythmSection: {
    vocals: "vocals",
    drums: "drums",
    bass: "bass",
    other: "drums", // other → drums bus so percussion+FX share a fader
  } as StemRouting,
  threeWay: {
    vocals: "vocals",
    drums: "drums",
    bass: "bass",
    other: "bass", // other → bass bus for low-end weight
  } as StemRouting,
  everythingVocals: {
    vocals: "vocals",
    drums: "vocals",
    bass: "vocals",
    other: "vocals",
  } as StemRouting,
  everythingDrums: {
    vocals: "drums",
    drums: "drums",
    bass: "drums",
    other: "drums",
  } as StemRouting,
};

/** Bus display labels for the UI. */
export const BUS_LABELS: Record<BusName, string> = {
  vocals: "Vocals",
  drums: "Drums / Rhythm",
  bass: "Bass",
  other: "Harmony / FX",
  master: "Master",
};

/** Bus color accents for the mixer UI. */
export const BUS_COLORS: Record<BusName, string> = {
  vocals: "#8b5cf6", // violet
  drums: "#f59e0b",  // amber
  bass: "#3b82f6",   // blue
  other: "#10b981",  // emerald
  master: "#ef4444", // red
};

/** All buses including master. */
export const ALL_BUSES: BusName[] = ["vocals", "drums", "bass", "other", "master"];

/** Returns a human-readable routing description. */
export function describeRouting(routing: StemRouting): string {
  return ROUTABLE_STEMS.map((s) => `${s} → ${routing[s]}`).join("  |  ");
}

/** Returns true if all stems route to their default namesake bus. */
export function isDefaultRouting(routing: StemRouting): boolean {
  return ROUTABLE_STEMS.every((s) => routing[s] === s);
}
