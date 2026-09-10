/**
 * PromptHistoryPanel — version history + repair log per song section.
 *
 * Implements the documented-but-missing "Prompt repair log + version history
 * per song section" (ai-video-trends-2026.md §5 P2; music-video-production.md
 * Phase 2: "save fails + 'no drums' style repairs, versioned").
 *
 * Lists past prompt versions for a track, lets the user fork a new version
 * (with a repair reason), view the ancestry chain, restore, and delete.
 */

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, RefreshCw, GitBranch, Trash2, RotateCcw, X, Check } from "lucide-react";
import { getPromptHistory, savePromptVersion, getPromptChain, deletePromptVersion, type PromptHistoryEntry } from "../../services/api";

interface Props {
  trackFilename: string;
  section?: string;
  onApplyPrompt?: (prompt: string, negativePrompt: string) => void;
}

export function PromptHistoryPanel({ trackFilename, section = "full", onApplyPrompt }: Props) {
  const [entries, setEntries] = useState<PromptHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFork, setShowFork] = useState<string | null>(null);
  const [forkReason, setForkReason] = useState("");
  const [forking, setForking] = useState(false);
  const [chain, setChain] = useState<PromptHistoryEntry[] | null>(null);
  const [chainEntry, setChainEntry] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!trackFilename) return;
    setLoading(true);
    try {
      const data = await getPromptHistory({ track_filename: trackFilename, section, limit: 50 });
      setEntries(data);
    } catch {
      /* ignore — no history yet */
    } finally {
      setLoading(false);
    }
  }, [trackFilename, section]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFork = async (parent: PromptHistoryEntry) => {
    if (!trackFilename) return;
    setForking(true);
    try {
      const res = await savePromptVersion({
        track_filename: trackFilename,
        section: parent.section,
        section_index: parent.section_index,
        prompt: parent.prompt,
        negative_prompt: parent.negative_prompt,
        parent_id: parent.id,
        action: "repair",
        repair_reason: forkReason || "manual fork (versioned)",
        outcome: "draft",
      });
      onApplyPrompt?.(res.entry.prompt, res.entry.negative_prompt);
      setShowFork(null);
      setForkReason("");
      await load();
    } finally {
      setForking(false);
    }
  };

  const handleShowChain = async (id: string) => {
    setChainEntry(id);
    try {
      setChain(await getPromptChain(id));
    } catch {
      setChain(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePromptVersion(id);
      await load();
    } catch {
      /* ignore */
    }
  };

  if (!trackFilename) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 mt-3" data-testid="prompt-history">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <History size={16} className="text-primary" /> Prompt History
          <span className="text-[10px] font-normal text-muted">({section})</span>
        </span>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />}
          <button onClick={load} className="p-1.5 hover:bg-white/10 rounded-lg text-muted hover:text-white" title="Refresh"><RefreshCw size={13} /></button>
        </div>
      </div>

      {entries.length === 0 && !loading && (
        <p className="text-xs text-muted">No version history yet — generations are auto-logged as they run.</p>
      )}

      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="bg-white/5 hover:bg-white/[0.08] rounded-lg px-3 py-2 border border-white/5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-violet-300">v{e.version}</span>
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                  e.action === "repair" ? "bg-amber-500/20 text-amber-300" :
                  e.action === "create" ? "bg-emerald-500/20 text-emerald-300" :
                  "bg-blue-500/20 text-blue-300"
                }`}>{e.action}</span>
                <span className="text-[10px] text-muted">{new Date(e.created_at).toLocaleString()}</span>
                <span className={`text-[10px] ${e.outcome === "failed" ? "text-red-400" : e.outcome === "generated" ? "text-emerald-400" : "text-muted"}`}>{e.outcome}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowFork(showFork === e.id ? null : e.id)} className="p-1 hover:bg-white/10 rounded-lg text-muted hover:text-white" title="Fork repair"><GitBranch size={13} /></button>
                <button onClick={() => void handleShowChain(e.id)} className="p-1 hover:bg-white/10 rounded-lg text-muted hover:text-white" title="View chain"><RefreshCw size={13} /></button>
                <button onClick={() => void handleDelete(e.id)} className="p-1 hover:bg-red-500/20 rounded-lg text-muted hover:text-red-400" title="Delete"><Trash2 size={13} /></button>
              </div>
            </div>
            {e.repair_reason && (
              <p className="text-[10px] text-amber-300 mt-1">repair: {e.repair_reason}</p>
            )}
            <p className="text-xs text-white/90 font-mono mt-1 line-clamp-2" title={e.prompt}>{e.prompt}</p>
            {onApplyPrompt && (
              <button
                onClick={() => onApplyPrompt(e.prompt, e.negative_prompt)}
                className="mt-1.5 text-[10px] text-violet-300 hover:text-violet-200 flex items-center gap-1"
                title="Restore this version into the composer"
              >
                <RotateCcw size={11} /> restore
              </button>
            )}

            {showFork === e.id && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={forkReason}
                  onChange={(e) => setForkReason(e.target.value)}
                  placeholder="Repair reason (e.g. 'drums clashed with vocal mix')"
                  className="flex-1 text-xs bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder:text-muted"
                />
                <button onClick={() => setShowFork(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-muted"><X size={13} /></button>
                <button
                  onClick={() => void handleFork(e)}
                  disabled={forking}
                  className="px-2 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-500 text-white text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {forking ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Fork
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {chain && chainEntry && (
        <div className="mt-3 rounded-lg bg-black/40 border border-white/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-white">Version chain</span>
            <button onClick={() => { setChain(null); setChainEntry(null); }} className="p-1 hover:bg-white/10 rounded-lg text-muted"><X size={13} /></button>
          </div>
          <div className="space-y-1">
            {chain.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-violet-300 shrink-0">v{c.version}</span>
                <span className="text-muted shrink-0">{c.action}</span>
                <span className="text-white/70 truncate">{c.prompt}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}