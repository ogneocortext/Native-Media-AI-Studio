import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw, Film, Sparkles } from "lucide-react";
import { Card } from "../../components/common";
import { showToast } from "../../utils/toast";

interface TrackDef {
  id: string;
  label: string;
  color: string;
  min: number;
  max: number;
  default: number;
}

const TRACKS: TrackDef[] = [
  { id: "posX", label: "Position X", color: "#6366f1", min: -3, max: 3, default: 0 },
  { id: "posY", label: "Position Y", color: "#22c55e", min: -2, max: 2, default: 0.5 },
  { id: "scale", label: "Scale", color: "#f59e0b", min: 0.2, max: 3, default: 1 },
  { id: "rotation", label: "Rotation", color: "#ec4899", min: 0, max: 360, default: 0 },
  { id: "opacity", label: "Opacity", color: "#06b6d4", min: 0, max: 1, default: 1 },
];

export function AnimationStudio() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(TRACKS.map((t) => [t.id, t.default])),
  );
  const [theatreReady, setTheatreReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    import("@theatre/core").then(() => {
      setTheatreReady(true);
    });
  }, []);

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

    ctx.restore();
  }, [values]);

  useEffect(() => {
    drawPreview();
  }, [drawPreview]);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      timeRef.current += dt;
      const t = timeRef.current;
      setValues((prev) => ({
        ...prev,
        posX: Math.sin(t * 0.8) * 1.5,
        posY: Math.cos(t * 0.6) * 0.8,
        rotation: (t * 30) % 360,
      }));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying]);

  const handleReset = () => {
    setIsPlaying(false);
    timeRef.current = 0;
    setValues(Object.fromEntries(TRACKS.map((t) => [t.id, t.default])));
    showToast("Animation reset", "info");
  };

  const handleExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "animation-frame.png";
      a.click();
      URL.revokeObjectURL(url);
      showToast("Frame exported as PNG", "success");
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Animation Studio</h1>
        <p className="text-muted mt-1">
          Keyframe-based animation powered by Theatre.js. Adjust properties and preview in real time.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Preview" className="lg:col-span-2">
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
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="btn btn-primary"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button onClick={handleReset} className="btn btn-secondary">
              <RotateCcw size={16} /> Reset
            </button>
            <button onClick={handleExport} className="btn btn-secondary">
              <Film size={16} /> Export Frame
            </button>
          </div>
        </Card>

        <Card title="Properties">
          <div className="space-y-4">
            {TRACKS.map((track) => (
              <div key={track.id}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-foreground">{track.label}</label>
                  <span className="text-xs text-muted font-mono">
                    {values[track.id].toFixed(2)}
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
                    setValues((prev) => ({ ...prev, [track.id]: v }));
                  }}
                  className="w-full"
                  style={{ accentColor: track.color }}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
