import { describe, expect, it } from "vitest";
import { createSpectralFluxOnset } from "./spectralFlux";

const BINS = 64;
const DT = 1 / 60;

/** Flat spectrum at `level` (0..1) — silence baseline. */
function flat(level: number): Float32Array {
  return new Float32Array(BINS).fill(level);
}

/** Kick-like hit: bass bins jump, rest stay flat. */
function kickHit(): Float32Array {
  const s = flat(0.05);
  for (let i = 0; i < 8; i++) s[i] = 0.8;
  return s;
}

describe("createSpectralFluxOnset (T-VIZ-16)", () => {
  it("fires on an isolated hit after a silent baseline", () => {
    const onset = createSpectralFluxOnset(BINS);
    for (let i = 0; i < 30; i++) onset.step(flat(0.02), DT);
    expect(onset.envelope).toBe(0);

    onset.step(kickHit(), DT);
    expect(onset.envelope).toBeGreaterThan(0.3);
    expect(onset.flux).toBeGreaterThan(onset.threshold);
  });

  it("decays toward zero over ~0.5 s", () => {
    const onset = createSpectralFluxOnset(BINS);
    for (let i = 0; i < 30; i++) onset.step(flat(0.02), DT);
    onset.step(kickHit(), DT);
    const peak = onset.envelope;
    expect(peak).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) onset.step(flat(0.02), DT); // ~0.5 s
    expect(onset.envelope).toBeLessThan(peak * 0.2);
  });

  it("does not fire on constant loud noise (adaptive threshold)", () => {
    const onset = createSpectralFluxOnset(BINS);
    // Steady-state noise: every frame identical, flux ≈ 0.
    const noise = flat(0.5);
    for (let i = 0; i < 60; i++) onset.step(noise, DT);
    expect(onset.envelope).toBe(0);
    expect(onset.flux).toBe(0);
  });

  it("does not retrigger on a sustained level (no flux = no onset)", () => {
    const onset = createSpectralFluxOnset(BINS);
    for (let i = 0; i < 30; i++) onset.step(flat(0.02), DT);
    const loud = flat(0.7);
    onset.step(loud, DT); // one jump — legitimate onset
    const afterJump = onset.envelope;
    expect(afterJump).toBeGreaterThan(0);
    // Hold loud: flux returns to ~0, envelope decays, no new hits.
    for (let i = 0; i < 10; i++) onset.step(loud, DT);
    expect(onset.flux).toBeLessThan(0.001);
  });

  it("reset clears envelope and history", () => {
    const onset = createSpectralFluxOnset(BINS);
    for (let i = 0; i < 30; i++) onset.step(flat(0.02), DT);
    onset.step(kickHit(), DT);
    expect(onset.envelope).toBeGreaterThan(0);
    onset.reset();
    expect(onset.envelope).toBe(0);
    expect(onset.flux).toBe(0);
    // After reset the detector needs a fresh baseline before firing again.
    onset.step(kickHit(), DT);
    // First frame after reset has no previous spectrum — flux = 0.
    expect(onset.flux).toBe(0);
  });

  it("handles short/empty input without throwing", () => {
    const onset = createSpectralFluxOnset(BINS);
    expect(() => onset.step([], DT)).not.toThrow();
    expect(() => onset.step(flat(0.5).subarray(0, 4), DT)).not.toThrow();
    expect(onset.envelope).toBe(0);
  });

  it("ignores non-finite bins", () => {
    const onset = createSpectralFluxOnset(BINS);
    for (let i = 0; i < 30; i++) onset.step(flat(0.02), DT);
    const bad = kickHit();
    bad[3] = NaN;
    bad[4] = Infinity;
    expect(() => onset.step(bad, DT)).not.toThrow();
    expect(onset.envelope).toBeGreaterThan(0);
  });
});
