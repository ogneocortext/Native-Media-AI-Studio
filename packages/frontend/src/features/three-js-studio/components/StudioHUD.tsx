interface StudioHUDProps {
  objects: any[];
  cameraMode: string;
  beatSync: boolean;
  bpm: number;
  sceneConfig: any;
  beatActive: boolean;
  focusMode: boolean;
}

export function StudioHUD({
  objects,
  cameraMode,
  beatSync,
  bpm,
  sceneConfig,
  beatActive,
  focusMode,
}: StudioHUDProps) {
  return (
    <div
      className={`hud absolute bottom-2 left-2 bg-black/60 backdrop-blur px-2.5 py-1 rounded text-gray-400 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5 pointer-events-none border border-white/5 max-w-[calc(100%-1rem)] ${focusMode ? "hidden" : ""}`}
    >
      <span>
        Objs <span className="text-white font-mono">{objects.length}</span>
      </span>
      <span>
        Cam <span className="text-purple-400 font-mono">{cameraMode}</span>
      </span>
      <span>
        BPM{" "}
        <span
          className={
            beatSync
              ? "text-green-400 font-mono"
              : "text-gray-500 font-mono"
          }
        >
          {beatSync ? bpm : "—"}
        </span>
      </span>
      {sceneConfig.selectiveBloom && (
        <span>
          Bloom{" "}
          <span className="text-amber-300 font-mono">
            {objects.filter((o) => o.bloom).length}/{objects.length}
          </span>
        </span>
      )}
      {beatSync && (
        <span className="flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full transition-all duration-75 ${beatActive ? "bg-green-400 scale-125" : "bg-gray-600 scale-100"}`}
          />
          <span className={beatActive ? "text-green-400" : "text-gray-500"}>
            Beat
          </span>
        </span>
      )}
    </div>
  );
}
