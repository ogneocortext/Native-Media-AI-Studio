import { useState, useEffect, useCallback } from "react";
import { Film, Play, ExternalLink, FolderOpen, Clock, HardDrive, Loader2, Info, RefreshCw, AlertTriangle } from "lucide-react";
import {
  getHyperFramesStatus,
  getHyperFramesExamples,
  launchHyperFramesPreview,
  renderHyperFramesComposition,
  type HyperFramesStatus,
} from "../../services/api";

export function HyperFramesPage() {
  const [status, setStatus] = useState<HyperFramesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getHyperFramesStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError("Failed to load HyperFrames status");
    }
  }, []);

  const handleRetry = useCallback(async () => {
    setRetryCount(c => c + 1);
    setError(null);
    await loadStatus();
    await loadExamples();
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadExamples().then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadStatus, retryCount]);

  const loadExamples = async () => {
    try {
      await getHyperFramesExamples();
    } catch {
      // examples optional
    }
  };

  const handlePreview = async () => {
    try {
      setError(null);
      setPreviewing(true);
      const res = await launchHyperFramesPreview();
      const url = (res.url as string) || "http://localhost:3000";
      setPreviewUrl(url);
    } catch (e) {
      setError("Failed to start preview server");
    } finally {
      setPreviewing(false);
    }
  };

  const handleRender = async () => {
    try {
      setRendering(true);
      setRenderResult(null);
      setError(null);
      const res = await renderHyperFramesComposition({
        composition: "index.html",
        format: "mp4",
        fps: 24,
        quality: "standard",
        workers: "auto",
        output: "render.mp4",
      });
      setRenderResult(res);
    } catch (e) {
      setError("Render failed: " + ((e as Error).message ?? String(e)));
    } finally {
      setRendering(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading HyperFrames...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Film className="h-7 w-7 text-purple-400" />
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">HyperFrames</h1>
          <p className="text-sm text-gray-400">
            v{status?.version ?? "?"} · CLI: {status?.hyperframes_cli ?? "npx hyperframes"}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-300">Something went wrong</p>
            <p className="text-xs text-red-300/80 mt-1">{error}</p>
          </div>
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/30 focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="group rounded-xl border border-gray-700/60 bg-gray-900/40 p-5 space-y-3 transition-colors hover:border-gray-600/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-sm font-medium text-gray-200">
              <FolderOpen className="h-4 w-4 text-gray-400" />
              <span>Project</span>
            </div>
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${status?.exists ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
              {status?.exists ? "Exists" : "Missing"}
            </span>
          </div>
          <p className="text-xs text-gray-400 break-all leading-relaxed">{status?.test_project ?? "tools/hyperframes-built-this-from-a-dream"}</p>
        </div>

        <div className="group rounded-xl border border-gray-700/60 bg-gray-900/40 p-5 space-y-3 transition-colors hover:border-gray-600/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-sm font-medium text-gray-200">
              <Clock className="h-4 w-4 text-gray-400" />
              <span>CLI</span>
            </div>
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${status?.cli_available ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
              {status?.cli_available ? "Available" : "Unavailable"}
            </span>
          </div>
          <p className="text-xs text-gray-400 break-all leading-relaxed">{status?.hyperframes_cli ?? "npx"}</p>
        </div>

        <div className="group rounded-xl border border-gray-700/60 bg-gray-900/40 p-5 space-y-3 transition-colors hover:border-gray-600/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-sm font-medium text-gray-200">
              <HardDrive className="h-4 w-4 text-gray-400" />
              <span>Output</span>
            </div>
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-blue-500/10 text-blue-300">
              D drive staging
            </span>
          </div>
          <p className="text-xs text-gray-400 break-all leading-relaxed">D:\hyperframes-cache</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handlePreview}
          disabled={previewing}
          className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {previewing ? "Starting..." : "Launch Preview"}
        </button>
        <button
          onClick={handleRender}
          disabled={rendering}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500/50 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
          {rendering ? "Rendering..." : "Render Composition"}
        </button>
      </div>

      {previewUrl && (
        <div className="rounded-xl border border-gray-700/60 bg-gray-900/40 p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-200">Preview Server</span>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50 rounded transition-colors"
            >
              Open <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="text-xs text-gray-400 break-all leading-relaxed">{previewUrl}</p>
        </div>
      )}

      {renderResult && (
        <div className="rounded-xl border border-gray-700/60 bg-gray-900/40 p-5 space-y-3">
          <span className="text-sm font-medium text-gray-200">Render Result</span>
          <pre className="mt-2 text-xs text-gray-200 whitespace-pre-wrap break-words leading-relaxed bg-black/30 rounded-lg p-3">
            {JSON.stringify(renderResult, null, 2)}
          </pre>
        </div>
      )}

      <div className="rounded-xl border border-gray-700/60 bg-gray-900/40 p-5 space-y-2">
        <div className="flex items-center gap-2.5 text-sm font-medium text-gray-200">
          <Info className="h-4 w-4 text-gray-400" />
          <span>Current Project</span>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">
          The active HyperFrames project is <code className="rounded bg-gray-800/60 px-1.5 py-0.5 text-xs text-gray-200">tools/hyperframes-built-this-from-a-dream</code>.
          {" "}Compositions: <code className="rounded bg-gray-800/60 px-1.5 py-0.5 text-xs text-gray-200">index.html</code>, <code className="rounded bg-gray-800/60 px-1.5 py-0.5 text-xs text-gray-200">v2/index.html</code>, <code className="rounded bg-gray-800/60 px-1.5 py-0.5 text-xs text-gray-200">v3/index.html</code>.
        </p>
      </div>
    </div>
  );
}
