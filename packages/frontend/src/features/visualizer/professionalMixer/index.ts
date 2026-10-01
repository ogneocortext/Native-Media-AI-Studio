/**
 * Professional mixing system barrel export.
 *
 * Consumes the existing stem system (StemMixer, audioEQ, stemSpatial) and
 * layers a DAW-style mixing console on top:
 *   - Per-stem channel strips (fader, pan, mute/solo, EQ, compressor, sends)
 *   - Per-bus submix channels
 *   - Master output channel
 *   - Live VU meters per channel
 *   - Stem routing presets
 */

export { useProfessionalMixer, linearToDb, dbToLinear } from "./useProfessionalMixer";
export type {
  MixerSnapshot,
  DEFAULT_MIXER_SNAPSHOT,
  DEFAULT_MASTER_STATE,
  DEFAULT_STRIP_STATE,
  ChannelStripState,
  BusChannelState,
  MasterSectionState,
  StemRouting,
  DEFAULT_STEM_ROUTING,
  BusName,
  StemName,
  STEM_NAMES,
  ChannelMeters,
  CompressorPreset,
  COMPRESSOR_PRESETS,
  FxReturns,
  ProfessionalMixerState,
  ProfessionalMixerActions,
  ProfessionalMixerReturn,
} from "./types";

export { ChannelStrip } from "./ChannelStrip";
export { BusChannel } from "./BusChannel";
export { MasterChannel } from "./MasterChannel";
export { ProfessionalMixer } from "./ProfessionalMixer";
export {
  ROUTING_PRESETS,
  ROUTABLE_STEMS,
  BUS_LABELS,
  BUS_COLORS,
  ALL_BUSES,
  describeRouting,
  isDefaultRouting,
} from "./stemBus";
export { createCompressor, type CompressorState } from "./stemCompressor";
