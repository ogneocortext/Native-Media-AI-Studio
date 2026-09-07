import { useState, useCallback } from "react";
import {
  getAvailableAudioBackends,
  type AudioBackendsResponse,
  getAnalysisSummary,
  ensureAnalysis,
  analyzeAudio,
  analyzeAudioCuda,
  type AudioAnalysisResult,
} from "../services/api";

export type { AudioBackendsResponse };

export interface AudioAnalysisState {
  backends: AudioBackendsResponse | null;
  summary: ReturnType<typeof getAnalysisSummary> extends Promise<infer T> ? T | null : null;
  analysis: AudioAnalysisResult | null;
  loadingBackends: boolean;
  loadingSummary: boolean;
  analyzing: boolean;
  error: string | null;
}

export function useAudioAnalysis() {
  const [backends, setBackends] = useState<AudioBackendsResponse | null>(null);
  const [summary, setSummary] = useState<AudioAnalysisState["summary"]>(null);
  const [analysis, setAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [loadingBackends, setLoadingBackends] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBackends = useCallback(async () => {
    setLoadingBackends(true);
    setError(null);
    try {
      const b = await getAvailableAudioBackends();
      setBackends(b);
      return b;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load audio backends");
      return null;
    } finally {
      setLoadingBackends(false);
    }
  }, []);

  const loadSummary = useCallback(async (filename: string) => {
    setLoadingSummary(true);
    setError(null);
    try {
      const s = await getAnalysisSummary(filename);
      setSummary(s);
      return s;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load analysis summary");
      return null;
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const ensure = useCallback(
    async (filename: string, backend = "sonara") => {
      setAnalyzing(true);
      setError(null);
      try {
        const result = await ensureAnalysis(filename, backend);
        if (result.analysis) {
          setAnalysis(result.analysis as AudioAnalysisResult);
        }
        return result;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to ensure analysis");
        return null;
      } finally {
        setAnalyzing(false);
      }
    },
    [],
  );

  const analyze = useCallback(
    async (file: File, backend = "sonara", useCuda = false) => {
      setAnalyzing(true);
      setError(null);
      try {
        const result = useCuda ? await analyzeAudioCuda(file) : await analyzeAudio(file, backend);
        setAnalysis(result);
        return result;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Analysis failed");
        return null;
      } finally {
        setAnalyzing(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setSummary(null);
    setAnalysis(null);
    setError(null);
  }, []);

  return {
    backends,
    summary,
    analysis,
    loadingBackends,
    loadingSummary,
    analyzing,
    error,
    loadBackends,
    loadSummary,
    ensure,
    analyze,
    reset,
  };
}
