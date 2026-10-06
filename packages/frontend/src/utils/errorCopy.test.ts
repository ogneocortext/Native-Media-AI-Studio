import { describe, expect, it } from "vitest";

import {
  SEPARATION_FAILED_HEADLINE,
  friendlyPipelineError,
} from "./errorCopy";

describe("friendlyPipelineError", () => {
  it("returns the fallback headline for empty input", () => {
    expect(friendlyPipelineError(null, SEPARATION_FAILED_HEADLINE)).toEqual({
      headline: SEPARATION_FAILED_HEADLINE,
    });
    expect(friendlyPipelineError(undefined, SEPARATION_FAILED_HEADLINE)).toEqual({
      headline: SEPARATION_FAILED_HEADLINE,
    });
    expect(friendlyPipelineError("", SEPARATION_FAILED_HEADLINE)).toEqual({
      headline: SEPARATION_FAILED_HEADLINE,
    });
  });

  it("unwraps a backend 'Separation failed: <exc>' into headline + detail", () => {
    const raw = "Separation failed: 'NoneType' object has no attribute 'x'";
    const out = friendlyPipelineError(raw, SEPARATION_FAILED_HEADLINE);
    expect(out.headline).toBe(SEPARATION_FAILED_HEADLINE);
    expect(out.detail).toBe("'NoneType' object has no attribute 'x'");
  });

  it("routes a raw Python exception to detail without the wrapped prefix", () => {
    const raw = "Separation failed: CUDA out of memory. Tried to allocate 2.00 GiB";
    const out = friendlyPipelineError(raw, SEPARATION_FAILED_HEADLINE);
    expect(out.headline).toBe(SEPARATION_FAILED_HEADLINE);
    expect(out.detail).toBe("CUDA out of memory. Tried to allocate 2.00 GiB");
  });

  it("routes exception-marker messages to detail", () => {
    const out = friendlyPipelineError("TypeError: Failed to fetch", SEPARATION_FAILED_HEADLINE);
    expect(out.headline).toBe(SEPARATION_FAILED_HEADLINE);
    expect(out.detail).toBe("TypeError: Failed to fetch");
  });

  it("shows already-friendly backend messages directly", () => {
    const friendly = "Unknown model: mdx. Choose: mdx_extra_q, htdemucs";
    expect(friendlyPipelineError(friendly, SEPARATION_FAILED_HEADLINE)).toEqual({
      headline: friendly,
    });
    const loadMsg = "No stems could be loaded — check server logs";
    expect(friendlyPipelineError(loadMsg, SEPARATION_FAILED_HEADLINE)).toEqual({
      headline: loadMsg,
    });
    const notReadable = "Separation finished but stems are not readable yet — retry in a moment";
    expect(friendlyPipelineError(notReadable, SEPARATION_FAILED_HEADLINE)).toEqual({
      headline: notReadable,
    });
  });
});
