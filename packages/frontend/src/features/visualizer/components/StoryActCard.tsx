import type { StoryBeat } from "../storyboard";

interface Props {
  beat: StoryBeat | null;
  elapsed: number;
  /** Seconds the card stays visible after each act entry */
  holdSeconds?: number;
  /** Show the quoted lyric hook — false when the lyrics layer is toggled off */
  showHook?: boolean;
}

/**
 * Cinematic act title card ("ACT II — THE BUILD" + lyric hook), shown briefly
 * when the storyboard enters a new beat. Keyed by beat id so the entrance
 * animation restarts on every act change. The hook is lyric text, so it
 * follows the lyrics visibility toggle; the act title is scene narrative
 * and stays with the visuals layer.
 */
export function StoryActCard({ beat, elapsed, holdSeconds = 2.8, showHook = true }: Props) {
  if (!beat) return null;
  if (elapsed - beat.start > holdSeconds || elapsed < beat.start) return null;
  return (
    <div className="viz-act-card" key={beat.id}>
      <div className="viz-act-kicker">{beat.actTitle}</div>
      {showHook && beat.hook && <div className="viz-act-hook">“{beat.hook}”</div>}
    </div>
  );
}
