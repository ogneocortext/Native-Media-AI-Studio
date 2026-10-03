import { describe, it, expect } from "vitest";
import { parsePanelOpen, panelStorageKey, serializePanelOpen } from "./panelCollapse";

describe("panelStorageKey", () => {
  it("namespaces keys under the visualizer prefix", () => {
    expect(panelStorageKey("stem-mixer")).toBe("nma.visualizer.panel.stem-mixer");
    expect(panelStorageKey("master-eq")).toBe("nma.visualizer.panel.master-eq");
  });
});

describe("serializePanelOpen", () => {
  it("writes stable tokens", () => {
    expect(serializePanelOpen(true)).toBe("open");
    expect(serializePanelOpen(false)).toBe("closed");
  });
});

describe("parsePanelOpen", () => {
  it("round-trips both states", () => {
    expect(parsePanelOpen(serializePanelOpen(true), false)).toBe(true);
    expect(parsePanelOpen(serializePanelOpen(false), true)).toBe(false);
  });

  it("defaults to collapsed when nothing is stored", () => {
    expect(parsePanelOpen(null, false)).toBe(false);
    expect(parsePanelOpen(null, true)).toBe(true);
  });

  it("falls back to the default for corrupted values instead of guessing", () => {
    expect(parsePanelOpen("garbage", false)).toBe(false);
    expect(parsePanelOpen("Open", false)).toBe(false); // tokens are case-sensitive
    expect(parsePanelOpen("", false)).toBe(false);
    expect(parsePanelOpen("garbage", true)).toBe(true);
  });
});
