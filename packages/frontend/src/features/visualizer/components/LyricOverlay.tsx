import { useMemo } from "react";
import { kineticTemplates, type KineticTemplateId } from "./KineticTemplates";

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  section: string;
}

interface Props {
  lyrics: LyricLine[];
  elapsed: number;
  visible: boolean;
  template?: KineticTemplateId;
  beat?: boolean;
}

export function LyricOverlay({ lyrics, elapsed, visible, template = "fadeReveal", beat }: Props) {
  const { currentLine, nextLine, progress } = useMemo(() => {
    if (!lyrics.length) return { currentLine: null, nextLine: null, progress: 0 };
    const idx = lyrics.findIndex(l => elapsed >= l.start && elapsed < l.end);
    if (idx < 0) return { currentLine: null, nextLine: null, progress: 0 };
    const line = lyrics[idx];
    const prog = (elapsed - line.start) / (line.end - line.start);
    return { currentLine: line, nextLine: lyrics[idx + 1] || null, progress: prog };
  }, [lyrics, elapsed]);

  const tpl = kineticTemplates[template];

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
    <div className={`viz-lyrics ${tpl.containerClass} ${beat ? "lyric-beat-flash" : ""}`}>
      <div className="viz-lyrics-section" style={{ color }}>{currentLine.section}</div>
      <div className="viz-lyrics-current" style={{ opacity: 0.7 + progress * 0.3 }}>
        {currentLine.text.split(" ").map((word, i) => {
          const wordProgress = progress * currentLine.text.split(" ").length;
          const isActive = i < wordProgress;
          return (
            <span
              key={i}
              className={`viz-lyric-word ${tpl.wordClass} ${isActive ? "active" : ""}`}
              style={{ color: isActive ? color : "#a1a1aa", transitionDelay: `${i * 60}ms` }}
            >
              {word}{" "}
            </span>
          );
        })}
      </div>
      {nextLine && (
        <div className="viz-lyrics-next">{nextLine.text}</div>
      )}
    </div>
  );
}
