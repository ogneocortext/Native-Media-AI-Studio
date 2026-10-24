/**
 * VideoGenerationPage — render a video section from audio + prompt.
 *
 * Main orchestrator — composes extracted components and delegates
 * stateful logic to custom hooks.
 */
import { useState } from "react";
import { Film, Wand2, Loader2 } from "lucide-react";
import { DS } from "../../styles/designSystem";
import { useVideoModels } from "./hooks/useVideoModels";
import { useJobProgress, useQueueStatus } from "./hooks";
import { QueueStatus } from "./components/QueueStatus";
import { JobProgress } from "./components/JobProgress";
import { ModelSelector } from "./components/ModelSelector";
import { AdvancedSettings } from "./components/AdvancedSettings";

interface VideoGenerationResult {
  job_id: string;
  status: string;
}

/**
 * Main orchestrator for the video generation page.
 *
 * Responsibilities:
 * - Compose UI sections (model selector, form, results, queue)
 * - Delegate state management to hooks
 * - Handle cross-component coordination (e.g., progress polling)
 */
export function VideoGenerationPage() {
  const {
    videoModels,
    loadingModels,
    comfyStatus,
    error: modelsError,
    refetch: refetchModels,
  } = useVideoModels();

  const { jobProgress, startProgressPolling } = useJobProgress();
  const { queueInfo } = useQueueStatus();

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(
    "blurry, low quality, distorted"
  );
  const [selectedModel, setSelectedModel] = useState("");
  const [duration, setDuration] = useState(10);
  const [verticalFirst, setVerticalFirst] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<VideoGenerationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scheduler, setScheduler] = useState("normal");
  const [fps, setFps] = useState(8);
  const [resolution, setResolution] = useState("480p");
  const [batchCount, setBatchCount] = useState(1);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/video/generate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt,
          model: selectedModel,
          duration,
          vertical_first: verticalFirst,
          scheduler,
          fps,
          resolution,
          batch_count: batchCount,
        }),
      });
      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      const data = await res.json();
      setResults((prev) => [...prev, data]);
      startProgressPolling(data.job_id);
      setGenerating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setGenerating(false);
    }
  };

  return (
    <div>
      {modelsError && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded p-4 mb-4 flex items-center gap-3">
          <span>Failed to load models</span>
          <button
            onClick={refetchModels}
            className="text-xs underline text-red-200 hover:text-white"
          >
            Retry
          </button>
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded p-4 mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left — Controls */}
        <div className="space-y-3">
          <ModelSelector
            models={videoModels}
            loading={loadingModels}
            status={comfyStatus}
            selected={selectedModel}
            onChange={setSelectedModel}
          />

          <div className={DS.card} style={{ padding: 16 }}>
            <div className="flex items-center gap-2 mb-3">
              <Film size={16} />
              <h3 className="text-sm font-semibold text-white">Generation</h3>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your video..."
              className={`${DS.textarea} w-full`}
              rows={4}
            />
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Negative prompt (optional)"
              className={`${DS.textarea} w-full mt-2`}
              rows={2}
            />
          </div>

          <AdvancedSettings
            show={showAdvanced}
            onToggle={() => setShowAdvanced((v) => !v)}
            duration={duration}
            onDurationChange={setDuration}
            verticalFirst={verticalFirst}
            onVerticalFirstChange={setVerticalFirst}
            scheduler={scheduler}
            onSchedulerChange={setScheduler}
            onRandomSeed={() => {}}
            fps={fps}
            onFpsChange={setFps}
            resolution={resolution}
            onResolutionChange={setResolution}
            batchCount={batchCount}
            onBatchCountChange={setBatchCount}
          />

          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || comfyStatus === "offline"}
            className={`${DS.btnFull} flex items-center gap-2`}
          >
            {generating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Wand2 />
            )}
            {generating ? "Generating..." : "Generate Video"}
          </button>
        </div>

        {/* Right — Results & Queue */}
        <div className="space-y-3">
          <QueueStatus info={queueInfo} />

          <div className="space-y-2">
            {results.map((r: VideoGenerationResult, idx: number) => (
              <div
                key={r.job_id || idx}
                className={DS.card}
                style={{ padding: 16 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">
                    {r.job_id}
                  </span>
                  <span className="text-xs text-muted">{r.status}</span>
                </div>
              </div>
            ))}
            {jobProgress && <JobProgress progress={jobProgress} />}
          </div>
        </div>
      </div>
    </div>
  );
}
