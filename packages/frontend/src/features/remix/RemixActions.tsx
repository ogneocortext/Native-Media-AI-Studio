/**
 * RemixActions — the render deck extracted from RemixPanel: the
 * Preview / Audition / Build / Cancel / Master buttons plus everything
 * they produce (listen excerpt player, stretch stats, warnings, error,
 * built-mix playback with version picker, earlier-remixes list).
 *
 * All mutations stay in the panel — this is a view over callbacks and
 * result state.
 */
import type { Dispatch, SetStateAction } from "react";
import { AlertCircle, Loader2, Play } from "lucide-react";
import {
  remixFileUrl,
  type RemixPreview,
  type RemixSummary,
  type RemixVersion,
  type StemName,
} from "../../services/api";
import type { RemixBusy } from "./RemixSlotsEditor";

export interface RemixListenState {
  url: string;
  duration_sec: number;
  truncated: boolean;
}

export interface RemixActionsProps {
  busy: RemixBusy;
  /** False disables Audition (every slot has zero layers). */
  hasPlayableSlots: boolean;
  buildJobId: string | null;
  onPreview: () => Promise<void>;
  onListen: () => Promise<void>;
  onBuild: () => Promise<void>;
  onCancelBuild: () => Promise<void>;
  onMaster: () => Promise<void>;
  listen: RemixListenState | null;
  preview: RemixPreview | null;
  error: string | null;
  built: RemixSummary | null;
  versions: RemixVersion[];
  versionPick: number | null;
  onVersionPick: (v: number | null) => void;
  currentVersion: number | null;
  play: (src: string) => void;
  remixes: RemixSummary[];
  setBuilt: Dispatch<SetStateAction<RemixSummary | null>>;
  loadVersions: (name: string) => Promise<void>;
}

export function RemixActions({
  busy,
  hasPlayableSlots,
  buildJobId,
  onPreview,
  onListen,
  onBuild,
  onCancelBuild,
  onMaster,
  listen,
  preview,
  error,
  built,
  versions,
  versionPick,
  onVersionPick,
  currentVersion,
  play,
  remixes,
  setBuilt,
  loadVersions,
}: RemixActionsProps) {
  return (
    <>
    <div className="flex flex-wrap gap-1.5 pt-1">
      <button onClick={onPreview} disabled={busy !== null} className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40">
        {busy === "preview" ? <Loader2 size={10} className="animate-spin" /> : null} Preview
      </button>
      <button
        onClick={onListen}
        disabled={busy !== null || !hasPlayableSlots}
        className="flex items-center gap-1 px-2 py-1 rounded bg-violet-500/20 hover:bg-violet-500/30 text-[10px] text-violet-100 disabled:opacity-40"
        title="Render a ~30 s excerpt of this arrangement and play it"
      >
        {busy === "listen" ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />} Audition
      </button>
      <button onClick={onBuild} disabled={busy !== null} className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100 disabled:opacity-40">
        {busy === "build" ? <Loader2 size={10} className="animate-spin" /> : null} Build
      </button>
      {/* Cancelling is cooperative - the render stops between slots -
          so this only disappears when the job reaches a terminal
          state, which the poll loop reports. */}
      {busy === "build" && buildJobId && (
        <button onClick={() => void onCancelBuild()} className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-red-500/20 text-[10px] text-white/80 hover:text-red-200">
          Cancel
        </button>
      )}
    </div>

    {listen && (
      <div className="space-y-1 rounded bg-violet-500/10 p-1.5" data-testid="remix-listen">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-violet-100">Audition</span>
          <span className="text-[10px] text-muted">
            {listen.duration_sec.toFixed(1)}s{listen.truncated ? " of the arrangement" : ""}
          </span>
        </div>
        {/* A native control is deliberate: the excerpt is a plain wav
            URL, and a real transport gives scrubbing for free. */}
        <audio controls src={listen.url} className="w-full h-7" preload="auto" />
        {listen.truncated && (
          <p className="text-[10px] text-muted">
            Excerpt only — build renders the full arrangement.
          </p>
        )}
      </div>
    )}

    {busy === "build" && <p className="text-[10px] text-muted">Rendering — time-stretching each source onto the grid…</p>}
    {busy === "master" && <p className="text-[10px] text-muted">Mastering through the Suno chain — this takes about a minute…</p>}

    {preview && (
      <div className="text-[10px] text-muted space-y-0.5">
        <p>{preview.duration_sec.toFixed(1)}s · {preview.total_bars} bars · {preview.sample_rate} Hz</p>
        {Object.entries(preview.stretch_ratios).map(([t, r]) => (
          <p key={t}>
            {t}: {r >= 1
              ? `stretched ${((r - 1) * 100).toFixed(1)}% faster`
              : `stretched ${((1 - r) * 100).toFixed(1)}% slower`}
          </p>
        ))}
      </div>
    )}

    {preview?.warnings.map((w) => (
      <p key={w} className="flex items-start gap-1 text-[10px] text-amber-300/90">
        <AlertCircle size={10} className="mt-0.5 shrink-0" />
        <span>{w}</span>
      </p>
    ))}

    {error && (
      <p className="flex items-start gap-1 text-[10px] text-red-300/90 break-words">
        <AlertCircle size={10} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </p>
    )}

    {built && (
      <div className="space-y-1 pt-1 border-t border-white/10">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-white flex-1">
            Hear “{built.name}”
            {currentVersion !== null ? ` v${currentVersion}` : ""}
          </span>
          <button onClick={onMaster} disabled={busy !== null || built.has_enhanced || versionPick !== null} title={versionPick !== null ? "Mastering renders a new current mix - it does not master an archived version" : undefined} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40">
            {busy === "master" ? "Mastering…" : built.has_enhanced ? "Mastered ✓" : "Master it"}
          </button>
        </div>

        {/* Only shown when a rebuild has archived something: the current
            render plus at least one earlier one. */}
        {versions.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted">Render</span>
            <select
              aria-label="Version"
              value={versionPick ?? ""}
              onChange={(e) => onVersionPick(e.target.value ? Number(e.target.value) : null)}
              className="bg-white/5 text-[10px] text-white rounded px-1 py-0.5"
            >
              <option value="">current</option>
              {versions.filter((v) => !v.current).map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} · {v.total_bars ?? "?"} bars · {typeof v.duration_sec === "number" ? `${v.duration_sec.toFixed(1)}s` : "?"}
                </option>
              ))}
            </select>
            {versionPick !== null && (
              <span className="text-[10px] text-muted">archived</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {(built.has_enhanced && versionPick === null ? [...built.stems, "master" as const] : built.stems).map((which) => (
            <button key={which} onClick={() => play(remixFileUrl(built.name, which as StemName | "master", versionPick ?? undefined))} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white">
              <Play size={9} /> {which}
            </button>
          ))}
        </div>
      </div>
    )}

    {remixes.filter((r) => r.name !== built?.name).length > 0 && (
      <details className="text-[10px] text-muted">
        <summary className="cursor-pointer hover:text-white">Earlier remixes ({remixes.filter((r) => r.name !== built?.name).length})</summary>
        <div className="flex flex-wrap gap-1 mt-1">
          {remixes.filter((r) => r.name !== built?.name).map((r) => (
            <button key={r.name} onClick={() => { setBuilt(r); void loadVersions(r.name); }} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white">
              {r.name}{r.has_enhanced ? " ★" : ""}
            </button>
          ))}
        </div>
      </details>
    )}
    </>
  );
}
