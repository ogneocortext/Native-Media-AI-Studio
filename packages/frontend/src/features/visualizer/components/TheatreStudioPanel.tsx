import { useEffect, useRef, useState, useCallback } from "react";
import { getProject, types } from "@theatre/core";
import studio from "@theatre/studio";
import { kineticPresets } from "./KineticPresets";

interface Props {
  visible: boolean;
  onClose: () => void;
  activePresetId: string;
  onPresetChange: (id: string) => void;
}

interface AnimationTrack {
  label: string;
  prop: string;
  min: number;
  max: number;
  step: number;
}

const TRACKS: AnimationTrack[] = [
  { label: "Translate X", prop: "translateX", min: -200, max: 200, step: 1 },
  { label: "Translate Y", prop: "translateY", min: -200, max: 200, step: 1 },
  { label: "Opacity", prop: "opacity", min: 0, max: 1, step: 0.01 },
  { label: "Scale", prop: "scale", min: 0, max: 3, step: 0.01 },
  { label: "Rotation", prop: "rotateZ", min: -180, max: 180, step: 1 },
  { label: "Skew X", prop: "skewX", min: -45, max: 45, step: 1 },
  { label: "Letter Spacing", prop: "letterSpacing", min: -10, max: 50, step: 1 },
  { label: "Blur", prop: "blur", min: 0, max: 20, step: 0.5 },
];

type AnimationPhase = "enter" | "beat" | "exit";

export function TheatreStudioPanel({ visible, onClose, activePresetId, onPresetChange }: Props) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<AnimationPhase>("enter");
  const [duration, setDuration] = useState(600);
  const [playingPhase, setPlayingPhase] = useState(false);
  const [studioReady, setStudioReady] = useState(false);
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    TRACKS.forEach(t => { init[t.prop] = 0; });
    return init;
  });
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const projectRef = useRef<ReturnType<typeof getProject> | null>(null);

  // Initialize Theatre.js studio once
  useEffect(() => {
    if (!visible) {
      setStudioReady(false);
      return;
    }
    let cancelled = false;
    const init = async () => {
      try {
        await studio.initialize();
      } catch {
        // Studio already initialized
      }
      if (!cancelled) setStudioReady(true);
    };
    init();
    return () => { cancelled = true; };
  }, [visible]);

  // Create Theatre.js project/sheet/objects for visual editing (optional, non-blocking)
  useEffect(() => {
    if (!visible || !studioReady) return;
    try {
      const project = getProject(`Kinetic Studio — ${activePresetId}/${phase}`);
      projectRef.current = project;
      const sheet = project.sheet(`Scene`);
      TRACKS.forEach(track => {
        sheet.object(track.label, {
          [track.prop]: types.number(0, { range: [track.min, track.max] }),
        });
      });
    } catch {
      // Theatre.js objects are optional for preview to work
    }
  }, [visible, studioReady, activePresetId, phase]);

  // Read values from Theatre.js objects when they change (optional enhancement)
  // const syncFromTheatre = useCallback(() => {
  //   if (!projectRef.current) return;
  //   try {
  //     const sheet = projectRef.current.sheet(`Scene`);
  //     const newValues: Record<string, number> = {};
  //     TRACKS.forEach(track => {
  //       try {
  //         const obj = sheet.object(track.label, { [track.prop]: types.number(0, { range: [track.min, track.max] }) });
  //         newValues[track.prop] = (obj.value as any)?.[track.prop] ?? 0;
  //       } catch {
  //         // ignore
  //       }
  //     });
  //     setValues(prev => ({ ...prev, ...newValues }));
  //   } catch {
  //     // ignore
  //   }
  // }, []);

  // Apply animation values to preview element
  const applyValues = useCallback((progress: number) => {
    if (!previewRef.current) return;
    const el = previewRef.current;

    const preset = kineticPresets[activePresetId];
    if (!preset) return;

    const startValues = getPresetStartValues(phase, activePresetId);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const t = Math.min(1, Math.max(0, progress));

    const finalTranslateX = lerp(startValues.translateX, values.translateX, t);
    const finalTranslateY = lerp(startValues.translateY, values.translateY, t);
    const finalOpacity = lerp(startValues.opacity, values.opacity, t);
    const finalScale = lerp(startValues.scale, values.scale, t);
    const finalRotateZ = lerp(startValues.rotateZ, values.rotateZ, t);
    const finalSkewX = lerp(startValues.skewX, values.skewX, t);
    const finalLetterSpacing = lerp(startValues.letterSpacing, values.letterSpacing, t);
    const finalBlur = lerp(startValues.blur, values.blur, t);

    el.style.transform = `translateX(${finalTranslateX}px) translateY(${finalTranslateY}px) scale(${finalScale}) rotateZ(${finalRotateZ}deg) skewX(${finalSkewX}deg)`;
    el.style.opacity = `${finalOpacity}`;
    el.style.letterSpacing = `${finalLetterSpacing}px`;
    el.style.filter = finalBlur > 0 ? `blur(${finalBlur}px)` : "";
  }, [activePresetId, phase, values]);

  // Play animation
  const playAnimation = useCallback(() => {
    if (playingPhase) return;
    setPlayingPhase(true);
    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(1, elapsed / duration);
      applyValues(progress);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setPlayingPhase(false);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [playingPhase, duration, applyValues]);

  // Cleanup RAF
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Reset preview
  const resetPreview = useCallback(() => {
    if (!previewRef.current) return;
    const el = previewRef.current;
    el.style.transform = "";
    el.style.opacity = "1";
    el.style.letterSpacing = "";
    el.style.filter = "";
    applyValues(0);
  }, [applyValues]);

  // Handle slider change
  const handleSliderChange = (prop: string, newValue: number) => {
    setValues(prev => ({ ...prev, [prop]: newValue }));
  };

  if (!visible) return null;

  const preset = kineticPresets[activePresetId];

  if (!studioReady) {
    return (
      <div className="theatre-studio-overlay">
        <div className="theatre-studio-panel">
          <div className="theatre-studio-header"><h3>Theatre.js Studio</h3></div>
          <div className="theatre-studio-body" style={{ justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
            <span style={{ color: '#94a3b8' }}>Initializing Theatre.js...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="theatre-studio-overlay">
      <div className="theatre-studio-panel">
        <div className="theatre-studio-header">
          <h3>Theatre.js Studio</h3>
          <div className="theatre-studio-controls">
            <select
              value={activePresetId}
              onChange={(e) => onPresetChange(e.target.value)}
              className="theatre-preset-select"
            >
              {Object.values(kineticPresets).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="theatre-phase-tabs">
              {(["enter", "beat", "exit"] as AnimationPhase[]).map(p => (
                <button
                  key={p}
                  className={`theatre-phase-tab ${phase === p ? "active" : ""} ${!preset?.beatAnimation && p === "beat" ? "disabled" : ""}`}
                  onClick={() => setPhase(p)}
                  disabled={!preset?.beatAnimation && p === "beat"}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="theatre-studio-close">✕</button>
          </div>
        </div>

        <div className="theatre-studio-body">
          <div className="theatre-preview-area">
            <div className="theatre-preview-label">Preview</div>
            <div className="theatre-preview-stage">
              <div ref={previewRef} className="theatre-preview-element">
                Sample Lyric Text
              </div>
            </div>
            <div className="theatre-preview-controls">
              <button onClick={playAnimation} className="theatre-play-btn" disabled={playingPhase}>
                {playingPhase ? "Playing..." : "▶ Play"}
              </button>
              <button onClick={resetPreview} className="theatre-reset-btn">
                ↺ Reset
              </button>
              <button
                onClick={() => {
                  const reset: Record<string, number> = {};
                  TRACKS.forEach(t => { reset[t.prop] = t.prop === "opacity" ? 1 : (t.prop === "scale" ? 1 : 0); });
                  setValues(reset);
                }}
                className="theatre-reset-btn"
                title="Reset all values to defaults"
              >
                ⟲ All
              </button>
              <div className="theatre-duration-control">
                <label>Duration</label>
                <input
                  type="range"
                  min="100"
                  max="2000"
                  step="50"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                />
                <span>{duration}ms</span>
              </div>
            </div>
          </div>

          <div className="theatre-timeline-area">
            <div className="theatre-timeline-header">
              <span className="theatre-timeline-title">Properties</span>
              <span className="theatre-timeline-time">0s — {(duration / 1000).toFixed(1)}s</span>
            </div>
            <div className="theatre-tracks">
              {TRACKS.map(track => (
                <div key={track.prop} className="theatre-track">
                  <div className="theatre-track-label">{track.label}</div>
                  <div className="theatre-track-slider">
                    <input
                      type="range"
                      min={track.min}
                      max={track.max}
                      step={track.step}
                      value={values[track.prop] ?? 0}
                      onChange={(e) => handleSliderChange(track.prop, parseFloat(e.target.value))}
                      className="theatre-track-input"
                    />
                    <span className="theatre-track-value">{(values[track.prop] ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="theatre-track-keyframe-bar">
                    <div className="theatre-track-keyframe-marker" style={{ left: `${(((values[track.prop] ?? 0) - track.min) / (track.max - track.min)) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="theatre-studio-footer">
          <div className="theatre-studio-info">
            <span className="theatre-lib-badge">Theatre.js 0.7.2</span>
            <span className="theatre-hint">Edit keyframes below. Changes apply to preview in real-time.</span>
          </div>
          <div className="theatre-studio-actions">
            <button className="theatre-export-btn" onClick={() => exportPreset(activePresetId, phase, values)}>
              Export JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getPresetStartValues(phase: AnimationPhase, presetId: string) {
  const defaults = { translateX: 0, translateY: 0, opacity: 1, scale: 1, rotateZ: 0, skewX: 0, letterSpacing: 0, blur: 0 };

  switch (presetId) {
    case "phonk":
      return phase === "enter" ? { ...defaults, opacity: 0, translateX: -30, scale: 1.3 }
        : phase === "exit" ? { ...defaults, opacity: 1, translateX: 0, scale: 1 }
        : defaults;
    case "synthwave":
      return phase === "enter" ? { ...defaults, opacity: 0, translateY: 40 }
        : phase === "exit" ? { ...defaults, opacity: 1, translateY: 0 }
        : defaults;
    case "ambient":
      return phase === "enter" ? { ...defaults, opacity: 0, translateY: 20, blur: 8 }
        : phase === "exit" ? { ...defaults, opacity: 1, translateY: 0, blur: 0 }
        : defaults;
    case "gfunk":
      return phase === "enter" ? { ...defaults, opacity: 0, translateY: 30, rotateZ: -5 }
        : phase === "exit" ? { ...defaults, opacity: 1, translateY: 0 }
        : defaults;
    case "grime":
      return phase === "enter" ? { ...defaults, opacity: 0, translateX: -50, skewX: -10 }
        : phase === "exit" ? { ...defaults, opacity: 1, translateX: 0 }
        : defaults;
    case "dubstep":
      return phase === "enter" ? { ...defaults, opacity: 0, scale: 2 }
        : phase === "exit" ? { ...defaults, opacity: 1, scale: 1 }
        : defaults;
    case "lofi":
      return phase === "enter" ? { ...defaults, opacity: 0 }
        : phase === "exit" ? { ...defaults, opacity: 1 }
        : defaults;
    case "cinematic":
    default:
      return phase === "enter" ? { ...defaults, opacity: 0, letterSpacing: 20 }
        : phase === "exit" ? { ...defaults, opacity: 1, letterSpacing: 8 }
        : defaults;
  }
}

function exportPreset(presetId: string, phase: string, values: Record<string, number>) {
  const exportData = {
    preset: presetId,
    phase,
    values,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `theatre-preset-${presetId}-${phase}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
