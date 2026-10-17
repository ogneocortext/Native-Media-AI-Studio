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
import { AlertCircle, ChevronDown, Loader2, Play, Plus, Scissors, Trash2, Wand2 } from "lucide-react";
import {
  STEM_NAMES,
  RemixCancelledError,
  awaitRemixJob,
  cancelRemixJob,
  draftRemixFromPrompt,
  enhanceRemix,
  getAudioStems,
  getApiBase,
  getRemixSources,
  listRemixes,
  previewRemix,
  previewRemixAudio,
  probeRemixTrack,
  remixFileUrl,
  separateAudioFile,
  startBuildRemix,
  listRemixVersions,
  type RemixBuildResult,
  type RemixPreview,
  type RemixRecipeSpec,
  type RemixSlotSpec,
  type RemixSource,
  type RemixSummary,
  type RemixVersion,
  type StemName,
} from "../../../services/api";
import { usePanelCollapsed } from "../usePanelCollapsed";
import { abInitial, abPin, abShowing, type AbState } from "../components/abCompare";
import {
  buildWizardSlots,
  wizardDurationSec,
  wizardName,
  wizardSummary,
  type WizardGoal,
  type WizardInput,
} from "./remixWizard";
import { consumePendingRemixOpen, consumePendingRemixRecipe } from "../../../utils/pendingTrack";

export interface RemixPanelProps {
  /** Track the visualizer is already showing; preselected as source A. */
  currentTrack?: string | null;
}

const NUM = "w-14 px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white text-right";
const LABEL = "text-[9px] uppercase tracking-wide text-muted";

/** A source shorter than this is a fixture, not a song, so it is not used as a mash partner. */
const MIN_SOURCE_SECONDS = 30;

// matchSource (library path <-> stem key, with the fixture guard) lives in
// ./remixRecipe so the unit suite can exercise it without React.
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
  matchSource,
  nextFreeName,
  recipeToEditableSlots,
  timelineSegments,
  STEM_TIMELINE_COLORS,
  type EditableLayer,
  type EditableSlot,
} from "./remixRecipe";

function newLayer(track: string, stem: StemName): EditableLayer {
  return newEditableLayer(track, stem);
}

export function RemixPanel({ currentTrack }: RemixPanelProps) {
  const { open, toggle, setOpen } = usePanelCollapsed("stem-remix");
  const [sources, setSources] = useState<RemixSource[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("mashup");
  const [nameTouched, setNameTouched] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [slots, setSlots] = useState<UISlot[]>([]);
  const [busy, setBusy] = useState<null | "preview" | "build" | "master" | "separate" | "listen" | "audition" | "revise">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RemixPreview | null>(null);
  // R1: the last revision sentence's human-readable diff, shown for review.
  const [reviseChanges, setReviseChanges] = useState<string[] | null>(null);
  const [reviseWarnings, setReviseWarnings] = useState<string[]>([]);
  const [reviseInput, setReviseInput] = useState("");
  // A3: the last rendered audition, played through a hidden <audio>.
  const [listen, setListen] = useState<{ url: string; duration_sec: number; truncated: boolean } | null>(null);
  const [built, setBuilt] = useState<RemixSummary | null>(null);
  // The lineage of the built remix: the current render plus every render a
  // rebuild archived. A rebuild used to delete the previous mix, so the
  // render you were comparing against was one click from gone; now it is
  // playable from here.
  const [versions, setVersions] = useState<RemixVersion[]>([]);
  // null plays the current render; a number plays that archived version.
  const [versionPick, setVersionPick] = useState<number | null>(null);
  // A/B pins: snapshots of the whole form, so flipping is a context switch.
  const [ab, setAb] = useState<AbState>(abInitial);
  // The guided wizard. `null` is closed; a number is the step being shown.
  // The plan parked this ("the presets already lower the floor"), and the
  // owner asked for it anyway, so it stays deliberately small: three
  // questions, a summary, and it ends by loading the arrangement into this
  // same form rather than building anything the form could not build.
  const [wizardStep, setWizardStep] = useState<number | null>(null);
  const [wizA, setWizA] = useState("");
  const [wizB, setWizB] = useState<string | null>(null);
  const [wizGoal, setWizGoal] = useState<WizardGoal>("swap");
  const [wizSlots, setWizSlots] = useState(2);
  const [wizBars, setWizBars] = useState(4);
  const currentVersion = useMemo(
    () => versions.find((v) => v.current)?.version ?? null,
    [versions],
  );

  const loadVersions = useCallback(async (name: string) => {
    setVersionPick(null);
    try {
      setVersions(await listRemixVersions(name));
    } catch {
      // An older backend has no versions route; the panel still works,
      // it just has no lineage to offer.
      setVersions([]);
    }
  }, []);

  /** Load a pinned arrangement into the form: a full context switch. */
  const loadVariant = useCallback((which: "a" | "b") => {
    const variant = which === "a" ? ab.a : ab.b;
    if (!variant) return;
    setName(variant.name);
    setBpm(variant.bpm);
    setSlots(variant.slots);
    // The preview and any audition belong to the arrangement they were
    // rendered from; keeping them would play the other variant's audio
    // under the new form and read as a bug.
    setPreview(null);
    setListen(null);
    setReviseChanges(null);
    setReviseWarnings([]);
  }, [ab]);
  const [remixes, setRemixes] = useState<RemixSummary[]>([]);
  // A5: replacing an existing remix is an explicit choice, not the default.
  const [overwrite, setOverwrite] = useState(false);
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
  // Two more probe facts, from the same requests the duration run already
  // makes (probes are cached server-side, so this costs nothing extra):
  // when a track first becomes audible, and its tempo. The wizard needs
  // both - it offsets a vocals entry past a silent intro, and follows the
  // tempo of whichever song the wizard picked as A.
  const [firstAudible, setFirstAudible] = useState<Record<string, number>>({});
  const [probeBpm, setProbeBpm] = useState<Record<string, number>>({});
  // A7: the probe's key advisory for the seeded track. It is *advisory*: on
  // this library chroma flatness is 0.978-0.998 and the argmax moved between
  // runs, so it is displayed labelled as unreliable rather than treated as a
  // key. The panel docstring claims this; now it is true.
  const [keyAdvisory, setKeyAdvisory] = useState<{ key: string; confident: boolean } | null>(null);

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
          .then((p) => [t, p.duration_sec, p.first_audible_sec, p.bpm] as const)
          .catch(() => [t, 0, 0, 0] as const),
      ),
    ).then((rows) => {
      if (!live) return;
      setDurations(Object.fromEntries(rows.map(([t, d]) => [t, d])));
      setFirstAudible(Object.fromEntries(rows.map(([t, , f]) => [t, f])));
      setProbeBpm(Object.fromEntries(rows.map(([t, , , b]) => [t, b])));
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
      .then((p) => {
        setBpm(Math.round(p.bpm));
        setKeyAdvisory(
          p.key_advisory ? { key: p.key_advisory, confident: Boolean(p.key_confident) } : null,
        );
      })
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

  // A1: a Media Library handoff ("Mashup this track") carries the intent to
  // expand this panel. The panel renders collapsed by default, so without
  // this the user lands on the Visualizer and hunts for the control they
  // just asked for. Consumed once, so a later reload does not re-open it.
  useEffect(() => {
    if (consumePendingRemixOpen()) setOpen(true);
  }, [setOpen]);

  // A5: with the name field untouched, keep it one step ahead of what exists,
  // so a second build does not collide (and with overwrite off, cannot
  // clobber). Anything the user types wins and is never rewritten.
  useEffect(() => {
    if (nameTouched || remixes.length === 0) return;
    const taken = remixes.map((r) => r.name);
    setName((current) => nextFreeName(current, taken));
  }, [remixes, nameTouched]);

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
    return {
      name: name.trim() || "mashup",
      target_bpm: bpm,
      slots: clean,
      beats_per_bar: 4,
      // A5: explicit, not hardcoded. The name suggestion above keeps the
      // default collision-free, so overwrite stays off unless asked for.
      overwrite,
    };
  }, [name, bpm, slots, overwrite]);

  // A2: the empty state used to be an instruction ("run stem separation…
  // first"), which sends the user somewhere else for the very thing they
  // opened this panel to do. Separation is one call, so it happens here and
  // refreshes the source list on completion.
  const runSeparate = useCallback(async () => {
    if (!currentTrack) {
      setError("Load a track first — separation runs on the track you are viewing.");
      return;
    }
    setBusy("separate");
    setError(null);
    try {
      await separateAudioFile(currentTrack);
      const fresh = await getRemixSources();
      setSources(fresh);
      setSourcesLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [currentTrack]);

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

  // ── the wizard ──────────────────────────────────────────────────────────
  // Seeded from the same defaults the presets use (A from the seeded track,
  // B the first substantive other), so opening the wizard never presents a
  // fixture as a song.
  const openWizard = useCallback(() => {
    const a = primaryTrack ?? tracks[0] ?? "";
    const b =
      tracks.find((t) => t !== a && (durations[t] ?? 0) >= MIN_SOURCE_SECONDS) ??
      tracks.find((t) => t !== a) ??
      null;
    setWizA(a);
    setWizB(b);
    setWizGoal("swap");
    setWizSlots(2);
    setWizBars(4);
    setWizardStep(0);
  }, [tracks, primaryTrack, durations]);

  const wizardInput = useCallback((): WizardInput => {
    const audible = wizB ? (firstAudible[wizB] ?? null) : null;
    return {
      songA: wizA,
      songB: wizB,
      goal: wizGoal,
      barsPerSlot: wizBars,
      slotCount: wizSlots,
      bpm,
      stemsA: stemsFor(wizA),
      stemsB: wizB ? stemsFor(wizB) : [],
      firstAudibleB: audible && audible > 0 ? audible : null,
    };
  }, [wizA, wizB, wizGoal, wizBars, wizSlots, bpm, stemsFor, firstAudible]);

  /**
   * End the wizard by loading its arrangement into the form.
   *
   * It does not build: rendering is an explicit, separate act everywhere
   * else in this panel, and a wizard that built behind the user's back
   * would break the one rule the whole feature is careful about. The name
   * is the wizard's own, one step ahead of what exists, and marking it
   * touched stops the suggestion effect from rewriting what the user just
   * chose through the wizard.
   */
  const applyWizard = useCallback(() => {
    const input = wizardInput();
    const slots = buildWizardSlots(input);
    if (slots.length === 0) {
      setError("That arrangement has no playable layers — pick another song.");
      return;
    }
    setName(nextFreeName(wizardName(input.songA, input.songB), remixes.map((r) => r.name)));
    setNameTouched(true);
    setSlots(slots);
    setWizardStep(null);
    setPreview(null);
    setListen(null);
    setError(null);
  }, [wizardInput, remixes, setNameTouched]);

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

  // A3: an audible audition of the arrangement. Preview answers "what would
  // this render to" in numbers; this answers "what does it sound like",
  // before a build is paid for.
  const runListen = useCallback(async () => {
    setBusy("listen");
    setError(null);
    try {
      const result = await previewRemixAudio(recipe());
      setListen({ url: result.url, duration_sec: result.duration_sec, truncated: result.truncated });
    } catch (e) {
      setError((e as Error).message);
      setListen(null);
    } finally {
      setBusy(null);
    }
  }, [recipe]);

  // R1: revise the live recipe with one sentence ("vocals up 2 dB"). The
  // panel's current recipe goes as base_recipe; the returned recipe is
  // applied to the form for review — rendering stays an explicit /build.
  const runRevise = useCallback(async () => {
    const sentence = reviseInput.trim();
    if (!sentence) {
      setError("Type a revision first — e.g. “vocals up 2 dB”.");
      return;
    }
    setBusy("revise");
    setError(null);
    try {
      const draft = await draftRemixFromPrompt(sentence, recipe());
      setSlots(recipeToEditableSlots(draft.recipe));
      setBpm(Math.round(draft.recipe.target_bpm));
      setReviseChanges(draft.changes);
      setReviseWarnings(draft.warnings);
    } catch (e) {
      setError((e as Error).message);
      setReviseChanges(null);
      setReviseWarnings([]);
    } finally {
      setBusy(null);
    }
  }, [reviseInput, recipe]);

  // R2: audition one slot alone through the timeline. The backend renders
  // just that slot through the same mix path; the panel plays it like any
  // other audition. seg.slotIndex is the true slots-array index, but the
  // wire recipe filters empty slots — resolve the nth playable slot's
  // position in the built recipe rather than assuming the index survived.
  const auditionSlot = useCallback(
    async (slotIndex: number) => {
      setBusy("listen");
      setError(null);
      try {
        const built = recipe();
        const playable = slots
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.layers.length > 0);
        const position = playable.findIndex(({ i }) => i === slotIndex);
        if (position < 0 || position >= built.slots.length) {
          throw new Error(`Slot ${slotIndex + 1} has no layers to audition.`);
        }
        const result = await previewRemixAudio(built, position);
        setListen({ url: result.url, duration_sec: result.duration_sec, truncated: result.truncated });
      } catch (e) {
        setError((e as Error).message);
        setListen(null);
      } finally {
        setBusy(null);
      }
    },
    [recipe, slots],
  );

  // R2: reorder slots by drag. The form sections render from the same array,
  // so they follow with no extra wiring — single source of truth.
  const moveSlot = useCallback((from: number, to: number) => {
    if (from === to) return;
    setSlots((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setPreview(null);
  }, []);

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  // The running build's job id, so Cancel has something to cancel. State,
  // not a ref: the Cancel button renders from it, and a value nothing
  // re-renders for is a button that never appears.
  const [buildJobId, setBuildJobId] = useState<string | null>(null);

  const runBuild = useCallback(async () => {
    // A5: refuse the one case that used to be silent. A colliding name with
    // overwrite off would have rendered to a directory that already exists;
    // the build used to pass overwrite: true, which replaced it without
    // asking. Now the collision is surfaced and the caller decides.
    if (!overwrite && remixes.some((r) => r.name.toLowerCase() === name.trim().toLowerCase())) {
      setError(`A remix named "${name.trim()}" already exists. Pick another name, or enable overwrite.`);
      return;
    }
    setBusy("build");
    setError(null);
    // The job id is what Cancel cancels, so the build is started and
    // awaited as a job rather than through the awaiting wrapper: a
    // render measured 7-23 s, and a wait with no way out is the
    // reason this panel now owns the poll loop.
    setBuildJobId(null);
    try {
      const accepted = await startBuildRemix(recipe());
      setBuildJobId(accepted.job_id);
      const status = await awaitRemixJob(accepted.job_id);
      if (status.state === "cancelled") {
        // Nothing was written: the mix is in memory until it is
        // complete, so an earlier render under this name survives.
        setError("Build cancelled — any earlier render is untouched.");
        return;
      }
      if (status.state === "failed" || !status.result) {
        setError(status.error ?? "Build failed");
        return;
      }
      const r = status.result as RemixBuildResult;
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
      void loadVersions(r.name);
    } catch (e) {
      if (e instanceof RemixCancelledError) {
        setError("Build cancelled — any earlier render is untouched.");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBuildJobId(null);
      setBusy(null);
    }
  }, [recipe, bpm, slots, overwrite, remixes, name]);

  const cancelBuild = useCallback(async () => {
    if (!buildJobId) return;
    try {
      await cancelRemixJob(buildJobId);
      // The poll loop above observes the terminal state and reports
      // it; this only has to survive the click.
    } catch (e) {
      setError((e as Error).message);
    }
  }, [buildJobId]);

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

  // A4: audition one layer's *source* stem — "what does B's vocals actually
  // sound like" without building anything. Resolved through the library
  // filename the sources listing carries (B6), then the stems index.
  const auditionLayer = useCallback(
    async (layer: UILayer) => {
      const source = sources.find((s) => s.track === layer.track);
      const libraryFile = source?.library_file;
      if (!libraryFile) {
        setError(`No library file is linked to ${layer.track}; cannot audition its ${layer.stem}.`);
        return;
      }
      setBusy("audition");
      setError(null);
      try {
        const stems = await getAudioStems(libraryFile);
        const url = stems.stems[layer.stem];
        if (!url) throw new Error(`${libraryFile} has no separated ${layer.stem}`);
        play(url.startsWith("/") ? `${getApiBase()}${url}` : url);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [sources, play],
  );

  if (!open) {
    return (
      <button onClick={toggle} className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-white transition-colors">
        <Wand2 size={12} className="text-amber-300" />
        <span className="flex-1 text-left">Remix / Mashup</span>
        <ChevronDown size={12} className="text-muted" />
      </button>
    );
  }

  // The wizard replaces the form while it is open. That is deliberate: a
  // guided flow competing for attention with the full editor behind it is
  // not guidance, it is clutter. It ends by loading the arrangement into
  // the form, so the user lands where they would have built it by hand -
  // with the difference that every choice was asked for in order.
  if (wizardStep !== null) {
    const wiz = wizardInput();
    const built = buildWizardSlots(wiz);
    const vocalsBar =
      built
        .flatMap((s) => s.layers)
        .find((l) => l.stem === "vocals" && l.track === wizB)?.source_start_bar ?? 0;
    const bVocals = wizB ? stemsFor(wizB).includes("vocals") : false;
    const stepCount = 4;
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <Wand2 size={12} className="text-amber-300" />
          <span className="flex-1 text-[11px] text-white">Mashup wizard</span>
          <span className="text-[9px] text-muted">
            step {wizardStep + 1} of {stepCount}
          </span>
        </div>

        {wizardStep === 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted leading-relaxed">
              Pick the songs. Everything else follows from these two choices.
            </p>
            <div className="flex items-center gap-1.5">
              <label className={LABEL}>Song A</label>
              <select
                aria-label="Wizard song A"
                value={wizA}
                onChange={(e) => {
                  const next = e.target.value;
                  setWizA(next);
                  // Follow the new song's tempo: a wizard that silently keeps
                  // the old tempo after the song changed is guessing.
                  const probed = probeBpm[next];
                  if (probed) setBpm(Math.round(probed));
                  if (wizB === next) setWizB(null);
                }}
                className="flex-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white"
              >
                {tracks.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className={LABEL}>Song B</label>
              <select
                aria-label="Wizard song B"
                value={wizB ?? ""}
                onChange={(e) => setWizB(e.target.value || null)}
                className="flex-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white"
              >
                <option value="">(one song only)</option>
                {tracks
                  .filter((t) => t !== wizA)
                  .map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {wizardStep === 1 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted leading-relaxed">
              What should the arrangement do?
            </p>
            {([
              {
                id: "swap" as WizardGoal,
                label: "Drums under vocals",
                detail: "Song A's drums and bass, with song B's vocals arriving",
                needsBVocals: true,
              },
              {
                id: "blend" as WizardGoal,
                label: "Blend the two songs",
                detail: "One slot holding both songs, song B without its vocals",
                needsBVocals: false,
              },
              {
                id: "intro" as WizardGoal,
                label: "Intro, then the vocals",
                detail: "An instrumental opening, then song B's vocals arrive",
                needsBVocals: true,
              },
            ] as const).map((goal) => (
              <button
                key={goal.id}
                disabled={goal.needsBVocals && !bVocals}
                title={
                  goal.needsBVocals && !bVocals
                    ? "Song B has no separated vocals — pick another song, or blend"
                    : undefined
                }
                onClick={() => setWizGoal(goal.id)}
                className={`block w-full text-left px-1.5 py-1 rounded text-[10px] disabled:opacity-40 ${
                  wizGoal === goal.id
                    ? "bg-amber-500/20 text-amber-100"
                    : "bg-white/5 hover:bg-white/10 text-white"
                }`}
              >
                <span className="block">{goal.label}</span>
                <span className="block text-[9px] text-muted">{goal.detail}</span>
              </button>
            ))}
          </div>
        )}

        {wizardStep === 2 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted leading-relaxed">
              How long should it run? The tempo is {bpm} BPM, from song A's probe.
            </p>
            <div className="flex items-center gap-1.5">
              <span className={LABEL}>Sections</span>
              {([2, 4] as const).map((n) => (
                <button
                  key={n}
                  aria-label={`${n} sections`}
                  onClick={() => setWizSlots(n)}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    wizSlots === n ? "bg-amber-500/20 text-amber-100" : "bg-white/5 hover:bg-white/10 text-white"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className={LABEL}>Bars each</span>
              {([4, 8] as const).map((n) => (
                <button
                  key={n}
                  aria-label={`${n} bars each`}
                  onClick={() => setWizBars(n)}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    wizBars === n ? "bg-amber-500/20 text-amber-100" : "bg-white/5 hover:bg-white/10 text-white"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-muted">
              About {wizardDurationSec(wiz).toFixed(1)} s of audio,{" "}
              {wiz.slotCount * wiz.barsPerSlot} bars in total.
            </p>
          </div>
        )}

        {wizardStep === 3 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted leading-relaxed">
              Here is what will be built. Review it in the form before you render.
            </p>
            {wizardSummary(wiz).map((line) => (
              <div key={line.label} className="flex gap-1.5 text-[10px]">
                <span className="text-muted w-16 shrink-0">{line.label}</span>
                <span className="text-white break-all">{line.value}</span>
              </div>
            ))}
            {vocalsBar > 0 && (
              <p className="flex items-start gap-1 text-[10px] text-amber-300/90 leading-relaxed">
                <AlertCircle size={10} className="mt-0.5 shrink-0" />
                <span>
                  Song B's vocals start at {(firstAudible[wizB ?? ""] ?? 0).toFixed(1)} s, so
                  they enter at bar {vocalsBar} — a vocals layer at bar 0 would render
                  digital silence and sound like a broken mixer.
                </span>
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1 pt-1 border-t border-white/10">
          <button
            disabled={wizardStep === 0}
            onClick={() => setWizardStep((s) => Math.max(0, (s ?? 1) - 1))}
            className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40"
          >
            Back
          </button>
          {wizardStep < stepCount - 1 ? (
            <button
              onClick={() => setWizardStep((s) => Math.min(stepCount - 1, (s ?? 0) + 1))}
              className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100"
            >
              Next
            </button>
          ) : (
            <button
              onClick={applyWizard}
              className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100"
            >
              Use this arrangement
            </button>
          )}
          <button
            onClick={() => setWizardStep(null)}
            className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white"
          >
            Cancel
          </button>
        </div>
      </div>
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
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted leading-relaxed">
            No separated stems yet for any track.
          </p>
          {currentTrack ? (
            <button
              onClick={runSeparate}
              disabled={busy !== null}
              className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100 disabled:opacity-40"
            >
              {busy === "separate" ? <Loader2 size={10} className="animate-spin" /> : <Scissors size={10} />}
              Separate stems for the current track
            </button>
          ) : (
            <p className="text-[10px] text-muted leading-relaxed">
              Load a track, then this panel can separate its stems for you.
            </p>
          )}
          {busy === "separate" && (
            <p className="text-[10px] text-muted">Separating — demucs takes a minute or two per track…</p>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
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

          {/* A5: replacing an existing remix is a visible, deliberate act.
              The default is the next free name plus overwrite off. */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-[10px] text-muted" title="Replace an existing remix of the same name instead of building under a new one">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="accent-amber-400"
              />
              Overwrite if the name exists
            </label>
            {!overwrite && remixes.some((r) => r.name.toLowerCase() === name.trim().toLowerCase()) && (
              <span className="text-[10px] text-amber-200/90" data-testid="remix-name-collision">
                A remix named “{name.trim()}” already exists — enable overwrite to replace it.
              </span>
            )}
          </div>

          {/* A7: render the advisory the panel docstring always claimed, with
              its unreliability attached. It sits with the arrangement header
              because it is a fact about the seeded source track, not about a
              rendered remix. */}
          {keyAdvisory && (
            <p className="text-[10px] text-muted" data-testid="remix-key-advisory">
              advisory key <span className="text-white/80">{keyAdvisory.key}</span>
              {keyAdvisory.confident
                ? ""
                : " — unreliable (chroma is flat on these stems); key shifts stay explicit per layer"}
            </p>
          )}

          <div className="flex flex-wrap gap-1">
            <button
              onClick={openWizard}
              title="Answer three questions and this panel fills itself in"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100"
            >
              <Wand2 size={10} /> Guided wizard
            </button>
            {(["swap", "intro", "blend"] as const).map((p) => (
              <button key={p} onClick={() => applyPreset(p)} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white">
                {p === "swap" ? "Drums A + Vocals B" : p === "intro" ? "Intro → swap" : "Blend A + B"}
              </button>
            ))}
          </div>

          {/* A/B: pin two arrangements and flip between them. A pin is a
              snapshot of the whole form, so flipping is a full context
              switch - what the form shows is what a preview or build
              renders, which is the iteration loop's actual question
              ("is the revision better than what I had?"). */}
          <div className="flex flex-wrap gap-1 items-center">
            <button
              onClick={() => setAb((s) => abPin(s, "a", { name, bpm, slots }))}
              className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white"
            >
              Pin as A{abShowing(ab, { name, bpm, slots }) === "a" ? " •" : ""}
            </button>
            {ab.a && (
              <button onClick={() => loadVariant("a")} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white">
                A
              </button>
            )}
            <button
              onClick={() => setAb((s) => abPin(s, "b", { name, bpm, slots }))}
              className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white"
            >
              Pin as B{abShowing(ab, { name, bpm, slots }) === "b" ? " •" : ""}
            </button>
            {ab.b && (
              <button onClick={() => loadVariant("b")} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white">
                B
              </button>
            )}
          </div>

          {/* R1: revise the live arrangement with one sentence. The panel's
              current recipe goes as base_recipe; the returned recipe lands
              back in the form for review — rendering stays an explicit build. */}
          <div className="flex items-center gap-1">
            <input
              value={reviseInput}
              onChange={(e) => setReviseInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runRevise();
              }}
              placeholder="Revise: vocals up 2 dB…"
              aria-label="Revise arrangement with a sentence"
              className="flex-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white placeholder:text-muted"
            />
            <button
              onClick={() => void runRevise()}
              disabled={busy !== null}
              // No aria-label: the visible text is the accessible name.
              // "Apply revision" made the name disagree with the label,
              // which fails WCAG 2.5.3 and hides the button from
              // getByRole("button", { name: "Revise" }).
              className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40"
            >
              {busy === "revise" ? <Loader2 size={10} className="animate-spin" /> : "Revise"}
            </button>
          </div>
          {(reviseChanges !== null || reviseWarnings.length > 0) && (
            <div className="space-y-0.5" data-testid="remix-revise-result">
              {(reviseChanges ?? []).map((c) => (
                <p key={c} className="text-[10px] text-emerald-200/90">✓ {c}</p>
              ))}
              {reviseChanges !== null && reviseChanges.length === 0 && (
                <p className="text-[10px] text-muted">No changes — recipe already matches.</p>
              )}
              {reviseWarnings.map((w) => (
                <p key={w} className="flex items-start gap-1 text-[10px] text-amber-300/90">
                  <AlertCircle size={10} className="mt-0.5 shrink-0" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          )}

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
                    onClick={() => void auditionSlot(seg.slotIndex)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void auditionSlot(seg.slotIndex);
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
                                onClick={() => void auditionLayer(layer)}
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
            <button
              onClick={runListen}
              disabled={busy !== null || slots.every((s) => s.layers.length === 0)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-violet-500/20 hover:bg-violet-500/30 text-[10px] text-violet-100 disabled:opacity-40"
              title="Render a ~30 s excerpt of this arrangement and play it"
            >
              {busy === "listen" ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />} Audition
            </button>
            <button onClick={runBuild} disabled={busy !== null} className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100 disabled:opacity-40">
              {busy === "build" ? <Loader2 size={10} className="animate-spin" /> : null} Build
            </button>
            {/* Cancelling is cooperative - the render stops between slots -
                so this only disappears when the job reaches a terminal
                state, which the poll loop reports. */}
            {busy === "build" && buildJobId && (
              <button onClick={() => void cancelBuild()} className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-red-500/20 text-[10px] text-white/80 hover:text-red-200">
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
                <button onClick={runMaster} disabled={busy !== null || built.has_enhanced || versionPick !== null} title={versionPick !== null ? "Mastering renders a new current mix - it does not master an archived version" : undefined} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40">
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
                    onChange={(e) => setVersionPick(e.target.value ? Number(e.target.value) : null)}
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

          {remixes.filter((r) => !built || r.name !== built.name).length > 0 && (
            <details className="text-[10px] text-muted">
              <summary className="cursor-pointer hover:text-white">Earlier remixes ({remixes.filter((r) => !built || r.name !== built.name).length})</summary>
              <div className="flex flex-wrap gap-1 mt-1">
                {remixes.filter((r) => !built || r.name !== built.name).map((r) => (
                  <button key={r.name} onClick={() => { setBuilt(r); void loadVersions(r.name); }} className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white">
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