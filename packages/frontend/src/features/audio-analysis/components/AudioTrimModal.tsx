import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, Play, Pause, Trash2, Loader2, CheckCircle2, AlertCircle,
  Scissors, Slice, Music2, Type, Delete,
} from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import { trimAudioFile, type TrimAudioResponse } from "../../../services/api";
import { DS } from "../../../styles/designSystem";

export interface TrimSection {
  type: string;
  start: number;
  end: number;
}

interface AudioTrimModalProps {
  isOpen: boolean;
  onClose: () => void;
  filename: string;
  audioUrl: string;
  duration: number;
  sections?: TrimSection[];
  onSaved: (res: TrimAudioResponse) => void;
  onAnalyzeFile: (filename: string, storedPath: string) => void;
  onSendToKinetic: (filename: string) => void;
}

interface RegionState {
  id: string;
  start: number;
  end: number;
}

const KEEP_COLOR = "rgba(139, 92, 246, 0.28)";
const REMOVE_COLOR = "rgba(239, 68, 68, 0.30)";

function formatTime(s: number): string {
  const safe = Math.max(0, s || 0);
  const m = Math.floor(safe / 60);
  const sec = (safe % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

export function AudioTrimModal({
  isOpen, onClose, filename, audioUrl, duration, sections,
  onSaved, onAnalyzeFile, onSendToKinetic,
}: AudioTrimModalProps) {
  const [mode, setMode] = useState<"keep" | "remove">("keep");
  const [regions, setRegions] = useState<RegionState[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrimAudioResponse | null>(null);

  const waveContainerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  const disableDragSelectRef = useRef<(() => void) | null>(null);
  const regionsStateRef = useRef<RegionState[]>([]);
  regionsStateRef.current = regions;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const syncRegions = useCallback(() => {
    const plugin = regionsPluginRef.current;
    if (!plugin) return;
    const list = plugin.getRegions()
      .map(r => ({ id: r.id, start: r.start, end: r.end }))
      .sort((a, b) => a.start - b.start);
    setRegions(list);
  }, []);

  const findLiveRegion = useCallback((id: string) => {
    return regionsPluginRef.current?.getRegions().find(r => r.id === id) ?? null;
  }, []);

  // Init wavesurfer + regions on mount
  useEffect(() => {
    if (!isOpen || !waveContainerRef.current) return;
    const ws = WaveSurfer.create({
      container: waveContainerRef.current,
      url: audioUrl,
      height: 128,
      waveColor: "#4b5563",
      progressColor: "#8b5cf6",
      cursorColor: "#a78bfa",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
    });
    const rp = ws.registerPlugin(RegionsPlugin.create());
    wsRef.current = ws;
    regionsPluginRef.current = rp;

    const onReady = () => {
      const d = ws.getDuration() || duration;
      setTotalDuration(d);
      disableDragSelectRef.current = rp.enableDragSelection({ color: KEEP_COLOR, drag: true, resize: true });
      // Keep mode starts with the full file selected so Save works immediately
      rp.addRegion({ start: 0, end: d, color: KEEP_COLOR, drag: true, resize: true });
      syncRegions();
    };
    const onTimeUpdate = (t: number) => {
      setCurrentTime(t);
      // WYSIWYG preview: skip over removed regions during playback
      if (modeRef.current === "remove" && ws.isPlaying()) {
        const hit = regionsStateRef.current.find(r => t >= r.start && t < r.end - 0.05);
        if (hit) ws.setTime(Math.min(hit.end + 0.01, ws.getDuration()));
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onFinish = () => setIsPlaying(false);
    const onRegionCreated = () => {
      // Keep mode = exactly one region: drop any previous one
      if (modeRef.current === "keep") {
        const all = rp.getRegions();
        if (all.length > 1) {
          const newest = all[all.length - 1];
          all.slice(0, -1).forEach(r => r.remove());
          void newest;
        }
      }
      syncRegions();
    };
    const onRegionUpdated = () => syncRegions();
    const onRegionRemoved = () => syncRegions();
    const onRegionClicked = (region: { play: () => void }) => region.play();

    ws.on("ready", onReady);
    ws.on("timeupdate", onTimeUpdate);
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);
    rp.on("region-created", onRegionCreated);
    rp.on("region-updated", onRegionUpdated);
    rp.on("region-removed", onRegionRemoved);
    rp.on("region-clicked", onRegionClicked);

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionsPluginRef.current = null;
    };
    // Deps intentionally narrowed to the two values that change what the
    // waveform shows. The callbacks/props used inside are stable for the
    // lifetime of the modal, so re-creating the wavesurfer instance on every
    // parent render would be wasteful (and would discard the current region).
  }, [isOpen, audioUrl]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, saving, onClose]);

  const switchMode = useCallback((next: "keep" | "remove") => {
    if (next === mode || saving) return;
    setMode(next);
    setError(null);
    // Clear regions; keep mode re-seeds the full-file region
    regionsPluginRef.current?.clearRegions();
    const rp = regionsPluginRef.current;
    if (rp && wsRef.current) {
      disableDragSelectRef.current?.();
      disableDragSelectRef.current = rp.enableDragSelection({
        color: next === "keep" ? KEEP_COLOR : REMOVE_COLOR,
        drag: true,
        resize: true,
      });
      if (next === "keep") {
        rp.addRegion({
          start: 0,
          end: wsRef.current.getDuration() || totalDuration,
          color: KEEP_COLOR,
          drag: true,
          resize: true,
        });
      }
    }
    syncRegions();
  }, [mode, saving, syncRegions, totalDuration]);

  const updateRegionTime = useCallback((id: string, field: "start" | "end", value: number) => {
    const region = findLiveRegion(id);
    if (!region || !Number.isFinite(value)) return;
    const max = wsRef.current?.getDuration() || totalDuration;
    const v = Math.max(0, Math.min(value, max));
    region.setOptions({ [field]: v });
    syncRegions();
  }, [findLiveRegion, syncRegions, totalDuration]);

  const deleteRegion = useCallback((id: string) => {
    findLiveRegion(id)?.remove();
    syncRegions();
  }, [findLiveRegion, syncRegions]);

  const applySection = useCallback((s: TrimSection) => {
    const rp = regionsPluginRef.current;
    if (!rp) return;
    if (modeRef.current !== "keep") {
      switchMode("keep");
    } else {
      rp.getRegions().forEach(r => r.remove());
    }
    // switchMode already seeds a full region; replace it on next tick
    window.setTimeout(() => {
      const plugin = regionsPluginRef.current;
      if (!plugin) return;
      plugin.getRegions().forEach(r => r.remove());
      plugin.addRegion({ start: s.start, end: s.end, color: KEEP_COLOR, drag: true, resize: true });
      syncRegions();
    }, 0);
  }, [switchMode, syncRegions]);

  const removedTotal = regions.reduce((a, r) => a + Math.max(0, r.end - r.start), 0);
  const outputDuration = mode === "keep"
    ? (regions[0] ? Math.max(0, regions[0].end - regions[0].start) : 0)
    : Math.max(0, totalDuration - removedTotal);

  const handleSave = useCallback(async () => {
    setError(null);
    const ranges = regions
      .map(r => ({
        start: Math.round(r.start * 100) / 100,
        end: Math.round(r.end * 100) / 100,
      }))
      .filter(r => r.end - r.start > 0.01);
    if (mode === "keep" && ranges.length !== 1) {
      setError("Drag on the waveform to select the part you want to keep.");
      return;
    }
    if (mode === "remove" && ranges.length === 0) {
      setError("Drag on the waveform to mark the parts you want to remove.");
      return;
    }
    setSaving(true);
    try {
      const res = await trimAudioFile({ filename, mode, ranges });
      setResult(res);
      onSaved(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [regions, mode, filename, onSaved]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={() => { if (!saving) onClose(); }}
      role="presentation"
    >
      <div
        className={DS.card}
        style={{ maxWidth: 760, width: "94%", maxHeight: "92vh", overflowY: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-label={`Trim ${filename}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Scissors size={18} className="text-violet-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Trim Audio</h3>
              <p className="text-xs text-gray-400 truncate max-w-md">{filename} · {formatTime(totalDuration)}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} className={DS.btnGhost} aria-label="Close trim editor">
            <X size={16} />
          </button>
        </div>

        {result ? (
          /* Success panel */
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
            <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-bold text-white">Saved {result.filename}</p>
            <p className="text-xs text-gray-400 mt-1 tabular-nums">
              {formatTime(result.duration)} kept · lossless stream copy · {result.render_s}s
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              <button
                onClick={() => onAnalyzeFile(result.filename, result.stored_path)}
                className={DS.btnPrimarySm}
              >
                <Music2 size={14} /> Analyze new file
              </button>
              <button
                onClick={() => onSendToKinetic(result.filename)}
                className={DS.btnSecondarySm}
              >
                <Type size={14} /> Kinetic Typography
              </button>
              <button onClick={onClose} className={DS.btnSecondarySm}>Close</button>
            </div>
          </div>
        ) : (
          <>
            {/* Mode tabs */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => switchMode("keep")}
                aria-pressed={mode === "keep"}
                className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${mode === "keep" ? "border-violet-500 bg-violet-500/10" : "border-gray-700 hover:border-gray-600"}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><Slice size={14} className="text-violet-400" /> Keep one part</span>
                <span className="text-xs text-gray-400">Save a single interval</span>
              </button>
              <button
                onClick={() => switchMode("remove")}
                aria-pressed={mode === "remove"}
                className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${mode === "remove" ? "border-red-500 bg-red-500/10" : "border-gray-700 hover:border-gray-600"}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-white"><Delete size={14} className="text-red-400" /> Remove parts</span>
                <span className="text-xs text-gray-400">Cut sections out, join the rest</span>
              </button>
            </div>

            {/* Waveform */}
            <div className="mt-3 rounded-xl border border-gray-700 bg-gray-900/40 p-2">
              <div ref={waveContainerRef} className="w-full" />
              <div className="flex items-center gap-2 mt-2 px-1">
                <button
                  onClick={() => wsRef.current?.playPause()}
                  className={DS.btnSecondarySm}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <span className="text-xs text-gray-400 tabular-nums">
                  {formatTime(currentTime)} / {formatTime(totalDuration)}
                </span>
                <span className="text-xs text-gray-500 ml-auto hidden sm:inline">
                  Drag on the waveform to {mode === "keep" ? "select" : "mark"} · drag edges to adjust · click a region to hear it
                </span>
              </div>
            </div>

            {/* Section shortcuts */}
            {sections && sections.length > 0 && (
              <div className="mt-3">
                <p className={DS.textXs + " mb-1.5"}>Jump to a detected section:</p>
                <div className="flex flex-wrap gap-1.5">
                  {sections.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => applySection(s)}
                      className="px-2 py-1 rounded-lg bg-gray-700/60 hover:bg-violet-600/40 text-xs text-gray-200 capitalize transition-colors"
                      title={`${formatTime(s.start)} – ${formatTime(s.end)}`}
                    >
                      {s.type} <span className="text-gray-400 tabular-nums">{formatTime(s.start)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Region list */}
            <div className="mt-3">
              <p className={DS.textXs + " mb-1.5"}>
                {mode === "keep" ? "Part to keep:" : `Parts to remove (${regions.length}):`}
              </p>
              {regions.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No regions yet — drag across the waveform.</p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {regions.map((r, i) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-lg bg-gray-800/60 px-2 py-1.5">
                      <span className={`text-xs font-bold w-5 h-5 rounded flex items-center justify-center shrink-0 ${mode === "keep" ? "bg-violet-500/30 text-violet-200" : "bg-red-500/30 text-red-200"}`}>
                        {i + 1}
                      </span>
                      <label className="text-xs text-gray-400">Start</label>
                      <input
                        type="number" step={0.1} min={0} max={totalDuration}
                        value={Math.round(r.start * 10) / 10}
                        onChange={e => updateRegionTime(r.id, "start", parseFloat(e.target.value))}
                        className="w-20 px-1.5 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-white tabular-nums"
                      />
                      <label className="text-xs text-gray-400">End</label>
                      <input
                        type="number" step={0.1} min={0} max={totalDuration}
                        value={Math.round(r.end * 10) / 10}
                        onChange={e => updateRegionTime(r.id, "end", parseFloat(e.target.value))}
                        className="w-20 px-1.5 py-1 rounded bg-gray-900 border border-gray-700 text-xs text-white tabular-nums"
                      />
                      <span className="text-xs text-gray-500 tabular-nums ml-auto">
                        {formatTime(Math.max(0, r.end - r.start))}
                      </span>
                      {(mode === "remove" || regions.length > 1) && (
                        <button
                          onClick={() => deleteRegion(r.id)}
                          className={DS.btnGhostSm}
                          aria-label={`Delete region ${i + 1}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-400 mt-3">
                <AlertCircle size={13} /> {error}
              </p>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-gray-400 tabular-nums">
                Output ≈ <strong className="text-white">{formatTime(outputDuration)}</strong>
                {" "}({totalDuration > 0 ? Math.round(outputDuration / totalDuration * 100) : 0}% of original)
                {" · "}lossless copy
              </p>
              <div className="flex gap-2">
                <button onClick={onClose} disabled={saving} className={DS.btnSecondary}>Cancel</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={`${DS.btnPrimary} ${DS.btnDisabled}`}
                >
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Scissors size={14} /> Save new file</>}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
