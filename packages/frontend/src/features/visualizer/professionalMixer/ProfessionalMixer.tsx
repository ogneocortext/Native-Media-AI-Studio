/**
 * ProfessionalMixer — DAW-style mixing console for stem-based audio.
 *
 * Consumes `useProfessionalMixer` hook for audio graph + meter data.
 * Props come from Visualizer.tsx integration.
 */

import { ChannelStrip } from "./ChannelStrip";
import { BusChannel } from "./BusChannel";
import { MasterChannel } from "./MasterChannel";
import { COMPRESSOR_PRESETS } from "./types";
import { useProfessionalMixer } from "./useProfessionalMixer";
import type { BusName } from "./stemBus";

const ALL_BUSES: Exclude<BusName, "master">[] = ["vocals", "drums", "bass", "other"];

export function ProfessionalMixer({
  audioFilename,
  sharedAudioContext,
  stems,
  compact = false,
  collapsedBuses = false,
  onClose,
}: {
  audioFilename?: string | null;
  sharedAudioContext?: AudioContext | null;
  stems: Record<string, string> | null;
  compact?: boolean;
  collapsedBuses?: boolean;
  onClose?: () => void;
}) {
  const mixer = useProfessionalMixer({
    audioFilename: audioFilename ?? undefined,
    sharedAudioContext: sharedAudioContext ?? undefined,
    stems: stems
      ? (Object.fromEntries(
          Object.entries(stems).filter(([, v]) => v),
        ) as Record<string, string>)
      : null,
  });

  const {
    strips,
    buses,
    master,
    routing,
    meters,
    soloCount,
    setStripVolume,
    setStripPan,
    toggleStripMute,
    toggleStripSolo,
    setStripCompressor,
    setStripSend,
    setRouting,
    setBusVolume,
    setBusPan,
    toggleBusMute,
    toggleBusSolo,
    setMasterVolume,
  } = mixer;

  const stemEntries = Object.entries(stems || {}).filter(([, v]) => v);

  return (
    <div className="w-full h-full bg-neutral-950 rounded-2xl border border-white/10 p-3 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-white/90 tracking-wide uppercase">Pro Mixer</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[10px] px-2 py-1 rounded bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors"
          >
            Close
          </button>
        )}
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-2 h-full min-w-max">
          {stemEntries.map(([name]) => (
            <ChannelStrip
              key={name}
              name={name as any}
              state={(strips as Record<string, any>)[name] || { volume: 1, pan: 0, muted: false, solo: false, eqBands: [], compressorThreshold: -24, compressorRatio: 4, compressorAttack: 10, compressorRelease: 120, reverbSend: 0, delaySend: 0 }}
              meters={meters[name] || { rms: 0, peak: 0, dBFS: -60 }}
              soloCount={soloCount}
              routing={routing}
              onVolume={(v) => setStripVolume(name as any, v)}
              onPan={(p) => setStripPan(name as any, p)}
              onMute={() => toggleStripMute(name as any)}
              onSolo={() => toggleStripSolo(name as any)}
              onCompressorPreset={(preset) => {
                const params = COMPRESSOR_PRESETS[preset];
                if (params) setStripCompressor(name as any, { threshold: params.threshold, ratio: params.ratio, attack: params.attack, release: params.release });
              }}
              onSend={(send, v) => setStripSend(name as any, send, v)}
              onRouting={(bus) => setRouting(name as any, bus)}
              compact={compact}
            />
          ))}

          {ALL_BUSES.map((bus) => (
            <BusChannel
              key={bus}
              name={bus}
              state={buses[bus]}
              meter={meters[`${bus}_0`] || { rms: 0, peak: 0, dBFS: -60 }}
              soloCount={soloCount}
              accent="#a855f7"
              onVolume={(v) => setBusVolume(bus, v)}
              onPan={(p) => setBusPan(bus, p)}
              onMute={() => toggleBusMute(bus)}
              onSolo={() => toggleBusSolo(bus)}
              onCompressorPreset={() => {}}
              collapsed={collapsedBuses}
              onToggleCollapse={() => {}}
            />
          ))}

          <MasterChannel
            volume={master.volume}
            meter={meters.master || { rms: 0, peak: 0, dBFS: -60 }}
            onVolume={(v) => setMasterVolume(v)}
            compressorThreshold={master.compressorThreshold}
            compressorRatio={master.compressorRatio}
          />
        </div>
      </div>
    </div>
  );
}
