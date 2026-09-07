import { useState } from "react";
import { Eye, Zap, Sliders } from "lucide-react";

export function RenderingGuideCard() {
  const [show, setShow] = useState(false);

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <button
        onClick={() => setShow(!show)}
        className="w-full text-white font-medium mb-3 flex items-center gap-2 text-left"
      >
        <Eye size={16} className="text-sky-400" />
        Rendering Guide (8GB)
        <span className="ml-auto text-xs text-gray-500">{show ? "▲" : "▼"}</span>
      </button>
      {show && (
        <div className="space-y-3 text-xs">
          <div className="bg-gray-900 rounded-xl p-3 border border-gray-700">
            <p className="font-bold text-white flex items-center gap-1"><Zap size={12} className="text-amber-400" /> EEVEE Next (recommended)</p>
            <p className="text-gray-400 mt-1">Real-time 1080p ≈2s/frame • 240f ≈8 min. Enable ray-traced shadows/GI only when needed.</p>
            <p className="text-violet-300 mt-1">Use for: previz, stylized, fast iteration.</p>
          </div>
          <div className="bg-gray-900 rounded-xl p-3 border border-gray-700">
            <p className="font-bold text-white flex items-center gap-1"><Sliders size={12} className="text-violet-400" /> Cycles CUDA (quality)</p>
            <p className="text-gray-400 mt-1">128 samples ≈30s/frame • 240f ≈120 min. GPU Compute, denoise + OpenImageDenoise.</p>
            <p className="text-violet-300 mt-1">Use for: finals, photoreal.</p>
          </div>
        </div>
      )}
    </div>
  );
}
