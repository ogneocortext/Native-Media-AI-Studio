import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSectionColors,
  getSectionIntensity,
  getSectionPreset,
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
  const [sectionPreset, setSectionPreset] = useState(presetId);
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

  const features = getTrackFeatures();

  // Track whether user has manually selected a preset
  const [userSelectedPreset, setUserSelectedPreset] = useState<string | null>(
    null,
  );

  // Update section preset only if user hasn't manually selected one
  useEffect(() => {
    if (!currentSection) return;
    // Only auto-switch if user hasn't manually selected a preset
    if (userSelectedPreset === null) {
      const newPreset = getSectionPreset(currentSection) || presetId;
      if (newPreset !== sectionPreset) {
        setSectionPreset(newPreset);
      }
    }
  }, [currentSection, presetId, userSelectedPreset, sectionPreset]);

  // When presetId changes from settings, mark as user-selected
  useEffect(() => {
    if (presetId) {
      setUserSelectedPreset(presetId);
      setSectionPreset(presetId);
    }
  }, [presetId]);

  const preset =
    kineticPresets[sectionPreset] ||
    kineticPresets[presetId] ||
    kineticPresets.cinematic;

  // Section transition animation
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;
    if (prevSectionRef.current !== currentSection && prevSectionRef.current) {
      const el = containerRef.current.querySelector(".kinetic-active-line");
      if (el) {
        animateSectionTransition(
          el as HTMLElement,
          prevSectionRef.current,
          currentSection,
        );
      }
    }
    prevSectionRef.current = currentSection;
  }, [currentSection, currentLine]);

  // Animate on line change with section-aware intensity
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;
    if (prevLineRef.current !== currentLine) {
      prevLineRef.current = currentLine;
      const el = containerRef.current.querySelector(".kinetic-active-line");
      if (el) {
        const intensity = getSectionIntensity(currentSection);
        (el as HTMLElement).style.setProperty(
          "--section-intensity",
          String(intensity),
        );
        preset.enterAnimation(el as HTMLElement);
      }
    }
  }, [currentLine, preset, currentSection]);

  // Beat animation with section-reactive intensity
  useEffect(() => {
    if (!beat || !containerRef.current) return;
    const el = containerRef.current.querySelector(".kinetic-active-line");
    if (el && preset.beatAnimation) {
      const intensity =
        0.4 + features.energy * 0.4 + getSectionIntensity(currentSection) * 0.2;
      (el as HTMLElement).style.setProperty(
        "--beat-intensity",
        String(intensity),
      );
      preset.beatAnimation(el as HTMLElement);
    }
  }, [beat, preset, features.energy, currentSection]);

  // Word-level beat synchronization
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;
    const words =
      currentLine.words && currentLine.words.length > 0
        ? currentLine.words
        : estimateWordTiming(
            currentLine.text,
            currentLine.start,
            currentLine.end,
          );

    const currentWordIdx = findCurrentWord(words, elapsed);
    const wordEls = wordElementsRef.current;

    if (wordEls.length > 0 && currentWordIdx >= 0) {
      animateWordsOnBeat(containerRef.current, wordEls, currentWordIdx);
    }
  }, [currentLine, elapsed]);

  // Phrase-change effect: pulse on line boundary (LRC precision)
  const phrasePulse = useMemo(() => {
    if (!currentLine) return false;
    // Use LRC sync data if available, otherwise fall back to elapsed time
    const isPhraseStart = lrcSync?.isPhraseStart ?? false;
    if (isPhraseStart) return true;
    const timeSinceLineStart = elapsed - currentLine.start;
    return timeSinceLineStart < 0.15; // Pulse in first 150ms of new line
  }, [currentLine, elapsed, lrcSync]);

  if (!visible || !currentLine) return null;

  // Enhanced color scheme with energy-reactive glow
  const colors = getSectionColors(currentLine.section);
  const brightness = 0.7 + features.brightness * 0.3;
  const energyBoost = features.energy * 0.2;

  // Render words (cap 20, split on whitespace, guards CJK/empty)
  const words = currentLine.text.split(/\s+/).filter(Boolean).slice(0, 20);

  return (
    <div
      className={`viz-lyrics viz-lyrics-enhanced ${preset.containerClass}`}
      ref={containerRef}
      data-section={currentSection}
      style={
        {
          "--section-glow": colors.glow,
          "--section-energy": colors.energy,
          "--phrase-pulse": phrasePulse ? "1" : "0",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        } as React.CSSProperties
      }
    >
      <div
        className="viz-lyrics-section"
        style={{
          color: colors.base,
          filter: `brightness(${brightness})`,
          textShadow: `0 0 ${10 + features.energy * 20}px ${colors.glow}`,
        }}
      >
        {currentLine.section}
      </div>
      <div
        className={`kinetic-active-line ${phrasePulse ? "phrase-pulse" : ""}`}
        style={{
          color: colors.base,
          filter: `brightness(${brightness + energyBoost})`,
          transform: `scale(${1 + features.onset * 0.12 + (phrasePulse ? 0.05 : 0)})`,
          transition: "transform 0.08s ease-out, filter 0.15s ease-out",
          textShadow: `0 0 ${8 + features.energy * 24}px ${colors.glow}, 0 0 ${16 + features.energy * 32}px ${colors.energy}`,
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
          <span
            key={idx}
            className="lyric-word-container"
            style={{ display: "inline-block" }}
          >
            <span className="lyric-word">{word}</span>
            {idx < words.length - 1 && <span className="lyric-space"> </span>}
          </span>
        ))}
      </div>
      {nextLine && (
        <div
          className="viz-lyrics-next"
          style={{
            color: colors.energy,
            opacity: 0.5 + features.brightness * 0.3,
          }}
        >
          {nextLine.text}
        </div>
      )}
    </div>
  );
}

export { selectPresetForTrack };
