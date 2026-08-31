import { Upload } from "lucide-react";

interface Props {
  hasAudio: boolean;
  onFile: (file: File) => void;
}

export function UploadPrompt({ hasAudio, onFile }: Props) {
  if (hasAudio) return null;
  return (
    <div className="viz-upload" onClick={() => document.getElementById("viz-file-input")?.click()}>
      <input id="viz-file-input" type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <Upload size={32} />
      <span>Drop audio file or click to upload</span>
      <span className="viz-upload-hint">Select a track from the dropdown above, or upload your own</span>
    </div>
  );
}
