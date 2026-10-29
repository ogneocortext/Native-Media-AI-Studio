/**
 * VideoLibrary — dedicated view of video files in `output/`.
 *
 * Route: `/library/video`
 *
 * Pre-filtered to video files only. Reuses the full media library UI
 * (grid/list, filters, favorites, collections, tags, trash, playback,
 * duplicates) but hides the file-type filter chips since the page is
 * already scoped to video.
 */
import { MediaLibraryView, type MediaLibraryViewProps } from "./MediaLibraryView";

const DEFAULT: MediaLibraryViewProps = { defaultFileType: "video" };

export function VideoLibrary() {
  return <MediaLibraryView {...DEFAULT} />;
}
