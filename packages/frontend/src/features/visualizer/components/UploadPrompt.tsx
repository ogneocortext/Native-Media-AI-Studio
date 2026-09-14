import { useState } from "react";
import { Upload } from "lucide-react";

interface Props {
  hasAudio: boolean;
  onFile: (file: File) => void;
  /** When true, render only the dim drop layer (no icon/text) — used
   *  underneath the guided empty-state hero so the two don't double up. */
  quiet?: boolean;
}

export function UploadPrompt({ hasAudio, onFile, quiet = false }: Props) {
  const [dragOver, setDragOver] = useState(false);
  if (hasAudio) return null;
  const openPicker = () => document.getElementById("viz-file-input")?.click();
  return (
    <div
      className={`viz-upload${dragOver ? " drag-over" : ""}${quiet ? " quiet" : ""}`}
      role="button"
      tabIndex={0}
      aria-label="Upload audio file — activate to browse, or drop an audio file here"
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <input id="viz-file-input" type="file" accept="audio/*" className="hidden" aria-label="Audio file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {!quiet && (
        <>
          <Upload size={32} aria-hidden="true" />
          <span>Drop audio file or click to upload</span>
          <span className="viz-upload-hint">Select a track from the dropdown above, or upload your own</span>
        </>
      )}
    </div>
  );
}
