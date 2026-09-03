import type { StoryBeat } from "../storyboard";

interface Props {
  beat: StoryBeat | null;
  elapsed: number;
  /** Seconds the card stays visible after each act entry */
  holdSeconds?: number;
}

/**
 * Cinematic act title card ("ACT II — THE BUILD" + lyric hook), shown briefly
 * when the storyboard enters a new beat. Keyed by beat id so the entrance
 * animation restarts on every act change.
 */
export function StoryActCard({ beat, elapsed, holdSeconds = 2.8 }: Props) {
  if (!beat) return null;
  if (elapsed - beat.start > holdSeconds || elapsed < beat.start) return null;
  return (
    <div className="viz-act-card" key={beat.id}>
      <div className="viz-act-kicker">{beat.actTitle}</div>
      {beat.hook && <div className="viz-act-hook">“{beat.hook}”</div>}
    </div>
  );
}
