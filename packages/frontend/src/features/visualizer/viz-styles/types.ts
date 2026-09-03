import type { LyricLine } from "../components/LyricOverlay";
import type { AudioAnalysisData, AudioData, VizParams } from "../types";

export interface VizProps {
  audioData: React.MutableRefObject<AudioData>;
  vizParams: VizParams;
  analysisData?: AudioAnalysisData | null;
  audioElapsedRef?: React.MutableRefObject<number>;
  sceneFrozen?: boolean;
  /** LRC lyric data for phrase-synchronized visuals — full sync when LRC file present */
  lyrics?: LyricLine[];
  lrcSync?: {
    currentSection: string;
    sectionProgress: number;
    isPhraseStart: boolean;
    lineProgress: number;
    currentLine: LyricLine | null;
    nextLine: LyricLine | null;
    timeToNextPhrase: number;
    currentIndex: number;
    totalLines: number;
  } | null;
  /** Accessibility: dampen rotation + animation speed when true */
  prefersReducedMotion?: boolean;
}
