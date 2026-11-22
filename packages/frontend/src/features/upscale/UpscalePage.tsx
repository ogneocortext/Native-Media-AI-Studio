/**
 * UpscalePage — standalone page for upscaling images 2x/4x via the existing
 * /api/integrations/upscale endpoint (backend: services/upscale_service.py).
 *
 * Engine behavior (a backend decision, surfaced as-is, never hidden):
 *   - ComfyUI AI upscale (LoadImage -> UpscaleModelLoader ->
 *     ImageUpscaleWithModel -> SaveImage) when ComfyUI is reachable.
 *   - FFmpeg lanczos resize fallback otherwise. The response's `engine`
 *     field says which ran ("comfyui" | "ffmpeg"); the UI never presents a
 *     fallback result as an AI upscale.
 *
 * Outputs land in output/images/{stem}_upscaled_{scale}x.png and appear in
 * the Media Library.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Image as ImageIcon, Maximize2 } from "lucide-react";
import { Link } from "react-router-dom";

import { getApiBase, fetchWithTimeout } from "@/services/api/core";
import { type UpscaleResponse } from "@/services/api";
import { getOutputUrl } from "@/utils/url";

type UpscaleModel = "4x-UltraSharp.pth" | "4x-ClearRealityV1.safetensors";

const UPSCALE_MODELS: { value: UpscaleModel; label: string }[] = [
  { value: "4x-UltraSharp.pth", label: "UltraSharp - anime" },
  { value: "4x-ClearRealityV1.safetensors", label: "ClearReality - photo" },
];

export function UpscalePage() {
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<UpscaleResponse | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [model, setModel] = useState<UpscaleModel>("4x-UltraSharp.pth");
  const [scale, setScale] = useState<2 | 4>(4);

  const [libraryImages, setLibraryImages] = useState<{ value: string; label: string }[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  // Media Library picker, fed by the same GET /api/outputs listing the
  // Media Library page uses (see features/media-library/hooks/useMediaFiles),
  // filtered to image files only.
  useEffect(() => {
    const load = async () => {
      setLibraryLoading(true);
      try {
        const base = getApiBase();
        const PAGE = 500;
        const raw: Record<string, unknown>[] = [];
        let total = Infinity;
        while (raw.length < total) {
          const res = await fetchWithTimeout(
            `${base}/api/outputs?limit=${PAGE}&offset=${raw.length}`,
            { timeout: 15000 },
          );
          if (!res.ok) throw new Error(`Failed to load library: ${res.status}`);
          const data = (await res.json()) as
            { outputs?: Record<string, unknown>[]; total?: number } | Record<string, unknown>[];
          const batch = Array.isArray(data) ? data : (data.outputs ?? []);
          if (Array.isArray(data)) total = batch.length;
          else if (typeof data.total === "number") total = data.total;
          raw.push(...batch);
          if (batch.length < PAGE) break;
        }
        const seen = new Set<string>();
        const pictures = (
          raw as {
            file_type: unknown;
            filename?: string;
            relative_path?: string;
          }[]
        )
          .filter((f) => f.file_type === "image")
          .map((f) => {
            const value: string = f.relative_path ?? f.filename ?? "";
            const label: string = f.filename ?? f.relative_path ?? "image";
            return { value, label };
          })
          .filter((item) => {
            if (seen.has(item.value)) return false;
            seen.add(item.value);
            return true;
          });
        setLibraryImages(pictures);
      } catch (e) {
        console.error("Failed to load media library images:", e);
      } finally {
        setLibraryLoading(false);
      }
    };
    void load();
  }, []);

  const previewSrc =
    image && (image.includes("/") || image.includes("\\")) ? getOutputUrl(image) : null;

  const handleLibraryPick = (value: string) => {
    if (!value) return;
    setImage(value);
    setError(null);
    setResult(null);
  };

  const handleUpscale = async () => {
    if (!image) {
      setError("Please choose an image first.");
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const base = getApiBase();
      const res = await fetchWithTimeout(`${base}/api/integrations/upscale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, model, scale, prefer_comfyui: true }),
        timeout: 300000,
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ detail: "Upscale failed" }))) as {
          detail?: string;
        };
        throw new Error(err.detail ?? "Upscale failed");
      }

      const data = (await res.json()) as UpscaleResponse;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upscale failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result?.relative_path) return;
    const link = document.createElement("a");
    link.href = getOutputUrl(result.relative_path);
    link.download = result.relative_path.split("/").pop() ?? "upscaled.png";
    link.click();
  };

  return (
    <div className="page">
      <div className="page-header">
        <Link to="/library" className="breadcrumb">
          <ArrowLeft size={16} />
          <span>Media Library</span>
        </Link>
        <div className="page-title">
          <Maximize2 size={20} />
          <span>Upscale</span>
        </div>
        <p className="page-subtitle">
          Upscale images 2x or 4x for 4K export without 4K render cost. Uses ComfyUI AI upscaling
          when reachable, otherwise an FFmpeg lanczos resize. The result panel states which engine
          ran.
        </p>
      </div>

      <div className="page-body">
        <div className="processing-panel">
          <div className="panel-section">
            <h3>
              <ImageIcon size={18} />
              Image Source
            </h3>
            <div className="image-source">
              <input
                type="text"
                value={image ?? ""}
                onChange={(e) => {
                  setImage(e.target.value || null);
                  setError(null);
                  setResult(null);
                }}
                placeholder="Path or bare filename, e.g. images/photo.png"
              />
              {libraryLoading ? (
                <span>loading library...</span>
              ) : (
                <select
                  value=""
                  onChange={(e) => void handleLibraryPick(e.target.value)}
                  aria-label="Pick an image from the Media Library"
                >
                  <option value="">Pick from Media Library</option>
                  {libraryImages.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {previewSrc && <img src={previewSrc} alt="Selected image" className="selected-image" />}
            {image && !previewSrc && (
              <p className="hint">
                No preview available for bare filenames; the backend resolves them against
                output/images.
              </p>
            )}
          </div>

          <div className="panel-section">
            <h3>Options</h3>
            <div className="option-group">
              <label>Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as UpscaleModel)}
                aria-label="Upscale model"
              >
                {UPSCALE_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="option-group">
              <label>Scale</label>
              <div className="scale-toggle">
                <button
                  aria-pressed={scale === 2}
                  className={`scale-btn ${scale === 2 ? "active" : ""}`}
                  onClick={() => setScale(2)}
                >
                  2x
                </button>
                <button
                  aria-pressed={scale === 4}
                  className={`scale-btn ${scale === 4 ? "active" : ""}`}
                  onClick={() => setScale(4)}
                >
                  4x
                </button>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <button
              className="btn btn-primary"
              onClick={() => void handleUpscale()}
              disabled={processing || !image}
            >
              {processing ? "Upscaling..." : "Upscale Image"}
            </button>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {result && (
          <div className="result-panel">
            <h3>Result</h3>
            {(result.relative_path ?? result.output_path) && (
              <div className="image-container">
                <img
                  src={getOutputUrl(result.relative_path ?? result.output_path)}
                  alt="Upscaled image"
                />
              </div>
            )}
            <div className="result-meta">
              <p>
                <strong>Engine:</strong> {result.engine}
              </p>
              <p>
                <strong>Model:</strong> {result.model}
              </p>
              <p>
                <strong>Scale:</strong> {result.scale}x
              </p>
              <p>
                <strong>Elapsed:</strong> {result.elapsed_s}s
              </p>
              {result.engine === "ffmpeg" && (
                <p className="engine-notice">
                  This was a lanczos resize (FFmpeg fallback), not an AI upscale.
                </p>
              )}
              {result.warnings.length > 0 && (
                <p className="warnings">{result.warnings.join(" · ")}</p>
              )}
              <p className="output-path">{result.output_path}</p>
              {result.relative_path && (
                <a
                  href={getOutputUrl(result.relative_path)}
                  download
                  onClick={handleDownload}
                  className="btn btn-primary"
                >
                  Download
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UpscalePage;
