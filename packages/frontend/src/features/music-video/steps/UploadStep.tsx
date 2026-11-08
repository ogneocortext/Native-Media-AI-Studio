import React, { useState, useRef } from "react";
import { AudioTransport } from "../../../components/audio";
import { Upload, Music, Loader2, Zap, Lightbulb, CheckCircle2 } from "lucide-react";

export function UploadStep({
  audioFile,
  audioUrl,
  onDrop,
  onFileSelect,
  onNext,
  analyzing,
}: {
  audioFile: File | null;
  audioUrl: string | null;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (file: File) => void;
  onNext: () => void;
  analyzing: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-2xl mx-auto text-center">
        <div className="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center mx-auto mb-3">
          <Music size={22} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Upload Your Track</h2>
        <p className="text-sm text-gray-400 mt-2">
          We analyze tempo, beats, sections & mood <em>before</em> generating — SunoMV
          &ldquo;analyze first, generate second&rdquo;. Supports MP3, WAV, FLAC, OGG, M4A (max 500
          MB).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelect(f);
            e.target.value = "";
          }}
        />
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop your audio track here or click to browse files. You can also paste audio files."
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onPaste={(e) => {
            const f = Array.from(e.clipboardData.files).at(0);
            if (f) onFileSelect(f);
          }}
          className={`mt-6 border-2 border-dashed rounded-xl p-8 md:p-10 transition-all cursor-pointer group ${dragOver ? "border-violet-500 bg-violet-500/5 ring-2 ring-violet-500/30" : "border-gray-600 hover:border-violet-500 hover:bg-violet-500/5"}`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <Upload
            size={40}
            className={`mx-auto mb-3 transition-transform group-hover:scale-110 ${audioFile ? "text-violet-400" : "text-gray-500"}`}
          />
          {audioFile ? (
            <div className="space-y-1">
              <p className="text-white font-semibold flex items-center justify-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-400" />
                {audioFile.name}
              </p>
              <p className="text-gray-400 text-sm">
                {(audioFile.size / (1024 * 1024)).toFixed(2)} MB • {audioFile.type || "audio"}
              </p>
              <p className="text-xs text-emerald-400 mt-2">
                Ready — click Analyze to extract beats & structure
              </p>
            </div>
          ) : (
            <>
              <p className="text-white font-medium">Click or drop audio file here</p>
              <p className="text-xs text-gray-500 mt-1">
                or paste a track from <span className="text-violet-300">Media Library</span>
              </p>
              <p className="text-[11px] text-gray-500 mt-3 inline-flex items-center gap-1">
                <Lightbulb size={12} /> Tip: Visualizer gets 2-5× more YouTube rec than static album
                art
              </p>
            </>
          )}
        </div>
        {audioUrl && (
          <AudioTransport src={audioUrl} className="w-full mt-4" ariaLabel="Track preview" />
        )}
        {audioFile && (
          <button
            onClick={onNext}
            disabled={analyzing}
            className="mt-6 w-full md:w-auto px-8 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl flex items-center gap-2 mx-auto font-semibold shadow-lg shadow-violet-600/20"
          >
            {analyzing ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}{" "}
            {analyzing ? "Analyzing..." : "Analyze Track →"}
          </button>
        )}
        <p className="text-[11px] text-gray-500 mt-3">
          We also compute valence, energy curve & key for palette/mood mapping.
        </p>
      </div>
    </div>
  );
}
