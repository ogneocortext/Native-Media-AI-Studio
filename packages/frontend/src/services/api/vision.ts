/**
 * Frontend client for /api/vision — OCR and visualizer analysis.
 */

import { postForm } from "./typed-fetch";
import type { VisionOCRResponse, AnalyzeVisualizerResponse } from "./types";

const BASE = "/api/vision";

/**
 * Perform OCR on an image file.
 * Long-running (up to 2 minutes).
 */
export async function visionOCR(
  file: File,
  prompt = "ocr",
  model = "minicpm-v:8b",
): Promise<VisionOCRResponse> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("prompt", prompt);
  fd.append("model", model);
  return postForm<VisionOCRResponse>(`${BASE}/ocr`, fd, { timeout: 120000 });
}

/**
 * Analyze a visualizer screenshot.
 * Long-running (up to 2 minutes).
 */
export async function analyzeVisualizer(
  file: File,
  mode = "bars",
  model = "minicpm-v:8b",
): Promise<AnalyzeVisualizerResponse> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  fd.append("model", model);
  return postForm<AnalyzeVisualizerResponse>(`${BASE}/analyze-visualizer`, fd, { timeout: 120000 });
}