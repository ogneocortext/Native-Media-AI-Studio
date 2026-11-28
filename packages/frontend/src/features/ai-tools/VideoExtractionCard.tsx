/**
 * VideoExtractionCard — uploads a video file, extracts its audio track via
 * `uploadAudioFile`, and plays the result with an AudioTransport.
 *
 * Extracted from AIToolsPage.tsx. Self-contained feature card.
 */

import { Download, AlertCircle, Loader2 } from "lucide-react";
import { Card } from "../../components/common";
import { DS } from "../../styles/designSystem";
import { getOutputUrl } from "../../utils/url";
import { AudioTransport } from "../../components/audio";

export interface ExtractResult {
  filename: string;
  relative_path: string;
  stored_path: string;
  size_bytes: number;
  message: string;
  converted: boolean | undefined;
  source_filename: string | null | undefined;
  lossless: boolean | undefined;
}

interface VideoExtractionCardProps {
  extractRunning: boolean;
  extractError: string | null;
  extractResult: ExtractResult | null;
  handleVideoUpload: (file: File) => void;
}

export function VideoExtractionCard({
  extractRunning,
  extractError,
  extractResult,
  handleVideoUpload,
}: VideoExtractionCardProps) {
  return (
    <Card title="Video → Audio" icon={<Download size={16} className="text-violet-400" />}>
      <div className="p-4">
        <p className={DS.textXs + " mb-3"}>
          Upload a video file to extract its audio track. The result is saved to your audio
          library and can be analyzed on the Audio Analysis page.
        </p>
        <label className="flex items-center gap-2 cursor-pointer bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-300 hover:bg-gray-600 transition-colors">
          <span>Choose video…</span>
          <input
            type="file"
            accept=".mp4,.mov,.mkv,.webm,.m4v,.avi"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleVideoUpload(file);
              e.target.value = "";
            }}
            className="sr-only"
            aria-label="Select a video file to extract audio"
          />
        </label>
        {extractRunning && (
          <div className="mt-3 flex items-center gap-2">
            <Loader2 size={13} className="animate-spin text-muted" />
            <span className={DS.textXs}>Extracting audio…</span>
          </div>
        )}
        {extractError && (
          <p className="mt-2 text-xs text-red-400 flex items-center gap-1" role="alert">
            <AlertCircle size={12} /> {extractError}
          </p>
        )}
        {extractResult && (
          <div className="mt-3 space-y-2 pt-2 border-t border-gray-700">
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
              {extractResult.converted ? "Converted" : "Uploaded"} · {extractResult.message}
            </div>
            <div className="flex items-center justify-between gap-2 bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-700">
              <p
                className={DS.textXs + " text-gray-300 font-mono truncate"}
                title={extractResult.filename}
              >
                {extractResult.filename}
              </p>
              <a
                href={getOutputUrl(extractResult.relative_path)}
                download
                className="p-1.5 hover:bg-gray-600 rounded-lg text-muted hover:text-white shrink-0"
                title="Download audio file"
              >
                <Download size={13} />
              </a>
            </div>
            <AudioTransport
              src={getOutputUrl(extractResult.relative_path)}
              className="mt-2 w-full"
              ariaLabel={`Play ${extractResult.filename}`}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
