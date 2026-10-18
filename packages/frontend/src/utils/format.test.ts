import { describe, it, expect } from "vitest";
import { formatBytes, formatTime, formatElapsed } from "./format";

describe("formatBytes", () => {
  it("formats bytes below 1 KB without a negative log index", () => {
    // Sub-1 KB values were the regression that caused an undefined-index crash;
    // Math.max(0, ...) on the floor(log) guard ensures i is clamped to 0.
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats KB and larger with 1 decimal (trailing zeros trimmed)", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });

  it("respects the decimals override (trailing zeros are trimmed)", () => {
    expect(formatBytes(1536, 2)).toBe("1.5 KB");
    expect(formatBytes(1536, 3)).toBe("1.5 KB");
  });

  it("clamps beyond available units to TB", () => {
    expect(formatBytes(5 * 1099511627776)).toBe("5 TB");
  });
});

describe("formatTime", () => {
  it("formats seconds as mm:ss for normal inputs", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3599)).toBe("59:59");
  });

  it("returns zero for non-finite or non-positive input", () => {
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
  });
});

describe("formatElapsed", () => {
  it("formats short durations as seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(42)).toBe("42s");
  });

  it("formats minutes", () => {
    expect(formatElapsed(120)).toBe("2m");
    expect(formatElapsed(125)).toBe("2m 5s");
  });

  it("formats hours", () => {
    expect(formatElapsed(3600)).toBe("1h");
    expect(formatElapsed(5400)).toBe("1h 30m");
  });
});
