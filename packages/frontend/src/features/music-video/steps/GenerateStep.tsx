import { useState } from "react";
import { Sparkles, Play, Loader2, Layers, Target, Scissors, Activity } from "lucide-react";
import type { AudioAnalysis, GenerationConfig } from "../types";
import { VISUAL_TREATMENTS } from "../types";
import {
  createCanvasLoop,
  routeScene,
  assembleBeatQuantized,
  getStemVisualization,
  type StemVisualizationUniform,
} from "../../../services/api/video-render";

export function GenerateStep({
  generating,
  progress,
  analysis,
  config,
  onStart,
  onConfigChange,
}: {
  generating: boolean;
  progress: number;
  analysis: AudioAnalysis | null;
  config: GenerationConfig;
  onStart: () => void;
  onConfigChange: (c: GenerationConfig) => void;
}) {
  const [sectionRoutes, setSectionRoutes] = useState<
    Record<string, { model: string; tier: string; reason: string }>
  >({});
  const [routing, setRouting] = useState(false);
  const [canvasOutput, setCanvasOutput] = useState<string | null>(null);
  const [creatingCanvas, setCreatingCanvas] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [assemblyOutput, setAssemblyOutput] = useState<string | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [stemVizData, setStemVizData] = useState<Record<string, StemVisualizationUniform> | null>(
    null,
  );
  const [loadingStemViz, setLoadingStemViz] = useState(false);
  const [stemVizError, setStemVizError] = useState<string | null>(null);

  const sections = analysis?.sections ?? [];

  // A6: route each section to its best model
  const loadRouting = async () => {
    if (!analysis || sections.length === 0) return;
    setRouting(true);
    try {
      const routes: Record<string, { model: string; tier: string; reason: string }> = {};
      // Iterate with the index rather than `sections.indexOf(s)`: indexOf scans
      // from the start for every section, and returns the FIRST match when two
      // sections share a type, so a repeated verse would collapse onto one key.
      for (const [i, s] of sections.entries()) {
        try {
          const res = await routeScene({
            section_type: s.type,
            energy: s.energy,
            duration: s.end - s.start,
            vram_available_mb: 7500,
          });
          routes[`${s.type}-${i}`] = {
            model: res.model,
            tier: res.tier,
            reason: res.reason,
          };
        } catch {
          /* skip failed section */
        }
      }
      setSectionRoutes(routes);
    } finally {
      setRouting(false);
    }
  };

  // A4: create Spotify Canvas loop from the generated video
  const handleCreateCanvas = async () => {
    if (!analysis) return;
    setCreatingCanvas(true);
    setCanvasError(null);
    try {
      // Use the chorus as the Canvas source (most visually active segment)
      const chorus = sections.find((s) => s.type === "chorus") ?? sections[0];
      const sourcePath = `output/video/${chorus.type}_latest.mp4`;
      const res = await createCanvasLoop({
        source_path: sourcePath,
        duration: 5.0,
        width: 720,
        height: 1280,
        crossfade: 0.3,
      });
      if (res.success && res.output_path) setCanvasOutput(res.output_path);
      else setCanvasError(res.error ?? res.message ?? "Failed");
    } catch (err) {
      setCanvasError(err instanceof Error ? err.message : "Failed to create Canvas loop");
    } finally {
      setCreatingCanvas(false);
    }
  };

  // A3: beat-quantized assembly of rendered section clips
  const handleAssemble = async () => {
    if (!analysis || sections.length === 0) return;
    setAssembling(true);
    setAssemblyError(null);
    try {
      const width = config.verticalFirst ? 1080 : 1920;
      const height = config.verticalFirst ? 1920 : 1080;
      const shot_manifest = (analysis.sections ?? []).map((s, i) => ({
        id: `section-${i}`,
        section: s.type,
        duration_seconds: s.end - s.start,
        output_path: `output/video/${s.type}_latest.mp4`,
        width,
        height,
        fps: 24,
        steps: config.steps,
      }));
      const res = await assembleBeatQuantized({
        shot_manifest,
        audio_path: analysis.stored_path ?? undefined,
        engine: "auto",
        transition: "xfade",
        transition_duration: 0.3,
        beat_times: analysis.beat_times,
      });
      if (res.success && res.output_path) setAssemblyOutput(res.output_path);
      else setAssemblyError(res.error ?? res.message ?? "Failed");
    } catch (err) {
      setAssemblyError(err instanceof Error ? err.message : "Failed to assemble");
    } finally {
      setAssembling(false);
    }
  };

  // A5: stem-reactive visualization uniforms
  const handleStemViz = async () => {
    if (!analysis) return;
    setLoadingStemViz(true);
    setStemVizError(null);
    try {
      // Find the uploaded filename from analysis
      const filename = analysis.stored_path?.split(/[\\/]/).pop() ?? "";
      if (!filename) {
        setStemVizError("No audio filename found — upload and analyze first");
        return;
      }
      const res = await getStemVisualization({ filename });
      if (Object.keys(res.uniforms).length > 0) {
        setStemVizData(res.uniforms);
      } else {
        setStemVizError("Stems not separated yet — run separation first");
      }
    } catch (err) {
      setStemVizError(err instanceof Error ? err.message : "Failed to load stem viz");
    } finally {
      setLoadingStemViz(false);
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="text-center max-w-2xl mx-auto">
        <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center mx-auto">
          <Sparkles size={18} className="text-white" />
        </div>
        <h2 className="text-xl font-bold text-white mt-3">
          Generate per Section — mindful, not wallpaper
        </h2>
        <p className="text-sm text-gray-400 mt-2">
          {generating
            ? "Generating visuals for each section — cuts land on strong beats."
            : "Each section gets its treatment. We generate sequentially (1 at a time = no 8GB OOM) with beat-synced cameras."}
        </p>
      </div>

      {!generating ? (
        <>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={loadRouting}
              disabled={routing || sections.length === 0}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-xl text-xs font-semibold border border-gray-600 flex items-center gap-2"
            >
              {routing ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}{" "}
              Route Scenes (A6)
            </button>
            <button
              type="button"
              onClick={handleCreateCanvas}
              disabled={creatingCanvas}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-xl text-xs font-semibold border border-gray-600 flex items-center gap-2"
            >
              {creatingCanvas ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Scissors size={14} />
              )}{" "}
              Spotify Canvas Loop (A4)
            </button>
            <button
              type="button"
              onClick={handleAssemble}
              disabled={assembling || sections.length === 0}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-xl text-xs font-semibold border border-gray-600 flex items-center gap-2"
            >
              {assembling ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}{" "}
              Assemble Master (A3)
            </button>
            <button
              type="button"
              onClick={handleStemViz}
              disabled={loadingStemViz}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-xl text-xs font-semibold border border-gray-600 flex items-center gap-2"
            >
              {loadingStemViz ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Activity size={14} />
              )}{" "}
              Stem Viz Uniforms (A5)
            </button>
          </div>
          {assemblyOutput && (
            <p className="mt-2 text-xs text-emerald-400 text-center">
              Assembled: {assemblyOutput.split(/[\\/]/).pop()} • Beat-quantized master ready
            </p>
          )}
          {assemblyError && (
            <p className="mt-2 text-xs text-red-400 text-center">{assemblyError}</p>
          )}
          {stemVizData && Object.keys(stemVizData).length > 0 && (
            <div className="mt-3 bg-gray-900 border border-gray-700 rounded-xl p-3">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">
                Stem-reactive uniforms (A5)
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(stemVizData).map(([key, val]) => (
                  <div key={key} className="bg-gray-800/60 rounded-lg p-2">
                    <p className="text-[10px] text-gray-500 uppercase">{key}</p>
                    <p className="text-xs text-white font-semibold">{val.stem}</p>
                    <p className="text-[10px] text-gray-400">
                      {val.duration.toFixed(1)}s • rms {val.rms_mean.toFixed(4)}
                    </p>
                    <div className="mt-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500"
                        style={{ width: `${Math.min(100, val.rms_mean * 500)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stemVizError && <p className="mt-2 text-xs text-red-400 text-center">{stemVizError}</p>}
          {canvasOutput && (
            <p className="mt-2 text-xs text-emerald-400 text-center">
              Canvas loop ready: {canvasOutput.split(/[\\/]/).pop()}
            </p>
          )}
          {canvasError && <p className="mt-2 text-xs text-red-400 text-center">{canvasError}</p>}
          <div className="mt-6 grid md:grid-cols-2 gap-3 max-w-3xl mx-auto">
            {sections.map((s, i) => {
              const routeKey = `${s.type}-${i}`;
              const route = sectionRoutes[routeKey];
              return (
                <div
                  key={i}
                  className="bg-gray-900 border border-gray-700 rounded-xl p-3 flex gap-3 items-center"
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${s.type === "chorus" ? "bg-violet-600 text-white" : s.type === "intro" ? "bg-sky-600 text-white" : s.type === "verse" ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"}`}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white capitalize flex items-center gap-2">
                      {s.type}{" "}
                      <span className="text-xs font-normal text-gray-500">
                        {s.start.toFixed(1)}s → {s.end.toFixed(1)}s
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {VISUAL_TREATMENTS[s.type] || "Custom"}
                    </p>
                    {route && (
                      <p className="text-[11px] text-violet-300 mt-1 flex items-center gap-1">
                        <Target size={10} /> {route.model}{" "}
                        <span className="text-gray-500">({route.tier})</span>
                      </p>
                    )}
                    <input
                      placeholder="Override prompt for this section (optional)"
                      value={config.sectionOverrides[`${s.type}-${i}`] || ""}
                      onChange={(e) => {
                        // Replace the object rather than mutating `config`: a
                        // direct write to the prop never re-renders and leaves
                        // the parent holding a stale copy.
                        const key = `${s.type}-${i}`;
                        const v = e.target.value;
                        onConfigChange({
                          ...config,
                          sectionOverrides: { ...config.sectionOverrides, [key]: v },
                        });
                      }}
                      className="w-full mt-1.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500"
                    />
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">
                    {(s.energy * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
          <button
            onClick={onStart}
            className="mt-6 mx-auto flex px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl items-center gap-2 font-semibold shadow-lg shadow-violet-600/20"
          >
            <Play size={18} /> Generate Video — {sections.length} sections
          </button>
        </>
      ) : (
        <div className="mt-8 max-w-xl mx-auto">
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-violet-600 to-fuchsia-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-400 mt-2 text-center">
            {progress.toFixed(0)}% • generating on CUDA (serial queue) — do not close
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-violet-400 text-sm">
            <Loader2 size={18} className="animate-spin" /> Beat-synced keyframes + EEVEE Next /
            Cycles
          </div>
        </div>
      )}
    </div>
  );
}
