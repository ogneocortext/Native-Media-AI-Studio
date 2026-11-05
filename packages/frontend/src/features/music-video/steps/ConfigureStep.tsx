import { useState, useMemo } from "react";
import { lintVideoPrompt } from "../../../utils/promptLint";
import {
  
  Music,
  Wand2,
  Sparkles,
  
  ChevronRight,
  
  
  
  
  Smartphone,
  
  
  Sliders,
  
  FileWarning,
  
  
  
} from "lucide-react";
import type { GenerationConfig } from "../types";
import { SHOT_SIZES, CAMERA_ANGLES, PROMPT_SUGGESTIONS } from "./shared";

export function ConfigureStep({
  config,
  composedPrompt,
  onConfigChange,
  onSuggestionClick,
  onNext,
  onGenerateMusicPrompt,
}: {
  config: GenerationConfig;
  composedPrompt: string;
  onConfigChange: (c: GenerationConfig) => void;
  onSuggestionClick: (w: string) => void;
  onNext: () => void;
  onGenerateMusicPrompt?: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState("happy");
  const applyStructured = () => onConfigChange({ ...config, prompt: composedPrompt });
  const lint = useMemo(() => lintVideoPrompt(config.prompt), [config.prompt]);

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Wand2 size={18} className="text-violet-400" /> Configure Generation — structured prompt
            format
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Formula:{" "}
            <code className="text-violet-300">
              [Shot] + [Angle] + [Subject] + [Action] + [Setting] + [Lighting] + [Mood]
            </code>
          </p>
        </div>
        <span className="hidden md:inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 shrink-0">
          <Sliders size={12} /> Present tense • single paragraph • &lt;75 words
        </span>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <p className="text-xs font-bold text-violet-300 flex items-center gap-1">
              <Sliders size={12} /> Structured Builder
            </p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs text-gray-400">Shot size</label>
                <select
                  value={config.structuredPrompt.shotSize}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      structuredPrompt: { ...config.structuredPrompt, shotSize: e.target.value },
                    })
                  }
                  className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white"
                >
                  {SHOT_SIZES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400">Camera angle</label>
                <select
                  value={config.structuredPrompt.cameraAngle}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      structuredPrompt: { ...config.structuredPrompt, cameraAngle: e.target.value },
                    })
                  }
                  className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white"
                >
                  {CAMERA_ANGLES.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 mt-3">
              {(
                [
                  ["Subject", "subject"],
                  ["Action", "action"],
                  ["Setting", "setting"],
                  ["Lighting", "lighting"],
                  ["Mood", "mood"],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <label className="text-xs text-gray-400">{label}</label>
                  <input
                    value={(config.structuredPrompt as Record<string, string>)[key]}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        structuredPrompt: { ...config.structuredPrompt, [key]: e.target.value },
                      })
                    }
                    placeholder={`Enter ${label}...`}
                    className="w-full mt-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500"
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 p-2.5 bg-gray-900 rounded-lg border border-gray-700">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Composed</p>
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">{composedPrompt}</p>
              <button
                onClick={applyStructured}
                className="mt-2 text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg"
              >
                Use composed → prompt
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.lipSyncChorus}
                  onChange={(e) => onConfigChange({ ...config, lipSyncChorus: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-violet-500"
                />
                <span>
                  <span className="text-xs font-bold text-violet-300">
                    Lip-sync chorus close-ups
                  </span>
                  <span className="block text-[11px] text-gray-400 mt-0.5">
                    Runs local MuseTalk (no cloud) on rendered chorus sections after
                    generation. Needs model weights + vocals stem; fails safe when
                    unconfigured.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-white">Style palette</label>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {Object.keys(PROMPT_SUGGESTIONS).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${activeCategory === cat ? "bg-violet-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {PROMPT_SUGGESTIONS[activeCategory].map((w) => (
                <button
                  key={w}
                  onClick={() => onSuggestionClick(w)}
                  className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full text-xs"
                >
                  + {w}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-white">
              Positive Prompt{" "}
              <span className="ml-1 text-[11px] font-normal text-gray-500">
                {lint.wordCount}/75 words • {lint.score}/{lint.checks.length} checks
              </span>
            </label>
            <textarea
              value={config.prompt}
              onChange={(e) => onConfigChange({ ...config, prompt: e.target.value })}
              rows={3}
              className="w-full mt-2 px-3 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none resize-none"
              placeholder="Describe your video scene..."
            />
            <ul className="mt-2 space-y-1" aria-live="polite">
              {lint.checks.map((c) => (
                <li
                  key={c.key}
                  className={`flex items-start gap-1.5 text-[11px] ${c.pass ? "text-emerald-400" : "text-gray-500"}`}
                >
                  <span aria-hidden>{c.pass ? "✓" : "○"}</span>
                  <span>
                    <b className="font-semibold">{c.label}</b>
                    {!c.pass && <span className="text-gray-500"> — {c.hint}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <label className="text-sm font-semibold text-white flex items-center gap-1">
              <FileWarning size={12} /> Negative Prompt
            </label>
            <input
              value={config.negativePrompt}
              onChange={(e) => onConfigChange({ ...config, negativePrompt: e.target.value })}
              className="w-full mt-2 px-3 py-2 bg-gray-900 border border-gray-600 rounded-xl text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none"
              placeholder="blurry, low quality..."
            />
          </div>
        </div>
        <div className="space-y-5">
          <label className="flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors bg-gray-900 border-gray-600 hover:border-violet-500/50">
            <input
              type="checkbox"
              checked={config.verticalFirst}
              onChange={(e) => onConfigChange({ ...config, verticalFirst: e.target.checked })}
              className="accent-violet-600"
            />
            <span className="text-sm text-white flex items-center gap-1">
              <Smartphone size={14} className="text-violet-400" /> Vertical-first master (9:16) —
              safe top 100 / bottom 200
            </span>
          </label>
          <details className="group rounded-xl border border-gray-700 bg-gray-900/50 open:bg-gray-900">
            <summary className="flex items-center gap-2 px-3 py-2.5 cursor-pointer list-none text-xs font-semibold text-gray-400 hover:text-white select-none">
              <Sliders size={12} className="shrink-0" />
              Advanced — Steps / CFG / Seed
              <span className="ml-auto text-[11px] font-normal text-gray-500 group-open:hidden">
                Steps {config.steps} • CFG {config.cfgScale} • Seed{" "}
                {config.seed === -1 ? "random" : config.seed}
              </span>
              <ChevronRight size={12} className="ml-1 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-3 pb-3 pt-1 grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-400">Steps</label>
                <input
                  type="number"
                  value={config.steps}
                  onChange={(e) => onConfigChange({ ...config, steps: Number(e.target.value) })}
                  min={5}
                  max={50}
                  className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">CFG</label>
                <input
                  type="number"
                  value={config.cfgScale}
                  onChange={(e) => onConfigChange({ ...config, cfgScale: Number(e.target.value) })}
                  min={1}
                  max={20}
                  step={0.5}
                  className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Seed</label>
                <input
                  type="number"
                  value={config.seed}
                  onChange={(e) => onConfigChange({ ...config, seed: Number(e.target.value) })}
                  className="w-full mt-1 px-2 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white"
                />
                <p className="text-[10px] text-gray-500 mt-1">-1 = random</p>
              </div>
            </div>
            <p className="px-3 pb-2 text-[11px] text-gray-500">
              Defaults 20 / 7.0 / random are tuned for Wan 2.2 5B on 8GB — change only if you know
              why.
            </p>
          </details>
          {onGenerateMusicPrompt && (
            <button
              type="button"
              onClick={onGenerateMusicPrompt}
              className="mt-2 w-full md:w-auto px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl flex items-center gap-2 font-semibold border border-gray-600"
            >
              <Music size={18} /> Generate Music Prompt
            </button>
          )}
          <button
            onClick={onNext}
            className="mt-2 w-full md:w-auto px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl flex items-center gap-2 font-semibold shadow-lg shadow-violet-600/20"
          >
            <Sparkles size={18} /> Continue to Generate →
          </button>
        </div>
      </div>
    </div>
  );
}
