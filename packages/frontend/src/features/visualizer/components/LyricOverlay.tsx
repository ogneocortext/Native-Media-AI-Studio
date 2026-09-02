import { useMemo } from "react";
import { getSectionColor } from "../sectionHelpers";
import { kineticTemplates, type KineticTemplateId } from "./KineticTemplates";

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  section: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

interface Props {
  lyrics: LyricLine[];
  elapsed: number;
  visible: boolean;
  template?: KineticTemplateId;
  beat?: boolean;
}

export function LyricOverlay({
  lyrics,
  elapsed,
  visible,
  template = "fadeReveal",
  beat,
}: Props) {
  const { currentLine, nextLine, progress } = useMemo(() => {
    if (!lyrics.length) return { currentLine: null, nextLine: null, progress: 0 };
    let lo = 0, hi = lyrics.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const l = lyrics[mid];
      if (elapsed < l.start) hi = mid - 1;
      else if (elapsed >= l.end) lo = mid + 1;
      else { found = mid; break; }
    }
    if (found === -1) return { currentLine: null, nextLine: lyrics[lo] || null, progress: 0 };
    const line = lyrics[found];
    const dur = line.end - line.start;
    const prog = dur > 1e-6 ? (elapsed - line.start) / dur : 0;
    return { currentLine: line, nextLine: lyrics[found + 1] || null, progress: Math.max(0, Math.min(1, prog)) };
  }, [lyrics, elapsed]);

  const tpl = kineticTemplates[template];

  if (!visible || !currentLine) return null;

  const color = getSectionColor(currentLine.section, "#a5b4fc");

  return (
    <div
      className={`viz-lyrics ${tpl.containerClass} ${beat ? "lyric-beat-flash" : ""}`}
    >
      <div className="viz-lyrics-section" style={{ color }}>
        {currentLine.section}
      </div>
      <div
        className="viz-lyrics-current"
        style={{ opacity: 0.7 + progress * 0.3 }}
      >
        {currentLine.text.split(/\s+/).filter(Boolean).slice(0,20).map((word, i, arr) => {
          const wordProgress = progress * arr.length;
          const isActive = i < Math.floor(wordProgress + 0.5);
          return (
            <span
              key={i}
              className={`viz-lyric-word ${tpl.wordClass} ${isActive ? "active" : ""}`}
              style={{
                color: isActive ? color : "#a1a1aa",
                transitionDelay: `${Math.min(i,10) * 40}ms`,
              }}
            >
              {word}{" "}
            </span>
          );
        })}
      </div>
      {nextLine && <div className="viz-lyrics-next">{nextLine.text}</div>}
    </div>
  );
}
