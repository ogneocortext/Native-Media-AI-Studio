/**
 * LineagePanel - what has been made *from* this track, and how.
 *
 * Sits in the Media Library audio detail view. The point is provenance: a mashup
 * can draw on several tracks, and a rendered manifest records every slot, layer,
 * gain, key shift and source offset. That makes "reopen and rearrange" a real
 * round-trip rather than re-deriving the arrangement by hand.
 *
 * Two things it deliberately does NOT do:
 *  - It does not rank "similar tracks". Measured on this library librosa's tempo
 *    is grid-quantised and octave-aliased, and chroma fails a white-noise control,
 *    so any similarity ordering would present noise as a recommendation. See
 *    docs/knowledge-library/track-similarity-measurement-2026.md.
 *  - It does not autoplay. Opening a detail modal should be silent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  GitBranch,
  Layers,
  Loader2,
  Pencil,
  Play,
  Sparkles,
  Wand2,
} from "lucide-react";
import { audioDisplayName } from "../../state/audioNaming";
import { setPendingRemixRecipe, setPendingTrack } from "../../utils/pendingTrack";
import {
  getTrackLineage,
  remixFileUrl,
  type RemixLineageEntry,
  type StemName,
} from "../../services/api";

interface Props {
  /** Library filename, e.g. "SunoV6Mini-Ad-Nauseam.m4a". */
  filename: string;
}

/** Turn a library filename into the bare stem key the manifests record. */
function stemKeyOf(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export function LineagePanel({ filename }: Props) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<RemixLineageEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const key = stemKeyOf(filename);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(null);
    setExpanded(null);
    // Try the bare stem key first (what manifests store), then the filename. A
    // separation dir can carry a hash prefix or extension the manifest does not,
    // so both are plausible join keys.
    const candidates = key === filename ? [filename] : [key, filename];
    (async () => {
      let lastError: string | null = null;
      for (const candidate of candidates) {
        try {
          const data = await getTrackLineage(candidate);
          if (!live) return;
          if (data.remixes.length > 0 || candidate === candidates[candidates.length - 1]) {
            setEntries(data.remixes);
            return;
          }
        } catch (e) {
          lastError = (e as Error).message;
        }
      }
      if (live) setError(lastError);
    })();
    return () => {
      live = false;
    };
  }, [key, filename]);

  const play = useCallback((url: string) => {
    const el = audioRef.current;
    if (!el) return;
    if (el.src !== url) {
      el.src = url;
      el.currentTime = 0;
    }
    void el.play().catch(() => {});
  }, []);

  const reopen = useCallback(
    (entry: RemixLineageEntry) => {
      if (!entry.recipe) return;
      setPendingRemixRecipe(entry.recipe, filename);
      setPendingTrack(filename);
      navigate("/visualizer");
    },
    [filename, navigate],
  );

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 mt-3" data-testid="lineage-panel">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <GitBranch size={16} className="text-amber-300" /> Mashups from this track
        </span>
        <span className="text-[10px] text-muted">provenance · reopen to rearrange</span>
      </div>

      {/* Hidden player: lineage must be silent until a stem is explicitly clicked. */}
      <audio ref={audioRef} preload="none" data-testid="lineage-audio" />

      {error && (
        <p className="flex items-start gap-1 text-xs text-red-300/90" data-testid="lineage-error">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      )}

      {entries === null && !error && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Checking lineage…
        </p>
      )}

      {entries !== null && entries.length === 0 && (
        <p className="text-xs text-muted" data-testid="lineage-empty">
          Nothing built from this track yet. Build a mashup from the Remix Panel in the Visualizer.
        </p>
      )}

      {entries !== null && entries.length > 0 && (
        <ul className="space-y-2" data-testid="lineage-list">
          {entries.map((entry) => {
            // Compare against the stem key, which is what manifests store, rather
            // than the filename (which may carry a hash prefix or extension).
            const others = entry.source_tracks.filter((t) => t !== key);
            const isOpen = expanded === entry.name;
            return (
              <li key={entry.name} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-white">{entry.name}</span>
                  {entry.role === "primary" ? (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300"
                      title="This track was the primary source"
                    >
                      primary
                    </span>
                  ) : (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300"
                      title="This track contributed alongside another"
                    >
                      contributor
                    </span>
                  )}
                  {entry.has_enhanced && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      mastered
                    </span>
                  )}
                  <span className="text-[10px] text-muted ml-auto">
                    {entry.duration_sec != null ? `${entry.duration_sec.toFixed(0)}s` : ""}
                    {entry.target_bpm != null ? ` · ${Math.round(entry.target_bpm)} BPM` : ""}
                  </span>
                </div>

                {others.length > 0 && (
                  <p className="text-[10px] text-muted mt-1" data-testid="lineage-sources">
                    also uses {others.map((t) => audioDisplayName(t)).join(", ")}
                  </p>
                )}

                {entry.recipe && (
                  <p className="text-[10px] text-muted mt-1">
                    {entry.recipe.slots.length} slot{entry.recipe.slots.length === 1 ? "" : "s"} ·{" "}
                    {entry.recipe.slots.reduce((n, s) => n + s.layers.length, 0)} layers
                  </p>
                )}

                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button
                    onClick={() => setExpanded(isOpen ? null : entry.name)}
                    aria-expanded={isOpen}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white"
                  >
                    <Layers size={10} /> {isOpen ? "Hide stems" : "Stems"}
                  </button>
                  {entry.recipe ? (
                    <button
                      onClick={() => reopen(entry)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100"
                      title="Load this exact arrangement into the Remix Panel to edit and rebuild"
                    >
                      <Pencil size={10} /> Reopen &amp; rearrange
                    </button>
                  ) : (
                    <span
                      className="flex items-center gap-1 text-[10px] text-muted"
                      title="This manifest cannot be reopened: it does not record a complete arrangement"
                    >
                      <AlertCircle size={10} /> Not reopenable
                    </span>
                  )}
                  {entry.has_enhanced && (
                    <button
                      onClick={() => play(remixFileUrl(entry.name, "master"))}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-[10px] text-emerald-100"
                    >
                      <Sparkles size={10} /> Master
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="mt-2 space-y-1" data-testid="lineage-stems">
                    {(entry.has_enhanced ? [...entry.stems, "master"] : entry.stems).map((which) => (
                      <button
                        key={which}
                        onClick={() => play(remixFileUrl(entry.name, which as StemName | "master"))}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white w-full text-left"
                      >
                        <Play size={9} /> {which}
                        {entry.recipe && (
                          <span className="ml-auto text-[9px] text-muted truncate">
                            {entry.recipe.slots
                              .flatMap((s) => s.layers)
                              .filter((l) => l.stem === which)
                              .map((l) => `${audioDisplayName(l.track)} +${l.gain_db}dB`)
                              .join(" · ") || null}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-start gap-1 text-[10px] text-muted mt-3">
        <Wand2 size={10} className="mt-0.5 shrink-0" />
        <span>
          No &ldquo;similar tracks&rdquo; ranking here: tempo detection is unreliable on this library and
          chroma failed a noise control. Lineage is what can be stated accurately.
        </span>
      </p>
    </div>
  );
}
