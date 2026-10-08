import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Film,
  Sparkles,
  Plus,
  Trash2,
  Download,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { getProject, type ISheet } from "@theatre/core";
import { Card } from "../../components/common";
import { showToast } from "../../utils/toast";

interface TrackDef {
  id: string;
  label: string;
  color: string;
  min: number;
  max: number;
  default: number;
  unit?: string;
}

interface Keyframe {
  id: string;
  trackId: string;
  time: number;
  value: number;
}

interface Preset {
  name: string;
  icon: string;
  keyframes: Array<{ trackId: string; time: number; value: number }>;
}

const TRACKS: TrackDef[] = [
  { id: "posX", label: "Position X", color: "#6366f1", min: -3, max: 3, default: 0 },
  { id: "posY", label: "Position Y", color: "#22c55e", min: -2, max: 2, default: 0.5 },
  { id: "scale", label: "Scale", color: "#f59e0b", min: 0.2, max: 3, default: 1 },
  { id: "rotation", label: "Rotation", color: "#ec4899", min: 0, max: 360, default: 0, unit: "deg" },
  { id: "opacity", label: "Opacity", color: "#06b6d4", min: 0, max: 1, default: 1 },
];

const DURATION = 4;
const FPS = 30;

const PRESETS: Preset[] = [
  {
    name: "Bounce In",
    icon: "bounce",
    keyframes: [
      { trackId: "posY", time: 0, value: -1.5 },
      { trackId: "posY", time: 0.5, value: 0 },
      { trackId: "posY", time: 0.7, value: -0.5 },
      { trackId: "posY", time: 0.9, value: 0 },
      { trackId: "scale", time: 0, value: 0.3 },
      { trackId: "scale", time: 0.5, value: 1.1 },
      { trackId: "scale", time: 0.7, value: 0.95 },
      { trackId: "scale", time: 0.9, value: 1 },
      { trackId: "opacity", time: 0, value: 0 },
      { trackId: "opacity", time: 0.3, value: 1 },
    ],
  },
  {
    name: "Spin & Scale",
    icon: "spin",
    keyframes: [
      { trackId: "rotation", time: 0, value: 0 },
      { trackId: "rotation", time: 1, value: 360 },
      { trackId: "scale", time: 0, value: 0.5 },
      { trackId: "scale", time: 0.5, value: 1.5 },
      { trackId: "scale", time: 1, value: 0.5 },
      { trackId: "scale", time: 1.5, value: 1.5 },
      { trackId: "scale", time: 2, value: 1 },
    ],
  },
  {
    name: "Slide Across",
    icon: "slide",
    keyframes: [
      { trackId: "posX", time: 0, value: -2.5 },
      { trackId: "posX", time: 1, value: 2.5 },
      { trackId: "posY", time: 0, value: 0 },
      { trackId: "posY", time: 0.5, value: -0.5 },
      { trackId: "posY", time: 1, value: 0 },
      { trackId: "opacity", time: 0, value: 0 },
      { trackId: "opacity", time: 0.2, value: 1 },
      { trackId: "opacity", time: 0.8, value: 1 },
      { trackId: "opacity", time: 1, value: 0 },
    ],
  },
  {
    name: "Pulse",
    icon: "pulse",
    keyframes: [
      { trackId: "scale", time: 0, value: 1 },
      { trackId: "scale", time: 0.25, value: 1.3 },
      { trackId: "scale", time: 0.5, value: 1 },
      { trackId: "scale", time: 0.75, value: 1.3 },
      { trackId: "scale", time: 1, value: 1 },
      { trackId: "opacity", time: 0, value: 0.7 },
      { trackId: "opacity", time: 0.25, value: 1 },
      { trackId: "opacity", time: 0.5, value: 0.7 },
      { trackId: "opacity", time: 0.75, value: 1 },
      { trackId: "opacity", time: 1, value: 0.7 },
    ],
  },
];

function interpolateValue(
  keyframes: Keyframe[],
  trackId: string,
  time: number,
  defaultValue: number,
): number {
  const trackFrames = keyframes
    .filter((k) => k.trackId === trackId)
    .sort((a, b) => a.time - b.time);

  if (trackFrames.length === 0) return defaultValue;
  if (time <= trackFrames[0].time) return trackFrames[0].value;
  if (time >= trackFrames[trackFrames.length - 1].time)
    return trackFrames[trackFrames.length - 1].value;

  for (let i = 0; i < trackFrames.length - 1; i++) {
    const a = trackFrames[i];
    const b = trackFrames[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time);
      const eased = t * t * (3 - 2 * t);
      return a.value + (b.value - a.value) * eased;
    }
  }
  return defaultValue;
}

export function AnimationStudio() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [theatreReady, setTheatreReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyframeIdRef = useRef(0);
  const sheetRef = useRef<ISheet | null>(null);
  const theatreObjRef = useRef<{ value: Record<string, number> } | null>(null);
  // Latest keyframes without re-subscribing the values listener.
  const keyframesRef = useRef<Keyframe[]>([]);
  keyframesRef.current = keyframes;
  // Mirror of currentTime for the rAF clock (avoids stale closures).
  const timeRef = useRef(0);

  const [values, setValues] = useState<Record<string, number>>(() => {
    const v: Record<string, number> = {};
    for (const track of TRACKS) {
      v[track.id] = track.default;
    }
    return v;
  });

  // Create the Theatre project/sheet/object. core 0.7.2 sheet objects
  // are NOT app-writable (measured: `value` is getter-only, no setter
  // even with studio loaded), so this object is the read side: Studio
  // edits flow in via onValuesChange, and our clock mirrors its
  // sequence position. Studio is initialized first because getProject
  // logs a console error when project state is empty.
  const initSheet = useCallback(() => {
    const project = getProject("Animation Studio");
    const sheet = project.sheet("Scene");
    sheetRef.current = sheet;
    const obj = sheet.object("Transform", {
      posX: 0,
      posY: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
    });
    theatreObjRef.current = obj as unknown as { value: Record<string, number> };
    const unsubscribe = obj.onValuesChange((vals) => {
      const v = vals as Record<string, number>;
      setValues((prev) => {
        if (
          prev.posX === v.posX &&
          prev.posY === v.posY &&
          prev.scale === v.scale &&
          prev.rotation === v.rotation &&
          prev.opacity === v.opacity
        ) {
          return prev;
        }
        return { ...prev, ...v };
      });
    });
    setTheatreReady(true);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      const studioMod = await import("@theatre/studio");
      try {
        await studioMod.default.initialize();
      } catch {
        // Already initialized - safe to ignore.
      }
      try {
        studioMod.default.ui?.hide?.();
      } catch {
        // UI hide not available (repo convention: own controls only).
      }
      if (cancelled) return;
      unsubscribe = initSheet();
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      sheetRef.current = null;
      theatreObjRef.current = null;
    };
  }, [initSheet]);

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 + values.posX * 50, h / 2 + values.posY * 50);
    ctx.rotate((values.rotation * Math.PI) / 180);
    ctx.scale(values.scale, values.scale);
    ctx.globalAlpha = values.opacity;

    const gradient = ctx.createLinearGradient(-40, -40, 40, 40);
    gradient.addColorStop(0, "#6366f1");
    gradient.addColorStop(1, "#ec4899");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(-40, -40, 80, 80, 12);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.roundRect(-30, -30, 60, 20, 6);
    ctx.fill();

    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }, [values]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  /**
   * Interpolate every track at `time` from the React keyframes.
   * core 0.7.2 exposes no public keyframe-write API (only the
   * read-only `sequence.__experimental_getKeyframes`), so keyframes
   * stay in React state and this function is the resolver.
   */
  const frameAt = useCallback((time: number): Record<string, number> => {
    const f: Record<string, number> = {};
    for (const track of TRACKS) {
      f[track.id] = interpolateValue(keyframesRef.current, track.id, time, track.default);
    }
    return f;
  }, []);

  /**
   * Push one frame at `time`: mirror the playhead into Theatre's
   * sequence (measured writable in 0.7.2; the object's `value` is
   * getter-only so React state is the write side) and update the
   * canvas + readouts on this tick.
   */
  const applyFrame = useCallback(
    (time: number) => {
      const t = Math.max(0, Math.min(DURATION, time));
      timeRef.current = t;
      const frame = frameAt(t);
      const sheet = sheetRef.current;
      if (sheet) sheet.sequence.position = t;
      setValues((prev) => {
        for (const track of TRACKS) {
          if (prev[track.id] !== frame[track.id]) return { ...prev, ...frame };
        }
        return prev;
      });
      setCurrentTime(t);
    },
    [frameAt],
  );

  // The clock: our own rAF interpolates keyframes each tick (Theatre's
  // sequence cannot play keyframes it has no write API for), pushing
  // every frame through Theatre so the engine stays the value bus.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = timeRef.current + dt;
      if (next >= DURATION) {
        applyFrame(DURATION);
        setIsPlaying(false);
        return;
      }
      applyFrame(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, applyFrame]);

  const handleReset = () => {
    setIsPlaying(false);
    applyFrame(0);
    showToast("Playback reset", "info");
  };

  const handleApplyPreset = (preset: Preset) => {
    const newKeyframes: Keyframe[] = preset.keyframes.map((kf) => ({
      id: `kf-${keyframeIdRef.current++}`,
      trackId: kf.trackId,
      time: kf.time,
      value: kf.value,
    }));
    keyframesRef.current = newKeyframes;
    setKeyframes(newKeyframes);
    // Jump to t=0 of the new preset so the preview shows its start
    // frame immediately (frameAt reads the ref updated synchronously).
    applyFrame(0);
    showToast(`Applied "${preset.name}" preset`, "success");
  };

  const handleAddKeyframe = () => {
    if (!selectedTrack) {
      showToast("Select a track first, then click + to add a keyframe", "warning");
      return;
    }
    const track = TRACKS.find((t) => t.id === selectedTrack);
    if (!track) return;
    const newKf: Keyframe = {
      id: `kf-${keyframeIdRef.current++}`,
      trackId: selectedTrack,
      time: Math.round(currentTime * FPS) / FPS,
      value: values[selectedTrack],
    };
    setKeyframes((prev) => [...prev, newKf]);
    showToast(`Keyframe added at ${newKf.time.toFixed(2)}s`, "success");
  };

  const handleDeleteKeyframe = (id: string) => {
    setKeyframes((prev) => prev.filter((k) => k.id !== id));
  };

  const handleClearKeyframes = () => {
    setKeyframes([]);
    showToast("All keyframes cleared", "info");
  };

  const handleExportJSON = () => {
    const data = {
      duration: DURATION,
      fps: FPS,
      tracks: TRACKS.map((t) => ({
        id: t.id,
        label: t.label,
        min: t.min,
        max: t.max,
        keyframes: keyframes
          .filter((k) => k.trackId === t.id)
          .sort((a, b) => a.time - b.time)
          .map((k) => ({ time: k.time, value: k.value })),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "animation-project.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Animation project exported", "success");
  };

  const handleExportFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `frame-${currentTime.toFixed(2)}s.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Frame exported as PNG", "success");
    });
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * DURATION;
    applyFrame(time);
  };

  const sortedKeyframes = useMemo(
    () => [...keyframes].sort((a, b) => a.time - b.time),
    [keyframes],
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Animation Studio</h1>
        <p className="text-muted mt-1">
          Keyframe-based animation powered by Theatre.js. Set keyframes, scrub the timeline, and export your project.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card title="Preview">
            <div className="relative bg-black/40 rounded-xl overflow-hidden aspect-video flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={640}
                height={360}
                className="max-w-full max-h-full"
              />
              {!theatreReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <p className="text-muted flex items-center gap-2">
                    <Sparkles size={16} className="animate-pulse" /> Loading Theatre.js...
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => applyFrame(0)}
                  className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                  title="Skip to start"
                >
                  <SkipBack size={14} />
                </button>
                <button
                  onClick={() => {
                      if (!isPlaying && timeRef.current >= DURATION) applyFrame(0);
                      setIsPlaying(!isPlaying);
                    }}
                  className="btn btn-primary"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button
                  onClick={() => applyFrame(DURATION)}
                  className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                  title="Skip to end"
                >
                  <SkipForward size={14} />
                </button>
                <button onClick={handleReset} className="btn btn-secondary">
                  <RotateCcw size={16} /> Reset
                </button>
                <span className="text-sm text-muted font-mono ml-auto">
                  {currentTime.toFixed(2)}s / {DURATION}s
                </span>
              </div>

              <div
                className="relative h-12 bg-gray-800 rounded-lg cursor-pointer overflow-hidden"
                onClick={handleTimelineClick}
              >
                <div className="absolute inset-0 flex items-end">
                  {TRACKS.map((track, i) => (
                    <div
                      key={track.id}
                      className="flex-1 border-r border-gray-700/50"
                      style={{ height: `${(i + 1) * 20}%` }}
                    />
                  ))}
                </div>
                {sortedKeyframes.map((kf) => {
                  const track = TRACKS.find((t) => t.id === kf.trackId);
                  return (
                    <div
                      key={kf.id}
                      className="absolute w-2.5 h-2.5 rounded-full border-2 border-white shadow-md transform -translate-x-1/2 -translate-y-1/2 cursor-pointer hover:scale-125 transition-transform"
                      style={{
                        left: `${(kf.time / DURATION) * 100}%`,
                        top: `${TRACKS.findIndex((t) => t.id === kf.trackId) * 20 + 10}%`,
                        backgroundColor: track?.color ?? "#fff",
                      }}
                      title={`${track?.label}: ${kf.value.toFixed(2)} @ ${kf.time.toFixed(2)}s`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteKeyframe(kf.id);
                      }}
                    />
                  );
                })}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none"
                  style={{ left: `${(currentTime / DURATION) * 100}%` }}
                />
              </div>
            </div>
          </Card>

          <Card
            title="Keyframes"
            headerActions={
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddKeyframe}
                  className="btn btn-primary btn-sm"
                  disabled={!selectedTrack}
                >
                  <Plus size={14} /> Add Keyframe
                </button>
                <button
                  onClick={handleClearKeyframes}
                  className="btn btn-secondary btn-sm"
                  disabled={keyframes.length === 0}
                >
                  <Trash2 size={14} /> Clear All
                </button>
              </div>
            }
          >
            {sortedKeyframes.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                No keyframes yet. Select a track, adjust the slider, then click "Add Keyframe" — or apply a preset.
              </p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-12 gap-2 text-xs text-muted font-medium px-2 py-1 border-b border-gray-700">
                  <span className="col-span-1">#</span>
                  <span className="col-span-4">Track</span>
                  <span className="col-span-3">Time</span>
                  <span className="col-span-3">Value</span>
                  <span className="col-span-1"></span>
                </div>
                {sortedKeyframes.map((kf, i) => {
                  const track = TRACKS.find((t) => t.id === kf.trackId);
                  return (
                    <div
                      key={kf.id}
                      className="grid grid-cols-12 gap-2 text-sm px-2 py-1.5 rounded hover:bg-white/5 items-center"
                    >
                      <span className="col-span-1 text-muted">{i + 1}</span>
                      <span className="col-span-4 flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: track?.color }}
                        />
                        {track?.label}
                      </span>
                      <span className="col-span-3 font-mono text-muted">
                        {kf.time.toFixed(2)}s
                      </span>
                      <span className="col-span-3 font-mono">
                        {kf.value.toFixed(2)}
                        {track?.unit ?? ""}
                      </span>
                      <span className="col-span-1">
                        <button
                          onClick={() => handleDeleteKeyframe(kf.id)}
                          className="p-1 rounded hover:bg-red-500/20 text-muted hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Presets">
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handleApplyPreset(preset)}
                  className="p-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-violet-500/30 text-left transition-all"
                >
                  <Sparkles size={14} className="text-violet-400 mb-1" />
                  <p className="text-sm font-medium text-foreground">{preset.name}</p>
                  <p className="text-[11px] text-muted">
                    {preset.keyframes.length} keyframes
                  </p>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Tracks">
            <div className="space-y-3">
              {TRACKS.map((track) => (
                <div
                  key={track.id}
                  className={`p-2 rounded-lg border transition-colors ${
                    selectedTrack === track.id
                      ? "border-violet-500/50 bg-violet-500/5"
                      : "border-transparent"
                  }`}
                >
                  <div
                    className="flex items-center justify-between mb-1 cursor-pointer"
                    onClick={() => setSelectedTrack(track.id)}
                  >
                    <label className="text-sm font-medium text-foreground flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: track.color }}
                      />
                      {track.label}
                    </label>
                    <span className="text-xs text-muted font-mono">
                      {values[track.id].toFixed(2)}
                      {track.unit ?? ""}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={track.min}
                    max={track.max}
                    step={(track.max - track.min) / 100}
                    value={values[track.id]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      // Live value: set React state directly so the canvas
                      // follows even when no keyframe sits at the playhead
                      // (previously this slider silently snapped back to the
                      // interpolated value - a dead control). Theatre's
                      // object value is getter-only in core 0.7.2, so the
                      // object is not written here.
                      setValues((prev) => ({ ...prev, [track.id]: v }));
                      // Bake into a keyframe when one sits at the playhead.
                      const existingKf = keyframes.find(
                        (k) =>
                          k.trackId === track.id &&
                          Math.abs(k.time - currentTime) < 0.05,
                      );
                      if (existingKf) {
                        setKeyframes((prev) =>
                          prev.map((k) => (k.id === existingKf.id ? { ...k, value: v } : k)),
                        );
                      }
                    }}
                    className="w-full"
                    style={{ accentColor: track.color }}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Export">
            <div className="space-y-2">
              <button onClick={handleExportJSON} className="btn btn-secondary w-full">
                <Download size={16} /> Export Project (JSON)
              </button>
              <button onClick={handleExportFrame} className="btn btn-secondary w-full">
                <Film size={16} /> Export Frame (PNG)
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
