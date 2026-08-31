import { useMemo, useRef, useEffect } from "react";
import type { LyricLine } from "./LyricOverlay";
import { kineticPresets, selectPresetForTrack } from "./KineticPresets";

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

  // Animate on line change
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;
    if (prevLineRef.current !== currentLine) {
      prevLineRef.current = currentLine;
      const el = containerRef.current.querySelector(".kinetic-active-line");
      if (el) preset.enterAnimation(el as HTMLElement);
    }
  }, [currentLine, preset]);

  // Beat animation
  useEffect(() => {
    if (!beat || !containerRef.current) return;
    const el = containerRef.current.querySelector(".kinetic-active-line");
    if (el && preset.beatAnimation) {
      preset.beatAnimation(el as HTMLElement);
    }
  }, [beat, preset]);

  if (!visible || !currentLine) return null;

  const sectionColors: Record<string, string> = {
    INTRO: "#818cf8",
    VERSE: "#60a5fa",
    CHORUS: "#c084fc",
    BRIDGE: "#f59e0b",
    "FINAL CHORUS": "#f472b6",
  };
  const color = sectionColors[currentLine.section] || "#a5b4fc";

  return (
    <div className={`viz-lyrics ${preset.containerClass}`} ref={containerRef}>
      <div className="viz-lyrics-section" style={{ color }}>{currentLine.section}</div>
      <div className="kinetic-active-line" style={{ color }}>
        {currentLine.text}
      </div>
      {nextLine && (
        <div className="viz-lyrics-next">{nextLine.text}</div>
      )}
    </div>
  );
}

export { selectPresetForTrack };
