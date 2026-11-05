/**
 * RemixSlotsEditor — the arrangement editor extracted from RemixPanel:
 * the bar-proportional timeline (click to audition a slot, drag or
 * arrow-key to reorder) plus the per-slot layer cards with track/stem
 * pickers, gain/key/start sliders, and layer/slot add-remove controls.
 *
 * Drag state is timeline-local and lives here; all arrangement mutations
 * go through the parent's setSlots/updateLayer/moveSlot callbacks so the
 * form stays the single source of truth.
 */
import { useState, type Dispatch, type SetStateAction } from "react";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import type { StemName } from "../../services/api";
import {
  newEditableLayer,
  STEM_TIMELINE_COLORS,
  timelineSegments,
  type EditableLayer,
  type EditableSlot,
} from "./remixRecipe";

export type RemixBusy =
  | "preview"
  | "build"
  | "master"
  | "separate"
  | "listen"
  | "audition"
  | "revise"
  | null;

const NUM = "w-14 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white text-right";
const LABEL = "text-[9px] uppercase tracking-wide text-muted";

export interface RemixSlotsEditorProps {
  slots: EditableSlot[];
  setSlots: Dispatch<SetStateAction<EditableSlot[]>>;
  tracks: string[];
  stemsFor: (track: string) => StemName[];
  bpm: number;
  busy: RemixBusy;
  onAuditionSlot: (slotIndex: number) => Promise<void>;
  onAuditionLayer: (layer: EditableLayer) => Promise<void>;
  updateLayer: (slotIdx: number, layerIdx: number, patch: Partial<EditableLayer>) => void;
  moveSlot: (from: number, to: number) => void;
}

export function RemixSlotsEditor({
  slots,
  setSlots,
  tracks,
  stemsFor,
  bpm,
  busy,
  onAuditionSlot,
  onAuditionLayer,
  updateLayer,
  moveSlot,
}: RemixSlotsEditorProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  return (
    <>
    {/* A6: the arrangement at a glance. Widths are shares of total
        bars — the relationship the render uses — so a 4-bar slot and a
        32-bar slot finally look different.
        R2: the timeline also edits. Click a segment to audition that
        slot alone; drag to reorder (arrow keys nudge when focused).
        Scope guard per the plan: no resize handles, no solo/mute. */}
    {timelineSegments(slots).length > 0 && (
      <div className="space-y-1" data-testid="remix-timeline">
        <div
          className="flex h-6 rounded overflow-hidden border border-white/10"
          role="listbox"
          aria-label="Arrangement timeline: click a slot to audition it, drag to reorder"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragFrom !== null && dropAt !== null) moveSlot(dragFrom, dropAt);
            setDragFrom(null);
            setDropAt(null);
          }}
          onDragLeave={() => setDropAt(null)}
        >
          {timelineSegments(slots).map((seg) => (
            <div
              key={seg.slotIndex}
              role="option"
              aria-selected={false}
              aria-label={`Slot ${seg.slotIndex + 1}: ${seg.bars} bars. Activate to audition; arrow keys reorder.`}
              tabIndex={0}
              draggable
              onClick={() => void onAuditionSlot(seg.slotIndex)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void onAuditionSlot(seg.slotIndex);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  moveSlot(seg.slotIndex, seg.slotIndex - 1);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  moveSlot(seg.slotIndex, seg.slotIndex + 1);
                }
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragFrom(seg.slotIndex);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDropAt(null);
              }}
              onDragEnter={() => {
                if (dragFrom !== null && dragFrom !== seg.slotIndex) setDropAt(seg.slotIndex);
              }}
              className={`relative flex flex-col justify-center gap-0.5 px-1 bg-white/[0.04] border-r border-white/10 last:border-r-0 cursor-pointer hover:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-amber-300/60${
                dragFrom === seg.slotIndex ? " opacity-40" : ""
              }${dropAt === seg.slotIndex ? " ring-1 ring-emerald-300/70" : ""}`}
              style={{ width: `${seg.pct}%` }}
              title={`Slot ${seg.slotIndex + 1}: ${seg.bars} bars${seg.crossfadePct > 0 ? `, ${seg.crossfadeBars}-bar crossfade` : ""} — click to audition, drag to reorder`}
            >
              <span className="text-[9px] text-muted truncate">
                {seg.bars}b{seg.crossfadeBars > 0 ? ` ×${seg.crossfadeBars}` : ""}
              </span>
              <div className="flex gap-0.5">
                {seg.stems.map((stem) => (
                  <span
                    key={stem}
                    className={`h-1.5 flex-1 rounded-sm ${STEM_TIMELINE_COLORS[stem]}`}
                    title={stem}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {(() => {
          const totalBars = slots.filter((s) => s.layers.length > 0).reduce((n, s) => n + s.bars, 0);
          // beats_per_bar is fixed at 4 in `recipe()`, so seconds =
          // bars x 4 beats x 60 / bpm. (Crossfades overlap slots, so this
          // is the upper bound: a 2-bar crossfade into slot 2 removes it.)
          return (
            <p className="text-[9px] text-muted">
              {totalBars} bars · {((totalBars * 4 * 60) / bpm).toFixed(1)}s at {bpm} BPM
            </p>
          );
        })()}
      </div>
    )}

    {slots.map((slot, si) => (
      <div key={si} className="space-y-1 rounded bg-white/[0.03] p-1.5">
        <div className="flex items-center gap-1.5">
          <span className={LABEL}>Slot {si + 1}</span>
          <label className={LABEL}>bars</label>
          <input type="number" min={1} value={slot.bars} onChange={(e) => setSlots((p) => p.map((s, i) => (i === si ? { ...s, bars: Math.max(1, Number(e.target.value)) } : s)))} className={NUM} aria-label={`Slot ${si + 1} bars`} />
          <label className={LABEL}>xfade</label>
          <input type="number" min={0} value={slot.crossfade_bars} onChange={(e) => setSlots((p) => p.map((s, i) => (i === si ? { ...s, crossfade_bars: Math.max(0, Number(e.target.value)) } : s)))} className={NUM} aria-label={`Slot ${si + 1} crossfade bars`} />
          <button onClick={() => setSlots((p) => p.filter((_, i) => i !== si))} aria-label={`Remove slot ${si + 1}`} className="ml-auto text-muted hover:text-red-300">
            <Trash2 size={11} />
          </button>
        </div>

        {/* Group layers by source track so stems from the same song
            sit together under a track header instead of a flat list. */}
        {(() => {
          const byTrack = new Map<string, { layer: EditableLayer; li: number }[]>();
          slot.layers.forEach((layer, li) => {
            const group = byTrack.get(layer.track) ?? [];
            group.push({ layer, li });
            byTrack.set(layer.track, group);
          });
          return (
            <>
              {Array.from(byTrack.entries()).map(([track, group]) => (
                <div key={track} className="mb-1">
                  <h4
                    className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted mb-1"
                    aria-label={`Source: ${track}`}
                    data-remix-track={track}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/20 bg-sky-400/60 border-sky-400"
                      aria-hidden="true"
                    />
                    {track}
                  </h4>
                  {group.map(({ layer, li }) => (
                    <div key={layer.__id} className="space-y-1 rounded bg-white/[0.03] p-1.5 ml-3">
                      <div className="flex items-center gap-1">
                        <select
                          value={layer.track}
                          onChange={(e) => updateLayer(si, li, { track: e.target.value })}
                          aria-label="Source track"
                          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white"
                        >
                          {tracks.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <select
                          value={layer.stem}
                          onChange={(e) => updateLayer(si, li, { stem: e.target.value as StemName })}
                          aria-label="Stem"
                          className="px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white"
                        >
                          {stemsFor(layer.track).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => void onAuditionLayer(layer)}
                          disabled={busy !== null}
                          aria-label={`Audition ${layer.stem} from ${layer.track}`}
                          title={`Play ${layer.track}'s ${layer.stem}`}
                          className="p-1 rounded bg-white/5 hover:bg-white/10 text-white disabled:opacity-40"
                        >
                          {busy === "audition" ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                        </button>
                        <button
                          onClick={() => setSlots((p) => p.map((s, i) => (i === si ? { ...s, layers: s.layers.filter((_, j) => j !== li) } : s)))}
                          aria-label="Remove layer"
                          className="text-muted hover:text-red-300"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <label className="space-y-0.5">
                          <span className="flex justify-between text-[9px] text-muted">
                            gain <span className="text-white/80">{layer.gain_db > 0 ? "+" : ""}{layer.gain_db} dB</span>
                          </span>
                          <input
                            type="range"
                            min={-24}
                            max={12}
                            step={0.5}
                            value={layer.gain_db}
                            onChange={(e) => updateLayer(si, li, { gain_db: Number(e.target.value) })}
                            aria-label="Gain dB"
                            className="w-full accent-amber-400"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="flex justify-between text-[9px] text-muted">
                            key <span className="text-white/80">{layer.key_shift_semitones > 0 ? "+" : ""}{layer.key_shift_semitones} st</span>
                          </span>
                          <input
                            type="range"
                            min={-12}
                            max={12}
                            step={1}
                            value={layer.key_shift_semitones}
                            onChange={(e) => updateLayer(si, li, { key_shift_semitones: Number(e.target.value) })}
                            aria-label="Key shift semitones"
                            className="w-full accent-amber-400"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="flex justify-between text-[9px] text-muted">
                            start <span className="text-white/80">bar {layer.source_start_bar}</span>
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={32}
                            step={1}
                            value={Math.min(layer.source_start_bar, 32)}
                            onChange={(e) => updateLayer(si, li, { source_start_bar: Number(e.target.value) })}
                            aria-label="Source start bar"
                            className="w-full accent-amber-400"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          );
        })()}

        <button onClick={() => setSlots((p) => p.map((s, i) => (i === si ? { ...s, layers: [...s.layers, newEditableLayer(s.layers[0]?.track ?? tracks[0], "drums")] } : s)))} className="flex items-center gap-1 text-[10px] text-muted hover:text-white">
          <Plus size={10} /> layer
        </button>
      </div>
    ))}

    <button onClick={() => setSlots((p) => [...p, { bars: 4, crossfade_bars: 2, layers: [newEditableLayer(tracks[0], "drums")] }])} className="flex items-center gap-1 text-[10px] text-muted hover:text-white">
      <Plus size={10} /> slot
    </button>
    </>
  );
}
