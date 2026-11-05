import { useState } from "react";
import { AudioTransport } from "../../../components/audio";
import {
  
  
  
  
  Play,
  
  Download,
  
  
  
  
  
  
  
  
  
  CheckCircle2,
  
  
} from "lucide-react";
import type { AudioAnalysis } from "../types";

export function ReviewStep({
  generatedSections,
  audioUrl,
  analysis,
}: {
  generatedSections: string[];
  audioUrl: string | null;
  analysis: AudioAnalysis | null;
}) {
  const [showExport, setShowExport] = useState(false);
  return (
    <div className="p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Download size={18} className="text-emerald-400" /> Review & Export
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Upload a track and get: MV + thumbs + social captions + platform edits.
          </p>
        </div>
        <span className="hidden md:inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 shrink-0">
          <CheckCircle2 size={12} />           {generatedSections.length || (analysis?.sections.length ?? 0)}{" "}
          sections
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        {(generatedSections.length
          ? generatedSections
          : (analysis?.sections.map((s, i) => `section_${i}_${s.type}.mp4`) ?? ["preview.mp4"])
        ).map((p, i) => (
          <div
            key={i}
            className="bg-gray-900 rounded-xl p-3 border border-gray-700 hover:border-violet-500/30 transition-colors group"
          >
            <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center relative overflow-hidden">
              <Play
                size={22}
                className="text-gray-600 group-hover:text-violet-400 transition-colors"
              />
              <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white border border-white/10">
                {analysis?.sections[i]?.type ?? "clip"}
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate mt-2" title={p}>
              {p}
            </p>
          </div>
        ))}
      </div>
      {audioUrl && <AudioTransport src={audioUrl} className="w-full mt-4" ariaLabel="Track preview" />}
      <button
        onClick={() => setShowExport(true)}
        className="mt-3 w-full md:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl flex items-center gap-2 font-semibold mx-auto"
      >
        <Download size={16} /> Open Export
      </button>
      {showExport && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowExport(false)}
        >
          <div
            className="bg-gray-800 rounded-2xl p-5 w-full max-w-lg border border-gray-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Download size={16} className="text-emerald-400" /> Export — 2026 Deliverables
            </h3>
            <div className="mt-4 space-y-2.5">
              {[
                {
                  title: "YouTube 16:9 Hero",
                  spec: "1920×1080 • H.264 • 16 Mbps • 24fps",
                  note: "Satisfaction > watch time",
                },
                {
                  title: "YouTube Shorts 9:16",
                  spec: "1080×1920 • safe top 100 / bottom 200 • 60s",
                  note: "First frame decisive",
                },
                {
                  title: "Thumbnails ×3 A/B",
                  spec: "Hook moment + title • high contrast",
                  note: "One improvement compounds",
                },
              ].map((e) => (
                <div
                  key={e.title}
                  className="p-3 bg-gray-900 border border-gray-700 rounded-xl flex justify-between items-center"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{e.title}</p>
                    <p className="text-xs text-gray-500">{e.spec}</p>
                    <p className="text-[11px] text-violet-300">{e.note}</p>
                  </div>
                  <button className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold">
                    Export
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowExport(false)}
              className="mt-4 w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}