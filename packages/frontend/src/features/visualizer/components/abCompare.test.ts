import { describe, expect, it } from "vitest";
import {
  abInitial,
  abMatches,
  abPin,
  abShowing,
  type AbVariant,
} from "./abCompare";
import type { EditableSlot } from "../remix/remixRecipe";

function variant(overrides: Partial<AbVariant> = {}): AbVariant {
  const slots: EditableSlot[] = [
    {
      bars: 4,
      crossfade_bars: 0,
      layers: [
        {
          __id: "l1",
          track: "SunoV6Mini-Ad-Nauseam",
          stem: "drums",
          gain_db: 0,
          key_shift_semitones: 0,
          source_start_bar: 0,
          lowpass_hz: null,
        },
      ],
    },
  ];
  return { name: "mashup-1", bpm: 140, slots, ...overrides };
}

describe("abCompare pins", () => {
  it("starts with nothing pinned", () => {
    expect(abInitial()).toEqual({ a: null, b: null });
  });

  it("pins without disturbing the other pin", () => {
    const first = abPin(abInitial(), "a", variant());
    const second = abPin(first, "b", variant({ name: "mashup-2" }));

    expect(second.a?.name).toBe("mashup-1");
    expect(second.b?.name).toBe("mashup-2");
  });

  it("overwrites its own pin on a re-pin", () => {
    // The loop is "pin, iterate, pin the other, flip" - a pin that cannot be
    // overwritten would force a third slot nobody asked for.
    const once = abPin(abInitial(), "a", variant({ name: "first" }));
    const twice = abPin(once, "a", variant({ name: "second" }));

    expect(twice.a?.name).toBe("second");
  });

  it("keeps a pin as a snapshot: pinning does not alias the form", () => {
    const live = variant();
    const pinned = abPin(abInitial(), "a", live);
    live.slots[0].bars = 16; // the form moves on after pinning

    expect(pinned.a?.slots[0].bars).toBe(4);
  });
});

describe("abCompare matching", () => {
  it("matches an identical form", () => {
    const current = variant();
    expect(abMatches(abPin(abInitial(), "a", current).a, current)).toBe(true);
  });

  it("does not match after any edit", () => {
    const pin = variant();
    const edited = variant({ slots: [{ ...pin.slots[0], bars: 8 }] });
    expect(abMatches(pin, edited)).toBe(false);
    expect(abMatches(pin, variant({ name: "other" }))).toBe(false);
    expect(abMatches(pin, variant({ bpm: 150 }))).toBe(false);
  });

  it("reports which pin the form is, and neither when it is both-new", () => {
    const a = abPin(abInitial(), "a", variant());
    const both = abPin(a, "b", variant({ name: "mashup-2" }));

    expect(abShowing(both, variant())).toBe("a");
    expect(abShowing(both, variant({ name: "mashup-2" }))).toBe("b");
    expect(abShowing(both, variant({ name: "mashup-3" }))).toBeNull();
  });
});
