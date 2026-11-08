import { describe, it, expect } from "vitest";
import { fmtTime } from "./VSTPage";
import { getCategoryColor, getCategoryIcon } from "./components/VSTPluginCard";

describe("VST Utilities", () => {
  describe("fmtTime", () => {
    it("formats seconds as mm:ss for normal inputs", () => {
      expect(fmtTime(0)).toBe("0:00");
      expect(fmtTime(65)).toBe("1:05");
      expect(fmtTime(3599)).toBe("59:59");
      expect(fmtTime(3600)).toBe("60:00");
    });

    it("returns zero for negative input", () => {
      expect(fmtTime(-1)).toBe("0:00");
      expect(fmtTime(-60)).toBe("0:00");
    });

    it("handles large durations", () => {
      expect(fmtTime(7200)).toBe("120:00");
      expect(fmtTime(3661)).toBe("61:01");
    });
  });

  describe("getCategoryColor", () => {
    it("returns correct color for known categories", () => {
      expect(getCategoryColor("effect")).toBe("#00F0FF");
      expect(getCategoryColor("instrument")).toBe("#FF2E88");
      expect(getCategoryColor("midi")).toBe("#7B5CFF");
    });

    it("returns default cyan for unknown categories", () => {
      expect(getCategoryColor("unknown")).toBe("#00F0FF");
      expect(getCategoryColor("")).toBe("#00F0FF");
    });

    it("is case-sensitive", () => {
      expect(getCategoryColor("Effect")).toBe("#00F0FF");
      expect(getCategoryColor("INSTRUMENT")).toBe("#00F0FF");
    });
  });

  describe("getCategoryIcon", () => {
    it("returns correct icon component for known categories", () => {
      const effectIcon = getCategoryIcon("effect");
      const instrumentIcon = getCategoryIcon("instrument");
      const midiIcon = getCategoryIcon("midi");

      expect(effectIcon).toBeDefined();
      expect(instrumentIcon).toBeDefined();
      expect(midiIcon).toBeDefined();
    });

    it("returns default PlugZap for unknown categories", () => {
      const unknownIcon = getCategoryIcon("unknown");
      expect(unknownIcon).toBeDefined();
    });
  });
});