import type { UseGeneration3DReturn } from "./useGeneration3D";

interface ReferenceImageSectionProps {
  hook: UseGeneration3DReturn;
}

export function ReferenceImageSection({ hook }: ReferenceImageSectionProps) {
  const { genMode, refPreviewUrl, refError, refFile, handleReferenceFile } = hook;

  if (genMode !== "reference") return null;

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-amber-500/30">
      <label className="text-sm font-medium text-gray-300 block mb-2">Reference image <span className="text-gray-500 font-normal">— PNG / JPEG / WebP, ≤15 MB</span></label>
      <div className="flex items-start gap-3">
        <label className="shrink-0 cursor-pointer px-3 py-2 bg-gray-900 border border-gray-700 hover:border-amber-500/40 rounded-lg text-xs text-gray-300">
          Choose file
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => handleReferenceFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {refPreviewUrl ? (
          <img src={refPreviewUrl} alt="Reference preview" className="w-20 h-20 object-cover rounded-lg border border-gray-700" />
        ) : (
          <p className="text-xs text-gray-500 self-center">Front-facing, evenly lit, plain background works best. The mesh is built from this image — use one anchor per character.</p>
        )}
      </div>
      {refError && <p className="text-xs text-red-400 mt-2">{refError}</p>}
      {refFile && <p className="text-xs text-gray-500 mt-2 font-mono truncate" title={refFile.name}>{refFile.name} • {(refFile.size / 1024 / 1024).toFixed(1)} MB</p>}
    </div>
  );
}
