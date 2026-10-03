/**
 * RemixPanel — build and hear a mashup from stems of different songs.
 *
 * The arrangement model is the backend's: a list of slots over a bar grid, each
 * slot naming the stems playing during its span. Presets exist because
 * "drums from one song under vocals from another" is the mashup almost everyone
 * wants first, and hand-building four slots to express it is not the point of a
 * first attempt.
 *
 * Two things the UI deliberately does not do:
 *  - It does not offer automatic key matching. Chroma flatness on these stems
 *    measures 0.978-0.998 (1.0 is pure noise), so a detected key is noise and
 *    shifting by it would be arbitrary. `key_shift_semitones` is a per-layer
 *    number the user sets, and the probe's advisory key is shown *labelled as
 *    unreliable* rather than presented as fact.
 *  - It does not pretend `preview` is free. Preview loads and time-stretches
 *    every source to measure levels; the button says what it costs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, Play, Plus, Trash2, Wand2 } from "lucide-react";
import {
  STEM_NAMES,
  buildRemix,
  enhanceRemix,
  getRemixSources,
  listRemixes,
  previewRemix,
  probeRemixTrack,
  remixFileUrl,
  type RemixPreview,
  type RemixRecipeSpec,
  type RemixSlotSpec,
  type RemixSource,
  type RemixSummary,
  type StemName,
} from "../../../services/api";
import { usePanelCollapsed } from "../usePanelCollapsed";
import { consumePendingRemixRecipe } from "../../../utils/pendingTrack";

export interface RemixPanelProps {
  /** Track the visualizer is already showing; preselected as source A. */
  currentTrack?: string | null;
}

const NUM = "w-14 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white text-right";
const LABEL = "text-[9px] uppercase tracking-wide text-muted";

/** A source shorter than this is a fixture, not a song, so it is not used as a mash partner. */
const MIN_SOURCE_SECONDS = 30;

/** Match a visualizer track against a stem source directory.
 *
 *  The visualizer holds library *paths* ("Suno-V6-Mini/SunoV6Mini-Ad-Nauseam.m4a")
 *  while separation writes directories keyed by the bare stem name
 *  ("SunoV6Mini-Ad-Nauseam"). Comparing them directly always failed, so the
 *  panel fell back to the first entry alphabetically — which on this machine is
 *  `demucs_test_input`, a 10-second test fixture. The seed then built a
 *  mashup from scratch audio, which looks like the panel being broken.
 */
function matchSource(currentTrack: string | null | undefined, tracks: string[]): string | undefined {
  if (!currentTrack) return undefined;
  const base = (currentTrack.split(/[\\/]/).pop() ?? currentTrack).replace(/\.[^.]+$/, "");
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(base);
  return tracks.find((t) => norm(t) === target) ?? tracks.find((t) => norm(t).includes(target) || target.includes(norm(t)));
}
// UILayer / UISlot are the panel's own aliases for the shared editable types, so
// the component's existing annotations keep working while the definitions (and
// their `__id` allocation) live in a module the unit suite can import on its own.
type UILayer = EditableLayer;
/** A slot whose layers carry their keys. */
type UISlot = EditableSlot;

// The pure recipe <-> panel-state conversions live in ./remixRecipe so the unit
// suite can exercise them without importing React.
import {
  newEditableLayer,
  recipeToEditableSlots,
  type EditableLayer,
  type EditableSlot,
} from "./remixRecipe";

function newLayer(track: string, stem: StemName): EditableLayer {
  return newEditableLayer(track, stem);
}

export function RemixPanel({ currentTrack }: RemixPanelProps) {
  const { open, toggle } = usePanelCollapsed("stem-remix");
  const [sources, setSources] = useState<RemixSource[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("mashup-1");
  const [bpm, setBpm] = useState(120);
  const [slots, setSlots] = useState<UISlot[]>([]);
  const [busy, setBusy] = useState<null | "preview" | "build" | "master">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RemixPreview | null>(null);
  const [built, setBuilt] = useState<RemixSummary | null>(null);
  const [remixes, setRemixes] = useState<RemixSummary[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const tracks = useMemo(() => sources.map((s) => s.track), [sources]);
  const stemsFor = useCallback(
    (track: string): StemName[] => {
      const found = sources.find((s) => s.track === track);
      return found ? STEM_NAMES.filter((n) => found.stems[n]) : [...STEM_NAMES];
    },
    [sources],
  );

  // Seeding is split in two deliberately. The fetch runs once; the defaults are
  // applied when `sources` first arrives, guarded by a ref so a later prop
  // change cannot overwrite what the user has already edited. Written as one
  // `[]` effect it needed an eslint-disable for a rule this project does not
  // configure (which errors rather than warns).
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const seededRef = useRef(false);
  // The track the panel seeded from. Presets must build A from this, not from
  // `tracks[0]`: the list is alphabetical, so tracks[0] was `demucs_test_input`
  // - a 10-second demucs test fixture - and "Drums A + Vocals B" silently built
  // the whole mashup out of scratch audio.
  const [primaryTrack, setPrimaryTrack] = useState<string | null>(null);
  // Durations per source, probed once in the background. Needed because a stem
  // source can be a 10-second fixture: picking B as "the first track that is not
  // A" landed on `demucs_test_input`, so the swap preset laid real drums under
  // a tenth of a second of scratch vocal. Probe results are cached on disk by
  // the backend, so this costs one slow load and nothing after.
  const [durations, setDurations] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    getRemixSources()
      .then((s) => {
        if (!live) return;
        setSources(s);
        setSourcesLoaded(true);
      })
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!sourcesLoaded || tracks.length === 0) return;
    let live = true;
    void Promise.all(
      tracks.map((t) =>
        probeRemixTrack(t)
          .then((p) => [t, p.duration_sec] as const)
          .catch(() => [t, 0] as const),
      ),
    ).then((pairs) => {
      if (live) setDurations(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [sourcesLoaded, tracks]);

  useEffect(() => {
    if (!sourcesLoaded || seededRef.current || sources.length === 0) return;
    seededRef.current = true;
    const wanted = matchSource(currentTrack, tracks) ?? tracks[0];
    setPrimaryTrack(wanted);
    void probeRemixTrack(wanted)
      .then((p) => setBpm(Math.round(p.bpm)))
      .catch(() => {});
    setSlots([
      {
        bars: 8,
        crossfade_bars: 2,
        layers: STEM_NAMES.filter((n) => stemsFor(wanted).includes(n)).map((n) => newLayer(wanted, n)),
      },
    ]);
  }, [sourcesLoaded, tracks, currentTrack, stemsFor]);

  useEffect(() => {
    listRemixes().then(setRemixes).catch(() => {});
  }, []);

  // Consume a reopened arrangement. Runs once per arrival, guarded by a ref so a
  // later `remixes` load cannot re-apply it. Deliberately AFTER seeding, so a
  // pending recipe always wins over the default arrangement: the whole point is to
  // reopen exactly what was rendered, not to re-derive it from presets.
  const reopenHandledRef = useRef(false);
  useEffect(() => {
    if (reopenHandledRef.current) return;
    const pending = consumePendingRemixRecipe();
    if (!pending.recipe) {
      // No arrival: allow a future one to be handled.
      reopenHandledRef.current = remixes.length > 0;
      return;
    }
    reopenHandledRef.current = true;
    setName(pending.recipe.name || "mashup");
    setBpm(Math.round(pending.recipe.target_bpm));
    setSlots(recipeToEditableSlots(pending.recipe));
    // Point the selectors at the recipe's own source track rather than whatever
    // the panel defaulted to, so the arrangement and the source agree.
    const firstLayerTrack = pending.recipe.slots[0]?.layers[0]?.track;
    if (firstLayerTrack && tracks.includes(firstLayerTrack)) setPrimaryTrack(firstLayerTrack);
    // Select the existing remix so its stems are immediately playable.
    const known = remixes.find((r) => r.name === pending.recipe?.name);
    if (known) setBuilt(known);
  }, [remixes, tracks]);

  const recipe = useCallback((): RemixRecipeSpec => {
    // __id is a UI concern only; the API model has no such field.
    const clean: RemixSlotSpec[] = slots
      .filter((s) => s.layers.length > 0)
      .map((s) => ({
        bars: s.bars,
        crossfade_bars: s.crossfade_bars,
        layers: s.layers.map(({ __id: _drop, ...layer }) => layer),
      }));
    return { name: name.trim() || "mashup", target_bpm: bpm, slots: clean, beats_per_bar: 4, overwrite: true };
  }, [name, bpm, slots]);

  const applyPreset = useCallback(
    (preset: "swap" | "blend" | "intro") => {
      const a = primaryTrack ?? tracks[0];
      // B is the first *substantive* source that is not A: a 10-second fixture
      // is worse than no second song, because it sounds like the tool is broken.
      const b =
        tracks.find((t) => t !== a && (durations[t] ?? 0) >= MIN_SOURCE_SECONDS) ??
        tracks.find((t) => t !== a);
      if (!a) return;
      if (preset === "blend") {
        const other = b ?? a;
        setSlots([
          {
            bars: 8,
            crossfade_bars: 0,
            layers: [...STEM_NAMES.filter((n) => stemsFor(a).includes(n)).map((n) => newLayer(a, n)),
                     ...STEM_NAMES.filter((n) => stemsFor(other).includes(n) && n !== "vocals").map((n) => newLayer(other, n))],
          },
        ]);
      } else if (preset === "intro" && b) {
        setSlots([
          { bars: 4, crossfade_bars: 2, layers: STEM_NAMES.filter((n) => n !== "vocals" && stemsFor(a).includes(n)).map((n) => newLayer(a, n)) },
          { bars: 4, crossfade_bars: 2, layers: [...STEM_NAMES.filter((n) => stemsFor(a).includes(n)).map((n) => newLayer(a, n)), newLayer(b, "vocals")] },
        ]);
      } else if (b) {
        setSlots([
          { bars: 4, crossfade_bars: 2, layers: [newLayer(a, "drums"), newLayer(a, "bass")] },
          { bars: 4, crossfade_bars: 2, layers: [newLayer(a, "drums"), newLayer(a, "bass"), newLayer(b, "vocals")] },
        ]);
      }
      setError(null);
      setPreview(null);
    },
    [tracks, stemsFor, primaryTrack, durations],
  );

  const runPreview = useCallback(async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await previewRemix(recipe()));
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(null);
    }
  }, [recipe]);

  const runBuild = useCallback(async () => {
    setBusy("build");
    setError(null);
    try {
      const r = await buildRemix(recipe());
      // Only the stems this recipe referenced. Offering all four put a
      // play button on `other` that returned digital silence (-240 dBFS),
      // because no slot used it - which reads as a broken player.
      const used = Array.from(
        new Set(
          slots.flatMap((s) => s.layers.map((l) => l.stem)).filter(Boolean),
        ),
      );
      setBuilt({ name: r.name, duration_sec: r.duration_sec, target_bpm: bpm, source_tracks: r.manifest.source_tracks as string[], stems: used.length ? used : Object.keys(r.stems), has_enhanced: false });
      setPreview((p) => (p ? { ...p, warnings: r.warnings } : p));
      listRemixes().then(setRemixes).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [recipe, bpm, slots]);

  const runMaster = useCallback(async () => {
    if (!built) return;
    setBusy("master");
    setError(null);
    try {
      await enhanceRemix(built.name);
      setBuilt((b) => (b ? { ...b, has_enhanced: true } : b));
      listRemixes().then(setRemixes).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [built]);

  const updateLayer = useCallback((slotIdx: number, layerIdx: number, patch: Partial<UILayer>) => {
    setSlots((prev) =>
      prev.map((s, i) =>
        i !== slotIdx ? s : { ...s, layers: s.layers.map((l, j) => (j === layerIdx ? { ...l, ...patch } : l)) },
      ),
    );
  }, []);

  const play = useCallback((src: string) => {
    const el = audioRef.current ?? new Audio();
    audioRef.current = el;
    if (el.src !== src) el.src = src;
    void el.play().catch(() => setError("Playback was blocked by the browser"));
  }, []);

  if (!open) {
    return (
      <button onClick={toggle} className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-white transition-colors">
        <Wand2 size={12} className="text-amber-300" />
        <span className="flex-1 text-left">Remix / Mashup</span>
        <ChevronDown size={12} className="text-muted" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 space-y-2">
      <button onClick={toggle} className="flex items-center gap-1.5 w-full text-left">
        <Wand2 size={12} className="text-amber-300" />
        <span className="flex-1 text-[11px] text-white">Remix / Mashup</span>
        <span className="text-[9px] text-muted">{sources.length} stems ready</span>
        <ChevronDown size={12} className="text-muted rotate-180" />
      </button>

      {loadError && <p className="text-[10px] text-red-300/80">{loadError}</p>}

      {sources.length === 0 && !loadError && (
        <p className="text-[10px] text-muted leading-relaxed">
          No separated stems found. Run stem separation on a track first (Stem Mixer → Enhance stems).
        </p>
      )}

      {sources.length > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="remix name"
              aria-label="Remix name"
              className="flex-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white"
            />
            <label className={LABEL}>BPM</label>
            <input
              type="number"
              value={bpm}
              min={40}
              max={240}
              onChange={(e) => setBpm(Number(e.target.value))}
              aria-label="Target BPM"
              className={NUM}
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {(["swap", "intro", "blend"] as const).map((p) => (
              <button key={p} onClick={() => applyPreset(p)} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white">
                {p === "swap" ? "Drums A + Vocals B" : p === "intro" ? "Intro → swap" : "Blend A + B"}
              </button>
            ))}
          </div>

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

              {slot.layers.map((layer, li) => (
                <div key={layer.__id} className="flex items-center gap-1">
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
                  <label className={LABEL}>dB</label>
                  <input type="number" step={0.5} value={layer.gain_db} onChange={(e) => updateLayer(si, li, { gain_db: Number(e.target.value) })} className={NUM} aria-label="Gain dB" />
                  <label className={LABEL}>st</label>
                  <input type="number" step={1} value={layer.key_shift_semitones} onChange={(e) => updateLayer(si, li, { key_shift_semitones: Number(e.target.value) })} className={NUM} aria-label="Key shift semitones" />
                  <label className={LABEL}>@bar</label>
                  <input type="number" min={0} value={layer.source_start_bar} onChange={(e) => updateLayer(si, li, { source_start_bar: Math.max(0, Number(e.target.value)) })} className={NUM} aria-label="Source start bar" />
                  <button onClick={() => setSlots((p) => p.map((s, i) => (i === si ? { ...s, layers: s.layers.filter((_, j) => j !== li) } : s)))} aria-label="Remove layer" className="text-muted hover:text-red-300">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}

              <button onClick={() => setSlots((p) => p.map((s, i) => (i === si ? { ...s, layers: [...s.layers, newLayer(s.layers[0]?.track ?? tracks[0], "drums")] } : s)))} className="flex items-center gap-1 text-[10px] text-muted hover:text-white">
                <Plus size={10} /> layer
              </button>
            </div>
          ))}

          <button onClick={() => setSlots((p) => [...p, { bars: 4, crossfade_bars: 2, layers: [newLayer(tracks[0], "drums")] }])} className="flex items-center gap-1 text-[10px] text-muted hover:text-white">
            <Plus size={10} /> slot
          </button>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <button onClick={runPreview} disabled={busy !== null} className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40">
              {busy === "preview" ? <Loader2 size={10} className="animate-spin" /> : null} Preview
            </button>
            <button onClick={runBuild} disabled={busy !== null} className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100 disabled:opacity-40">
              {busy === "build" ? <Loader2 size={10} className="animate-spin" /> : null} Build
            </button>
          </div>

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
                <span className="text-[10px] text-white flex-1">Hear “{built.name}”</span>
                <button onClick={runMaster} disabled={busy !== null || built.has_enhanced} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40">
                  {busy === "master" ? "Mastering…" : built.has_enhanced ? "Mastered ✓" : "Master it"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {(built.has_enhanced ? [...built.stems, "master" as const] : built.stems).map((which) => (
                  <button key={which} onClick={() => play(remixFileUrl(built.name, which as StemName | "master"))} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white">
                    <Play size={9} /> {which}
                  </button>
              ))}
              </div>
            </div>
          )}

          {remixes.filter((r) => !built || r.name !== built.name).length > 0 && (
            <details className="text-[10px] text-muted">
              <summary className="cursor-pointer hover:text-white">Earlier remixes ({remixes.filter((r) => !built || r.name !== built.name).length})</summary>
              <div className="flex flex-wrap gap-1 mt-1">
                {remixes.filter((r) => !built || r.name !== built.name).map((r) => (
                  <button key={r.name} onClick={() => setBuilt(r)} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white">
                    {r.name}{r.has_enhanced ? " ★" : ""}
                  </button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}