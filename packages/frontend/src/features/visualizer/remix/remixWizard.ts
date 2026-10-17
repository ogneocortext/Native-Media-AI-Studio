/**
 * The guided wizard: the first mashup as questions in order.
 *
 * Lives apart from `RemixPanel.tsx` for the same reason `remixRecipe.ts` and
 * `abCompare.ts` do — the unit suite excludes React/CSS/asset imports, so the
 * decision logic has to be reachable without mounting the component.
 *
 * The plan parked this ("the panel's presets already lower the floor; a
 * wizard is a bigger design commitment than the evidence demands"), and that
 * reasoning is why this is small: three questions and a summary, no new
 * concepts, and no structure the presets do not already build. What the
 * wizard adds over the presets is order and completeness — the two songs and
 * the length are set once, in the open, instead of being inferred from
 * `tracks[0]` and edited afterwards in per-layer selects.
 *
 * One real trap is handled here rather than left to a warning after the
 * render: tracks in this library open instrumentally (Ad Nauseam's vocals are
 * digital silence for 7.06 s), so a vocals layer at `source_start_bar=0`
 * renders silence that reads as a broken mixer. The wizard offsets the
 * vocals entry to the first audible 4-bar boundary instead.
 */
import { newEditableLayer, type EditableLayer, type EditableSlot } from "./remixRecipe";

/** The three structures the wizard builds, in the panel's own vocabulary. */
export type WizardGoal = "swap" | "blend" | "intro";

/** Slot lengths the wizard offers, in bars. */
export const WIZARD_BAR_CHOICES = [4, 8] as const;
/** How many slots: a short pass or a longer one. */
export const WIZARD_SLOT_CHOICES = [2, 4] as const;

/** Everything the builder needs, as plain data — no fetches, no React. */
export interface WizardInput {
  songA: string;
  songB: string | null;
  goal: WizardGoal;
  barsPerSlot: number;
  slotCount: number;
  bpm: number;
  /** The stems each song actually has, already filtered by the caller. */
  stemsA: EditableLayer["stem"][];
  stemsB: EditableLayer["stem"][];
  /** Seconds until song B's first audible content, or null when unprobed. */
  firstAudibleB: number | null;
}

/**
 * Bars to offset a vocals layer so it does not open on digital silence.
 *
 * Rounded up to the next 4-bar boundary, which is both the guidance the
 * prompt path already gives ("start_bar=4, 8, 12...") and a whole number of
 * phrases — a vocal entering mid-bar sounds like an edit, not an
 * arrangement. Returns 0 whenever the source is audible inside the first
 * bar, so a track with no silent intro is left exactly where it was.
 */
export function safeVocalsStartBar(firstAudibleSec: number | null, barSeconds: number): number {
  if (firstAudibleSec === null || !(firstAudibleSec > 0) || firstAudibleSec <= barSeconds) {
    return 0;
  }
  return Math.ceil(firstAudibleSec / (4 * barSeconds)) * 4;
}

/** Seconds of audio the wizard's arrangement will render. */
export function wizardDurationSec(input: WizardInput): number {
  const totalBars = input.slotCount * input.barsPerSlot;
  return (totalBars * 4 * 60) / Math.max(input.bpm, 1);
}

function vocalsLayer(input: WizardInput): EditableLayer | null {
  if (!input.songB || !input.stemsB.includes("vocals")) return null;
  const layer = newEditableLayer(input.songB, "vocals");
  // Skip the intro: this library's tracks open instrumentally, and a vocal
  // entry on silence reads as a broken mixer rather than an arrangement.
  layer.source_start_bar = safeVocalsStartBar(
    input.firstAudibleB,
    (4 * 60) / Math.max(input.bpm, 1),
  );
  return layer;
}

function instrumentLayer(track: string, stems: EditableLayer["stem"][], stem: EditableLayer["stem"]) {
  return stems.includes(stem) ? newEditableLayer(track, stem) : null;
}

/**
 * Build the wizard's arrangement as editable slots, ready for the form.
 *
 * The structures are the presets', deliberately: "swap" is drums and bass
 * under vocals from another song, "blend" is two songs in one slot, "intro"
 * opens instrumental before the vocals arrive. A missing stem is omitted
 * rather than sent to a render that would reject it — the caller disables
 * goals it cannot satisfy, and this is the belt to that braces.
 */
export function buildWizardSlots(input: WizardInput): EditableSlot[] {
  const slots: EditableSlot[] = [];
  const bars = input.barsPerSlot;
  const crossfade = 2;
  const vocals = vocalsLayer(input);
  const backing = (["drums", "bass"] as const)
    .map((stem) => instrumentLayer(input.songA, input.stemsA, stem))
    .filter((layer): layer is EditableLayer => layer !== null);

  for (let index = 0; index < input.slotCount; index += 1) {
    if (input.goal === "blend") {
      const layers = input.stemsA.map((stem) => newEditableLayer(input.songA, stem));
      for (const stem of input.stemsB) {
        if (stem === "vocals") continue;
        layers.push(newEditableLayer(input.songB as string, stem));
      }
      slots.push({ bars, crossfade_bars: crossfade, layers });
      continue;
    }
    if (input.goal === "intro") {
      // The first slot opens without vocals, whatever the length.
      const instrumental = index === 0;
      const layers = instrumental
        ? input.stemsA.filter((stem) => stem !== "vocals").map((stem) => newEditableLayer(input.songA, stem))
        : [...input.stemsA.map((stem) => newEditableLayer(input.songA, stem))];
      if (!instrumental && vocals) layers.push(vocals);
      slots.push({ bars, crossfade_bars: crossfade, layers });
      continue;
    }
    // swap: backing throughout, vocals arriving from slot 2.
    const layers = [...backing];
    if (index > 0 && vocals) layers.push(vocals);
    slots.push({ bars, crossfade_bars: crossfade, layers });
  }
  return slots.filter((slot) => slot.layers.length > 0);
}

/** A name for the wizard's arrangement, one step ahead of what exists. */
export function wizardName(songA: string, songB: string | null): string {
  const short = (track: string) => track.split(/[-_]/).filter(Boolean).slice(-2).join("-");
  return songB ? `mashup-${short(songA)}-${short(songB)}`.toLowerCase() : `mashup-${short(songA)}`.toLowerCase();
}

/** The summary the wizard shows before applying, as plain lines. */
export function wizardSummary(input: WizardInput): { label: string; value: string }[] {
  const goalText: Record<WizardGoal, string> = {
    swap: "Drums and bass under vocals from the other song",
    blend: "Both songs in one slot, B without its vocals",
    intro: "An instrumental opening, then the vocals arrive",
  };
  return [
    { label: "Song A", value: input.songA },
    { label: "Song B", value: input.songB ?? "(none)" },
    { label: "Shape", value: goalText[input.goal] },
    { label: "Length", value: `${input.slotCount} x ${input.barsPerSlot} bars` },
    { label: "Runs for", value: `${wizardDurationSec(input).toFixed(1)} s at ${input.bpm} BPM` },
  ];
}
