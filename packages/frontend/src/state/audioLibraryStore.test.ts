import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAudioLibraryStore, __resetAudioLibraryCache } from "./audioLibraryStore";
import type { AudioLibraryFile } from "./audioNaming";

vi.mock("../services/api", () => ({
  listAudioFiles: vi.fn(),
}));

import { listAudioFiles } from "../services/api";

const mockListAudioFiles = vi.mocked(listAudioFiles);

const makeFile = (overrides: Partial<AudioLibraryFile> = {}): AudioLibraryFile => ({
  filename: "track.mp3",
  relative_path: "track.mp3",
  folder: "",
  size_bytes: 1000,
  modified: 1234567890,
  ...overrides,
});

describe("audioLibraryStore", () => {
  beforeEach(() => {
    __resetAudioLibraryCache();
    mockListAudioFiles.mockReset();
  });

  it("starts with empty entries and no error", () => {
    const state = useAudioLibraryStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.lastLoadedAt).toBeNull();
  });

  it("loads entries from listAudioFiles", async () => {
    const files = [makeFile({ filename: "song.mp3", relative_path: "song.mp3" })];
    mockListAudioFiles.mockResolvedValue(files);

    await useAudioLibraryStore.getState().ensureLoaded();

    const state = useAudioLibraryStore.getState();
    expect(state.entries.length).toBe(1);
    expect(state.entries[0].displayName).toBe("song");
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.lastLoadedAt).toBeGreaterThan(0);
    expect(mockListAudioFiles).toHaveBeenCalledTimes(1);
  });

  it("dedupes entries by display name", async () => {
    const files = [
      makeFile({ filename: "abc12345_song.mp3", relative_path: "song.mp3" }),
      makeFile({ filename: "song.mp3", relative_path: "song.mp3" }),
    ];
    mockListAudioFiles.mockResolvedValue(files);

    await useAudioLibraryStore.getState().ensureLoaded();

    const state = useAudioLibraryStore.getState();
    expect(state.entries.length).toBe(1);
    expect(state.entries[0].displayName).toBe("song");
  });

  it("shares one in-flight request for concurrent callers", async () => {
    mockListAudioFiles.mockResolvedValue([makeFile()]);

    const p1 = useAudioLibraryStore.getState().ensureLoaded();
    const p2 = useAudioLibraryStore.getState().ensureLoaded();
    await Promise.all([p1, p2]);

    expect(mockListAudioFiles).toHaveBeenCalledTimes(1);
  });

  it("force reload bypasses settled cache", async () => {
    mockListAudioFiles.mockResolvedValue([makeFile({ filename: "a.mp3" })]);
    await useAudioLibraryStore.getState().ensureLoaded();
    expect(mockListAudioFiles).toHaveBeenCalledTimes(1);

    mockListAudioFiles.mockResolvedValue([makeFile({ filename: "b.mp3" })]);
    await useAudioLibraryStore.getState().refresh();
    expect(mockListAudioFiles).toHaveBeenCalledTimes(2);
  });

  it("returns settled promise without refetching on ensureLoaded", async () => {
    mockListAudioFiles.mockResolvedValue([makeFile()]);
    await useAudioLibraryStore.getState().ensureLoaded();
    await useAudioLibraryStore.getState().ensureLoaded();

    expect(mockListAudioFiles).toHaveBeenCalledTimes(1);
  });

  it("sets error on failure", async () => {
    mockListAudioFiles.mockRejectedValue(new Error("Network error"));

    await useAudioLibraryStore.getState().ensureLoaded();

    const state = useAudioLibraryStore.getState();
    expect(state.error).toBe("Network error");
    expect(state.isLoading).toBe(false);
  });

  it("clearError clears the error", async () => {
    mockListAudioFiles.mockRejectedValue(new Error("Network error"));
    await useAudioLibraryStore.getState().ensureLoaded();
    expect(useAudioLibraryStore.getState().error).toBe("Network error");

    useAudioLibraryStore.getState().clearError();
    expect(useAudioLibraryStore.getState().error).toBeNull();
  });

  it("optionLabel adds hash suffix for duplicate display names", async () => {
    // Test audioOptionLabel directly: two entries with same display name get hash suffix
    const { audioOptionLabel } = await import("./audioNaming");
    const all = [
      makeFile({ filename: "song.mp3", relative_path: "song.mp3" }),
      makeFile({ filename: "abc12345_song.mp3", relative_path: "song2.mp3" }),
    ];
    const label1 = audioOptionLabel(all[0], all);
    const label2 = audioOptionLabel(all[1], all);
    // song.mp3 has no hash prefix, so no suffix even with collision
    expect(label1).toBe("song");
    // abc12345_song.mp3 has a hash prefix → disambiguating suffix
    expect(label2).toBe("song [abc12345]");
    expect(label1).not.toBe(label2);
  });

  it("ref exposes relative_path", async () => {
    const files = [makeFile({ relative_path: "folder/track.mp3", filename: "track.mp3" })];
    mockListAudioFiles.mockResolvedValue(files);

    await useAudioLibraryStore.getState().ensureLoaded();

    expect(useAudioLibraryStore.getState().entries[0].ref).toBe("folder/track.mp3");
  });
});
