/**
 * RemixPage - standalone page for building mashups from stems of different songs.
 *
 * RemixPanel was previously only reachable from inside the Visualizer ("Stem
 * Mixer"), so it was effectively hidden from anyone who didn't already know to
 * look there. This page exposes it as a first-class destination so home-server
 * users can discover and use the mashup feature directly.
 *
 * The panel itself is unchanged; this page only adds a header, a back-to-library
 * breadcrumb, and a full-width layout.
 *
 * Track handoff: Media Library's LineagePanel and the Visualizer's Remix
 * Studio links both arrive here via `setPendingTrack` + `setPendingRemixOpen`
 * (utils/pendingTrack). The pending filename becomes the panel's
 * `currentTrack` so recipe reopens match their source track, and the
 * "Open in Visualizer" link carries the same track back for preview.
 */
import { RemixPanel } from "./RemixPanel";
import { ArrowLeft, Wand2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import {
  peekPendingTrack,
  setPendingTrack,
} from "../../utils/pendingTrack";

export function RemixPage() {
  const navigate = useNavigate();
  // Read once per mount: the pending filename is the track the user was
  // working on when they followed a mashup link here.
  const pendingTrack = useMemo(() => peekPendingTrack(), []);

  const openInVisualizer = () => {
    if (pendingTrack) setPendingTrack(pendingTrack);
    void navigate("/visualizer");
  };

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/library" className="breadcrumb">
          <ArrowLeft size={16} />
          <span>Media Library</span>
        </Link>
        <div className="page-title">
          <Wand2 size={20} />
          <span>Remix / Mashup</span>
        </div>
        <p className="page-subtitle">
          Build a mashup from stems of different songs - drums from one track,
          vocals from another. Key shifts are explicit; detected keys are shown
          as unreliable advisories only.
        </p>
        {pendingTrack && (
          <button
            type="button"
            onClick={openInVisualizer}
            className="mt-2 text-xs text-violet-300/80 hover:text-violet-200 underline underline-offset-2"
            title={`Preview "${pendingTrack}" in the Visualizer`}
          >
            Open in Visualizer →
          </button>
        )}
      </div>
      <div className="page-body">
        <RemixPanel currentTrack={pendingTrack} />
      </div>
    </div>
  );
}
