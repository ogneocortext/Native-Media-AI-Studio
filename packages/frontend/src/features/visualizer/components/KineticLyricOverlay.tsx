import { useMemo, useRef, useEffect } from "react";
import type { LyricLine } from "./LyricOverlay";
import { kineticPresets, selectPresetForTrack } from "./KineticPresets";
import { getTrackFeatures } from "../trackFeatures";

interface Props {
  lyrics: LyricLine[];
  elapsed: number;
  visible: boolean;
  presetId: string;
  beat?: boolean;
}

export function KineticLyricOverlay({ lyrics, elapsed, visible, presetId, beat }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLineRef = useRef<LyricLine | null>(null);

  const { currentLine, nextLine } = useMemo(() => {
    if (!lyrics.length) return { currentLine: null, nextLine: null };
    const idx = lyrics.findIndex(l => elapsed >= l.start && elapsed < l.end);
    if (idx < 0) return { currentLine: null, nextLine: null };
    const line = lyrics[idx];
    return { currentLine: line, nextLine: lyrics[idx + 1] || null };
  }, [lyrics, elapsed]);

  const preset = kineticPresets[presetId] || kineticPresets.cinematic;

  // Get rich audio features for dynamic animations
  const features = getTrackFeatures();

  // Animate on line change
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;
    if (prevLineRef.current !== currentLine) {
      prevLineRef.current = currentLine;
      const el = containerRef.current.querySelector(".kinetic-active-line");
      if (el) preset.enterAnimation(el as HTMLElement);
    }
  }, [currentLine, preset]);

  // Beat animation - now with energy intensity
  useEffect(() => {
    if (!beat || !containerRef.current) return;
    const el = containerRef.current.querySelector(".kinetic-active-line");
    if (el && preset.beatAnimation) {
      // Scale animation intensity by energy
      const intensity = 0.5 + features.energy * 0.5;
      (el as HTMLElement).style.setProperty("--beat-intensity", String(intensity));
      preset.beatAnimation(el as HTMLElement);
    }
  }, [beat, preset, features.energy]);

  if (!visible || !currentLine) return null;

  // Dynamic color based on section and energy
  const sectionColors: Record<string, string> = {
    INTRO: "#818cf8",
    VERSE: "#60a5fa",
    CHORUS: "#c084fc",
    BRIDGE: "#f59e0b",
    "FINAL CHORUS": "#f472b6",
  };
  const baseColor = sectionColors[currentLine.section] || "#a5b4fc";
  
  // Adjust brightness based on spectral features
  const brightness = 0.7 + features.brightness * 0.3;

  return (
    <div className={`viz-lyrics ${preset.containerClass}`} ref={containerRef}>
      <div className="viz-lyrics-section" style={{ color: baseColor, filter: `brightness(${brightness})` }}>{currentLine.section}</div>
      <div
        className="kinetic-active-line"
        style={{
          color: baseColor,
          filter: `brightness(${brightness})`,
          transform: `scale(${1 + features.onset * 0.1})`,
          transition: "transform 0.1s ease-out",
        }}
      >
        {currentLine.text}
      </div>
      {nextLine && (
        <div className="viz-lyrics-next">{nextLine.text}</div>
      )}
    </div>
  );
}

export { selectPresetForTrack };
