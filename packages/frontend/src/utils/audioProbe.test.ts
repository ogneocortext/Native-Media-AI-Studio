import { describe, it, expect } from "vitest";
import { getFileExtension, isAudioFile, formatDuration } from "./audioProbe";

describe("getFileExtension", () => {
  it("returns extension for normal filename", () => {
    expect(getFileExtension("song.mp3")).toBe("mp3");
    expect(getFileExtension("audio.file.wav")).toBe("wav");
  });

  it("returns lowercase extension", () => {
    expect(getFileExtension("SONG.MP3")).toBe("mp3");
  });

  it("returns empty string for filename without extension", () => {
    expect(getFileExtension("README")).toBe("");
    expect(getFileExtension("")).toBe("");
  });

  it("returns the part after the last dot for dotfiles", () => {
    expect(getFileExtension(".bashrc")).toBe("bashrc");
  });
});

describe("isAudioFile", () => {
  const makeFile = (name: string, type: string): File =>
    new File([""], name, { type });

  it("returns true when type starts with audio/", () => {
    expect(isAudioFile(makeFile("song.mp3", "audio/mpeg"))).toBe(true);
    expect(isAudioFile(makeFile("song.wav", "audio/wav"))).toBe(true);
  });

  it("returns true for known audio extensions regardless of MIME", () => {
    expect(isAudioFile(makeFile("song.mp3", ""))).toBe(true);
    expect(isAudioFile(makeFile("track.flac", ""))).toBe(true);
    expect(isAudioFile(makeFile("audio.m4a", ""))).toBe(true);
    expect(isAudioFile(makeFile("audio.ogg", ""))).toBe(true);
    expect(isAudioFile(makeFile("audio.aac", ""))).toBe(true);
    expect(isAudioFile(makeFile("audio.opus", ""))).toBe(true);
    expect(isAudioFile(makeFile("audio.webm", ""))).toBe(true);
  });

  it("returns true for video/ogg and application/ogg containers", () => {
    expect(isAudioFile(makeFile("audio.ogg", "video/ogg"))).toBe(true);
    expect(isAudioFile(makeFile("audio.ogg", "application/ogg"))).toBe(true);
  });

  it("returns true for audio/x- MIME types", () => {
    expect(isAudioFile(makeFile("audio", "audio/x-wav"))).toBe(true);
  });

  it("returns false for unknown extensions", () => {
    expect(isAudioFile(makeFile("image.jpg", ""))).toBe(false);
    expect(isAudioFile(makeFile("document.pdf", ""))).toBe(false);
  });

  it("uses accept list when provided", () => {
    const file = makeFile("song.mp3", "audio/mpeg");
    expect(isAudioFile(file, "audio/mpeg, audio/wav")).toBe(true);
    // Known extension check passes before accept, so .mp3 passes even with .wav accept
    expect(isAudioFile(makeFile("song.mp3", ""), ".mp3")).toBe(true);
    // Unknown extension with non-matching accept fails
    expect(isAudioFile(makeFile("data.xyz", ""), ".wav")).toBe(false);
  });
});

describe("formatDuration", () => {
  it("returns 'unknown length' for null", () => {
    expect(formatDuration(null)).toBe("unknown length");
  });

  it("returns 'unknown length' for NaN/Infinity", () => {
    expect(formatDuration(NaN)).toBe("unknown length");
    expect(formatDuration(Infinity)).toBe("unknown length");
  });

  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(61)).toBe("1:01");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("pads seconds with leading zero", () => {
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(59)).toBe("0:59");
  });
});
