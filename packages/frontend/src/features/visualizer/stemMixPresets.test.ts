import { describe, it, expect } from "vitest";
import {
  FADER_MAX_DB,
  FADER_MIN_DB,
  MIN_DB_EPSILON,
  MIX_PRESETS,
  DEFAULT_STEM_GAINS_DB,
  NEUTRAL_STEM_GAINS_DB,
  STEM_NAMES,
  dbFromFraction,
  dbToGain,
  formatDb,
  fractionFromDb,
  gainToDb,
  snapDb,
} from "./stemMixPresets";

describe("stemMixPresets", () => {
  describe("dbToGain", () => {
    it("maps 0 dB to unity", () => {
      expect(dbToGain(0)).toBeCloseTo(1, 10);
    });

    it("uses amplitude, not power (the 20 vs 10 trap)", () => {
      // 10^(20/20) = 10, NOT 10^(20/10) = 100. Using /10 would double every
      // fader position's amplitude and is the classic way this goes unnoticed.
      //
      // These use exact equality, not toBeCloseTo. With a 6-decimal tolerance the
      // mutant (db/10) still passes, because 100 and 10 both "round" to the same
      // value at the wrong precision - verified by mutating the source and
      // watching this test stay green.
      expect(dbToGain(20)).toBe(10);
      expect(dbToGain(-20)).toBe(0.1);
      expect(dbToGain(6)).toBeCloseTo(1.9952623149688795, 12);
      expect(dbToGain(-24)).toBeCloseTo(0.06309573444801933, 12);
    });

    it("maps -inf to true silence, not NaN", () => {
      expect(dbToGain(-Infinity)).toBe(0);
    });

    it("floors very negative values to silence", () => {
      expect(dbToGain(-80)).toBe(0);
      expect(dbToGain(MIN_DB_EPSILON - 1)).toBe(0);
    });

    it("passes non-finite (NaN) through as unity rather than propagating", () => {
      expect(dbToGain(NaN)).toBe(1);
    });

    it("is monotonic increasing", () => {
      const samples = [-24, -12, -6, 0, 3, 6].map(dbToGain);
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThan(samples[i - 1]);
      }
    });
  });

  describe("gainToDb", () => {
    it("round-trips through dbToGain", () => {
      for (const db of [-24, -12, -1.5, 0, 3.5, 6]) {
        expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 6);
      }
    });

    it("maps silence to the epsilon floor, not -Infinity", () => {
      // Must stay slider-compatible: a raw -Infinity breaks range inputs.
      expect(gainToDb(0)).toBe(MIN_DB_EPSILON);
    });
  });

  describe("snapDb", () => {
    it("snaps to unity within the snap window", () => {
      expect(snapDb(0.3)).toBe(0);
      expect(snapDb(-0.4)).toBe(0);
    });

    it("does not snap outside the window", () => {
      expect(snapDb(1.5)).toBeCloseTo(1.5, 6);
      expect(snapDb(-2)).toBeCloseTo(-2, 6);
    });

    it("leaves exactly-on-boundary values alone", () => {
      expect(snapDb(0.5)).toBeCloseTo(0.5, 6);
      expect(snapDb(-0.5)).toBeCloseTo(-0.5, 6);
    });

    it("clamps beyond the fader range", () => {
      expect(snapDb(100)).toBe(FADER_MAX_DB);
      expect(snapDb(-100)).toBe(FADER_MIN_DB);
    });

    it("preserves -Infinity so karaoke vocals survive", () => {
      expect(snapDb(-Infinity)).toBe(-Infinity);
    });

    it("leaves NaN alone rather than clamping it to a real number", () => {
      expect(Number.isNaN(snapDb(NaN))).toBe(true);
    });
  });

  describe("fader position mapping", () => {
    it("maps fraction endpoints to the dB range", () => {
      expect(dbFromFraction(0)).toBe(FADER_MIN_DB);
      expect(dbFromFraction(1)).toBe(FADER_MAX_DB);
      expect(dbFromFraction(0.5)).toBeCloseTo(-9, 6);
    });

    it("clamps out-of-range fractions", () => {
      expect(dbFromFraction(-1)).toBe(FADER_MIN_DB);
      expect(dbFromFraction(2)).toBe(FADER_MAX_DB);
    });

    it("round-trips fraction -> dB -> fraction", () => {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(fractionFromDb(dbFromFraction(t))).toBeCloseTo(t, 6);
      }
    });

    it("puts -inf faders at the bottom", () => {
      expect(fractionFromDb(-Infinity)).toBe(0);
    });
  });

  describe("formatDb", () => {
    it("renders -inf as a symbol", () => {
      expect(formatDb(-Infinity)).toBe("-∞");
    });

    it("signs positive values", () => {
      expect(formatDb(1.5)).toBe("+1.5 dB");
    });

    it("omits the sign on zero", () => {
      expect(formatDb(0)).toBe("0.0 dB");
      expect(formatDb(0.04)).toBe("0.0 dB");
    });

    it("keeps the sign on negative values", () => {
      expect(formatDb(-1.5)).toBe("-1.5 dB");
    });
  });

  describe("preset tables", () => {
    it("defines every stem in every preset", () => {
      for (const [name, gains] of Object.entries(MIX_PRESETS)) {
        for (const stem of STEM_NAMES) {
          expect(gains[stem], `${name}.${stem}`).toBeTypeOf("number");
        }
      }
    });

    it("defaults to the Balanced preset", () => {
      expect(DEFAULT_STEM_GAINS_DB).toEqual(MIX_PRESETS.balanced);
    });

    it("raises vocals and lowers 'other' by default (the stated reason)", () => {
      const d = DEFAULT_STEM_GAINS_DB;
      expect(d.vocals).toBeGreaterThan(0);
      expect(d.other).toBeLessThan(0);
      expect(d.drums).toBe(0);
    });

    it("mutes vocals only in karaoke", () => {
      expect(MIX_PRESETS.karaoke.vocals).toBe(-Infinity);
      for (const other of ["balanced", "vocal_focus"] as const) {
        expect(MIX_PRESETS[other].vocals).toBeGreaterThan(0);
      }
    });

    it("keeps the neutral profile flat", () => {
      for (const stem of STEM_NAMES) {
        expect(NEUTRAL_STEM_GAINS_DB[stem]).toBe(0);
      }
    });

    it("keeps every preset within the fader travel, except deliberate -inf", () => {
      for (const gains of Object.values(MIX_PRESETS)) {
        for (const [stem, db] of Object.entries(gains)) {
          if (db === -Infinity) continue;
          expect(db, stem).toBeGreaterThanOrEqual(FADER_MIN_DB);
          expect(db, stem).toBeLessThanOrEqual(FADER_MAX_DB);
        }
      }
    });
  });
});