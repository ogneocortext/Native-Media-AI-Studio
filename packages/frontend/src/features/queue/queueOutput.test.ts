import { describe, expect, it } from "vitest";
import { resolveJobOutput } from "./QueueList";

describe("resolveJobOutput", () => {
  it("resolves project-relative output paths", () => {
    const out = resolveJobOutput("output/video/clip_123.mp4");
    expect(out?.filename).toBe("clip_123.mp4");
    expect(out?.kind).toBe("video");
    expect(out?.url).toContain("/output/video/clip_123.mp4");
  });

  it("resolves absolute Windows paths", () => {
    const out = resolveJobOutput("D:\\studio\\output\\images\\2026-01-01_120000.png");
    expect(out?.filename).toBe("2026-01-01_120000.png");
    expect(out?.kind).toBe("image");
    expect(out?.url).toContain("/output/images/2026-01-01_120000.png");
  });

  it("resolves output-dir-relative paths", () => {
    const out = resolveJobOutput("audio/song.wav");
    expect(out?.kind).toBe("audio");
    expect(out?.url).toContain("/output/audio/song.wav");
  });

  it("passes through already-servable paths and URLs", () => {
    expect(resolveJobOutput("/output/video/x.mp4")?.url).toBe("/output/video/x.mp4");
    expect(resolveJobOutput("https://cdn.example.com/x.png")?.url).toBe(
      "https://cdn.example.com/x.png",
    );
  });

  it("classifies extensions into preview kinds", () => {
    expect(resolveJobOutput("output/images/a.webp")?.kind).toBe("image");
    expect(resolveJobOutput("output/audio/b.flac")?.kind).toBe("audio");
    expect(resolveJobOutput("output/video/c.webm")?.kind).toBe("video");
    expect(resolveJobOutput("output/data/report.json")?.kind).toBe("file");
    expect(resolveJobOutput("output/generated_3d/model.glb")?.kind).toBe("file");
  });

  it("returns null for empty or filename-less input", () => {
    expect(resolveJobOutput("")).toBeNull();
    expect(resolveJobOutput("output/video/")).toBeNull();
  });
});
