import React, { useEffect, useMemo, useRef } from "react";
import { animate } from "animejs";
import {
  getSectionColors,
  getSectionIntensity,
} from "../sectionHelpers";
import { getTrackFeatures } from "../trackFeatures";
import {
  animateSectionTransition,
  animateWordsOnBeat,
  estimateWordTiming,
  findCurrentWord,
  kineticPresets,
  selectPresetForTrack,
} from "./KineticPresets";
import type { LyricLine } from "./LyricOverlay";

interface Props {
  lyrics: LyricLine[];
  elapsed: number;
  visible: boolean;
  presetId: string;
  beat?: boolean;
  /** Enhanced LRC sync data for precise visual synchronization */
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
    timeToNextPhrase: number;
  } | null;
}

export function KineticLyricOverlay({
  lyrics,
  elapsed,
  visible,
  presetId,
  beat,
  lrcSync,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLineRef = useRef<LyricLine | null>(null);
  const prevSectionRef = useRef<string>("");
  const wordElementsRef = useRef<HTMLElement[]>([]);

  // Use binary search via lrcSync if available, else O(log n) local; avoid O(n) findIndex per frame
  const { currentLine, nextLine, currentSection } = useMemo(() => {
    if (!lyrics.length) return { currentLine: null, nextLine: null, currentSection: "VERSE" };
    let lo = 0, hi = lyrics.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const l = lyrics[mid];
      if (elapsed < l.start) hi = mid - 1;
      else if (elapsed >= l.end) lo = mid + 1;
      else { found = mid; break; }
    }
    if (found === -1) return { currentLine: null, nextLine: lyrics[lo] || null, currentSection: lyrics[lo]?.section || "VERSE" };
    const line = lyrics[found];
    return { currentLine: line, nextLine: lyrics[found + 1] || null, currentSection: line.section };
  }, [lyrics, elapsed]);

  // Keep overlay visible during *short* gaps — show next line dimmed only if
  // it's imminent (≤1.8s). Before first line or long instrumentals, stay blank
  // instead of flashing the next lyric 4s early.
  const gapIsImminent = !currentLine && !!nextLine && nextLine.start - elapsed < 1.8;
  const displayLine = currentLine ?? (gapIsImminent ? nextLine : null);
  const isGapPreview = !currentLine && !!displayLine;

  const features = getTrackFeatures();

  // Preset is now stable per track — the previous per-section auto-switch
  // (VERSE→cinematic, CHORUS→dubstep, etc.) was the primary source of
  // "incredibly buggy" flicker, as the entire animation preset would snap
  // mid-song. Section-derived colors/intensity still vary via getSectionColors.
  const preset =
    kineticPresets[presetId] ||
    kineticPresets.cinematic;

  // Track animation handles so overlapping triggers don't stack and cause jank.
  const lineAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const beatAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const prevWordIdxRef = useRef<number>(-1);

  // Section transition animation — only when the *displayed* section actually changes.
  useEffect(() => {
    const activeSection = displayLine?.section || currentSection;
    if (!displayLine || !containerRef.current) return;
    if (prevSectionRef.current !== activeSection && prevSectionRef.current) {
      const el = containerRef.current.querySelector(".kinetic-active-line");
      if (el) {
        try { lineAnimRef.current?.pause(); } catch {}
        animateSectionTransition(el as HTMLElement, activeSection);
      }
    }
    prevSectionRef.current = activeSection;
  }, [displayLine, currentSection]);

  // Animate on line change with section-aware intensity — single source (displayLine).
  useEffect(() => {
    if (!displayLine || !containerRef.current) return;
    if (prevLineRef.current !== displayLine) {
      prevLineRef.current = displayLine;
      prevWordIdxRef.current = -1;
      const el = containerRef.current.querySelector(".kinetic-active-line");
      if (el) {
        const intensity = getSectionIntensity(displayLine.section);
        (el as HTMLElement).style.setProperty("--section-intensity", String(intensity));
        try { lineAnimRef.current?.pause(); } catch {}
        // `animate` returns a JSAnimatable; keep handle so beat/section don't pile up.
        // Cast to any — animejs v4 types are loose.
        lineAnimRef.current = preset.enterAnimation(el as HTMLElement) as any;
      }
    }
  }, [displayLine, preset]);

  // Beat animation with section-reactive intensity — throttled by the `beat` flag
  // which already arrives decayed (u_beat style: ~8-frame tail), so we don't
  // fire every rAF, only on actual beats.
  useEffect(() => {
    if (!beat || !displayLine || !containerRef.current || isGapPreview) return;
    const el = containerRef.current.querySelector(".kinetic-active-line");
    if (el && preset.beatAnimation) {
      const intensity = 0.4 + features.energy * 0.4 + getSectionIntensity(displayLine!.section) * 0.2;
      (el as HTMLElement).style.setProperty("--beat-intensity", String(intensity));
      try { beatAnimRef.current?.pause(); } catch {}
      beatAnimRef.current = preset.beatAnimation(el as HTMLElement) as any;
    }
  }, [beat, preset, features.energy, displayLine, isGapPreview]);

  // Word-level synchronization — only when the *word index* actually changes,
  // not on every elapsed tick (20fps → would otherwise re-animate 20×/sec).
  useEffect(() => {
    if (!displayLine || isGapPreview || !containerRef.current) return;
    const dl = displayLine!;
    const words =
      dl.words && dl.words.length > 0
        ? dl.words
        : estimateWordTiming(dl.text, dl.start, dl.end);
    const currentWordIdx = findCurrentWord(words, elapsed);
    if (currentWordIdx < 0 || currentWordIdx === prevWordIdxRef.current) return;
    prevWordIdxRef.current = currentWordIdx;
    const wordEls = wordElementsRef.current;
    if (wordEls.length > 0) {
      animateWordsOnBeat(containerRef.current, wordEls, currentWordIdx);
    }
  }, [displayLine, elapsed, isGapPreview]);

  // Phrase-change effect: pulse on line boundary (LRC precision)
  const phrasePulse = useMemo(() => {
    if (!currentLine) return false;
    // Use LRC sync data if available, otherwise fall back to elapsed time
    const isPhraseStart = lrcSync?.isPhraseStart ?? false;
    if (isPhraseStart) return true;
    const timeSinceLineStart = elapsed - currentLine.start;
    return timeSinceLineStart < 0.15; // Pulse in first 150ms of new line
  }, [currentLine, elapsed, lrcSync]);

  if (!visible || !displayLine) return null;

  // Enhanced color scheme with energy-reactive glow — uses displayLine so
  // gap previews still get a sensible palette instead of crashing on null.
  const colors = getSectionColors(displayLine.section);
  const brightness = 0.7 + features.brightness * 0.3;

  // Render words (cap 20, split on whitespace, guards CJK/empty)
  const words = displayLine.text.split(/\s+/).filter(Boolean).slice(0, 20);

  // During gaps the active line is the upcoming one — render it dimmed so the
  // overlay never fully vanishes. Otherwise keep the normal next-line preview
  // below the current line.
  const nextLineToShow = isGapPreview ? null : nextLine;

  // 2026 premium layout: lower-third, cinematic, backdrop for readability over busy visuals
  return (
    <div
      className={`viz-lyrics viz-lyrics-enhanced ${preset.containerClass} ${isGapPreview ? "viz-lyrics-gap" : ""}`}
      ref={containerRef}
      data-section={displayLine.section}
      style={
        {
          "--section-glow": colors.glow,
          "--section-energy": colors.energy,
          "--phrase-pulse": phrasePulse ? "1" : "0",
          position: "absolute",
          bottom: "14%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "92%",
          maxWidth: 860,
          textAlign: "center" as const,
          padding: "14px 18px",
          background: "rgba(8,8,12,0.32)",
          backdropFilter: "blur(10px)",
          borderRadius: 14,
          border: `1px solid ${colors.glow}18`,
          boxShadow: `0 8px 32px rgba(0,0,0,0.45), 0 0 ${16 + features.energy * 24}px ${colors.glow}08`,
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          opacity: isGapPreview ? 0.58 : 1,
        } as React.CSSProperties
      }
    >
      <div
        className="viz-lyrics-section"
        style={{
          color: colors.base,
          fontSize: "0.62rem",
          fontWeight: 800,
          letterSpacing: "0.22em",
          textTransform: "uppercase" as const,
          opacity: 0.72,
          marginBottom: 6,
          filter: `brightness(${brightness})`,
          textShadow: `0 0 ${10 + features.energy * 20}px ${colors.glow}`,
        }}
      >
        {displayLine.section}
        {isGapPreview && <span style={{ marginLeft: 8, opacity: 0.55, fontSize: "0.7em", letterSpacing: "0.12em" }}>NEXT</span>}
      </div>
      <div
        className={`kinetic-active-line ${phrasePulse ? "phrase-pulse" : ""} ${isGapPreview ? "gap-preview" : ""}`}
        style={{
          color: "#f1f5f9",
          fontSize: "1.65rem",
          fontWeight: 750,
          lineHeight: 1.25,
          letterSpacing: "-0.02em",
          filter: `brightness(${isGapPreview ? 0.92 : 1})`,
          transform: `scale(${1 + features.onset * 0.08 + (phrasePulse ? 0.03 : 0)})`,
          transition: "transform 0.12s ease-out, filter 0.18s ease-out",
          textShadow: `0 2px 16px rgba(0,0,0,0.85), 0 0 ${10 + features.energy * 20}px ${colors.glow}, 0 0 ${20 + features.energy * 28}px ${colors.energy}40`,
        }}
        ref={(el) => {
          if (el) {
            // Cache word elements for word-level animation
            wordElementsRef.current = Array.from(
              el.querySelectorAll(".lyric-word"),
            );
          }
        }}
      >
        {words.map((word, idx) => (
          <React.Fragment key={idx}>
            <span className="lyric-word-container" style={{ display: "inline-block" }}>
              <span className="lyric-word">{word}</span>
            </span>
            {idx < words.length - 1 && <span style={{ display: "inline-block", width: "0.32em" }} aria-hidden="true"> </span>}
          </React.Fragment>
        ))}
      </div>
      {nextLineToShow && (
        <div
          className="viz-lyrics-next"
          style={{
            color: "#cbd5e1",
            fontSize: "0.78rem",
            fontWeight: 450,
            letterSpacing: "0.02em",
            marginTop: 8,
            opacity: 0.38 + features.brightness * 0.14,
            fontStyle: "italic" as const,
            lineHeight: 1.3,
          }}
        >
          {nextLineToShow.text}
        </div>
      )}
    </div>
  );
}

export { selectPresetForTrack };
