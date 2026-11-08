/**
 * RemixWizard — the guided 4-step mashup flow extracted from RemixPanel.
 *
 * The wizard replaces the form while it is open. That is deliberate: a
 * guided flow competing for attention with the full editor behind it is
 * not guidance, it is clutter. It ends by calling `onApply` with the
 * arrangement, which loads it into the form — the user lands where they
 * would have built it by hand, with every choice asked for in order.
 *
 * All wizard-local state (song picks, goal, length, step) lives here; the
 * component remounts on each open so `useState` initializers reseed from
 * the current sources.
 */
import { useState } from "react";
import { AlertCircle, Wand2 } from "lucide-react";
import type { StemName } from "../../services/api";
import {
  buildWizardSlots,
  MIN_SOURCE_SECONDS,
  wizardDurationSec,
  wizardSummary,
  type WizardGoal,
  type WizardInput,
} from "./remixWizard";

const LABEL = "text-[9px] uppercase tracking-wide text-muted";
const STEP_COUNT = 4;

export interface RemixWizardProps {
  tracks: string[];
  /** Track the panel seeded from — the wizard's default song A. */
  primaryTrack: string | null;
  /** Probed durations per source (seconds); short fixtures are not songs. */
  durations: Record<string, number>;
  bpm: number;
  probeBpm: Record<string, number>;
  firstAudible: Record<string, number>;
  stemsFor: (track: string) => StemName[];
  /** Follow the newly-picked song A's probed tempo. */
  onBpmFollow: (bpm: number) => void;
  onApply: (input: WizardInput) => void;
  onClose: () => void;
}

export function RemixWizard({
  tracks,
  primaryTrack,
  durations,
  bpm,
  probeBpm,
  firstAudible,
  stemsFor,
  onBpmFollow,
  onApply,
  onClose,
}: RemixWizardProps) {
  // Seeded from the same defaults the presets use (A from the seeded track,
  // B the first substantive other), so opening the wizard never presents a
  // fixture as a song.
  const [step, setStep] = useState(0);
  const [wizA, setWizA] = useState(() => primaryTrack ?? tracks.at(0) ?? "");
  const [wizB, setWizB] = useState<string | null>(() => {
    const a = primaryTrack ?? tracks.at(0) ?? "";
    return (
      tracks.find((t) => t !== a && (durations[t] ?? 0) >= MIN_SOURCE_SECONDS) ??
      tracks.find((t) => t !== a) ??
      null
    );
  });
  const [wizGoal, setWizGoal] = useState<WizardGoal>("swap");
  const [wizSlots, setWizSlots] = useState(2);
  const [wizBars, setWizBars] = useState(4);

  const wiz: WizardInput = {
    songA: wizA,
    songB: wizB,
    goal: wizGoal,
    barsPerSlot: wizBars,
    slotCount: wizSlots,
    bpm,
    stemsA: stemsFor(wizA),
    stemsB: wizB ? stemsFor(wizB) : [],
    firstAudibleB: (() => {
      const audible = wizB ? (firstAudible[wizB] ?? null) : null;
      return audible && audible > 0 ? audible : null;
    })(),
  };
  const built = buildWizardSlots(wiz);
  const vocalsBar =
    built.flatMap((s) => s.layers).find((l) => l.stem === "vocals" && l.track === wizB)
      ?.source_start_bar ?? 0;
  const bVocals = wizB ? stemsFor(wizB).includes("vocals") : false;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 space-y-2">
      <div className="flex items-center gap-1.5">
        <Wand2 size={12} className="text-amber-300" />
        <span className="flex-1 text-[11px] text-white">Mashup wizard</span>
        <span className="text-[9px] text-muted">
          step {step + 1} of {STEP_COUNT}
        </span>
      </div>

      {step === 0 && (
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
                if (probed) onBpmFollow(Math.round(probed));
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

      {step === 1 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted leading-relaxed">What should the arrangement do?</p>
          {(
            [
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
            ] as const
          ).map((goal) => (
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

      {step === 2 && (
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
                  wizSlots === n
                    ? "bg-amber-500/20 text-amber-100"
                    : "bg-white/5 hover:bg-white/10 text-white"
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
                  wizBars === n
                    ? "bg-amber-500/20 text-amber-100"
                    : "bg-white/5 hover:bg-white/10 text-white"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-muted">
            About {wizardDurationSec(wiz).toFixed(1)} s of audio, {wiz.slotCount * wiz.barsPerSlot}{" "}
            bars in total.
          </p>
        </div>
      )}

      {step === 3 && (
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
                Song B's vocals start at {(firstAudible[wizB ?? ""] ?? 0).toFixed(1)} s, so they
                enter at bar {vocalsBar} — a vocals layer at bar 0 would render digital silence and
                sound like a broken mixer.
              </span>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1 pt-1 border-t border-white/10">
        <button
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white disabled:opacity-40"
        >
          Back
        </button>
        {step < STEP_COUNT - 1 ? (
          <button
            onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))}
            className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100"
          >
            Next
          </button>
        ) : (
          <button
            onClick={() => onApply(wiz)}
            className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-100"
          >
            Use this arrangement
          </button>
        )}
        <button
          onClick={onClose}
          className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
