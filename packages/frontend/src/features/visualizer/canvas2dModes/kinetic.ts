/**
 * canvas2dModes/kinetic — see index.ts for the module map.
 */
import { clamp, makeFreqMapper, sampleMappedBand, withAlpha } from "../canvas2dHelpers";
import type { BarModeContext, BarModeState } from "./types";

/**
 * Kinetic Typography (T-VIZ-21) — the lyric line IS the scene.
 *
 * Deadpan register per the mode-research spec: restrained palette, no bouncy
 * easing, minimal reactive ground (a thin mirrored spectrum baseline). The
 * current line enters on its LRC start (scale+fade over the first ~12% of the
 * line), exits by decay over the last ~10%, and hook sections (CHORUS/DROP)
 * get a slightly larger cut with a beat-phase pulse. Word-level LRC reveals
 * the current word; instrumental passages fall back to a section card so the
 * mode never sits empty. `motionScale` (reduced-motion) collapses all
 * choreography to fades.
 */
export function renderKineticType(
  dpr: number,
  w: number,
  h: number,
  modeCtx: BarModeContext,
  state: BarModeState,
): void {
  const {
    ctx,
    bg,
    colors,
    freq,
    lyric,
    lyricProgress = 0,
    sectionName,
    motionScale,
    beatEnv,
    energyMod,
    nowMs,
    perceptualScale,
  } = modeCtx;
  const d = modeCtx.d;
  const vocalEnergy = ((d.mid ?? 0) + d.treble) / 2;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // ── Minimal reactive ground: thin mirrored spectrum baseline ──────────
  // 2026: perceptual mapper + single-bin samples (was a linear i*step bin
  // walk that ignored perceptualScale), plus a beatEnv lift so the ground
  // moves on the beat grid even mid-verse.
  const groundY = h * 0.8;
  const bars = 48;
  const barW = w / bars;
  ctx.fillStyle = withAlpha(colors[1], "33");
  if (freq) {
    const freqMap = makeFreqMapper(
      perceptualScale,
      bars,
      freq.length,
      modeCtx.analyser?.context.sampleRate,
    );
    const groundLift = 0.5 + vocalEnergy + (beatEnv ?? 0) * 0.5;
    for (let i = 0; i < bars; i++) {
      const v = (sampleMappedBand(freq, freqMap, i) / 255) * h * 0.06 * groundLift;
      if (v > 0.5) ctx.fillRect(i * barW + 1, groundY - v, barW - 2, v);
    }
  }
  ctx.fillStyle = withAlpha(colors[1], "55");
  ctx.fillRect(0, groundY, w, Math.max(1, dpr));

  const isHook = sectionName === "CHORUS" || sectionName === "DROP" || sectionName === "PRE-CHORUS";
  const beatPulse = (beatEnv ?? 0) * 0.02 * motionScale;

  // ── Instrumental fallback: section card, never an empty frame ─────────
  if (!lyric) {
    const label = (sectionName ?? "").toLowerCase();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 2026: the card used to sit perfectly static for whole instrumental
    // passages (the scored "dead mode" capture). Slow breathe + beat-grid
    // lift + a few px of drift keep it alive without breaking the
    // deadpan register; motionScale still collapses it under
    // prefers-reduced-motion.
    const idleT = nowMs() * 0.001 * motionScale;
    const idlePulse =
      0.72 +
      0.18 * Math.sin(idleT * 0.9) +
      0.18 * Math.sin(idleT * 0.37 + 1.7) +
      (beatEnv ?? 0) * 0.35 * motionScale;
    const driftY = Math.sin(idleT * 0.5) * h * 0.006 * motionScale;
    ctx.globalAlpha = clamp(idlePulse, 0.3, 1);
    ctx.fillStyle = withAlpha(colors[0], "aa");
    ctx.font = `600 ${Math.round(h * 0.045 * dpr)}px system-ui, sans-serif`;
    const card = label ? label.toUpperCase() : "INSTRUMENTAL";
    ctx.fillText(card, w / 2, h * 0.42 + driftY);
    ctx.globalAlpha = clamp(idlePulse * 0.85, 0.15, 1);
    ctx.fillStyle = withAlpha(colors[1], "66");
    ctx.font = `500 ${Math.round(h * 0.02 * dpr)}px system-ui, sans-serif`;
    ctx.fillText("— instrumental —", w / 2, h * 0.42 + h * 0.07 * dpr + driftY);
    ctx.globalAlpha = 1;
    return;
  }

  // ── Entry / exit envelopes (fractions of the line's own duration) ──────
  const entryT = Math.min(1, lyricProgress / 0.12);
  const exitT = lyricProgress > 0.9 ? (lyricProgress - 0.9) / 0.1 : 0;
  const ease = 1 - Math.pow(1 - entryT, 3);
  const entryScale = 0.94 + 0.06 * ease * motionScale + beatPulse;
  const alpha =
    (0.35 + 0.65 * ease) * (1 - exitT * 0.6 * motionScale) * Math.min(1, 0.4 + energyMod * 0.6);

  // ── Word-level timing: approximate audio position inside the line ──────
  const lineDur = Math.max(0.001, lyric.end - lyric.start);
  const approxTime = lyric.start + lyricProgress * lineDur;
  const words = lyric.words ?? [];
  const useWords = words.length > 0;

  // ── Layout: wrap to lines, then draw centred ───────────────────────────
  const maxW = w * 0.86;
  const baseSize = Math.round(clamp(Math.min(w / 15, h / 6.5), 26, 92) * dpr * (isHook ? 1.08 : 1));
  ctx.font = `${isHook ? 700 : 600} ${baseSize}px system-ui, sans-serif`;

  // Word-wrap preserving per-word identity for highlight.
  const units = useWords
    ? words.map((wd) => ({ text: wd.word, start: wd.start, end: wd.end }))
    : lyric.text
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => ({ text: t }));

  // 2026: full layout cache — word-wrap AND per-word widths were re-measured
  // every frame (~40+ canvas measureText calls/frame). Everything the layout
  // depends on (lyric line, timing, canvas size, dpr, font metrics, hook
  // weight) is captured in cacheKey, so a lyric line pays the measure cost
  // exactly once.
  const cacheKey = `${lyric.start}|${lyric.end}|${lyric.text}|${w}x${h}x${dpr}|${baseSize}|${isHook ? 1 : 0}`;
  let layout = state.kineticLayout;
  if (layout?.key !== cacheKey) {
    const wrapped: { words: { text: string; start?: number; end?: number }[] }[] = [];
    let cur: typeof units = [];
    let curW = 0;
    for (const u of units) {
      const uw = ctx.measureText(u.text + " ").width;
      if (curW + uw > maxW && cur.length > 0) {
        wrapped.push({ words: cur });
        cur = [];
        curW = 0;
      }
      cur.push(u);
      curW += uw;
    }
    if (cur.length) wrapped.push({ words: cur });
    const spaceW = ctx.measureText(" ").width;
    layout = {
      key: cacheKey,
      spaceW,
      lines: wrapped.map((ln) => {
        const widths = ln.words.map((wd) => ctx.measureText(wd.text).width);
        const fullW = widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, ln.words.length - 1);
        return { words: ln.words, widths, fullW };
      }),
    };
    state.kineticLayout = layout;
  }
  const lay = layout;
  const lineH = baseSize * 1.22;
  const blockH = lay.lines.length * lineH;
  const top = h * 0.5 - blockH / 2 + lineH * 0.5;

  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(w / 2, top);
  ctx.scale(entryScale * (1 + vocalEnergy * 0.02 * motionScale), entryScale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  lay.lines.forEach((ln, li) => {
    const y = li * lineH - blockH / 2 + lineH / 2;
    let x = -ln.fullW / 2;
    ln.words.forEach((wd, wi) => {
      const ww = ln.widths[wi];
      let fill = colors[0];
      let wordAlpha = 1;
      if (useWords && wd.start !== undefined && wd.end !== undefined) {
        if (approxTime < wd.start) {
          wordAlpha = 0.45; // sung — recede (deadpan: no bounce, just dim)
        } else if (approxTime < wd.end) {
          fill = colors[1]; // current word lifts
        } else {
          wordAlpha = 0.8;
        }
      }
      ctx.globalAlpha = clamp(alpha * wordAlpha, 0, 1);
      ctx.fillStyle = fill;
      ctx.fillText(wd.text, x + ww / 2, y);
      x += ww + lay.spaceW;
    });
  });
  ctx.restore();
}
