import { useState, useCallback, useEffect, useRef } from "react";
import type { useNavigate } from "react-router-dom";
import { generate3D, generate3DFromImage, get3DStatus, updateMCPContext } from "../../services/api";

export interface CharacterBible {
  name: string;
  notes: string;
  seed: number;
  prompt: string;
}

export interface GeneratedModel {
  filename: string;
  path: string;
  servable_url?: string | null;
  size_bytes: number;
  modified: number;
}

export interface VizParams {
  cfg: number;
  color: string;
  metalness: number;
  roughness: number;
  scale: number;
  resolution: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  vram: string;
  time: string;
  desc: string;
  color: string;
  available: boolean;
  unavailableHint?: string;
}

export const PROMPT_EXAMPLES = [
  {
    label: "Robot",
    prompt: "a futuristic robot, chrome metallic, highly detailed, standing pose",
    tag: "character",
  },
  {
    label: "Neon Mic",
    prompt: "a neon microphone, cyberpunk style, glowing accents, floating",
    tag: "prop",
  },
  {
    label: "DJ Console",
    prompt: "a DJ console, modern minimalist, LED indicators, top-down view",
    tag: "prop",
  },
  {
    label: "Stage",
    prompt: "concert stage platform, LED walls, fog, cinematic volumetric lighting",
    tag: "environment",
  },
] as const;

export const CHARACTER_TEMPLATES = [
  {
    label: "Humanoid",
    prompt:
      "a stylized humanoid character, athletic build, matte bodysuit with glowing seam lines, symmetrical proportions, neutral A-pose, highly detailed, standing pose",
    bible: "Stylized humanoid; athletic build; matte bodysuit, glowing seams",
  },
  {
    label: "Avatar Bust",
    prompt:
      "a stylized avatar bust, androgynous face, short dark hair, smooth skin, studio lighting, front-facing portrait, highly detailed",
    bible: "Avatar bust; androgynous face; short dark hair",
  },
  {
    label: "Creature",
    prompt:
      "a small forest creature mascot, big expressive eyes, soft fur, rounded friendly forms, standing pose, highly detailed",
    bible: "Forest creature mascot; big eyes; soft fur; rounded forms",
  },
  {
    label: "Robot",
    prompt: "a futuristic robot, chrome metallic, highly detailed, standing pose",
    bible: "Futuristic robot; chrome metallic",
  },
] as const;

export const MATERIAL_TEMPLATES = [
  {
    label: "Leather Jacket",
    prompt:
      "a stylized character wearing a worn brown leather jacket, metal zippers, fabric folds, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "clothing",
  },
  {
    label: "Chainmail",
    prompt:
      "a stylized character wearing intricate chainmail armor, metallic rings, subsurface metal reflections, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "clothing",
  },
  {
    label: "Silk Robe",
    prompt:
      "a stylized character wearing a flowing silk robe, fabric drape, soft highlights, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "clothing",
  },
  {
    label: "Skin Material",
    prompt:
      "character skin material reference, subsurface scattering, pore detail, freckles, neutral expression, studio lighting, reference plate, highly detailed",
    tag: "skin",
  },
  {
    label: "Robot Plating",
    prompt:
      "a futuristic robot character with panel plating, wear and tear, scuff marks, exposed wiring joints, neutral A-pose, front view, studio lighting, white background, highly detailed, game-ready",
    tag: "material",
  },
  {
    label: "Environment Prop",
    prompt:
      "a detailed environment prop, weathered wood and rusted metal, cinematic lighting, matte painting style, game engine ready, highly detailed",
    tag: "environment",
  },
] as const;

const PENDING_CHARACTER_KEY = "pendingCharacter";

// Distilled DiT variants need proportionally fewer diffusion steps.
const MODEL_SPEED_FACTOR: Record<string, number> = {
  hunyuan3d_2mini_fast: 0.7,
  hunyuan3d_2mini_turbo: 0.5,
};

// TripoSR is a single feed-forward pass — the steps slider doesn't apply,
// so it gets a flat estimate instead of the steps-scaled formula.
const MODEL_ESTIMATE_SEC: Record<string, number> = {
  triposr: 60,
};

// Magic-byte check mirroring the backend's _sniff_image_type — file.type is
// client-supplied and spoofable, so verify the payload signature too.
async function sniffImageType(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const b = Array.from(head);
  const isPng = b.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isWebp =
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  if (isPng) return "image/png";
  if (isJpeg) return "image/jpeg";
  if (isWebp) return "image/webp";
  return null;
}

function loadBibles(): Record<string, CharacterBible> {
  try {
    return JSON.parse(localStorage.getItem("characterBibles") ?? "{}") as Record<
      string,
      CharacterBible
    >;
  } catch {
    return {};
  }
}

export const PIPELINE_STEPS = [
  { n: 1, t: "Text Prompt", c: "text-sky-400" },
  { n: 2, t: "ComfyUI (Hunyuan3D)", c: "text-violet-400 font-bold" },
  { n: 3, t: "GLB Output", c: "text-emerald-400" },
  { n: 4, t: "Blender Refine", c: "text-orange-400" },
  { n: 5, t: "Sync & Animate", c: "text-amber-400" },
  { n: 6, t: "Render & Export", c: "text-emerald-400" },
] as const;

export type WizardStep = "describe" | "style" | "generate";

// Phases ComfyUI can't report over REST stay null and render as "—".
export interface GenTiming {
  queueWaitTime: number | null;
  modelLoadTime: number | null;
  inferenceTime: number | null;
  postProcessTime: number | null;
  totalTime: number;
  vramPeak: number | null;
}

interface ServerGenTiming {
  queue_wait_ms?: number | null;
  inference_ms?: number | null;
  post_process_ms?: number | null;
  total_ms?: number | null;
  vram_peak_mb?: number | null;
}

function toGenTiming(t: ServerGenTiming | null | undefined, fallbackTotalMs: number): GenTiming {
  return {
    queueWaitTime: t?.queue_wait_ms ?? null,
    modelLoadTime: null, // ComfyUI REST exposes no per-phase model-load split
    inferenceTime: t?.inference_ms ?? null,
    postProcessTime: t?.post_process_ms ?? null,
    totalTime: t?.total_ms ?? fallbackTotalMs,
    vramPeak: t?.vram_peak_mb ?? null,
  };
}

export interface UseGeneration3DReturn {
  // State
  prompt: string;
  setPrompt: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  steps: number;
  setSteps: (v: number) => void;
  generating: boolean;
  result: Record<string, unknown> | null;
  setResult: (v: Record<string, unknown> | null) => void;
  status3d: Record<string, unknown>;
  statusLoading: boolean;
  error: string | null;
  setError: (v: string | null) => void;
  elapsed: number;
  generatedList: GeneratedModel[];
  historyLoading: boolean;
  wizardStep: WizardStep;
  setWizardStep: (v: WizardStep) => void;
  vizParams: VizParams;
  setVizParams: (v: VizParams) => void;
  genMode: "text" | "reference";
  setGenMode: (v: "text" | "reference") => void;
  charName: string;
  setCharName: (v: string) => void;
  charNotes: string;
  setCharNotes: (v: string) => void;
  seed: number;
  setSeed: (v: number) => void;
  refFile: File | null;
  refPreviewUrl: string | null;
  refError: string | null;
  bibles: Record<string, CharacterBible>;

  // Derived
  selectedModel: ModelInfo;
  wordCount: number;
  isAvailable: boolean;
  comfyRunning: boolean;
  estimatedSec: number;
  glbUrl: string | null;
  glbFilename: string | null;
  resultModelPath: string | null | undefined;
  genTiming: GenTiming | null;

  // Actions
  saveBible: (filename: string, bible: CharacterBible) => void;
  randomizeSeed: () => void;
  handleReferenceFile: (file: File | null) => void;
  sendToStudio: (filename: string) => void;
  loadStatus: () => Promise<void>;
  loadHistory: () => Promise<void>;
  handleGenerate: () => Promise<void>;
  handleGenerateFromReference: () => Promise<void>;
  models: readonly ModelInfo[];
  navigate: ReturnType<typeof useNavigate>;
}

export function useGeneration3D(navigate: ReturnType<typeof useNavigate>): UseGeneration3DReturn {
  const [prompt, setPrompt] = useState(
    "a futuristic robot, chrome metallic, highly detailed, standing pose",
  );
  const [model, setModel] = useState("hunyuan3d_2mini");
  const [steps, setSteps] = useState(15);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [status3d, setStatus3d] = useState<Record<string, unknown>>({});
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [genTiming, setGenTiming] = useState<GenTiming | null>(null);
  const [generatedList, setGeneratedList] = useState<GeneratedModel[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("describe");

  const [vizParams, setVizParams] = useState<VizParams>({
    cfg: 7.0,
    color: "#00ffff",
    metalness: 0.6,
    roughness: 0.4,
    scale: 1.0,
    resolution: 256,
  });

  const [genMode, setGenMode] = useState<"text" | "reference">("text");
  const [charName, setCharName] = useState("");
  const [charNotes, setCharNotes] = useState("");
  const [seed, setSeed] = useState(42);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refPreviewUrl, setRefPreviewUrl] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const sniffSeq = useRef(0);
  const [bibles, setBibles] = useState<Record<string, CharacterBible>>(loadBibles);

  const saveBible = useCallback((filename: string, bible: CharacterBible) => {
    setBibles((prev) => {
      const next = { ...prev, [filename]: bible };
      try {
        localStorage.setItem("characterBibles", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const randomizeSeed = useCallback(() => {
    setSeed(Math.floor(Math.random() * 2 ** 31));
  }, []);

  const handleReferenceFile = useCallback(
    (file: File | null) => {
      // Bumped on every call (including clears) so an in-flight sniff for a
      // previously picked file can't resurrect it after the selection changed.
      const seq = ++sniffSeq.current;
      if (refPreviewUrl) URL.revokeObjectURL(refPreviewUrl);
      setRefPreviewUrl(null);
      setRefFile(null);
      setRefError(null);
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setRefError("Reference must be PNG, JPEG, or WebP.");
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setRefError("Reference image exceeds 15 MB.");
        return;
      }
      // Async magic-byte check; reject before upload instead of after a 415.
      void sniffImageType(file).then((sniffed) => {
        if (seq !== sniffSeq.current) return;
        if (!sniffed) {
          setRefError("File content is not a valid PNG, JPEG, or WebP image.");
          return;
        }
        setRefFile(file);
        setRefPreviewUrl(URL.createObjectURL(file));
      });
    },
    [refPreviewUrl],
  );

  // Revoke the object URL on unmount — handleReferenceFile only cleans up the
  // *previous* URL when a new file is picked.
  useEffect(() => {
    return () => {
      if (refPreviewUrl) URL.revokeObjectURL(refPreviewUrl);
    };
  }, [refPreviewUrl]);

  const bibleForResult = useCallback(
    (): CharacterBible => ({
      name: charName.trim(),
      notes: charNotes.trim(),
      seed,
      prompt,
    }),
    [charName, charNotes, seed, prompt],
  );

  const sendToStudio = useCallback(
    (filename: string) => {
      const bible = bibles[filename] ?? bibleForResult();
      const servable = `/output/generated_3d/${filename}`;
      try {
        localStorage.setItem(
          PENDING_CHARACTER_KEY,
          JSON.stringify({
            modelUrl: servable,
            name: bible.name || filename.replace(/\.glb$/i, ""),
            bible: [bible.name, bible.notes].filter(Boolean).join(" — ") || bible.prompt,
          }),
        );
      } catch {
        /* ignore */
      }
      void navigate("/three-js-studio");
    },
    [bibles, bibleForResult, navigate],
  );

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await get3DStatus();
      setStatus3d(data);
    } catch {
      setStatus3d({ available: false, error: "Backend not reachable" });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/3d/models`);
      if (res.ok) {
        const models = (await res.json()) as {
          filename: string;
          path: string;
          size_bytes: number;
          servable_url?: string | null;
          modified?: number;
        }[] | null;
        if (Array.isArray(models) && models.length > 0) {
          const mapped = models
            .slice(0, 10)
            .map((m) => ({
                filename: m.filename,
                path: m.path,
                servable_url: m.servable_url ?? null,
                size_bytes: m.size_bytes,
                modified: m.modified ?? 0,
              }),
            );
          setGeneratedList(mapped);
          return;
        }
      }
      const res2 = await fetch(`/api/outputs`);
      if (res2.ok) {
        const d2 = (await res2.json()) as {
          outputs?: { filename: string; path?: string; size?: number }[];
        };
        const outs = d2.outputs ?? [];
        setGeneratedList(
          outs
            .filter((f) => f.filename.endsWith(".glb"))
            .slice(0, 10)
            .map((f) => ({
              filename: f.filename,
              path: f.path ?? "",
              servable_url: null,
              size_bytes: f.size ?? 0,
              modified: 0,
            })),
        );
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadHistory();
  }, [loadStatus, loadHistory]);

  useEffect(() => {
    if (!generating) {
      setElapsed(0);
      return;
    }
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, [generating]);

  // Live availability comes from /api/3d/status -> backend_health (weights on
  // disk + Hy3D node classes registered). Falls back to the historical static
  // flags only while status is still loading or the field is absent.
  const backendHealth = (status3d.backend_health ?? {}) as Record<
    string,
    { available?: boolean } | undefined
  >;
  const healthAvailable = (id: string, fallback: boolean) =>
    backendHealth[id]?.available ?? fallback;

  const models: readonly ModelInfo[] = [
    {
      id: "hunyuan3d_2mini",
      name: "Hunyuan3D-2mini",
      vram: "5GB",
      time: "3-5 min",
      desc: "0.6B • Installed & 8GB-safe",
      color: "text-emerald-400",
      available: healthAvailable("hunyuan3d_2mini", true),
    },
    {
      id: "hunyuan3d_2mini_fast",
      name: "Hunyuan3D-2mini Fast",
      vram: "5GB",
      time: "2-4 min",
      desc: "0.6B distilled • faster drafts",
      color: "text-emerald-400",
      available: healthAvailable("hunyuan3d_2mini_fast", false),
    },
    {
      id: "hunyuan3d_2mini_turbo",
      name: "Hunyuan3D-2mini Turbo",
      vram: "5GB",
      time: "1-2 min",
      desc: "0.6B turbo-distilled • fastest",
      color: "text-emerald-400",
      available: healthAvailable("hunyuan3d_2mini_turbo", false),
    },
    {
      id: "triposr",
      name: "TripoSR",
      vram: "6GB",
      time: "~1 min",
      desc: "Single-pass image→mesh • vertex colors • fastest",
      color: "text-sky-400",
      available: healthAvailable("triposr", false),
    },
    {
      id: "hunyuan3d-2",
      name: "Hunyuan3D-2",
      vram: "9GB+",
      time: "6-8 min",
      desc: "1.2B • Not installed on this system",
      color: "text-amber-400",
      available: false,
      unavailableHint: "Hunyuan3D-2 full is not installed — use a 2mini variant",
    },
  ];

  const selectedModel = models.find((m) => m.id === model) ?? models[0];
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const isAvailable = (status3d.available as boolean | undefined) ?? false;
  const comfyRunning = (status3d.comfyui_running as boolean | undefined) ?? false;
  const estimatedSec =
    MODEL_ESTIMATE_SEC[model] ??
    Math.round(
      (steps <= 10 ? 90 : steps <= 15 ? 150 : steps <= 20 ? 210 : 300) *
        (MODEL_SPEED_FACTOR[model] ?? 1),
    );

  const resultModelPath = (result as { model_path?: string } | null)?.model_path;
  const glbFilename = resultModelPath
    ? (String(resultModelPath).split(/[\\/]/).pop() ?? null)
    : null;
  const glbUrl =
    glbFilename && (result as { success?: boolean } | null)?.success
      ? `/output/generated_3d/${glbFilename}`
      : null;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (prompt.length > 500) {
      setError("Prompt too long (max 500 chars). Keep under 75 words.");
      return;
    }
    const sel = models.find((m) => m.id === model);
    if (sel && !sel.available) {
      setError(`${sel.name} is not available — pick an installed variant or start ComfyUI.`);
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);
    setGenTiming(null);
    const start = Date.now();
    let serverTiming: ServerGenTiming | null = null;
    try {
      const data = await generate3D({
        prompt,
        model,
        steps,
        seed,
        cfg: vizParams.cfg,
      });
      serverTiming = (data as { timing?: ServerGenTiming }).timing ?? null;
      setResult(data as unknown as Record<string, unknown>);
      if ((data as { success?: boolean }).success === false) {
        setError(
          (data as { error?: string }).error ?? "Generation failed — check ComfyUI and VRAM",
        );
      } else {
        const mp = (data as { model_path?: string }).model_path;
        const fn = mp ? String(mp).split(/[\\/]/).pop() : null;
        if (fn) saveBible(fn, bibleForResult());
        if (fn) {
          updateMCPContext({
            character: {
              name: charName.trim() || fn.replace(/\.glb$/i, ""),
              notes: charNotes.trim(),
              seed,
              prompt,
              visible: true,
            },
            scene: { name: "Generated3D" },
          }).catch(() => {
            /* non-fatal */
          });
        }
      }
      void loadStatus();
      void loadHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("timeout") || msg.includes("504")) {
        setError(
          "Generation timed out — Hunyuan3D-2mini takes 2-4 min on 8GB. Check Queue or try fewer steps.",
        );
      } else if (msg.includes("VRAM") || msg.includes("memory")) {
        setError(
          "VRAM full — close ComfyUI/Blender, reduce steps to 10, or use 2mini. See /health.",
        );
      } else {
        setError(msg || "Generation failed");
      }
    } finally {
      setGenerating(false);
      const totalTime = Date.now() - start;
      setGenTiming(toGenTiming(serverTiming, totalTime));
      const dur = Math.round(totalTime / 1000);
      if (dur > 5) console.log(`3D generation took ${dur}s`);
    }
  };

  const handleGenerateFromReference = async () => {
    if (!refFile) return;
    const sel = models.find((m) => m.id === model);
    if (sel && !sel.available) {
      setError(`${sel.name} is not available — pick an installed variant or start ComfyUI.`);
      return;
    }
    setGenerating(true);
    setError(null);
    setResult(null);
    setGenTiming(null);
    const start = Date.now();
    let serverTiming: ServerGenTiming | null = null;
    try {
      const data = await generate3DFromImage(refFile, { steps, model });
      serverTiming = (data as { timing?: ServerGenTiming }).timing ?? null;
      setResult(data as unknown as Record<string, unknown>);
      if ((data as { success?: boolean }).success === false) {
        setError(
          (data as { error?: string }).error ??
            "Reference generation failed — check ComfyUI and VRAM",
        );
      } else {
        const mp = (data as { model_path?: string }).model_path;
        const fn = mp ? String(mp).split(/[\\/]/).pop() : null;
        if (fn) saveBible(fn, bibleForResult());
      }
      void loadStatus();
      void loadHistory();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reference generation failed");
    } finally {
      setGenerating(false);
      setGenTiming(toGenTiming(serverTiming, Date.now() - start));
      const dur = Math.round((Date.now() - start) / 1000);
      if (dur > 5) console.log(`Reference 3D generation took ${dur}s`);
    }
  };

  return {
    prompt,
    setPrompt,
    model,
    setModel,
    steps,
    setSteps,
    generating,
    result,
    setResult,
    status3d,
    statusLoading,
    error,
    setError,
    elapsed,
    generatedList,
    historyLoading,
    wizardStep,
    setWizardStep,
    vizParams,
    setVizParams,
    genMode,
    setGenMode,
    charName,
    setCharName,
    charNotes,
    setCharNotes,
    seed,
    setSeed,
    refFile,
    refPreviewUrl,
    refError,
    bibles,
    selectedModel,
    wordCount,
    isAvailable,
    comfyRunning,
    estimatedSec,
    glbUrl,
    glbFilename,
    resultModelPath,
    saveBible,
    randomizeSeed,
    handleReferenceFile,
    sendToStudio,
    loadStatus,
    loadHistory,
    handleGenerate,
    handleGenerateFromReference,
    models,
    navigate,
    genTiming,
  };
}
