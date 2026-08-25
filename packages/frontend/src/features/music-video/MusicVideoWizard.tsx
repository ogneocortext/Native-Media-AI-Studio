import { useState, useCallback, useMemo } from "react";
import { ChevronRight, ChevronLeft, AlertCircle, Check } from "lucide-react";
import { STEPS } from "./types";
import type { WizardStep, AudioAnalysis, GenerationConfig } from "./types";
import { UploadStep, AnalyzeStep, ConfigureStep, GenerateStep, ReviewStep } from "./steps";

const DEFAULT_CONFIG: GenerationConfig = {
  prompt: "",
  negativePrompt: "blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, text",
  steps: 20,
  cfgScale: 7.0,
  seed: -1,
  styleReferences: [],
  structuredPrompt: { shotSize: "Medium", cameraAngle: "Eye Level", subject: "", action: "", setting: "", lighting: "", mood: "" },
  verticalFirst: false,
  sectionOverrides: {},
};

export function MusicVideoWizard() {
  const [currentStep, setCurrentStep] = useState<WizardStep>("upload");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [config, setConfig] = useState<GenerationConfig>(DEFAULT_CONFIG);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedSections, setGeneratedSections] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);

  const handleFileUpload = useCallback((file: File) => {
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) handleFileUpload(file);
    else setError("Please upload an audio file (MP3, WAV, FLAC)");
  }, [handleFileUpload]);

  const analyzeAudio = useCallback(async () => {
    if (!audioFile) return;
    setAnalyzing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", audioFile);
      const res = await fetch("/api/audio/analyze", { method: "POST", body: formData });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail.detail || `Analysis failed (${res.status})`);
      }
      const data: AudioAnalysis = await res.json();
      if (!data.sections || data.sections.length === 0) throw new Error("Analysis returned no sections");
      setAnalysis(data);
      setCurrentStep("analyze");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      let hint = "";
      if (msg.includes("librosa not installed")) hint = " — Backend needs: pip install librosa soundfile";
      else if (msg.includes("Failed to fetch") || msg.includes("Backend not available")) hint = " — Ensure backend is running";
      setError(`${msg}${hint}`);
    } finally { setAnalyzing(false); }
  }, [audioFile]);

  const composedPrompt = useMemo(() => {
    const s = config.structuredPrompt;
    return `${s.shotSize} shot, ${s.cameraAngle.toLowerCase()} angle, ${s.subject} ${s.action}, ${s.setting}, ${s.lighting} lighting, ${s.mood}, cinematic 35mm film`;
  }, [config.structuredPrompt]);

  const generateVideo = useCallback(async () => {
    setGenerating(true); setGenerationProgress(0); setError(null);
    const sections = analysis?.sections || [{ type: "full", start: 0, end: 10, energy: 0.5 }];
    const results: string[] = [];

    const pollJob = async (jobId: string, sectionLabel: string) => {
      const maxWait = 120;
      const start = Date.now();
      while ((Date.now() - start) / 1000 < maxWait) {
        const r = await fetch(`/api/jobs/${jobId}`);
        if (!r.ok) throw new Error(`Job poll failed ${r.status}`);
        const job = await r.json();
        if (job.status === "completed") return (job.output_path as string) || (job.result?.output_path as string) || `output/video/${sectionLabel}_${jobId}.mp4`;
        if (job.status === "failed") throw new Error(job.error || `Section ${sectionLabel} failed`);
        await new Promise(res => setTimeout(res, 1200));
      }
      throw new Error(`Timeout waiting for section ${sectionLabel}`);
    };

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const sectionPrompt = config.sectionOverrides[`${section.type}-${i}`] || config.prompt || composedPrompt;
      const duration = (section.end - section.start) || 10;
      try {
        const res = await fetch("/api/video/generate-section", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: sectionPrompt, negative_prompt: config.negativePrompt, steps: config.steps,
            cfg_scale: config.cfgScale, seed: config.seed === -1 ? Math.floor(Math.random() * 100000) : config.seed,
            section: section.type, duration, vertical_first: config.verticalFirst,
            audio_path: analysis?.stored_path || undefined, audio_filename: audioFile?.name,
          }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(detail.detail || `Queue failed for ${section.type}`);
        }
        const data = await res.json();
        const jobId: string | undefined = data.job_id;
        if (!jobId) throw new Error(`No job_id for ${section.type}`);
        const out = await pollJob(jobId, section.type);
        results.push(out);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Section ${section.type}: ${msg}`);
        results.push(`FAILED:${section.type}`);
      }
      setGenerationProgress(((i + 1) / sections.length) * 100);
    }
    setGeneratedSections(results.filter(r => !r.startsWith("FAILED:")));
    if (results.some(r => r.startsWith("FAILED:"))) setError(prev => prev ? `${prev} — some sections failed` : null);
    setGenerating(false);
    setCurrentStep("review");
  }, [config, analysis, composedPrompt, audioFile]);

  const addPromptSuggestion = (word: string) => {
    if (!config.prompt.toLowerCase().includes(word.toLowerCase())) setConfig((prev) => ({ ...prev, prompt: prev.prompt ? `${prev.prompt}, ${word}` : word }));
  };

  const renderStep = () => {
    switch (currentStep) {
      case "upload": return <UploadStep audioFile={audioFile} audioUrl={audioUrl} onDrop={handleDrop} onFileSelect={handleFileUpload} onNext={() => audioFile && analyzeAudio()} analyzing={analyzing} />;
      case "analyze": return analysis ? <AnalyzeStep analysis={analysis} audioUrl={audioUrl} onNext={() => setCurrentStep("configure")} /> : null;
      case "configure": return <ConfigureStep config={config} composedPrompt={composedPrompt} onConfigChange={setConfig} onSuggestionClick={addPromptSuggestion} onNext={() => setCurrentStep("generate")} />;
      case "generate": return <GenerateStep generating={generating} progress={generationProgress} analysis={analysis} config={config} onStart={generateVideo} />;
      case "review": return <ReviewStep generatedSections={generatedSections} audioUrl={audioUrl} analysis={analysis} />;
      default: return null;
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <div className="flex items-center gap-1 md:gap-0 justify-between bg-gray-800/70 border border-gray-700 rounded-xl p-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon; const isActive = index === currentStepIndex; const isComplete = index < currentStepIndex;
            return (
              <div key={step.id} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center flex-1 min-w-0 px-1">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all shrink-0 ${isComplete ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20" : isActive ? "bg-violet-600 text-white ring-2 ring-violet-400/30 shadow-lg shadow-violet-600/20" : "bg-gray-700 text-gray-400"}`}>
                    {isComplete ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}
                  </div>
                  <span className={`text-[11px] md:text-xs mt-1.5 font-semibold truncate ${isActive ? "text-violet-300" : isComplete ? "text-emerald-400" : "text-gray-500"}`}>{step.label}</span>
                  <span className="text-[10px] text-gray-500 hidden md:block truncate">{step.desc}</span>
                </div>
                {index < STEPS.length - 1 && <div className={`hidden md:block flex-1 h-0.5 mx-1 rounded ${index < currentStepIndex ? "bg-emerald-600" : "bg-gray-700"}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg flex items-start gap-2 text-amber-200 text-sm"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span><button onClick={() => setError(null)} className="ml-auto text-amber-300 hover:text-white text-xs">Dismiss</button></div>}

      <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-xl overflow-hidden">{renderStep()}</div>

      <div className="flex justify-between mt-4">
        <button onClick={() => { const prev = STEPS[currentStepIndex - 1]; if (prev) setCurrentStep(prev.id); }} disabled={currentStepIndex === 0} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-2 text-sm font-medium"><ChevronLeft size={16} /> Back</button>
        <button onClick={() => { const next = STEPS[currentStepIndex + 1]; if (next) setCurrentStep(next.id); }} disabled={currentStepIndex === STEPS.length - 1 || !audioFile} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg flex items-center gap-2 text-sm font-medium">Next <ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
