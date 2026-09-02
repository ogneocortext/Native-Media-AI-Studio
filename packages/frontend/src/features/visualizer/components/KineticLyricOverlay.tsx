import { useMemo, useRef, useEffect, useState } from "react";
import type { LyricLine } from "./LyricOverlay";
import { kineticPresets, selectPresetForTrack } from "./KineticPresets";
import { getTrackFeatures } from "../trackFeatures";

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

// Section-driven preset mapping for automatic visual intensity changes
const SECTION_PRESET_MAP: Record<string, string> = {
  INTRO: "ambient",
  VERSE: "cinematic",
  "PRE-CHORUS": "synthwave",
  CHORUS: "dubstep",
  BRIDGE: "gfunk",
  BREAKDOWN: "ambient",
  "BUILD-UP": "synthwave",
  DROP: "dubstep",
  "FINAL CHORUS": "phonk",
  OUTRO: "lofi",
};

// Enhanced color palette with energy-aware gradients
const SECTION_COLORS: Record<string, { base: string; glow: string; energy: string }> = {
  INTRO: { base: "#818cf8", glow: "#6366f1", energy: "#a5b4fc" },
  VERSE: { base: "#60a5fa", glow: "#3b82f6", energy: "#93c5fd" },
  "PRE-CHORUS": { base: "#c084fc", glow: "#a855f7", energy: "#d8b4fe" },
  CHORUS: { base: "#f472b6", glow: "#ec4899", energy: "#f9a8d4" },
  BRIDGE: { base: "#f59e0b", glow: "#d97706", energy: "#fcd34d" },
  BREAKDOWN: { base: "#34d399", glow: "#10b981", energy: "#6ee7b7" },
  "BUILD-UP": { base: "#fb923c", glow: "#f97316", energy: "#fdba74" },
  DROP: { base: "#ef4444", glow: "#dc2626", energy: "#fca5a5" },
  "FINAL CHORUS": { base: "#e879f9", glow: "#d946ef", energy: "#f0abfc" },
  OUTRO: { base: "#94a3b8", glow: "#64748b", energy: "#cbd5e1" },
};

export function KineticLyricOverlay({ lyrics, elapsed, visible, presetId, beat }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLineRef = useRef<LyricLine | null>(null);
  const [sectionPreset, setSectionPreset] = useState(presetId);

  const { currentLine, nextLine, currentSection } = useMemo(() => {
    if (!lyrics.length) return { currentLine: null, nextLine: null, currentSection: "VERSE" };
    const idx = lyrics.findIndex(l => elapsed >= l.start && elapsed < l.end);
    if (idx < 0) return { currentLine: null, nextLine: null, currentSection: "VERSE" };
    const line = lyrics[idx];
    return { currentLine: line, nextLine: lyrics[idx + 1] || null, currentSection: line.section };
  }, [lyrics, elapsed]);

  const features = getTrackFeatures();

  // Auto-switch preset based on LRC section markers
  useEffect(() => {
    if (!currentSection) return;
    const newPreset = SECTION_PRESET_MAP[currentSection] || presetId;
    if (newPreset !== sectionPreset) {
      setSectionPreset(newPreset);
    }
  }, [currentSection, presetId]);

  const preset = kineticPresets[sectionPreset] || kineticPresets[presetId] || kineticPresets.cinematic;

  // Animate on line change with section-aware intensity
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;
    if (prevLineRef.current !== currentLine) {
      prevLineRef.current = currentLine;
      const el = containerRef.current.querySelector(".kinetic-active-line");
      if (el) {
        // Enhanced enter animation with section-based intensity
        const intensity = getSectionIntensity(currentSection);
        (el as HTMLElement).style.setProperty("--section-intensity", String(intensity));
        preset.enterAnimation(el as HTMLElement);
      }
    }
  }, [currentLine, preset, currentSection]);

  // Beat animation with section-reactive intensity
  useEffect(() => {
    if (!beat || !containerRef.current) return;
    const el = containerRef.current.querySelector(".kinetic-active-line");
    if (el && preset.beatAnimation) {
      const intensity = 0.4 + features.energy * 0.4 + getSectionIntensity(currentSection) * 0.2;
      (el as HTMLElement).style.setProperty("--beat-intensity", String(intensity));
      preset.beatAnimation(el as HTMLElement);
    }
  }, [beat, preset, features.energy, currentSection]);

  // Phrase-change effect: pulse on line boundary (LRC precision)
  const phrasePulse = useMemo(() => {
    if (!currentLine) return false;
    const timeSinceLineStart = elapsed - currentLine.start;
    return timeSinceLineStart < 0.15; // Pulse in first 150ms of new line
  }, [currentLine, elapsed]);

  if (!visible || !currentLine) return null;

  // Enhanced color scheme with energy-reactive glow
  const colors = SECTION_COLORS[currentLine.section] || SECTION_COLORS.VERSE;
  const brightness = 0.7 + features.brightness * 0.3;
  const energyBoost = features.energy * 0.2;

  return (
    <div
      className={`viz-lyrics viz-lyrics-enhanced ${preset.containerClass}`}
      ref={containerRef}
      data-section={currentSection}
      style={{
        "--section-glow": colors.glow,
        "--section-energy": colors.energy,
        "--phrase-pulse": phrasePulse ? "1" : "0",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      } as React.CSSProperties}
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
      >
        {currentLine.text}
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

// Helper: get visual intensity based on section type
function getSectionIntensity(section: string): number {
  const intensityMap: Record<string, number> = {
    INTRO: 0.3,
    VERSE: 0.5,
    "PRE-CHORUS": 0.6,
    CHORUS: 0.9,
    BRIDGE: 0.6,
    BREAKDOWN: 0.4,
    "BUILD-UP": 0.7,
    DROP: 1.0,
    "FINAL CHORUS": 0.95,
    OUTRO: 0.3,
  };
  return intensityMap[section] ?? 0.5;
}

export { selectPresetForTrack };
