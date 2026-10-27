/**
 * RemixPage — standalone page for building mashups from stems of different songs.
 *
 * RemixPanel was previously only reachable from inside the Visualizer ("Stem
 * Mixer"), so it was effectively hidden from anyone who didn't already know to
 * look there. This page exposes it as a first-class destination so home-server
 * users can discover and use the mashup feature directly.
 *
 * The panel itself is unchanged; this page only adds a header, a back-to-library
 * breadcrumb, and a full-width layout.
 */
import { RemixPanel } from "./RemixPanel";
import { ArrowLeft, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";

export function RemixPage() {
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
          Build a mashup from stems of different songs — drums from one track,
          vocals from another. Key shifts are explicit; detected keys are shown
          as unreliable advisories only.
        </p>
      </div>
      <div className="page-body">
        <RemixPanel currentTrack={null} />
      </div>
    </div>
  );
}
