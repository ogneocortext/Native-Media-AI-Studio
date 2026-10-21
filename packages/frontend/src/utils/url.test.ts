import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOutputUrl } from "./url";

vi.mock("../services/portConfig", () => ({
  getCachedConfig: vi.fn(),
}));

import { getCachedConfig } from "../services/portConfig";

const mockGetCachedConfig = vi.mocked(getCachedConfig);

describe("getOutputUrl", () => {
  beforeEach(() => {
    mockGetCachedConfig.mockReset();
  });

  it("returns empty string for empty path", () => {
    expect(getOutputUrl("")).toBe("");
  });

  it("passes through absolute http URLs", () => {
    expect(getOutputUrl("https://example.com/file.mp4")).toBe("https://example.com/file.mp4");
  });

  it("passes through absolute https URLs", () => {
    expect(getOutputUrl("http://localhost:8000/output/audio/track.mp3")).toBe(
      "http://localhost:8000/output/audio/track.mp3",
    );
  });

  it("builds comfyui URL from cached backend config", () => {
    mockGetCachedConfig.mockReturnValue({ backend_url: "http://backend:8000" } as never);
    expect(getOutputUrl("comfyui/outputs/image.png")).toBe(
      "http://backend:8000/api/outputs/comfyui/outputs/image.png",
    );
  });

  it("builds comfyui URL with relative fallback when no cached config", () => {
    mockGetCachedConfig.mockReturnValue(null);
    expect(getOutputUrl("comfyui/outputs/image.png")).toBe("/api/outputs/comfyui/outputs/image.png");
  });

  it("builds output URL from cached backend config", () => {
    mockGetCachedConfig.mockReturnValue({ backend_url: "http://backend:8000" } as never);
    expect(getOutputUrl("audio/track.mp3")).toBe("http://backend:8000/output/audio/track.mp3");
  });

  it("builds output URL with relative fallback when no cached config", () => {
    mockGetCachedConfig.mockReturnValue(null);
    expect(getOutputUrl("audio/track.mp3")).toBe("/output/audio/track.mp3");
  });
});
