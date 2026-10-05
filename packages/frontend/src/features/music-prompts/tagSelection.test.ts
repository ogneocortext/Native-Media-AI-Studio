import { describe, it, expect } from "vitest";
import {
  MAX_SELECTED_TAGS,
  tagStringFor,
  toggleTag,
  unfilledRelated,
} from "./tagSelection";

describe("toggleTag", () => {
  it("adds a tag", () => {
    expect(toggleTag([], "phonk")).toEqual(["phonk"]);
  });

  it("removes a tag that is already selected", () => {
    expect(toggleTag(["phonk", "trap"], "phonk")).toEqual(["trap"]);
  });

  it("is case-insensitive, so the same tag cannot land twice", () => {
    // Search is case-insensitive, so typing "Phonk" and clicking "phonk" must not
    // produce two entries.
    expect(toggleTag(["Phonk"], "phonk")).toEqual([]);
  });

  it("keeps the first spelling entered", () => {
    expect(toggleTag(["R&B"], "phonk")).toEqual(["R&B", "phonk"]);
  });

  it("preserves selection order", () => {
    let sel: string[] = [];
    for (const t of ["a", "b", "c"]) sel = toggleTag(sel, t);
    expect(sel).toEqual(["a", "b", "c"]);
  });

  it("ignores blank tags", () => {
    expect(toggleTag(["phonk"], "   ")).toEqual(["phonk"]);
  });

  it("refuses to grow past the cap but still allows removal", () => {
    const full = Array.from({ length: MAX_SELECTED_TAGS }, (_, i) => `t${i}`);
    expect(toggleTag(full, "one more")).toHaveLength(MAX_SELECTED_TAGS);
    expect(toggleTag(full, "t0")).toHaveLength(MAX_SELECTED_TAGS - 1);
  });

  it("does not mutate the input", () => {
    const before = ["phonk"];
    toggleTag(before, "trap");
    expect(before).toEqual(["phonk"]);
  });
});

describe("tagStringFor", () => {
  it("joins in selection order", () => {
    expect(tagStringFor(["drift phonk", "phonk", "dark", "aggressive"])).toBe(
      "drift phonk, phonk, dark, aggressive",
    );
  });

  it("is the exact string the spec's acceptance describes", () => {
    expect(tagStringFor(["drift phonk", "phonk", "dark", "aggressive"])).toBe(
      "drift phonk, phonk, dark, aggressive",
    );
  });

  it("is empty for an empty selection", () => {
    expect(tagStringFor([])).toBe("");
  });

  it("drops blanks and trims", () => {
    expect(tagStringFor(["  phonk ", "", "   "])).toBe("phonk");
  });
});

describe("unfilledRelated", () => {
  it("offers only tags not already selected", () => {
    expect(unfilledRelated(["phonk"], ["memphis rap", "trap", "phonk"])).toEqual([
      "memphis rap",
      "trap",
    ]);
  });

  it("compares case-insensitively", () => {
    expect(unfilledRelated(["Phonk"], ["phonk", "trap"])).toEqual(["trap"]);
  });

  it("is empty when everything related is already chosen", () => {
    expect(unfilledRelated(["trap"], ["trap"])).toEqual([]);
  });
});
