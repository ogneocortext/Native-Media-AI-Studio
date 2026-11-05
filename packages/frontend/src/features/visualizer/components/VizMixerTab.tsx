/**
 * VizMixerTab — inspector "Mixer" tab content: simple/pro mixer toggle,
 * the active mixer, and the link card into the dedicated Remix Studio page.
 *
 * Extracted from Visualizer.tsx (T-VIZ-33).
 */
import type { MutableRefObject } from "react";
import { Wand2 } from "lucide-react";
import { ProfessionalMixer } from "../professionalMixer/ProfessionalMixer";
import { StemMixerPanel, type StemName } from "./StemMixer";
import type { EQBand } from "../audioEQ";

interface VizMixerTabProps {
  useProMixer: boolean;
  onToggleProMixer: () => void;
  proMixerStems: Record<StemName, string> | null;
  currentFilename: string | null;
  audioCtx: AudioContext | null;
  onMixerStateChange: (state: {
    muted: Record<StemName, boolean>;
    volumes: Record<StemName, number>;
    eqBands: Record<StemName, EQBand[]>;
  }) => void;
  audioElRef: MutableRefObject<HTMLAudioElement | null>;
  mainGainRef: MutableRefObject<GainNode | null>;
  onOpenRemixStudio: () => void;
}

export function VizMixerTab({
  useProMixer,
  onToggleProMixer,
  proMixerStems,
  currentFilename,
  audioCtx,
  onMixerStateChange,
  audioElRef,
  mainGainRef,
  onOpenRemixStudio,
}: VizMixerTabProps) {
  return (
    <div className="viz-inspector-mixer">
      <button
        onClick={onToggleProMixer}
        className={`viz-inspector-mixer-toggle ${useProMixer ? "active" : ""}`}
        aria-pressed={useProMixer}
      >
        {useProMixer ? "Professional Mixer" : "Simple Mixer"}
      </button>
      {useProMixer && proMixerStems ? (
        <ProfessionalMixer
          audioFilename={currentFilename}
          sharedAudioContext={audioCtx}
          stems={proMixerStems}
          compact
          collapsedBuses
        />
      ) : (
        <StemMixerPanel
          audioFilename={currentFilename}
          compact
          onStateChange={onMixerStateChange}
          sharedAudioContext={audioCtx}
          mainAudioRef={audioElRef}
          mainGainRef={mainGainRef}
        />
      )}
      <button
        className="viz-inspector-linkcard"
        onClick={onOpenRemixStudio}
        title="Build a mashup from stems of different songs"
      >
        <Wand2 size={13} />
        <span>
          Build a mashup
          <small>Remix Studio — stems from different songs</small>
        </span>
      </button>
    </div>
  );
}
