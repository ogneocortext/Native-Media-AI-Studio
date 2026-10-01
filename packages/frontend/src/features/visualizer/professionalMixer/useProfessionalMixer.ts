/**
 * `useProfessionalMixer` — the professional mixing engine.
 *
 * Owns the entire Web Audio graph:
 *   stem source → channel strip → bus → master → destination
 *   with per-channel EQ, compression, pan, fader, FX sends,
 *   per-bus processing, master processing, and live meters.
 *
 * The hook does NOT render UI — it exposes state + actions.
 * The UI layer (`ProfessionalMixer.tsx`) renders the console.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createEQ, type EQBand, type EQInstance } from "../audioEQ";
import { createCompressor, type CompressorState } from "./stemCompressor";
import type {
  BusChannelState,
  BusName,
  ChannelStripState,
  MasterSectionState,
  MixerSnapshot,
  ProfessionalMixerActions,
  ProfessionalMixerReturn,
  ProfessionalMixerState,
  StemName,
} from "./types";
import { STEM_NAMES } from "./types";
import { DEFAULT_MIXER_SNAPSHOT, DEFAULT_STRIP_STATE } from "./types";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

/** Linear volume 0–1 → roughly musical dB scale for display. */
export function linearToDb(v: number): number {
  if (v <= 0) return -Infinity;
  return 20 * Math.log10(v);
}

/** dB → linear 0–1 (clamped). */
export function dbToLinear(db: number): number {
  return clamp(Math.pow(10, db / 20), 0, 1);
}

const MASTER_COMPRESSOR_DEFAULT = { threshold: -6, ratio: 2, attack: 5, release: 120 } as const;

interface InternalBus {
  name: BusName;
  input: GainNode;
  eqInput: GainNode;
  eq: EQInstance;
  eqOutput: GainNode;
  compressorReturn: { input: GainNode; output: GainNode; node: DynamicsCompressorNode; setState: (p: Partial<CompressorState>) => void; getState: () => CompressorState; dispose: () => void };
  fader: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
  meterBuf: Uint8Array;
  state: BusChannelState;
}

interface InternalStem {
  name: StemName;
  source: MediaElementAudioSourceNode | null;
  input: GainNode;
  eq: EQInstance;
  eqOutput: GainNode;
  compressorReturn: { input: GainNode; output: GainNode; node: DynamicsCompressorNode; setState: (p: Partial<CompressorState>) => void; getState: () => CompressorState; dispose: () => void };
  fader: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
  meterBuf: Uint8Array;
  reverbSend: GainNode;
  delaySend: GainNode;
  element: HTMLAudioElement;
  state: ChannelStripState;
}

export function useProfessionalMixer({
  sharedAudioContext,
  stems,
}: {
  audioFilename?: string | null;
  sharedAudioContext?: AudioContext | null;
  stems: Record<string, string> | null;
}): ProfessionalMixerReturn {
  const [snapshot, setSnapshot] = useState<MixerSnapshot>({ ...DEFAULT_MIXER_SNAPSHOT });
  const [meters, setMeters] = useState<ProfessionalMixerState["meters"]>(() => ({
    vocals: { rms: 0, peak: 0, dBFS: -60 },
    drums: { rms: 0, peak: 0, dBFS: -60 },
    bass: { rms: 0, peak: 0, dBFS: -60 },
    other: { rms: 0, peak: 0, dBFS: -60 },
    "vocals_0": { rms: 0, peak: 0, dBFS: -60 },
    "drums_0": { rms: 0, peak: 0, dBFS: -60 },
    "bass_0": { rms: 0, peak: 0, dBFS: -60 },
    "other_0": { rms: 0, peak: 0, dBFS: -60 },
    master: { rms: 0, peak: 0, dBFS: -60 },
  }));

  const ctxRef = useRef<AudioContext | null>(null);
  const stemsRefVersion = useRef(0);

  // Internal audio-graph refs
  const internalStemsRef = useRef<Map<StemName, InternalStem>>(new Map());
  const internalBusesRef = useRef<Map<BusName, InternalBus>>(new Map());
  const masterRef = useRef<{
    input: GainNode;
    eq: EQInstance;
    eqOutput: GainNode;
    compressor: { input: GainNode; output: GainNode; node: DynamicsCompressorNode; setState: (p: Partial<CompressorState>) => void; getState: () => CompressorState; dispose: () => void };
    fader: GainNode;
    pan: StereoPannerNode;
    analyser: AnalyserNode;
    meterBuf: Uint8Array;
    reverbReturn: GainNode;
    delayReturn: GainNode;
    state: MasterSectionState;
  } | null>(null);

  const rafRef = useRef<number>(0);
  const soloCountRef = useRef(0);

  // Persist snapshot to localStorage so mixes survive reloads.
  useEffect(() => {
    try {
      localStorage.setItem("professionalMixer:snapshot", JSON.stringify(snapshot));
    } catch { /* ignore */ }
  }, [snapshot]);

  // Load persisted snapshot on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("professionalMixer:snapshot");
      if (raw) {
        const parsed = JSON.parse(raw) as MixerSnapshot;
        if (parsed && parsed.strips && parsed.buses && parsed.master) {
          setSnapshot(parsed);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const getOrCreateCtx = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = sharedAudioContext ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
    }
    return ctxRef.current;
  }, [sharedAudioContext]);

  // ─── Master section ────────────────────────────────────────────────────────
  const buildMaster = useCallback((ctx: AudioContext) => {
    const input = ctx.createGain();
    const eq = createEQ(ctx, []);
    const eqOutput = ctx.createGain();
    eq.input.connect(eqOutput);
    eqOutput.connect(input); // EQ is parallel-bridged via output→input (pre-fader)

    const compressor = createCompressor(ctx, MASTER_COMPRESSOR_DEFAULT);
    compressor.input.connect(compressor.output);

    const fader = ctx.createGain();
    fader.gain.value = snapshot.master.volume;

    const pan = ctx.createStereoPanner();
    pan.pan.value = 0;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    const meterBuf = new Uint8Array(analyser.frequencyBinCount);

    // FX returns
    const convolver = ctx.createConvolver();
    convolver.buffer = generateImpulseResponse(ctx, 1.8, 0.4);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.15;
    convolver.connect(reverbReturn);
    reverbReturn.connect(input);

    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.025;
    const delayGain = ctx.createGain();
    delayGain.gain.value = 0.12;
    delay.connect(delayGain);
    delayGain.connect(input);

    // Graph: bus outputs → input → [reverbReturn / delayReturn / eqOutput] → compressor → fader → pan → analyser → destination
    // eqOutput already feeds input above
    input.connect(compressor.input);
    compressor.output.connect(fader);
    fader.connect(pan);
    pan.connect(analyser);
    pan.connect(ctx.destination);

    const master = {
      input,
      eq,
      eqOutput,
      compressor,
      fader,
      pan,
      analyser,
      meterBuf,
      reverbReturn,
      delayReturn: delayGain,
      state: { ...snapshot.master },
    };

    // Apply stored state
    master.fader.gain.value = master.state.volume;
    if (master.state.eqBands.length) master.eq.setBands(master.state.eqBands);
    master.compressor.setState({
      threshold: master.state.compressorThreshold,
      ratio: master.state.compressorRatio,
      attack: master.state.compressorAttack,
      release: master.state.compressorRelease,
    });

    return master;
  }, [snapshot.master]);

  // ─── Bus section ───────────────────────────────────────────────────────────
  const buildBus = useCallback((ctx: AudioContext, name: BusName): InternalBus => {
    const state = snapshot.buses[name] ?? DEFAULT_MIXER_SNAPSHOT.buses[name];

    const input = ctx.createGain();
    const eq = createEQ(ctx, state.eqBands);
    const eqOutput = ctx.createGain();
    eq.input.connect(eqOutput);

    const compressor = createCompressor(ctx, {
      threshold: state.compressorThreshold,
      ratio: state.compressorRatio,
      attack: state.compressorAttack,
      release: state.compressorRelease,
    });
    compressor.input.connect(compressor.output);

    const fader = ctx.createGain();
    fader.gain.value = state.volume;

    const pan = ctx.createStereoPanner();
    pan.pan.value = state.pan;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    const meterBuf = new Uint8Array(analyser.frequencyBinCount);

    // Graph: stems route here → input → eq → compressor → fader → pan → analyser → master input
    eqOutput.connect(compressor.input);
    compressor.output.connect(fader);
    fader.connect(pan);
    pan.connect(analyser);

    return {
      name,
      input,
      eqInput: eq.input,
      eq,
      eqOutput,
      compressorReturn: compressor,
      fader,
      pan,
      analyser,
      meterBuf,
      state,
    };
  }, [snapshot.buses]);

  // ─── Stem channel strip ────────────────────────────────────────────────────
  const buildStemChannel = useCallback((
    ctx: AudioContext,
    name: StemName,
    url: string,
  ): InternalStem => {
    const state = (snapshot.strips as Record<string, ChannelStripState>)[name] ?? DEFAULT_STRIP_STATE;

    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.src = url;
    el.preload = "auto";

    let source: MediaElementAudioSourceNode;
    try {
      source = ctx.createMediaElementSource(el);
    } catch {
      // Already connected — dispose old one first
      const existing = internalStemsRef.current.get(name);
      if (existing?.source) {
        try { existing.source.disconnect(); } catch { /* ignore */ }
      }
      source = ctx.createMediaElementSource(el);
    }

    const input = ctx.createGain();
    input.gain.value = state.muted ? 0 : 1;

    const eq = createEQ(ctx, state.eqBands);
    const eqOutput = ctx.createGain();

    const compressor = createCompressor(ctx, {
      threshold: state.compressorThreshold,
      ratio: state.compressorRatio,
      attack: state.compressorAttack,
      release: state.compressorRelease,
    });
    compressor.input.connect(compressor.output);

    const fader = ctx.createGain();
    fader.gain.value = state.volume;

    const pan = ctx.createStereoPanner();
    pan.pan.value = state.pan;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    const meterBuf = new Uint8Array(analyser.frequencyBinCount);

    // FX sends
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = state.reverbSend;
    const delaySend = ctx.createGain();
    delaySend.gain.value = state.delaySend;

    // Graph: source → input → eq → compressor → fader → pan → analyser
    //                   └→ reverbSend └→ delaySend (both → FX returns in bus/master)
    source.connect(input);
    input.connect(eq.input);
    eq.output.connect(eqOutput);
    eqOutput.connect(compressor.input);
    compressor.output.connect(fader);
    fader.connect(pan);
    pan.connect(analyser);

    return {
      name,
      source,
      input,
      eq,
      eqOutput,
      compressorReturn: compressor,
      fader,
      pan,
      analyser,
      meterBuf,
      reverbSend,
      delaySend,
      element: el,
      state,
    };
  }, [snapshot.strips]);

  // ─── Rebuild entire graph when stems change ────────────────────────────────
  const rebuild = useCallback(() => {
    const ctx = getOrCreateCtx();
    if (ctx.state === "closed") {
      ctxRef.current = null;
      return;
    }

    // Dispose old
    internalStemsRef.current.forEach((s) => {
      try { s.element.pause(); } catch { /* ignore */ }
      try { s.source?.disconnect(); } catch { /* ignore */ }
      try { s.input.disconnect(); } catch { /* ignore */ }
      try { s.eq.dispose(); } catch { /* ignore */ }
      try { s.compressorReturn.dispose(); } catch { /* ignore */ }
      try { s.fader.disconnect(); } catch { /* ignore */ }
      try { s.pan.disconnect(); } catch { /* ignore */ }
      try { s.analyser.disconnect(); } catch { /* ignore */ }
      try { s.reverbSend.disconnect(); } catch { /* ignore */ }
      try { s.delaySend.disconnect(); } catch { /* ignore */ }
    });
    internalStemsRef.current.clear();

    internalBusesRef.current.forEach((b) => {
      try { b.input.disconnect(); } catch { /* ignore */ }
      try { b.eq.dispose(); } catch { /* ignore */ }
      try { b.compressorReturn.dispose(); } catch { /* ignore */ }
      try { b.fader.disconnect(); } catch { /* ignore */ }
      try { b.pan.disconnect(); } catch { /* ignore */ }
      try { b.analyser.disconnect(); } catch { /* ignore */ }
    });
    internalBusesRef.current.clear();

    if (masterRef.current) {
      try { masterRef.current.input.disconnect(); } catch { /* ignore */ }
      try { masterRef.current.eq.dispose(); } catch { /* ignore */ }
      try { masterRef.current.compressor.dispose(); } catch { /* ignore */ }
      try { masterRef.current.fader.disconnect(); } catch { /* ignore */ }
      try { masterRef.current.pan.disconnect(); } catch { /* ignore */ }
      try { masterRef.current.analyser.disconnect(); } catch { /* ignore */ }
      try { masterRef.current.reverbReturn.disconnect(); } catch { /* ignore */ }
    }
    masterRef.current = null;

    if (!stems) return;

    // Build buses (except master — handled separately)
    const buses = new Map<BusName, InternalBus>();
    for (const name of ["vocals", "drums", "bass", "other"] as BusName[]) {
      buses.set(name, buildBus(ctx, name));
    }
    internalBusesRef.current = buses;

    // Build master (connects to destination)
    const master = buildMaster(ctx);
    masterRef.current = master;

    // Wire bus outputs → master input
    internalBusesRef.current.forEach((bus) => {
      bus.analyser.connect(master.input);
    });

    // Build stem channels and connect to buses
    const stemMap = new Map<StemName, InternalStem>();
    for (const name of STEM_NAMES) {
      const url = stems[name];
      if (!url) continue;
      const channel = buildStemChannel(ctx, name, url);
      stemMap.set(name, channel);

      // Connect FX sends to master returns
      channel.reverbSend.connect(master.reverbReturn);
      channel.delaySend.connect(master.delayReturn);

      // Connect channel output → target bus
      const targetBusName = snapshot.stemRouting[name] ?? name;
      const targetBus = internalBusesRef.current.get(targetBusName);
      if (targetBus) {
        channel.analyser.connect(targetBus.input);
      }
    }
    internalStemsRef.current = stemMap;

    // Resume context if suspended
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }, [getOrCreateCtx, stems, snapshot.stemRouting, buildBus, buildMaster, buildStemChannel]);

  // ─── Solo logic ────────────────────────────────────────────────────────────
  const computeSoloCount = useCallback(() => {
    let count = 0;
    for (const name of STEM_NAMES) {
      if ((snapshot.strips as Record<string, ChannelStripState>)[name].solo) count++;
    }
    for (const name of ["vocals", "drums", "bass", "other"] as BusName[]) {
      if (snapshot.buses[name].solo) count++;
    }
    return count;
  }, [snapshot.strips, snapshot.buses]);

  const isChannelAudible = useCallback((isMuted: boolean, isSolo: boolean): boolean => {
    const soloCount = computeSoloCount();
    if (soloCount > 0) return isSolo; // only soloed channels pass
    return !isMuted;
  }, [computeSoloCount]);

  // ─── Actions ──────────────────────────────────────────────────────────────
  const setStripVolume = useCallback((name: StemName, v: number) => {
    setSnapshot((prev) => {
      const next = {
        ...prev,
        strips: { ...prev.strips, [name]: { ...prev.strips[name], volume: clamp(v, 0, 1) } },
      };
      const ch = internalStemsRef.current.get(name);
      if (ch?.fader) ch.fader.gain.setTargetAtTime(clamp(v, 0.001, 1), ctxRef.current!.currentTime, 0.02);
      return next;
    });
  }, []);

  const setStripPan = useCallback((name: StemName, p: number) => {
    setSnapshot((prev) => {
      const next = {
        ...prev,
        strips: { ...prev.strips, [name]: { ...prev.strips[name], pan: clamp(p, -1, 1) } },
      };
      const ch = internalStemsRef.current.get(name);
      if (ch?.pan) ch.pan.pan.setTargetAtTime(clamp(p, -1, 1), ctxRef.current!.currentTime, 0.02);
      return next;
    });
  }, []);

  const toggleStripMute = useCallback((name: StemName) => {
    setSnapshot((prev) => {
      const nextMuted = !prev.strips[name].muted;
      const next = {
        ...prev,
        strips: { ...prev.strips, [name]: { ...prev.strips[name], muted: nextMuted } },
      };
      const ch = internalStemsRef.current.get(name);
      if (ch?.input) {
        const target = nextMuted ? 0 : ch.state.volume;
        ch.input.gain.setTargetAtTime(target, ctxRef.current!.currentTime, 0.02);
      }
      return next;
    });
  }, []);

  const toggleStripSolo = useCallback((name: StemName) => {
    setSnapshot((prev) => {
      const nextSolo = !prev.strips[name].solo;
      const next = {
        ...prev,
        strips: { ...prev.strips, [name]: { ...prev.strips[name], solo: nextSolo } },
      };
      return next;
    });
  }, []);

  const setStripEQ = useCallback((name: StemName, bands: EQBand[]) => {
    setSnapshot((prev) => {
      const next = {
        ...prev,
        strips: { ...prev.strips, [name]: { ...prev.strips[name], eqBands: bands.map((b) => ({ ...b })) } },
      };
      const ch = internalStemsRef.current.get(name);
      ch?.eq.setBands(bands);
      return next;
    });
  }, []);

  const setStripCompressor = useCallback((name: StemName, params: Partial<CompressorState>) => {
    setSnapshot((prev) => {
      const cur = prev.strips[name];
      const next = {
        ...cur,
        compressorThreshold: params.threshold ?? cur.compressorThreshold,
        compressorRatio: params.ratio ?? cur.compressorRatio,
        compressorAttack: params.attack ?? cur.compressorAttack,
        compressorRelease: params.release ?? cur.compressorRelease,
      };
      const updated = { ...prev, strips: { ...prev.strips, [name]: next } };
      const ch = internalStemsRef.current.get(name);
      ch?.compressorReturn.setState(params);
      return updated;
    });
  }, []);

  const setStripSend = useCallback((name: StemName, send: "reverbSend" | "delaySend", v: number) => {
    setSnapshot((prev) => {
      const next = {
        ...prev,
        strips: { ...prev.strips, [name]: { ...prev.strips[name], [send]: clamp(v, 0, 1) } },
      };
      const ch = internalStemsRef.current.get(name);
      if (ch) {
        const gainNode = send === "reverbSend" ? ch.reverbSend : ch.delaySend;
        gainNode.gain.setTargetAtTime(clamp(v, 0, 1), ctxRef.current!.currentTime, 0.02);
      }
      return next;
    });
  }, []);

  const setRouting = useCallback((stem: StemName, bus: BusName) => {
    setSnapshot((prev) => {
      const next = { ...prev, stemRouting: { ...prev.stemRouting, [stem]: bus } };
      // Rewire stem → new bus
      const ch = internalStemsRef.current.get(stem);
      const targetBus = internalBusesRef.current.get(bus);
      if (ch?.analyser && targetBus?.input) {
        try { ch.analyser.disconnect(); } catch { /* ignore */ }
        ch.analyser.connect(targetBus.input);
      }
      return next;
    });
  }, []);

  // Bus actions
  const setBusVolume = useCallback((name: BusName, v: number) => {
    setSnapshot((prev) => {
      const next = { ...prev, buses: { ...prev.buses, [name]: { ...prev.buses[name], volume: clamp(v, 0, 1) } } };
      const bus = internalBusesRef.current.get(name);
      if (bus?.fader) bus.fader.gain.setTargetAtTime(clamp(v, 0.001, 1), ctxRef.current!.currentTime, 0.02);
      return next;
    });
  }, []);

  const setBusPan = useCallback((name: BusName, p: number) => {
    setSnapshot((prev) => {
      const next = { ...prev, buses: { ...prev.buses, [name]: { ...prev.buses[name], pan: clamp(p, -1, 1) } } };
      const bus = internalBusesRef.current.get(name);
      if (bus?.pan) bus.pan.pan.setTargetAtTime(clamp(p, -1, 1), ctxRef.current!.currentTime, 0.02);
      return next;
    });
  }, []);

  const toggleBusMute = useCallback((name: BusName) => {
    setSnapshot((prev) => {
      const nextMuted = !prev.buses[name].muted;
      const next = { ...prev, buses: { ...prev.buses, [name]: { ...prev.buses[name], muted: nextMuted } } };
      const bus = internalBusesRef.current.get(name);
      if (bus?.fader) {
        bus.fader.gain.setTargetAtTime(nextMuted ? 0 : bus.state.volume, ctxRef.current!.currentTime, 0.02);
      }
      return next;
    });
  }, []);

  const toggleBusSolo = useCallback((name: BusName) => {
    setSnapshot((prev) => {
      const nextSolo = !prev.buses[name].solo;
      const next = { ...prev, buses: { ...prev.buses, [name]: { ...prev.buses[name], solo: nextSolo } } };
      return next;
    });
  }, []);

  const setBusEQ = useCallback((name: BusName, bands: EQBand[]) => {
    setSnapshot((prev) => {
      const next = { ...prev, buses: { ...prev.buses, [name]: { ...prev.buses[name], eqBands: bands.map((b) => ({ ...b })) } } };
      const bus = internalBusesRef.current.get(name);
      bus?.eq.setBands(bands);
      return next;
    });
  }, []);

  const setBusCompressor = useCallback((name: BusName, params: Partial<CompressorState>) => {
    setSnapshot((prev) => {
      const cur = prev.buses[name];
      const next = {
        ...cur,
        compressorThreshold: params.threshold ?? cur.compressorThreshold,
        compressorRatio: params.ratio ?? cur.compressorRatio,
        compressorAttack: params.attack ?? cur.compressorAttack,
        compressorRelease: params.release ?? cur.compressorRelease,
      };
      const updated = { ...prev, buses: { ...prev.buses, [name]: next } };
      const bus = internalBusesRef.current.get(name);
      bus?.compressorReturn.setState(params);
      return updated;
    });
  }, []);

  // Master actions
  const setMasterVolume = useCallback((v: number) => {
    setSnapshot((prev) => {
      const next = { ...prev, master: { ...prev.master, volume: clamp(v, 0, 1) } };
      if (masterRef.current?.fader) {
        masterRef.current.fader.gain.setTargetAtTime(clamp(v, 0.001, 1), ctxRef.current!.currentTime, 0.02);
      }
      return next;
    });
  }, []);

  const setMasterEQ = useCallback((bands: EQBand[]) => {
    setSnapshot((prev) => ({ ...prev, master: { ...prev.master, eqBands: bands.map((b) => ({ ...b })) } }));
    masterRef.current?.eq.setBands(bands);
  }, []);

  const setMasterCompressor = useCallback((params: Partial<CompressorState>) => {
    setSnapshot((prev: MixerSnapshot) => {
      const cur = prev.master;
      const next = {
        ...cur,
        compressorThreshold: params.threshold ?? cur.compressorThreshold,
        compressorRatio: params.ratio ?? cur.compressorRatio,
        compressorAttack: params.attack ?? cur.compressorAttack,
        compressorRelease: params.release ?? cur.compressorRelease,
      };
      const updated: MixerSnapshot = { ...prev, master: next };
      masterRef.current?.compressor.setState(params);
      return updated;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setSnapshot({ ...DEFAULT_MIXER_SNAPSHOT });
    // Rebuild with defaults applied
    setTimeout(() => rebuild(), 0);
  }, [rebuild]);

  // ─── Meter loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const ctx = ctxRef.current;
      if (!ctx || ctx.state === "closed") {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const newMeters: any = {};
      const now = ctx.currentTime;

      // Solo count
      const soloCount = computeSoloCount();
      soloCountRef.current = soloCount;

      // Stem meters
      internalStemsRef.current.forEach((ch, name) => {
        const state = (snapshot.strips as Record<string, ChannelStripState>)[name];
        const audible = isChannelAudible(state.muted, state.solo);
        ch.analyser.getByteTimeDomainData(ch.meterBuf as any);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < ch.meterBuf.length; i++) {
          const v = (ch.meterBuf[i] - 128) / 128;
          sum += v * v;
          const abs = Math.abs(v);
          if (abs > peak) peak = abs;
        }
        const rms = Math.sqrt(sum / ch.meterBuf.length);
        const effectiveRms = audible ? rms : 0;
        const effectivePeak = audible ? peak : 0;
        newMeters[name] = {
          rms: effectiveRms,
          peak: effectivePeak,
          dBFS: effectiveRms > 0 ? 20 * Math.log10(effectiveRms) : -60,
        };

        // Apply mute/solo to channel input
        const targetGain = audible ? 1 : 0;
        ch.input.gain.setTargetAtTime(targetGain, now, 0.02);
      });

      // Bus meters
      internalBusesRef.current.forEach((bus) => {
        bus.analyser.getByteTimeDomainData(bus.meterBuf as any);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < bus.meterBuf.length; i++) {
          const v = (bus.meterBuf[i] - 128) / 128;
          sum += v * v;
          const abs = Math.abs(v);
          if (abs > peak) peak = abs;
        }
        const rms = Math.sqrt(sum / bus.meterBuf.length);
        newMeters[`${bus.name}_0`] = {
          rms,
          peak,
          dBFS: rms > 0 ? 20 * Math.log10(rms) : -60,
        };
      });

      // Master meter
      if (masterRef.current) {
        const m = masterRef.current;
        m.analyser.getByteTimeDomainData(m.meterBuf as any);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < m.meterBuf.length; i++) {
          const v = (m.meterBuf[i] - 128) / 128;
          sum += v * v;
          const abs = Math.abs(v);
          if (abs > peak) peak = abs;
        }
        const rms = Math.sqrt(sum / m.meterBuf.length);
        newMeters.master = {
          rms,
          peak,
          dBFS: rms > 0 ? 20 * Math.log10(rms) : -60,
        };
      }

      setMeters((prev) => {
        const merged = { ...prev, ...newMeters };
        return merged;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [snapshot.strips, snapshot.buses, computeSoloCount, isChannelAudible]);

  // ─── Rebuild on stems change ───────────────────────────────────────────────
  const prevStemsVersion = useRef(0);
  useEffect(() => {
    if (!stems) return;
    const version = ++stemsRefVersion.current;
    prevStemsVersion.current = version;
    // Small delay so the previous graph fully tears down
    const timer = setTimeout(() => {
      if (prevStemsVersion.current === version) {
        rebuild();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [stems, rebuild]);

  // ─── Return ───────────────────────────────────────────────────────────────
  const state: ProfessionalMixerState = {
    strips: snapshot.strips,
    buses: snapshot.buses,
    master: snapshot.master,
    routing: snapshot.stemRouting,
    meters,
    soloCount: soloCountRef.current,
  };

  const actions: ProfessionalMixerActions = {
    setStripVolume,
    setStripPan,
    toggleStripMute,
    toggleStripSolo,
    setStripEQ,
    setStripCompressor,
    setStripSend,
    setRouting,
    setBusVolume,
    setBusPan,
    toggleBusMute,
    toggleBusSolo,
    setBusEQ,
    setBusCompressor,
    setMasterVolume,
    setMasterEQ,
    setMasterCompressor,
    resetToDefaults,
    rebuild,
  };

  return { ...state, ...actions };
}

// ─── IR generator (used by master for reverb return) ────────────────────────

function generateImpulseResponse(
  ctx: AudioContext,
  duration: number,
  decay: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * duration);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const channelDecay = decay * (channel === 0 ? 1.0 : 0.92);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, channelDecay * 10);
    }
  }
  return buffer;
}
