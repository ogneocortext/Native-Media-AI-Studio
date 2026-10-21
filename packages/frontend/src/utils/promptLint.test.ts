import { describe, it, expect } from "vitest";
import { countWords, lintVideoPrompt } from "./promptLint";

describe("countWords", () => {
  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(countWords("   ")).toBe(0);
  });

  it("returns 0 for null/undefined input", () => {
    expect(countWords(null as unknown as string)).toBe(0);
    expect(countWords(undefined as unknown as string)).toBe(0);
  });

  it("counts single word", () => {
    expect(countWords("hello")).toBe(1);
  });

  it("counts multiple words with varied whitespace", () => {
    expect(countWords("hello   world")).toBe(2);
    expect(countWords("one two three")).toBe(3);
  });
});

describe("lintVideoPrompt", () => {
  it("returns all checks failing for empty prompt except specific", () => {
    const result = lintVideoPrompt("");
    expect(result.wordCount).toBe(0);
    // specific passes vacuously (no generic words in empty string)
    expect(result.score).toBe(1);
    expect(result.checks.find((c) => c.key === "specific")!.pass).toBe(true);
    expect(result.checks.find((c) => c.key === "length")!.pass).toBe(false);
  });

  it("returns all checks passing for a well-formed prompt", () => {
    const result = lintVideoPrompt("Close-up of a warrior at low angle, golden hour lighting, cinematic mood");
    expect(result.score).toBe(5);
    expect(result.checks.every((c) => c.pass)).toBe(true);
  });

  it("fails shot check when no shot token present", () => {
    const result = lintVideoPrompt("A warrior standing in a field at golden hour");
    const shot = result.checks.find((c) => c.key === "shot")!;
    expect(shot.pass).toBe(false);
  });

  it("fails angle check when no angle token present", () => {
    const result = lintVideoPrompt("Close-up of a warrior in a field");
    const angle = result.checks.find((c) => c.key === "angle")!;
    expect(angle.pass).toBe(false);
  });

  it("fails lighting check when no light token present", () => {
    const result = lintVideoPrompt("Close-up of a warrior at low angle");
    const lighting = result.checks.find((c) => c.key === "lighting")!;
    expect(lighting.pass).toBe(false);
  });

  it("fails length check when over 75 words", () => {
    const longPrompt = "word ".repeat(80);
    const result = lintVideoPrompt(longPrompt);
    const length = result.checks.find((c) => c.key === "length")!;
    expect(length.pass).toBe(false);
  });

  it("fails specific check when generic filler present", () => {
    const result = lintVideoPrompt("Close-up of a beautiful warrior at low angle");
    const specific = result.checks.find((c) => c.key === "specific")!;
    expect(specific.pass).toBe(false);
  });

  it("passes specific check with 'cool' as part of another word", () => {
    const result = lintVideoPrompt("Close-up of a coolant system at low angle, neon lighting");
    const specific = result.checks.find((c) => c.key === "specific")!;
    expect(specific.pass).toBe(true);
  });

  it("treats case-insensitively", () => {
    const result = lintVideoPrompt("CLOSE-UP OF A WARRIOR AT LOW ANGLE, GOLDEN HOUR LIGHTING");
    expect(result.score).toBe(5);
  });

  it("gives useful hints for failing checks", () => {
    const result = lintVideoPrompt("");
    const lengthHint = result.checks.find((c) => c.key === "length")!.hint;
    expect(lengthHint).toContain("Describe one subject per shot");
  });
});
