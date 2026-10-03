/**
 * Friendly error copy for pipeline panels (plan 0.1 UI / "separation panel").
 *
 * Backend 500s wrap raw Python exceptions as `Separation failed: {e}` — that
 * string must never appear as the panel's visible state. Instead the panel
 * shows a fixed friendly headline and puts the raw message behind a
 * disclosure. Messages that are already human-readable are shown directly.
 */

export const SEPARATION_FAILED_HEADLINE = "Separation failed — see backend log";

export interface FriendlyError {
  headline: string;
  detail?: string;
}

const WRAPPED_PREFIX = /^Separation failed:\s*([\s\S]+)$/;

const RAW_EXCEPTION =
  /Traceback|AttributeError|TypeError|ValueError|RuntimeError|KeyError|IndexError|OSError|ImportError|ModuleNotFoundError|\bError\b|\bException\b|NoneType|object has no attribute|out of memory|Tried to allocate/i;

/**
 * Classify a raw error message for display.
 *
 * - `raw` null/empty → the fallback headline alone.
 * - `raw` is a wrapped backend exception (`Separation failed: <exc>`) or
 *   contains exception markers → fallback headline + original text as
 *   `detail` (render it behind a disclosure).
 * - otherwise the message is already friendly → shown directly as headline.
 */
export function friendlyPipelineError(
  raw: string | null | undefined,
  fallback: string,
): FriendlyError {
  if (!raw) return { headline: fallback };
  const trimmed = raw.trim();
  const wrapped = WRAPPED_PREFIX.exec(trimmed);
  const candidate = wrapped ? wrapped[1].trim() : trimmed;
  if (RAW_EXCEPTION.test(candidate)) {
    return { headline: fallback, detail: candidate };
  }
  return { headline: candidate };
}
