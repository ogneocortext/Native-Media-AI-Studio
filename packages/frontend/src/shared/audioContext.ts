/**
 * App-wide shared AudioContext.
 *
 * Browsers cap concurrent AudioContexts (~6 per domain in Chromium), and each
 * `new AudioContext()` also costs a real-time audio thread. Features that only
 * need decode/analyse/playback (beat detection, probing, preview mixers)
 * should share this singleton instead of constructing their own.
 *
 * Ownership rules:
 * - The visualizer's `useAudioGraph` keeps its own context: it owns a full
 *   node graph (analyser/EQ/gain) and legitimately closes/rebuilds it on
 *   unmount. Do not route it through here.
 * - Consumers of this singleton must NEVER call `close()` on it — it lives
 *   for the page lifetime. `getSharedAudioContext()` transparently recreates
 *   it if something else closed it.
 * - The context may start `suspended` (autoplay policy); decode/analyse work
 *   fine suspended, and `resumeSharedAudioContext()` handles playback paths.
 */

let sharedCtx: AudioContext | null = null;

function createContext(): AudioContext {
  const Ctor =
    (window.AudioContext as typeof AudioContext | undefined) ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API is not supported in this browser");
  return new Ctor({ renderSizeHint: "hardware" } as AudioContextOptions);
}

/** Return the shared context, creating or recreating it as needed. */
export function getSharedAudioContext(): AudioContext {
  if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
  sharedCtx = createContext();
  return sharedCtx;
}

/**
 * Return the shared context and resume it if the autoplay policy suspended
 * it. Use on user-gesture playback paths; decode-only callers can use
 * `getSharedAudioContext()` directly.
 */
export async function resumeSharedAudioContext(): Promise<AudioContext> {
  const ctx = getSharedAudioContext();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* ignore — caller's play() will surface real errors */
    }
  }
  return ctx;
}
