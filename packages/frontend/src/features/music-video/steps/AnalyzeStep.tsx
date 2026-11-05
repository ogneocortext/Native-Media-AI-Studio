import { AudioTransport } from "../../../components/audio";
import {
  
  Music,
  Wand2,
  
  
  ChevronRight,
  
  
  
  Layers,
  
  Lightbulb,
  Target,
  
  Eye,
  
  
  
  
} from "lucide-react";
import type { AudioAnalysis } from "../types";
import { VISUAL_TREATMENTS } from "../types";
import { SECTION_COLORS } from "./shared";

export function AnalyzeStep({
  analysis,
  audioUrl,
  onNext,
}: {
  analysis: AudioAnalysis;
  audioUrl: string | null;
  onNext: () => void;
}) {
  // Reduce, not `Math.max(...energies, 1)`: the spread passes every section's
  // energy as a separate argument, which overflows the call stack on a long
  // track and allocates an intermediate array on every render.
  const maxEnergy = analysis.sections.reduce((m, s) => Math.max(m, s.energy), 1);
  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
          <Music size={16} className="text-sky-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Track Analysis — stem-native ready</h2>
          <p className="text-xs text-gray-400">
            Tempo, beats, sections + per-stem hooks for visuals (drums→pulse, bass→shake,
            vocals→kinetic).
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-wide">Tempo</p>
          <p className="text-2xl font-extrabold text-white mt-1">{analysis.tempo_bpm}</p>
          <p className="text-gray-500 text-xs">
            BPM •{" "}
            {analysis.tempo_bpm < 90
              ? "Ballad"
              : analysis.tempo_bpm < 120
                ? "Groove"
                : "High-energy"}
          </p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-wide">Duration</p>
          <p className="text-2xl font-extrabold text-white mt-1">
            {(analysis.duration_seconds / 60).toFixed(1)}
            <span className="text-sm font-normal text-gray-500"> min</span>
          </p>
          <p className="text-gray-500 text-xs">
            {analysis.duration_seconds.toFixed(0)}s • {analysis.beat_count} beats
          </p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-wide">Beats</p>
          <p className="text-2xl font-extrabold text-white mt-1">{analysis.beat_count}</p>
          <p className="text-gray-500 text-xs">
            ≈ {(analysis.beat_count / (analysis.duration_seconds / 60)).toFixed(1)}/min
          </p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 text-center border border-violet-500/30 bg-violet-500/5">
          <p className="text-violet-300 text-xs uppercase tracking-wide font-semibold">Sections</p>
          <p className="text-2xl font-extrabold text-white mt-1">{analysis.sections.length}</p>
          <p className="text-gray-500 text-xs">for per-section generation</p>
        </div>
      </div>
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
          <Layers size={14} className="text-violet-400" /> Song Structure
        </h3>
        <div className="flex gap-0.5 h-14 rounded-xl overflow-hidden border border-gray-700">
          {analysis.sections.map((section, i) => {
            const width = ((section.end - section.start) / analysis.duration_seconds) * 100;
            const treatment = VISUAL_TREATMENTS[section.type] || "Custom treatment";
            return (
              <div
                key={i}
                className={`${SECTION_COLORS[section.type] || "bg-gray-600"} flex flex-col items-center justify-center relative group cursor-help`}
                style={{ width: `${width}%` }}
              >
                <span className="text-xs text-white font-bold truncate px-1">{section.type}</span>
                <span className="text-[10px] text-white/80 hidden md:block">
                  {(section.energy * 100).toFixed(0)}% energy
                </span>
                <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 border border-gray-700 text-white text-xs p-2.5 rounded-xl shadow-xl whitespace-nowrap z-10 min-w-[180px]">
                  <p className="font-bold">{section.type}</p>
                  <p className="text-gray-400">
                    {section.start.toFixed(1)}s → {section.end.toFixed(1)}s •{" "}
                    {(section.end - section.start).toFixed(1)}s
                  </p>
                  <p className="text-violet-300 mt-1">{treatment}</p>
                  <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500"
                      style={{ width: `${(section.energy / maxEnergy) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-1.5 text-xs text-gray-500">
          <span>0:00</span>
          <span className="inline-flex items-center gap-1">
            <Target size={10} /> Strong beats → hard cut • Chorus = most important anchor
          </span>
          <span>
            {Math.floor(analysis.duration_seconds / 60)}:
            {String(Math.floor(analysis.duration_seconds % 60)).padStart(2, "0")}
          </span>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3 mb-6">
        <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-3 flex gap-2.5">
          <Lightbulb size={16} className="text-sky-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-sky-300">Stem-native insight (new 2026)</p>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              Split stems (Demucs 8 stems) →{" "}
              <b className="text-gray-300">
                drums→scale pulse, bass→camera shake, spectral centroid→palette temp, onset→cut
              </b>
              . Enabled in backend via <code className="text-violet-300">analyze_and_sync.py</code>.
            </p>
          </div>
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex gap-2.5">
          <Eye size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-300">Mindful layering</p>
            <p className="text-xs text-gray-400 mt-1">
              Cap <b className="text-gray-300">total motion &lt;800ms</b>, 1 primary + 1 secondary
              per shot. Chorus = maximalist, bridge = intimate VHS.
            </p>
          </div>
        </div>
      </div>
      {audioUrl && <AudioTransport src={audioUrl} className="w-full" ariaLabel="Track preview" />}
      <button
        onClick={onNext}
        className="mt-6 w-full md:w-auto px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl flex items-center gap-2 font-semibold shadow-lg shadow-violet-600/20"
      >
        <Wand2 size={18} /> Configure Style →<ChevronRight size={16} />
      </button>
    </div>
  );
}
