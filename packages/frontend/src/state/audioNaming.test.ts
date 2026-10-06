import { describe, it, expect } from "vitest";
import {
  countGroupedEntries,
  groupAudioEntries,
  audioDisplayName,
  audioEntryLabel,
  audioOptionLabel,
  audioRefFor,
  dedupeAudioFiles,
  isUnnamedFile,
  isVariantFile,
  parseVariantName,
  shortHashOf,
  stripAudioExtension,
  stripHashPrefixes,
  stripHashPrefixesFromPath,
  unnamedFileLabel,
  variantFileName,
  variantLabel,
  variantOptionLabel,
  type AudioLibraryFile,
} from "./audioNaming";

function file(filename: string, relative_path?: string): AudioLibraryFile {
  return {
    filename,
    relative_path: relative_path ?? filename,
    folder: "",
    size_bytes: 1024,
    modified: 0,
  };
}

describe("stripHashPrefixes", () => {
  // The legacy uuid scheme stacked prefixes, and a regex matching only one or
  // two left the remainder visible. Every arity must fully strip.
  it("strips a single content-hash prefix", () => {
    expect(stripHashPrefixes("03c5fbfd_NeoCortext.mp3")).toBe("NeoCortext.mp3");
  });

  it("stacks: strips two prefixes", () => {
    expect(stripHashPrefixes("97630035_ab5ca1f8_Song.mp3")).toBe("Song.mp3");
  });

  it("stacks: strips three prefixes", () => {
    expect(
      stripHashPrefixes("a19680f6_3a2337e6_1bc4ab02_Learning How to Stay.mp3"),
    ).toBe("Learning How to Stay.mp3");
  });

  it("is case-insensitive on the hash", () => {
    expect(stripHashPrefixes("A19680F6_3a2337e6_Song.mp3")).toBe("Song.mp3");
  });

  it("leaves a name with no hash prefix untouched", () => {
    expect(stripHashPrefixes("NeoCortext - Take the Crown.mp3")).toBe(
      "NeoCortext - Take the Crown.mp3",
    );
  });

  it("does not strip an 8-hex run that is not followed by an underscore", () => {
    // A bare 8-hex word is part of the name, not a prefix.
    expect(stripHashPrefixes("deadbeef song.mp3")).toBe("deadbeef song.mp3");
  });
});

describe("stripHashPrefixesFromPath", () => {
  it("strips the prefix in each segment but keeps the folders", () => {
    expect(stripHashPrefixesFromPath("Suno-V6-Mini/03c5fbfd_NeoCortext.mp3")).toBe(
      "Suno-V6-Mini/NeoCortext.mp3",
    );
  });
});

describe("stripAudioExtension", () => {
  it.each(["mp3", "wav", "flac", "ogg", "m4a", "wma", "aac"])("removes .%s", (ext) => {
    expect(stripAudioExtension(`Track.${ext}`)).toBe("Track");
  });

  it("is case-insensitive", () => {
    expect(stripAudioExtension("Track.MP3")).toBe("Track");
  });

  it("leaves non-audio extensions alone", () => {
    expect(stripAudioExtension("artwork.jpg")).toBe("artwork.jpg");
    expect(stripAudioExtension("lyrics.lrc")).toBe("lyrics.lrc");
  });
});

describe("audioDisplayName", () => {
  it("removes folder, hash prefix and extension", () => {
    expect(
      audioDisplayName(
        file(
          "03c5fbfd_NeoCortext - I Won't Ride.mp3",
          "Suno-V6-Mini/03c5fbfd_NeoCortext - I Won't Ride.mp3",
        ),
      ),
    ).toBe("NeoCortext - I Won't Ride");
  });

  it("accepts a bare string", () => {
    expect(audioDisplayName("85a406ef_NeoCortext - Take the Crown.mp3")).toBe(
      "NeoCortext - Take the Crown",
    );
  });

  // The regression that motivated the module: the old two-prefix regex left the
  // hash in place for single-prefix names.
  it("never leaves a hash prefix visible", () => {
    for (const raw of [
      "03c5fbfd_NeoCortext - I Won't Ride with the Choir.mp3",
      "1bc4ab02_3a2337e6_a19680f6_NeoCortext - Learning How to Stay.mp3",
      "90c24323_Context Window (Final Polish).wav",
    ]) {
      expect(audioDisplayName(raw)).not.toMatch(/^[0-9a-f]{8}_/i);
    }
  });
});

describe("audioRefFor", () => {
  it("prefers the folder-aware relative_path", () => {
    expect(audioRefFor(file("track.m4a", "Suno-V6-Mini/track.m4a"))).toBe(
      "Suno-V6-Mini/track.m4a",
    );
  });

  it("normalises Windows separators to POSIX", () => {
    expect(audioRefFor(file("track.m4a", "Suno-V6-Mini\\track.m4a"))).toBe(
      "Suno-V6-Mini/track.m4a",
    );
  });

  it("falls back to filename when relative_path is empty", () => {
    expect(audioRefFor(file("track.m4a", ""))).toBe("track.m4a");
  });
});

describe("audioOptionLabel", () => {
  it("is the plain display name when nothing collides", () => {
    const a = file("11111111_Alpha.mp3");
    expect(audioOptionLabel(a, [a, file("22222222_Beta.mp3")])).toBe("Alpha");
  });

  it("appends the hash when two tracks share a display name", () => {
    const a = file("11111111_Alpha.mp3");
    const b = file("22222222_Alpha.mp3");
    expect(audioOptionLabel(a, [a, b])).toBe("Alpha [11111111]");
    expect(audioOptionLabel(b, [a, b])).toBe("Alpha [22222222]");
  });

  it("distinguishes entries that differ only by stacked prefix depth", () => {
    // Both strip to "Alpha"; without the suffix a selector shows two identical
    // options, which is the duplicate-dropdown problem.
    const a = file("11111111_Alpha.mp3");
    const b = file("22222222_33333333_Alpha.mp3");
    expect(audioOptionLabel(a, [a, b])).not.toBe(audioOptionLabel(b, [a, b]));
  });

  it("labels an unnamed file rather than rendering its uuid", () => {
    // Regression: audioOptionLabel used to call audioDisplayName directly, so a
    // hash-only filename reached the UI as 32 characters of hex.
    const a = file("ec2c167538d44391af7d14d57fede26d.wav");
    expect(audioOptionLabel(a, [a])).toBe("Unnamed track ec2c16");
  });

  it("keeps two unnamed files distinct in the same list", () => {
    const a = file("ec2c167538d44391af7d14d57fede26d.wav");
    const b = file("fc37eecb77fc4759bd64daa5ddd34fa8.wav");
    const both = [a, b];
    expect(audioOptionLabel(a, both)).not.toBe(audioOptionLabel(b, both));
  });
});

describe("isUnnamedFile", () => {
  it("detects a bare 32-char uuid name", () => {
    // Real case in this library: uploads stored with no track title at all.
    expect(isUnnamedFile("ec2c167538d44391af7d14d57fede26d.wav")).toBe(true);
  });

  it("detects a bare 8-char hash name", () => {
    expect(isUnnamedFile("deadbeef.wav")).toBe(true);
  });

  it("does not flag a hash-prefixed real title", () => {
    expect(isUnnamedFile("deadbeef_NeoCortext.mp3")).toBe(false);
  });

  it("does not flag a title that merely starts with hex", () => {
    expect(isUnnamedFile("decade_dreams.mp3")).toBe(false);
  });

  it("does not flag an ordinary track", () => {
    expect(isUnnamedFile("03c5fbfd_NeoCortext - I Won't Ride.mp3")).toBe(false);
  });
});

describe("unnamedFileLabel / audioEntryLabel", () => {
  it("labels a uuid-named file readably", () => {
    expect(unnamedFileLabel("ec2c167538d44391af7d14d57fede26d.wav")).toBe(
      "Unnamed track ec2c16",
    );
  });

  it("keeps two unnamed files distinguishable", () => {
    const a = audioEntryLabel(file("ec2c167538d44391af7d14d57fede26d.wav"));
    const b = audioEntryLabel(file("fc37eecb77fc4759bd64daa5ddd34fa8.wav"));
    expect(a).not.toBe(b);
  });

  it("leaves a real track's entry label as its display name", () => {
    expect(audioEntryLabel(file("11111111_Alpha.mp3"))).toBe("Alpha");
  });
});

describe("dedupeAudioFiles", () => {
  it("keeps the first entry per display name", () => {
    const out = dedupeAudioFiles([
      file("11111111_Alpha.mp3"),
      file("22222222_Alpha.mp3"),
      file("33333333_Beta.mp3"),
    ]);
    expect(out.map(audioDisplayName)).toEqual(["Alpha", "Beta"]);
  });

  it("preserves backend order (most recently modified first)", () => {
    const out = dedupeAudioFiles([file("11111111_New.mp3"), file("22222222_Old.mp3")]);
    expect(out.map((f) => f.filename)).toEqual(["11111111_New.mp3", "22222222_Old.mp3"]);
  });

  it("does not collapse different tracks that merely share a prefix", () => {
    const out = dedupeAudioFiles([file("11111111_Alpha.mp3"), file("22222222_Alpine.mp3")]);
    expect(out).toHaveLength(2);
  });

  it("is idempotent", () => {
    const once = dedupeAudioFiles([file("11111111_Alpha.mp3"), file("22222222_Alpha.mp3")]);
    expect(dedupeAudioFiles(once)).toHaveLength(1);
  });

  it("handles an empty list", () => {
    expect(dedupeAudioFiles([])).toEqual([]);
  });
});

describe("shortHashOf", () => {
  it("returns the leading hash", () => {
    expect(shortHashOf("03c5fbfd_Song.mp3")).toBe("03c5fbfd");
  });

  it("returns empty when there is no hash", () => {
    expect(shortHashOf("Song.mp3")).toBe("");
  });

describe("preset variants", () => {
  it("builds a filename that leaves the source name intact and readable", () => {
    expect(variantFileName("Still I Rise.wav", "warm")).toBe("Still I Rise [warm].wav");
    expect(variantFileName("Still I Rise.wav", "vocal focus")).toBe(
      "Still I Rise [vocal focus].wav",
    );
  });

  it("keeps the source's extension unless overridden", () => {
    expect(variantFileName("Track.m4a", "warm")).toBe("Track [warm].m4a");
    // A 48 kHz WAV rendered from an .m4a must not silently become .m4a.
    expect(variantFileName("Track.m4a", "warm", "wav")).toBe("Track [warm].wav");
  });

  it("strips upload hash prefixes and folder segments like the rest of the module", () => {
    expect(variantFileName("Suno-V6-Mini/2f9a5ced_Track.mp3", "bassBoost")).toBe(
      "Track [bassBoost].mp3",
    );
  });

  it("round-trips: build then parse returns the original source and preset", () => {
    const name = variantFileName("Still I Rise.wav", "warm");
    expect(parseVariantName(name)).toEqual({ source: "Still I Rise", preset: "warm" });
  });

  it("parses a source that itself contains brackets, taking the last group", () => {
    // A greedy pattern would read the source as "Track" and preset as "Live] [warm".
    expect(parseVariantName("Track [Live] [warm].wav")).toEqual({
      source: "Track [Live]",
      preset: "warm",
    });
  });

  it("rejects a name that is only a marker, with no source", () => {
    expect(parseVariantName("[warm].wav")).toBeNull();
    expect(parseVariantName("[].wav")).toBeNull();
  });

  it("does not treat an ordinary track as a variant", () => {
    for (const name of [
      "Still I Rise.wav",
      "2f9a5ced_Still I Rise.mp3",
      "Suno-V6-Mini/Track.m4a",
      "ec2c167538d44391af7d14d57fede26d.wav",
    ]) {
      expect(isVariantFile(name)).toBe(false);
      expect(parseVariantName(name)).toBeNull();
    }
  });

  it("strips brackets from a preset id rather than emitting an ambiguous name", () => {
    const name = variantFileName("Track.wav", "we[ird]id");
    expect(name).toBe("Track [weirdid].wav");
    expect(parseVariantName(name)).toEqual({ source: "Track", preset: "weirdid" });
  });

  it("refuses an empty preset id instead of writing a name that parses wrong", () => {
    expect(() => variantFileName("Track.wav", "   ")).toThrow(/empty preset id/);
    expect(() => variantFileName("Track.wav", "[]")).toThrow(/empty preset id/);
  });

  it("labels a variant with both preset and source so options never collide", () => {
    expect(variantLabel({ source: "Still I Rise", preset: "warm" })).toBe(
      "warm — Still I Rise",
    );
    // Two variants of different tracks must not render identically.
    expect(variantOptionLabel("Still I Rise [warm].wav")).not.toBe(
      variantOptionLabel("Take the Crown [warm].wav"),
    );
  });

  it("falls back to the normal entry label for a non-variant file", () => {
    expect(variantOptionLabel("Still I Rise.wav")).toBe("Still I Rise");
  });

  it("does not disturb existing display names for library files", () => {
    // The variant rules must not change what any current selector renders.
    const f = file("2f9a5ced_Still I Rise.mp3");
    expect(audioDisplayName(f)).toBe("Still I Rise");
    expect(audioOptionLabel(f, [f])).toBe("Still I Rise");
  });
});
});

describe("grouping", () => {
  const e = (filename: string) => ({ filename });

  it("puts a track and its variants in one group", () => {
    const groups = groupAudioEntries([
      e("Still I Rise.wav"),
      e("Still I Rise [warm].wav"),
      e("Still I Rise [bright].wav"),
      e("Take the Crown.wav"),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Still I Rise", "Take the Crown"]);
    expect(groups[0].source?.filename).toBe("Still I Rise.wav");
    expect(groups[0].variants.map((v) => v.filename)).toEqual([
      "Still I Rise [warm].wav",
      "Still I Rise [bright].wav",
    ]);
    expect(groups[1].variants).toHaveLength(0);
  });

  it("keeps groups in first-appearance order even when a variant sorts first", () => {
    // A variant appearing before its source must not hoist the group to the top.
    const groups = groupAudioEntries([
      e("Zebra Track [warm].wav"),
      e("Zebra Track.wav"),
      e("Alpha Track.wav"),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Zebra Track", "Alpha Track"]);
    expect(groups[0].source?.filename).toBe("Zebra Track.wav");
  });

  it("still surfaces a variant whose source is not in the library", () => {
    // Hiding the group would make the variant unselectable.
    const groups = groupAudioEntries([e("Ghost Track [warm].wav")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].source).toBeNull();
    expect(groups[0].name).toBe("Ghost Track");
    expect(groups[0].variants).toHaveLength(1);
  });

  it("does not regroup a plain library at all", () => {
    const entries = [e("a.wav"), e("b.mp3"), e("folder/c.m4a")];
    const groups = groupAudioEntries(entries);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.variants.length === 0)).toBe(true);
  });

  it("counts every entry exactly once", () => {
    const entries = [
      e("a.wav"),
      e("a [warm].wav"),
      e("b.wav"),
      e("orphan [x].wav"),
    ];
    expect(countGroupedEntries(groupAudioEntries(entries))).toBe(entries.length);
  });

  it("prefers the source's optionLabel for the heading when one was computed", () => {
    // Two tracks share a display name, so the store appends a [hash] suffix.
    // The group heading must carry it or the two groups become indistinguishable.
    const groups = groupAudioEntries([
      { filename: "Track.wav", optionLabel: "Track [1a2b3c4d]" },
      { filename: "other/Track.wav", optionLabel: "Track [9f8e7d6c]" },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Track [1a2b3c4d]", "Track [9f8e7d6c]"]);
  });
});
