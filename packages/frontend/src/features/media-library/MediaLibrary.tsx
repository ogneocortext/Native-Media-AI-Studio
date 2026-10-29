/**
 * MediaLibrary — browser UI for all `output/` file operations.
 *
 * Docs: `docs/guides/FILE_MANAGEMENT.md` covers play, cover art, rename,
 * delete, duplicates, and the selection/bulk bar.
 *
 * This is now a thin wrapper around `MediaLibraryView` scoped to all file
 * types. Dedicated video and audio pages live at `/library/video` and
 * `/library/audio`.
 */
import { MediaLibraryView } from "./MediaLibraryView";

export function MediaLibrary() {
  return <MediaLibraryView defaultFileType="all" />;
}
