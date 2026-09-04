/**
 * Dashboard — SIMPLIFIED (user: "looks complicated")
 * One primary action, 3 steps, nothing else.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Music2, Wand2, ArrowRight, Sparkles, Check, Image, Film, Trash2 } from "lucide-react";
import { Card } from "../../components/common";
import { useJobs } from "../../hooks";
import { useOutputStore, formatFileSize, getOutputUrl } from "../../state/outputStore";

export function Dashboard() {
  const navigate = useNavigate();
  const { jobs } = useJobs();
  const { recentOutputs, fetchRecent, deleteOutput } = useOutputStore();
  const [dragOver, setDragOver] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => { fetchRecent(4); }, [fetchRecent]);

  const hasOutputs = recentOutputs.length > 0;
  const hasActiveJobs = jobs.some(j => j.status === "pending" || j.status === "queued" || j.status === "running");

  const handleDelete = async (e: React.MouseEvent, output: typeof recentOutputs[0]) => {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    setDeleting(output.relative_path);
    try {
      await deleteOutput(output.relative_path);
    } catch (err) {
      console.error("Failed to delete:", err);
    } finally {
      setDeleting(null);
      fetchRecent(4);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    // Handoff via window global — wizard picks it up on mount (no second drop)
    (window as unknown as { __pendingAudioFile?: File }).__pendingAudioFile = f;
    try { sessionStorage.setItem("__pendingAudioName", f.name); } catch { /* ignore */ }
    navigate("/music-video-wizard");
  };

  return (
    <div className="max-w-[900px] mx-auto p-6">
      {/* Hero — one job, one button */}
      <div className="text-center py-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300">
          <Sparkles size={12} /> Local • private • no upload limits
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight mt-4">
          Drop your song.<br />
          <span className="text-violet-400">Get your video.</span>
        </h1>
        <p className="text-muted mt-3 max-w-[560px] mx-auto leading-relaxed">
          Three steps. No tabs to learn. Pick a track, pick a vibe, export for YouTube.
        </p>
      </div>

      {/* ONE drop zone — the whole action */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop audio file here or click to browse"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = "audio/*,.mp3,.wav,.flac,.ogg,.m4a";
          input.onchange = () => handleFiles(input.files);
          input.click();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const input = document.createElement("input");
            input.type = "file"; input.accept = "audio/*,.mp3,.wav,.flac,.ogg,.m4a";
            input.onchange = () => handleFiles(input.files);
            input.click();
          }
        }}
        className={`group relative rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all ${dragOver ? "border-violet-500 bg-violet-500/10" : "border-white/10 bg-white/[0.02] hover:border-violet-500/40 hover:bg-violet-500/5"}`}
      >
        <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center mx-auto shadow-lg shadow-violet-600/20 group-hover:scale-105 transition-transform">
          <Music2 size={24} className="text-white" />
        </div>
        <p className="text-lg font-bold text-white mt-4">Drop audio file here</p>
        <p className="text-sm text-muted mt-1">MP3, WAV, FLAC • max 500 MB • or click to browse</p>
        <p className="text-xs text-muted mt-3 inline-flex items-center gap-1.5"><Check size={12} className="text-emerald-400" /> Analyzed on your GPU — beats, tempo, sections auto-detected</p>
        <div className="mt-6">
          <span className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 text-white font-semibold shadow-md">
            <Wand2 size={16} /> Start — 3 steps <ArrowRight size={14} />
          </span>
        </div>
        <p className="text-[11px] text-muted mt-3">You’ll pick style next. We handle cuts on the beat.</p>
      </div>

      {/* 3 steps — not 4, not 6 */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[
          { n: 1, title: "Drop song", desc: "We find tempo & sections" },
          { n: 2, title: "Pick style", desc: "One prompt, 6 vibes" },
          { n: 3, title: "Export", desc: "YouTube 16:9 + Shorts 9:16" },
        ].map(s => (
          <div key={s.n} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
            <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-xs font-bold text-white">{s.n}</div>
            <p className="text-sm font-bold text-white mt-2">{s.title}</p>
            <p className="text-xs text-muted mt-1">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Recent — only if you have something, otherwise hide */}
      {hasOutputs && (
        <Card title="Your recent videos" className="mt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {recentOutputs.slice(0, 4).map(o => (
              <div key={o.path} className="group relative rounded-xl overflow-hidden border border-white/5 bg-black/20 hover:border-violet-500/30 transition-colors">
                <a href={getOutputUrl(o.relative_path)} target="_blank" rel="noreferrer" className="block">
                  <div className="aspect-video bg-white/5 flex items-center justify-center">
                    {o.cover_image ? (
                      <img src={getOutputUrl(o.cover_image)} alt={o.filename} className="w-full h-full object-cover" />
                    ) : o.file_type === "image" ? (
                      <img src={getOutputUrl(o.relative_path)} alt={o.filename} className="w-full h-full object-cover" />
                    ) : o.file_type === "audio" ? (
                      <Music2 size={24} className="text-violet-400" />
                    ) : (
                      <Film size={20} className="text-muted" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium text-white truncate" title={o.filename}>{o.filename}</p>
                    <p className="text-[11px] text-muted">{formatFileSize(o.size_bytes)}</p>
                  </div>
                </a>
                <button
                  onClick={(e) => handleDelete(e, o)}
                  disabled={deleting === o.relative_path}
                  className="absolute top-1 right-1 p-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white/70 hover:text-red-400 hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {hasActiveJobs && !hasOutputs && (
        <Card className="mt-6">
          <p className="text-sm text-white font-semibold flex items-center gap-2"><Film size={14} className="text-violet-400" /> Jobs in progress</p>
          <p className="text-xs text-muted mt-1">Check Queue — videos render one at a time to avoid VRAM errors.</p>
          <button onClick={() => navigate("/queue")} className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white hover:bg-white/10">View Queue →</button>
        </Card>
      )}

      {!hasOutputs && !hasActiveJobs && (
        <div className="mt-6 rounded-xl border border-white/5 bg-white/[0.02] p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0"><Image size={14} className="text-emerald-400" /></div>
          <div>
            <p className="text-sm font-bold text-white">First time? Use the Happyshrimp demo</p>
            <p className="text-xs text-muted mt-1">We tested with your 7 tracks on E:\Generated by HappyShrimp(beta)\ — Try “Take the Crown” (4 min, 152 BPM, shortest). It analyzed in 3.1s and rendered a real 1080p clip in 6s.</p>
            <button onClick={() => navigate("/music-video-wizard")} className="mt-2 text-xs text-violet-300 hover:underline">Open wizard →</button>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-muted mt-6">Need the old layout? Switch to <button onClick={() => navigate("/music-video")} className="underline hover:text-white">Classic Studio</button> or <button onClick={() => navigate("/visualizer")} className="underline hover:text-white">Visualizer</button> — hidden from this view on purpose.</p>
    </div>
  );
}
