/**
 * OnboardingFlow — the 5-minute path, step by step.
 *
 * Implements `docs/plans/creative-onboarding-ux-2026-10.md` (O3) against the
 * flow drafted in `docs/ux/5-minute-path.md`.
 *
 * The path is linear: add → analyze → look → watch → render → done. The
 * rules live in `onboardingState.ts` (pure, unit-tested); this component
 * owns the effects — uploading, analysing, rendering — and the presentation.
 *
 * Copy rules (from the draft):
 *   - headline: "Drop a track, get a video."
 *   - buttons: verb + object ("Choose a track", "Looks good", "Make my clip")
 *   - progress: named stages, never a bare percentage
 *   - failure: what happened + the fix + one button
 *   - exit: "Show the full studio", always visible, never guilt-tripped
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, FileUp, Music4, Play, Upload } from "lucide-react";
import {
  ensureAnalysis,
  generateVideoSection,
  uploadAudioFile,
  type AudioAnalysisResult,
} from "../../services/api/audio";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { QuickExportButton } from "./QuickExportButton";
import { SuccessCard } from "./SuccessCard";
import {
  CLIP_SECONDS,
  INITIAL_STATE,
  analysisFailed,
  analysisSucceeded,
  describeSuggestion,
  lookAccepted,
  pickHighestEnergyWindow,
  renderFailed,
  renderStarted,
  renderSucceeded,
  retry,
  startOver,
  trackSelected,
  type OnboardingState,
} from "./onboardingState";

/** Named analysis stages — never a bare percentage. */
const ANALYSIS_STAGES = [
  "Listening…",
  "Finding the beat…",
  "Reading the energy…",
];

export interface OnboardingFlowProps {
  /** Called when the user leaves the path for the full studio. */
  onExit?: () => void;
  /** Called when the path completes (sets the first-run flag). */
  onComplete?: () => void;
}

export function OnboardingFlow({ onExit, onComplete }: OnboardingFlowProps) {
  const navigate = useNavigate();
  const { entries, isLoading: libLoading } = useAudioLibrary();

  const [state, setState] = useState<OnboardingState>(INITIAL_STATE);
  const [analysisStage, setAnalysisStage] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Bumped on every new selection; stale async work is discarded. */
  const runTokenRef = useRef(0);

  const runAnalysis = useCallback(async (filename: string, token: number) => {
    setAnalysisStage(0);
    const stageTimer = setInterval(() => {
      setAnalysisStage((s) => Math.min(s + 1, ANALYSIS_STAGES.length - 1));
    }, 2500);
    try {
      const res = await ensureAnalysis(filename);
      clearInterval(stageTimer);
      if (token !== runTokenRef.current) return;
      const analysis = res.analysis;
      const suggestion = describeSuggestion({
        visualization: analysis.suggested_visualization,
        confidence: analysis.suggested_visualization_confidence,
        tempoBpm: analysis.tempo_bpm,
        energy: averageEnergy(analysis),
      });
      const clipWindow = pickHighestEnergyWindow(
        analysis.energy_curve,
        analysis.sections,
        analysis.duration_seconds,
        CLIP_SECONDS,
      );
      setState((s) => analysisSucceeded(s, suggestion, clipWindow));
    } catch (err) {
      clearInterval(stageTimer);
      if (token !== runTokenRef.current) return;
      setState((s) =>
        analysisFailed(
          s,
          "That file couldn't be read.",
          err instanceof Error && err.message
            ? `Choose another track (${err.message})`
            : "Choose another track",
        ),
      );
    }
  }, []);

  /**
   * Step 2 starts automatically the moment a track is chosen — no button.
   *
   * The upload and the analysis are one operation, not an effect reacting to
   * state: a new file is uploaded first, and the *stored* name (which carries
   * the content-hash prefix) is what the analysis endpoints expect — the
   * upload's `filename` field is the original name, not the on-disk one.
   */
  const beginAnalysis = useCallback(
    async (file: File | null, libraryRef: string | null) => {
      const token = ++runTokenRef.current;
      setAnalysisStage(0);
      let filename = libraryRef;
      if (file) {
        try {
          const up = await uploadAudioFile(file);
          if (token !== runTokenRef.current) return;
          filename = basenameOf(up.stored_path) || up.filename;
          setState((s) => ({ ...s, filename }));
        } catch (err) {
          if (token !== runTokenRef.current) return;
          setState((s) =>
            analysisFailed(
              s,
              "That file couldn't be uploaded.",
              err instanceof Error ? err.message : "Choose another track",
            ),
          );
          return;
        }
      }
      if (!filename) {
        setState((s) =>
          analysisFailed(s, "That file couldn't be read.", "Choose another track"),
        );
        return;
      }
      await runAnalysis(filename, token);
    },
    [runAnalysis],
  );

  const handleFile = useCallback(
    (file: File) => {
      setState((s) => trackSelected(s, file.name));
      void beginAnalysis(file, null);
    },
    [beginAnalysis],
  );

  const handleLibraryPick = useCallback(
    (ref: string) => {
      if (!ref) return;
      setState((s) => trackSelected(s, ref));
      void beginAnalysis(null, ref);
    },
    [beginAnalysis],
  );

  const handleExport = useCallback(async () => {
    if (!state.filename) return;
    setState((s) => renderStarted(s));
    try {
      const res = await generateVideoSection({
        prompt: state.suggestion?.visualization ?? "audio reactive",
        section: "onboarding",
        duration: CLIP_SECONDS,
        method: "visualization",
        audio_filename: state.filename,
        visualization: state.suggestion
          ? { mode: state.suggestion.visualization }
          : undefined,
      });
      if (!res.success || !res.job_id) {
        throw new Error(res.error || res.message || "The render did not start");
      }
      const outputPath = await pollJob(res.job_id);
      setState((s) => renderSucceeded(s, outputPath));
      onComplete?.();
    } catch (err) {
      setState((s) =>
        renderFailed(
          s,
          "We couldn't make the clip.",
          err instanceof Error ? err.message : "Try again",
        ),
      );
    }
  }, [state.filename, state.suggestion, onComplete]);

  const exit = useCallback(() => {
    onComplete?.();
    if (onExit) {
      onExit();
    } else {
      navigate("/");
    }
  }, [navigate, onExit, onComplete]);

  const libraryOptions = useMemo(
    () => entries.map((e) => ({ ref: e.ref, label: e.optionLabel })),
    [entries],
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8" data-testid="onboarding-flow">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">Drop a track, get a video.</h1>
        <p className="text-sm text-white/50 mt-1">
          Six steps, no settings. You can leave at any time.
        </p>
      </header>

      {state.step === "add" && (
        <section
          className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
            dragOver
              ? "border-violet-400 bg-violet-500/10"
              : "border-white/15 bg-white/[0.02]"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          data-testid="onboarding-drop"
        >
          <div className="flex flex-col items-center gap-3">
            <FileUp size={28} className="text-white/30" />
            <p className="text-white/70">Drop audio here</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/mp4,video/quicktime"
              className="hidden"
              data-testid="onboarding-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition"
              data-testid="onboarding-choose-track"
            >
              Choose a track
            </button>

            {!libLoading && libraryOptions.length > 0 && (
              <div className="mt-4 w-full max-w-sm">
                <label
                  htmlFor="onboarding-library"
                  className="block text-xs text-white/50 mb-1"
                >
                  …or pick one already in your library
                </label>
                <select
                  id="onboarding-library"
                  defaultValue=""
                  onChange={(e) => handleLibraryPick(e.target.value)}
                  data-testid="onboarding-library-pick"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm"
                >
                  <option value="">— select a track —</option>
                  {libraryOptions.map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>
      )}

      {state.step === "analyzing" && (
        <section className="py-10" data-testid="onboarding-analyzing">
          <p className="text-white/80 mb-4">{state.filename}</p>
          <ul className="space-y-2">
            {ANALYSIS_STAGES.map((stage, i) => (
              <li
                key={stage}
                className={`flex items-center gap-2 text-sm ${
                  i < analysisStage
                    ? "text-emerald-400"
                    : i === analysisStage
                      ? "text-white"
                      : "text-white/25"
                }`}
              >
                {i < analysisStage ? (
                  <Check size={15} />
                ) : (
                  <span className="w-[15px] h-[15px] rounded-full border border-current" />
                )}
                {stage}
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.step === "look" && (
        <section className="py-6" data-testid="onboarding-look">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 flex flex-col items-center gap-4">
            <div className="w-40 h-24 rounded-lg bg-gradient-to-br from-violet-500/40 to-fuchsia-500/20 flex items-center justify-center">
              <Music4 size={26} className="text-white/60" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white uppercase tracking-wide">
                {state.suggestion?.visualization ?? "pulse grid"}
              </p>
              {state.suggestion && (
                <p className="text-xs text-white/50 mt-1">{state.suggestion.text}</p>
              )}
            </div>
            <p className="text-sm text-white/60 text-center">
              We picked this look for your track.
              <br />
              You can change it later in the Visualizer.
            </p>
            <button
              type="button"
              onClick={() => setState((s) => lookAccepted(s))}
              data-testid="onboarding-looks-good"
              className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition"
            >
              Looks good
            </button>
          </div>
        </section>
      )}

      {state.step === "watch" && (
        <section className="py-6" data-testid="onboarding-watch">
          <div className="rounded-xl border border-white/10 bg-black/40 p-6 flex flex-col items-center gap-4">
            <PreviewStage
              filename={state.filename}
              analysis={null}
              clipStart={state.clipWindow?.start ?? null}
            />
            <QuickExportButton
              onExport={handleExport}
              clipStart={state.clipWindow?.start ?? null}
            />
          </div>
        </section>
      )}

      {state.step === "rendering" && (
        <section className="py-10 text-center" data-testid="onboarding-rendering">
          <p className="text-white/70">
            {["Rendering frames…", "Mixing the audio…", "Finishing…"][
              Math.min(
                Math.floor((Date.now() / 1000) % 3),
                2,
              )
            ]}
          </p>
        </section>
      )}

      {state.step === "done" && state.outputUrl && (
        <SuccessCard
          outputUrl={state.outputUrl}
          filename={state.filename ?? ""}
          onSave={() => undefined}
          onOpenStudio={() => navigate("/visualizer")}
          onMakeAnother={() => setState((s) => startOver(s))}
        />
      )}

      {state.step === "error" && (
        <section
          className="py-6 rounded-xl border border-red-500/30 bg-red-500/5 p-6"
          data-testid="onboarding-error"
        >
          <p className="text-white/85 mb-1">{state.error}</p>
          {state.errorFix && (
            <p className="text-sm text-white/60 mb-4">{state.errorFix}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setState((s) => retry(s));
              }}
              data-testid="onboarding-retry"
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => setState((s) => startOver(s))}
              data-testid="onboarding-choose-another"
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-sm transition"
            >
              Choose another track
            </button>
          </div>
        </section>
      )}

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={exit}
          data-testid="onboarding-exit"
          className="text-sm text-white/40 hover:text-white/70 transition flex items-center gap-2"
        >
          <Upload size={13} className="rotate-180" />
          Show the full studio
        </button>
      </div>
    </div>
  );
}

/**
 * The stage at step 4 — the track playing, with the look's energy shape
 * behind it. Deliberately simple: the path's job is to show the idea, not
 * the whole visualizer.
 */
function PreviewStage({
  filename,
  clipStart,
}: {
  filename: string | null;
  analysis: AudioAnalysisResult | null;
  clipStart: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !filename) return;
    if (clipStart !== null && Number.isFinite(clipStart)) {
      el.currentTime = clipStart;
    }
  }, [filename, clipStart]);

  if (!filename) return null;

  return (
    <div className="w-full flex flex-col items-center gap-3">
      <div className="w-full aspect-video rounded-lg bg-gradient-to-br from-violet-900/40 via-black to-fuchsia-900/20 flex items-center justify-center">
        <button
          type="button"
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            if (el.paused) {
              void el.play();
              setPlaying(true);
            } else {
              el.pause();
              setPlaying(false);
            }
          }}
          data-testid="onboarding-play"
          aria-label={playing ? "Pause" : "Play"}
          className="w-14 h-14 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur flex items-center justify-center transition"
        >
          <Play size={22} className="text-white ml-0.5" />
        </button>
      </div>
      <audio
        ref={audioRef}
        src={`/api/audio/file/${encodeURIComponent(filename)}`}
        onEnded={() => setPlaying(false)}
        preload="metadata"
      />
    </div>
  );
}

/** Mean energy of the analysed track, 0..1. */
function averageEnergy(analysis: AudioAnalysisResult): number | null {
  if (!analysis.energy_curve || analysis.energy_curve.length === 0) return null;
  const sum = analysis.energy_curve.reduce((a, b) => a + b, 0);
  return sum / analysis.energy_curve.length;
}

/**
 * The file name of a stored path, for either separator.
 *
 * The upload response's `filename` field is the *original* name; the file on
 * disk carries a content-hash prefix (`<hash>_name.wav`), and that is the
 * name the analysis and file-serving endpoints expect.
 */
function basenameOf(storedPath: string): string {
  const parts = storedPath.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : storedPath;
}

/**
 * Poll a queued render job until it completes.
 * Mirrors the wizard's polling (`MusicVideoWizard.tsx`).
 */
async function pollJob(jobId: string, maxWaitSeconds = 180): Promise<string> {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxWaitSeconds) {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(`Job poll failed (${res.status})`);
    const job = await res.json();
    if (job.status === "completed") {
      const path: string =
        job.output_path || job.result?.output_path || `output/video/${jobId}.mp4`;
      return toOutputUrl(path);
    }
    if (job.status === "failed" || job.status === "dead") {
      throw new Error(job.error || "The render failed");
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("The render took too long");
}

/**
 * Turn a server path into a URL the browser can play.
 * `output/` is mounted as static files at `/output`.
 */
function toOutputUrl(serverPath: string): string {
  const normalized = serverPath.replace(/\\/g, "/");
  const idx = normalized.indexOf("output/");
  if (idx === -1) return normalized;
  return `/${normalized.slice(idx)}`;
}
