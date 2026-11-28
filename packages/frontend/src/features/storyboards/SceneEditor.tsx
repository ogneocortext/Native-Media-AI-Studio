/**
 * Per-scene direction editor for a canonical storyboard board.
 *
 * Every field here is authored direction that persists on the board and
 * rides the compile payload. Timing edits are absolute seconds; the
 * backend store validates them against the compiler's rules (end after
 * start, no overlaps) when the board is saved.
 */

import type { BoardScene } from "./boardTypes";

const inputCls =
  "w-full bg-gray-900/60 border border-gray-700/60 rounded px-2 py-1 text-[11px] text-gray-200 focus:outline-none focus:border-purple-500/60";
const labelCls = "block text-[9px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

export function SceneEditor({
  scene,
  onChange,
}: {
  scene: BoardScene;
  onChange: (patch: Partial<BoardScene>) => void;
}) {
  const setNum = (field: "start" | "end") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onChange({ [field]: Number.isFinite(value) ? value : 0 });
  };
  const setText =
    (field: keyof BoardScene) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange({ [field]: e.target.value });
    };
  const invalidTiming = !(scene.end > scene.start);

  return (
    <div className="mt-2 pt-2 border-t border-gray-700/50 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-3 gap-1.5">
        <Field label="Start (s)">
          <input type="number" step="0.1" min="0" value={scene.start} onChange={setNum("start")} className={inputCls} />
        </Field>
        <Field label="End (s)">
          <input type="number" step="0.1" min="0" value={scene.end} onChange={setNum("end")} className={inputCls} />
        </Field>
        <Field label="Section">
          <input type="text" value={scene.section} onChange={setText("section")} className={inputCls} />
        </Field>
      </div>
      {invalidTiming && (
        <p className="text-[10px] text-red-400">End must be after start, or the board will not save.</p>
      )}
      <Field label="Lyric lines (one per line)">
        <textarea
          rows={Math.min(6, Math.max(1, scene.lyric_lines.length))}
          value={scene.lyric_lines.join("\n")}
          onChange={(e) =>
            onChange({ lyric_lines: e.target.value.split("\n").filter((line) => line.length > 0) })
          }
          className={inputCls}
        />
      </Field>
      <Field label="Visual (what is on screen)">
        <textarea rows={3} value={scene.visual} onChange={setText("visual")} className={inputCls} />
      </Field>
      <Field label="Camera direction">
        <textarea rows={2} value={scene.camera_text ?? ""} onChange={setText("camera_text")} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="Palette">
          <input type="text" value={scene.palette_text ?? ""} onChange={setText("palette_text")} className={inputCls} />
        </Field>
        <Field label="Transition">
          <input type="text" value={scene.transition ?? ""} onChange={setText("transition")} className={inputCls} />
        </Field>
        <Field label="Typography">
          <input type="text" value={scene.typography ?? ""} onChange={setText("typography")} className={inputCls} />
        </Field>
        <Field label="Technique">
          <input type="text" value={scene.technique ?? ""} onChange={setText("technique")} className={inputCls} />
        </Field>
      </div>
      <Field label="Blender / 3D note">
        <input type="text" value={scene.blender ?? ""} onChange={setText("blender")} className={inputCls} />
      </Field>
    </div>
  );
}
