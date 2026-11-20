/**
 * NsfwLibrary — the dedicated NSFW section.
 *
 * Route: `/nsfw`
 *
 * Two states, and the difference matters:
 *
 * - gate OFF (the default): the route renders the app's standard empty state
 *   and never fetches. The nav entry is absent too, so nothing advertises it.
 * - gate ON: the page is the media library scoped to flagged items
 *   (`MediaLibraryView scope="nsfw"`, served by `/api/outputs/nsfw`).
 *
 * Enforcement is server-side: flagged items are excluded from the home feed and
 * every general library list whether or not this page is reachable, so the
 * section is a view over flagged items rather than the thing that hides them.
 */
import { useNavigate } from "react-router-dom";
import { EyeOff, Loader2, Settings } from "lucide-react";
import { Card, EmptySection } from "../../components/common";
import { useNsfwStore } from "../../state/nsfwStore";
import { MediaLibraryView } from "./MediaLibraryView";

export function NsfwLibrary() {
  const navigate = useNavigate();
  const showNsfw = useNsfwStore((s) => s.showNsfw);
  const loaded = useNsfwStore((s) => s.loaded);

  if (!loaded) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-primary" />
        <span className="ml-2 text-muted">Loading…</span>
      </div>
    );
  }

  if (!showNsfw) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <EyeOff size={22} />
          NSFW
        </h1>
        <Card title="NSFW content is hidden">
          <EmptySection
            icon={<EyeOff />}
            title="Nothing to show"
            description="Items you flag NSFW stay out of the home feed and the library. Turn on “Show NSFW content” in Settings to reveal this section."
            action={{
              label: "Open Settings",
              icon: <Settings size={14} />,
              onClick: () => {
                void navigate("/system/settings");
              },
            }}
          />
        </Card>
      </div>
    );
  }

  return <MediaLibraryView defaultFileType="all" scope="nsfw" />;
}
