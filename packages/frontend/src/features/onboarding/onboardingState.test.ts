import { describe, it, expect } from "vitest";
import {
  CLIP_SECONDS,
  INITIAL_STATE,
  analysisFailed,
  analysisSucceeded,
  describeSuggestion,
  isComplete,
  lookAccepted,
  pickHighestEnergyWindow,
  renderFailed,
  renderStarted,
  renderSucceeded,
  retry,
  startOver,
  trackSelected,
  type OnboardingState,
} from "./onboardingState";

/**
 * Plan O3 acceptance: "Unit tests for the flow state machine".
 *
 * These pin the rules of `docs/ux/5-minute-path.md`: the path is linear, the
 * only branch is failure, and failure always carries its own fix.
 */

describe("onboarding state machine", () => {
  it("starts on the add step with nothing chosen", () => {
    expect(INITIAL_STATE.step).toBe("add");
    expect(INITIAL_STATE.filename).toBeNull();
    expect(INITIAL_STATE.suggestion).toBeNull();
    expect(INITIAL_STATE.error).toBeNull();
  });

  it("runs the happy path in order: add → analyzing → look → watch → rendering → done", () => {
    let s: OnboardingState = INITIAL_STATE;
    s = trackSelected(s, "track.wav");
    expect(s.step).toBe("analyzing");
    expect(s.filename).toBe("track.wav");

    s = analysisSucceeded(
      s,
      { text: "High-energy track, 126 BPM", visualization: "pulse", confidence: 0.8 },
      { start: 12, end: 22 },
    );
    expect(s.step).toBe("look");
    expect(s.suggestion?.visualization).toBe("pulse");
    expect(s.clipWindow).toEqual({ start: 12, end: 22 });

    s = lookAccepted(s);
    expect(s.step).toBe("watch");

    s = renderStarted(s);
    expect(s.step).toBe("rendering");

    s = renderSucceeded(s, "/api/video/output/clip.mp4");
    expect(s.step).toBe("done");
    expect(s.outputUrl).toBe("/api/video/output/clip.mp4");
    expect(isComplete(s)).toBe(true);
  });

  it("starts analysis automatically when a track is chosen", () => {
    const s = trackSelected(INITIAL_STATE, "a.mp3");
    // No 'analyze' step exists — the path has no button press here.
    expect(s.step).toBe("analyzing");
  });

  it("clears stale suggestion and window when a new track is chosen", () => {
    let s = trackSelected(INITIAL_STATE, "first.wav");
    s = analysisSucceeded(
      s,
      { text: "Mid-energy track", visualization: "grid", confidence: 0.5 },
      { start: 0, end: 10 },
    );
    s = trackSelected(s, "second.wav");
    expect(s.suggestion).toBeNull();
    expect(s.clipWindow).toBeNull();
  });

  it("routes failure to the error branch with a fix attached", () => {
    const s = analysisFailed(
      trackSelected(INITIAL_STATE, "broken.wav"),
      "That file couldn't be read.",
      "Choose another track",
    );
    expect(s.step).toBe("error");
    expect(s.error).toBe("That file couldn't be read.");
    expect(s.errorFix).toBe("Choose another track");
  });

  it("retries from the error branch back into analysis, keeping the track", () => {
    let s = analysisFailed(
      trackSelected(INITIAL_STATE, "track.wav"),
      "boom",
    );
    s = retry(s);
    expect(s.step).toBe("analyzing");
    expect(s.filename).toBe("track.wav");
    expect(s.error).toBeNull();
  });

  it("retry with no track selected returns to the add step", () => {
    const s = retry({ ...INITIAL_STATE, step: "error", error: "boom" });
    expect(s.step).toBe("add");
    expect(s.filename).toBeNull();
  });

  it("startOver resets everything", () => {
    let s = renderSucceeded(
      renderStarted(lookAccepted(analysisSucceeded(
        trackSelected(INITIAL_STATE, "t.wav"),
        { text: "r", visualization: "v", confidence: 1 },
        { start: 0, end: 10 },
      ))),
      "/out.mp4",
    );
    expect(s.step).toBe("done");
    s = startOver(s);
    expect(s).toEqual(INITIAL_STATE);
  });

  it("ignores transitions that are not legal from the current step", () => {
    // You cannot accept a look before analysis finished.
    expect(lookAccepted(INITIAL_STATE).step).toBe("add");
    // You cannot render before the look was accepted.
    expect(renderStarted(INITIAL_STATE).step).toBe("add");
    // Retry outside the error branch is a no-op.
    expect(retry(INITIAL_STATE)).toBe(INITIAL_STATE);
  });

  it("allows rendering to start from the error branch (retry the render)", () => {
    const s = renderFailed(
      renderStarted(lookAccepted(analysisSucceeded(
        trackSelected(INITIAL_STATE, "t.wav"),
        { text: "r", visualization: "v", confidence: 1 },
        { start: 0, end: 10 },
      ))),
      "encoder died",
    );
    expect(s.step).toBe("error");
    expect(renderStarted(s).step).toBe("rendering");
  });
});

describe("pickHighestEnergyWindow", () => {
  it("returns null for a zero-length track", () => {
    expect(pickHighestEnergyWindow([0.1, 0.2], undefined, 0)).toBeNull();
  });

  it("falls back to the opening window when there is no energy data", () => {
    const w = pickHighestEnergyWindow(undefined, undefined, 30);
    expect(w).toEqual({ start: 0, end: CLIP_SECONDS });
  });

  it("finds the loud stretch in a flat-then-loud curve", () => {
    // 30s at 1 sample/second. Quiet 0..14, loud 15..29.
    const curve = new Array(30).fill(0.1).concat(new Array(15).fill(0.9));
    const w = pickHighestEnergyWindow(curve, undefined, 45);
    expect(w).not.toBeNull();
    // The window must sit inside the loud region.
    expect(w!.start).toBeGreaterThanOrEqual(14);
    expect(w!.end - w!.start).toBeCloseTo(CLIP_SECONDS, 1);
  });

  it("clips the window to the track duration", () => {
    const w = pickHighestEnergyWindow(undefined, undefined, 4);
    expect(w).toEqual({ start: 0, end: 4 });
  });

  it("uses the highest-energy section when there is no curve", () => {
    const sections = [
      { start: 0, end: 10, energy: 0.2 },
      { start: 10, end: 20, energy: 0.9 },
      { start: 20, end: 30, energy: 0.4 },
    ];
    const w = pickHighestEnergyWindow(undefined, sections, 30);
    expect(w!.start).toBeGreaterThanOrEqual(10);
    expect(w!.end - w!.start).toBeCloseTo(CLIP_SECONDS, 1);
  });

  it("is deterministic for a flat curve (earliest window wins)", () => {
    const curve = new Array(60).fill(0.5);
    const a = pickHighestEnergyWindow(curve, undefined, 60);
    const b = pickHighestEnergyWindow(curve, undefined, 60);
    expect(a).toEqual(b);
    expect(a!.start).toBe(0);
  });
});

describe("describeSuggestion", () => {
  it("returns null when there is no suggested visualization", () => {
    expect(describeSuggestion({ visualization: null })).toBeNull();
  });

  it("describes a high-energy track in plain language", () => {
    const s = describeSuggestion({
      visualization: "pulse",
      confidence: 0.82,
      tempoBpm: 126,
      energy: 0.8,
    });
    expect(s).not.toBeNull();
    expect(s!.text).toBe("High-energy track, 126 BPM");
    expect(s!.visualization).toBe("pulse");
  });

  it("describes a low-energy track", () => {
    const s = describeSuggestion({
      visualization: "grid",
      tempoBpm: 70,
      energy: 0.2,
    });
    expect(s!.text).toBe("Low-energy track, 70 BPM");
  });

  it("never renders a percentage — the reason is the message", () => {
    const s = describeSuggestion({
      visualization: "pulse",
      confidence: 0.93,
      tempoBpm: 128,
      energy: 0.7,
    });
    expect(s!.text).not.toContain("%");
    expect(s!.text).not.toContain("93");
  });

  it("falls back to a generic reason when there is no energy or tempo", () => {
    const s = describeSuggestion({ visualization: "grid" });
    expect(s!.text).toBe("Matched to your track");
  });
});
