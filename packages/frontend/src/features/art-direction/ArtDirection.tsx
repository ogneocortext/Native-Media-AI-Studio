/**
 * Art Direction — Modular visual system with live style preview
 * Redesigned for clarity: every option has a visible effect,
 * tooltips explain what each variant does, and a live style tile
 * shows the combined result of all active modules.
 */

import { useState, useEffect } from "react";
import { Card } from "../../components/common";
import {
  Film,
  Palette,
  Type,
  Sparkles,
  Box,
  Music,
  Eye,
  Settings2,
  Move,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Info,
  BookOpen,
} from "lucide-react";
import {
  defaultModules,
  SONGS,
  paletteVariants,
  typographyVariants,
} from "./art-direction-data";
import type { ModuleId, ModuleState, SongId } from "./art-direction-data";

const moduleIcons: Record<ModuleId, React.ComponentType<{ size?: number; className?: string }>> = {
  audio: Music,
  palette: Palette,
  typography: Type,
  bento: LayoutGrid,
  texture: Sparkles,
  blender: Box,
  motion: Move,
  storyboard: Film,
  preview: Eye,
};

const moduleLabels: Record<ModuleId, string> = {
  audio: "Audio Analysis",
  palette: "Palette System",
  typography: "Typography",
  bento: "Layout",
  texture: "Texture & Grain",
  blender: "3D Assets",
  motion: "Motion",
  storyboard: "Storyboard",
  preview: "Previews",
};

const moduleColors: Record<ModuleId, string> = {
  audio: "text-sky-400",
  palette: "text-violet-400",
  typography: "text-amber-400",
  bento: "text-emerald-400",
  texture: "text-cyan-400",
  blender: "text-orange-400",
  motion: "text-pink-400",
  storyboard: "text-red-400",
  preview: "text-indigo-400",
};

const moduleTooltips: Record<ModuleId, string> = {
  audio: "Tempo, key, and loudness data that drives visual reactivity",
  palette: "Color scheme applied to backgrounds, accents, and overlays",
  typography: "Font style, size animation, and text placement rules",
  bento: "Grid layout structure for meta info and visual panels",
  texture: "Overlay grain and surface texture for visual depth",
  blender: "3D asset quality level for rendered scenes",
  motion: "Animation speed, easing, and transition intensity",
  storyboard: "Shot sequence and narrative structure",
  preview: "Output preview clips at different stages",
};

export function ArtDirection() {
  const [modules, setModules] = useState<ModuleState[]>(defaultModules);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [activeDoc, setActiveDoc] = useState<string>("VISUAL_STORYTELLING_2026.md");
  const [docContent, setDocContent] = useState<string>("Loading...");
  const [song, setSong] = useState<SongId>("still-i-rise");
  const [expandedModule, setExpandedModule] = useState<ModuleId | null>(null);
  const [showDocs, setShowDocs] = useState(false);

  useEffect(() => {
    fetch(SONGS[song].analysis)
      .then((r) => r.json())
      .then((data) => setAnalysis(data as Record<string, unknown>))
      .catch(() => {});
    setActiveDoc(SONGS[song].docFiles[0]);
  }, [song]);

  useEffect(() => {
    fetch(`/docs/${activeDoc}`)
      .then((r) => r.text())
      .then(setDocContent)
      .catch(() => setDocContent("Failed to load doc"));
  }, [activeDoc]);

  const toggle = (id: ModuleId) =>
    setModules((ms) => ms.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)));
  const setVariant = (id: ModuleId, variant: string) =>
    setModules((ms) => ms.map((m) => (m.id === id ? { ...m, variant } : m)));
  const enabledCount = modules.filter((m) => m.enabled).length;

  // Compute derived values for the style tile
  const activePalette = paletteVariants[modules.find((m) => m.id === "palette")?.variant || "nocturnal"];
  const activeMotion = modules.find((m) => m.id === "motion")?.variant || "restrained";
  const activeTypography = typographyVariants[modules.find((m) => m.id === "typography")?.variant || "kinetic"];
  const motionIntensity = activeMotion === "restrained" ? 0.42 : activeMotion === "maximalist" ? 0.88 : 0.05;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Palette size={24} className="text-primary" /> Art Direction
        </h1>
        <p className="text-muted mt-1">
          Modular visual systems for {SONGS[song].label} — {enabledCount} active modules
        </p>
      </div>

      {/* Song Selector & Actions */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={song}
          onChange={(e) => setSong(e.target.value as SongId)}
          className="select text-sm"
        >
          <option value="still-i-rise">Still I Rise</option>
          <option value="take-the-crown">Take the Crown</option>
        </select>
        <span className="text-xs px-3 py-1.5 rounded-full bg-primary/15 border border-primary/20">
          {SONGS[song].badge}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowDocs(!showDocs)}
          className={`btn btn-ghost text-sm ${showDocs ? "text-primary" : ""}`}
        >
          Docs
        </button>
        <a href="/preview/" target="_blank" className="btn btn-secondary text-sm">
          <Eye size={16} />
          Open Preview
        </a>
      </div>

      {/* LIVE STYLE TILE — Shows combined effect of all modules */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Eye size={16} className="text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Style Tile</h3>
              <p className="text-xs text-muted">Live preview of your art direction settings</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="px-2 py-1 bg-background rounded capitalize">{activePalette.name}</span>
            <span className="px-2 py-1 bg-background rounded capitalize">{activeTypography.name}</span>
          </div>
        </div>

        {/* Visual Style Tile */}
        <div
          className="relative h-48 rounded-lg overflow-hidden border border-border"
          style={{
            background: `linear-gradient(135deg, ${activePalette.swatches[0]} 0%, ${activePalette.swatches[1]} 50%, ${activePalette.swatches[2]} 100%)`,
          }}
        >
          {/* Texture overlay */}
          {modules.find((m) => m.id === "texture")?.enabled && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,${modules.find((m) => m.id === "texture")?.variant === "VHS 0.075" ? "0.08" : "0.03"}) 2px, transparent 4px)`,
                mixBlendMode: "overlay",
              }}
            />
          )}

          {/* Content mockup */}
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6">
            {/* Title with typography style */}
            <h2
              className={`font-bold mb-2 ${
                modules.find((m) => m.id === "typography")?.enabled
                  ? modules.find((m) => m.id === "typography")?.variant === "hero"
                    ? "text-4xl"
                    : modules.find((m) => m.id === "typography")?.variant === "editorial"
                      ? "text-lg tracking-wide"
                      : "text-2xl"
                  : "text-2xl"
              }`}
              style={{
                color: activePalette.swatches[2] || "#ffffff",
                fontFamily: modules.find((m) => m.id === "typography")?.variant === "editorial" ? "serif" : "inherit",
                transform: modules.find((m) => m.id === "motion")?.enabled
                  ? `scale(${1 + motionIntensity * 0.05})`
                  : "scale(1)",
                transition: "transform 0.3s ease",
              }}
            >
              STILL I RISE
            </h2>

            {/* Color palette strip */}
            <div className="flex gap-2 mt-3">
              {activePalette.swatches.map((color, i) => (
                <div
                  key={i}
                  className="w-10 h-10 rounded-lg border border-white/20 shadow-lg"
                  style={{ background: color }}
                  title={["Primary", "Secondary", "Accent", "Highlight"][i]}
                />
              ))}
            </div>

            {/* Motion indicator */}
            {modules.find((m) => m.id === "motion")?.enabled && (
              <div className="mt-4 flex items-center gap-2">
                <div className="h-1.5 w-32 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/80 rounded-full transition-all duration-500"
                    style={{ width: `${motionIntensity * 100}%` }}
                  />
                </div>
                <span className="text-xs text-white/60 capitalize">{activeMotion}</span>
              </div>
            )}
          </div>

          {/* Disabled overlay */}
          {enabledCount < 9 && (
            <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 rounded text-xs text-white/70">
              {9 - enabledCount} module{9 - enabledCount > 1 ? "s" : ""} disabled
            </div>
          )}
        </div>
      </Card>

      {/* Module Grid — Progressive Disclosure */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {modules.map((mod) => {
          const Icon = moduleIcons[mod.id];
          const color = moduleColors[mod.id];
          const isExpanded = expandedModule === mod.id;

          return (
            <div
              key={mod.id}
              className={`rounded-lg border transition-all ${
                mod.enabled
                  ? "border-border bg-surface"
                  : "border-border/50 bg-surface/50 opacity-60"
              } ${isExpanded ? "ring-1 ring-primary/30" : ""}`}
            >
              {/* Module Header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer"
                onClick={() => setExpandedModule(isExpanded ? null : mod.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg bg-background flex items-center justify-center ${color}`}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{moduleLabels[mod.id]}</p>
                      <div className="group relative">
                        <Info size={12} className="text-muted cursor-help" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-background border border-border rounded-lg text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                          {moduleTooltips[mod.id]}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      {mod.enabled ? getVariantLabel(mod.id, mod.variant) : "Disabled"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={mod.enabled}
                    onClick={(e) => { e.stopPropagation(); toggle(mod.id); }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      mod.enabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-y-[-1px]">
                      <span className={`absolute inset-0 flex h-full w-full items-center justify-center transition-opacity ${mod.enabled ? "opacity-0" : "opacity-100"}`}>
                        <svg className="h-3 w-3 text-muted" fill="none" viewBox="0 0 12 12"><path d="M4 8l2-2m0 0l2-2M6 6L4 4m2 2l2 2" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      <span className={`absolute inset-0 flex h-full w-full items-center justify-center transition-opacity ${mod.enabled ? "opacity-100" : "opacity-0"}`}>
                        <svg className="h-3 w-3 text-primary" fill="currentColor" viewBox="0 0 12 12"><path d="M3.707 5.293a1 1 0 00-1.414 1.414l1.414-1.414zM5 8l-.707.707a1 1 0 001.414 0L5 8zm4.707-3.293a1 1 0 00-1.414-1.414l1.414 1.414zm-7.414 2l2 2 1.414-1.414-2-2-1.414 1.414zm3.414 2l4-4-1.414-1.414-4 4 1.414 1.414z" /></svg>
                      </span>
                    </span>
                    <span aria-hidden="true" className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${mod.enabled ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                  {isExpanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                </div>
              </div>

              {/* Module Details — Expandable */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border/50">
                  <div className="pt-4 space-y-4">
                    {mod.id === "audio" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Tempo Detection
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("audio", e.target.value)}
                            className="select text-sm w-full"
                          >
                            <option>{song === "take-the-crown" ? "152 BPM detected" : "99.4 BPM detected"}</option>
                            <option>{song === "take-the-crown" ? "76 BPM half-time" : "132 BPM swung"}</option>
                            <option>{song === "take-the-crown" ? "E major key" : "65 BPM half-time"}</option>
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Drives visual reactivity — faster BPM = more rapid visual changes
                          </p>
                        </div>
                        {analysis && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-2.5 bg-background rounded-lg">
                              <span className="text-xs text-muted">Key</span>
                              <p className="font-mono font-medium text-sm">{String((analysis as Record<string, unknown>).estimated_key ?? "")}</p>
                            </div>
                            <div className="p-2.5 bg-background rounded-lg">
                              <span className="text-xs text-muted">Loudness</span>
                              <p className="font-mono font-medium text-sm">{String((analysis as Record<string, unknown>).rms_db ?? "")} dB</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {mod.id === "palette" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Color Scheme
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("palette", e.target.value)}
                            className="select text-sm w-full"
                          >
                            {Object.keys(paletteVariants).map((k) => (
                              <option key={k} value={k}>{paletteVariants[k].name}</option>
                            ))}
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Applied to backgrounds, text, and accents in the style tile above
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {(paletteVariants[mod.variant]?.swatches || []).map((c, i) => (
                            <div key={i} className="flex-1 text-center">
                              <div
                                className="w-full h-10 rounded-lg border border-white/10 mb-1"
                                style={{ background: c }}
                              />
                              <span className="text-[10px] text-muted capitalize">
                                {["Primary", "Secondary", "Accent", "Highlight"][i]}
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-muted">{paletteVariants[mod.variant]?.desc}</p>
                      </div>
                    )}

                    {mod.id === "typography" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Text Style
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("typography", e.target.value)}
                            className="select text-sm w-full"
                          >
                            {Object.keys(typographyVariants).map((k) => (
                              <option key={k} value={k}>{typographyVariants[k].name}</option>
                            ))}
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Controls text animation and size — see it live in the style tile
                          </p>
                        </div>
                        <div className="p-4 bg-background rounded-lg text-center">
                          <span
                            className="font-bold"
                            style={{
                              fontSize: mod.variant === "hero" ? "32px" : mod.variant === "editorial" ? "18px" : "22px",
                              fontFamily: mod.variant === "editorial" ? "serif" : "inherit",
                            }}
                          >
                            STILL I RISE
                          </span>
                          <p className="text-xs text-muted mt-2">{typographyVariants[mod.variant]?.desc}</p>
                        </div>
                      </div>
                    )}

                    {mod.id === "texture" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Surface Texture
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("texture", e.target.value)}
                            className="select text-sm w-full"
                          >
                            <option value="subtle">Subtle (minimal grain)</option>
                            <option value="paper fiber">Paper Fiber (organic)</option>
                            <option value="burlap">Burlap (coarse)</option>
                            <option value="VHS 0.075">VHS (retro scanlines)</option>
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Overlay grain applied on top of the style tile
                          </p>
                        </div>
                        <div
                          className="h-12 rounded-lg border border-border overflow-hidden"
                          style={{
                            background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,${mod.variant === "VHS 0.075" ? "0.12" : mod.variant === "burlap" ? "0.08" : "0.04"}) 2px, transparent 4px), linear-gradient(135deg, #1a1a2e, #16213e)`,
                          }}
                        >
                          <div className="h-full flex items-center justify-center text-xs text-white/50">
                            Texture preview
                          </div>
                        </div>
                      </div>
                    )}

                    {mod.id === "motion" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Animation Intensity
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("motion", e.target.value)}
                            className="select text-sm w-full"
                          >
                            <option value="restrained">Restained (subtle, professional)</option>
                            <option value="maximalist">Maximalist (high energy)</option>
                            <option value="stillness">Stillness (no motion)</option>
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Controls animation speed and transition intensity
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted">Motion Budget</span>
                            <span className="font-mono">{mod.variant === "restrained" ? "42%" : mod.variant === "maximalist" ? "88%" : "5%"}</span>
                          </div>
                          <div className="h-2 bg-background rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: mod.variant === "restrained" ? "42%" : mod.variant === "maximalist" ? "88%" : "5%",
                                background: mod.variant === "maximalist" ? "#f472b6" : mod.variant === "stillness" ? "#666" : "#a78bfa",
                              }}
                            />
                          </div>
                          <div className="p-3 bg-background rounded-lg">
                            <div
                              className="h-8 rounded bg-primary/20 flex items-center justify-center text-xs text-white/60"
                              style={{
                                transform: `scale(${1 + motionIntensity * 0.1})`,
                                transition: "transform 0.3s ease",
                              }}
                            >
                              Preview motion: {mod.variant}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {mod.id === "bento" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Layout Structure
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("bento", e.target.value)}
                            className="select text-sm w-full"
                          >
                            <option value="2-card">2-Card (meta + 32-bar)</option>
                            <option value="1-card">1-Card (spectrum only)</option>
                            <option value="hidden">Hidden</option>
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Grid arrangement for metadata and visual panels
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className={`col-span-1 h-16 rounded-lg border flex items-center justify-center text-xs text-muted ${mod.variant === "1-card" ? "opacity-30" : "border-border bg-background"}`}>
                            Meta
                          </div>
                          <div className={`col-span-2 h-16 rounded-lg border flex items-center justify-center text-xs text-muted ${mod.variant === "hidden" ? "opacity-30" : "border-border bg-background"}`}>
                            32-bar
                          </div>
                        </div>
                      </div>
                    )}

                    {mod.id === "blender" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            3D Asset Quality
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("blender", e.target.value)}
                            className="select text-sm w-full"
                          >
                            <option value="v4 PBR">v4 PBR (photorealistic)</option>
                            <option value="SD low-poly">SD Low-Poly (stylized)</option>
                            <option value="flat placeholder">Flat Placeholder (fast)</option>
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Quality level for 3D rendered scenes
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {["Terrain", "Planet", "Floaters"].map((name) => (
                            <div key={name} className="aspect-square rounded-lg bg-background border border-white/10 flex items-center justify-center text-[10px] text-muted">
                              {name}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {mod.id === "storyboard" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Sequence Length
                          </label>
                          <select
                            value={mod.variant}
                            onChange={(e) => setVariant("storyboard", e.target.value)}
                            className="select text-sm w-full"
                          >
                            <option>10 sequences</option>
                            <option>5 sequences</option>
                            <option>31 lines (detailed)</option>
                          </select>
                          <p className="text-xs text-muted mt-2">
                            Number of shots in the narrative sequence
                          </p>
                        </div>
                        <div className="space-y-1.5 max-h-[100px] overflow-y-auto text-xs">
                          {[
                            "S01 INTRO 00:00 Midnight hums…",
                            "S02 VERSE 01a 00:18 I walk where…",
                            "S04 CHORUS 01:07 Still I rise…",
                            "S08 BRIDGE 02:25 I thought map…",
                            "S10 FINAL 03:24 Still I rise — still…",
                          ].map((s) => (
                            <div key={s} className="text-muted truncate py-0.5">• {s}</div>
                          ))}
                        </div>
                        <a href="/docs/STORYBOARD_StillIRise.md" target="_blank" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                          Open full storyboard →
                        </a>
                      </div>
                    )}

                    {mod.id === "preview" && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
                            Preview Clips
                          </label>
                          <p className="text-xs text-muted">
                            Output preview clips at different production stages
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-lg bg-black aspect-video flex flex-col items-center justify-center text-[10px] text-muted border border-white/10 p-1">
                            <span>5s Intro</span>
                            <span className="text-[9px] opacity-60">150 frames</span>
                          </div>
                          <div className="rounded-lg bg-black aspect-video flex flex-col items-center justify-center text-[10px] text-muted border border-primary/30 p-1">
                            <span>10s Silicon</span>
                            <span className="text-[9px] opacity-60">300 frames</span>
                          </div>
                          <div className="rounded-lg bg-black aspect-video flex flex-col items-center justify-center text-[10px] text-muted border border-amber-400/40 p-1">
                            <span>10s Crown</span>
                            <span className="text-[9px] opacity-60">300 frames</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <a href="/preview/" className="flex-1 text-center text-xs py-2 rounded bg-primary text-primary-foreground font-medium">
                            Open Filmstrip
                          </a>
                          <a href="/preview/take-crown-10s.mp4" className="flex-1 text-center text-xs py-2 rounded border border-border">
                            Download
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Documentation Viewer — Collapsible */}
      {showDocs && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BookOpen size={18} />
              <span className="font-semibold">Documentation</span>
            </div>
            <div className="flex items-center gap-2">
              <select value={activeDoc} onChange={(e) => setActiveDoc(e.target.value)} className="select text-sm">
                {SONGS[song].docFiles.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <a href={`/docs/${activeDoc}`} target="_blank" className="btn btn-ghost btn-sm">
                Raw
              </a>
            </div>
          </div>
          <pre className="bg-background p-4 rounded-lg text-xs whitespace-pre-wrap font-mono max-h-[400px] overflow-y-auto leading-relaxed">
            {docContent}
          </pre>
        </Card>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted">
        <Settings2 size={14} />
        Toggle modules on/off to build your visual identity. Expand a card to configure variants. Changes update the Style Tile above.
      </div>
    </div>
  );
}

function getVariantLabel(moduleId: ModuleId, variant: string): string {
  switch (moduleId) {
    case "audio":
      return variant;
    case "palette":
      return paletteVariants[variant]?.name || variant;
    case "typography":
      return typographyVariants[variant]?.name || variant;
    case "motion":
      return variant.charAt(0).toUpperCase() + variant.slice(1);
    case "texture":
      return variant.charAt(0).toUpperCase() + variant.slice(1);
    case "blender":
      return variant;
    case "bento":
      return variant === "2-card" ? "2-Card Layout" : variant === "1-card" ? "1-Card Layout" : "Hidden";
    case "storyboard":
      return variant;
    case "preview":
      return "Active";
    default:
      return variant;
  }
}
