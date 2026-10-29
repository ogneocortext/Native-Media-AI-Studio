/**
 * AudioLibrary — dedicated view of audio files in `output/`.
 *
 * Route: `/library/audio`
 *
 * Pre-filtered to audio files only. Reuses the full media library UI
 * (grid/list, filters, favorites, collections, tags, trash, playback,
 * duplicates) but hides the file-type filter chips since the page is
 * already scoped to audio.
 */
import { MediaLibraryView, type MediaLibraryViewProps } from "./MediaLibraryView";

const DEFAULT: MediaLibraryViewProps = { defaultFileType: "audio" };

export function AudioLibrary() {
  return <MediaLibraryView {...DEFAULT} />;
}
