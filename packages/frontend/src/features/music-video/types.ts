import {
  Upload,
  Music,
  Wand2,
  Sparkles,
  Play,
  Download,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  AlertCircle,
  Zap,
  Clock,
  Image as ImageIcon,
  Layers,
  Video,
  Smartphone,
  Lightbulb,
  Target,
  BookOpen,
  Sliders,
  Eye,
  FileWarning,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";

export type WizardStep = "upload" | "analyze" | "configure" | "generate" | "review";

export interface AudioAnalysis {
  tempo_bpm: number;
  duration_seconds: number;
  sections: Array<{ type: string; start: number; end: number; energy: number }>;
  beat_count: number;
  beat_times?: number[];
  onset_times?: number[];
  energy_curve?: number[];
  confidence?: number;
  amplitude_envelope?: number[];
  stored_path?: string;
  job_id?: string;
}

export interface GenerationConfig {
  prompt: string;
  negativePrompt: string;
  steps: number;
  cfgScale: number;
  seed: number;
  styleReferences: string[];
  structuredPrompt: { shotSize: string; cameraAngle: string; subject: string; action: string; setting: string; lighting: string; mood: string };
  verticalFirst: boolean;
  sectionOverrides: Record<string, string>;
}

export const PROMPT_SUGGESTIONS: Record<string, string[]> = {
  happy: ["upbeat", "bright", "colorful", "energetic", "joyful", "vibrant"],
  calm: ["peaceful", "serene", "soft", "gentle", "relaxing", "ambient"],
  dark: ["moody", "atmospheric", "cinematic", "dramatic", "intense", "mysterious"],
  electronic: ["neon", "futuristic", "cyberpunk", "glitch", "synth", "digital"],
  natural: ["organic", "earthy", "warm", "sunset", "nature", "flowing"],
};

export const SHOT_SIZES = ["Extreme Wide", "Wide", "Medium", "Close-up", "Extreme Close-up"];
export const CAMERA_ANGLES = ["Eye Level", "Low Angle", "High Angle", "Bird's Eye", "Dutch Angle"];
export const VISUAL_TREATMENTS: Record<string, string> = {
  intro: "Establish mood, slow builds, wide shots",
  verse: "Narrative progression, medium shots",
  "pre-chorus": "Building tension, closer shots",
  chorus: "Peak energy, high impact, close-ups",
  bridge: "Visual pivot, abstract/surprise",
  outro: "Wind down, defocus, final frame",
};

export const STEPS: { id: WizardStep; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; desc: string }[] = [
  { id: "upload", label: "Upload", icon: Upload, desc: "MP3/WAV/FLAC" },
  { id: "analyze", label: "Analyze", icon: Music, desc: "Beats BPM sections" },
  { id: "configure", label: "Style", icon: Wand2, desc: "Prompt + refs" },
  { id: "generate", label: "Generate", icon: Sparkles, desc: "Per-section" },
  { id: "review", label: "Export", icon: Download, desc: "16:9 + 9:16" },
];

// Re-export icons used by step components
export { Upload, Music, Wand2, Sparkles, Play, Download, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, Zap, Clock, ImageIcon, Layers, Video, Smartphone, Lightbulb, Target, BookOpen, Sliders, Eye, FileWarning, ExternalLink, CheckCircle2 };
