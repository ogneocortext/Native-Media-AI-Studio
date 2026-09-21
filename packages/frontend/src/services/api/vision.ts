import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export async function visionOCR(file: File, prompt: string = "ocr", model: string = "minicpm-v:8b"): Promise<{ text: string; model: string; prompt: string }> {
  const base = getApiBase();
  const fd = new FormData();
  fd.append("file", file);
  fd.append("prompt", prompt);
  fd.append("model", model);
  const res = await fetchWithTimeout(`${base}/api/vision/ocr`, { method: "POST", body: fd, timeout: 120000 });
  if (!res.ok) throw new Error("Vision OCR failed");
  return res.json();
}

export async function analyzeVisualizer(
  file: File,
  mode: string = "bars",
  model: string = "minicpm-v:8b",
): Promise<{ text: string; model: string; mode: string }> {
  const base = getApiBase();
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  fd.append("model", model);
  const res = await fetchWithTimeout(`${base}/api/vision/analyze-visualizer`, { method: "POST", body: fd, timeout: 120000 });
  if (!res.ok) throw new Error("Visualizer analysis failed");
  return res.json();
}
