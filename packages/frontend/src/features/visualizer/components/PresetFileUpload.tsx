import { useRef, useState, useCallback, useEffect } from "react";
import { FileJson, X, Clipboard } from "lucide-react";
import type { VisualPreset } from "../visualPreset";
import { importPresetFromString } from "../visualPreset";

interface PresetFileUploadProps {
  onPresetLoaded: (preset: VisualPreset) => void;
  loadedPresetName: string | null;
  onClearPreset: () => void;
}

export function PresetFileUpload({ onPresetLoaded, loadedPresetName, onClearPreset }: PresetFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const processText = useCallback((text: string) => {
    setError(null);
    const preset = importPresetFromString(text);
    if (!preset) {
      setError("Invalid JSON");
      return;
    }
    if (!preset.theme && !preset.visualizer) {
      setError("Not a visualizer preset");
      return;
    }
    onPresetLoaded(preset);
  }, [onPresetLoaded]);

  const processFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Expected .json file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      processText(text);
    };
    reader.readAsText(file);
  }, [processText]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) return;
    processText(pasteText);
    setPasteText("");
    setShowPaste(false);
  }, [pasteText, processText]);

  // Global Ctrl+V to paste JSON when no input is focused
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        const active = document.activeElement;
        const isInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || (active as HTMLElement).isContentEditable);
        if (isInput) return; // let normal paste happen in inputs
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim().startsWith("{")) {
            e.preventDefault();
            processText(text);
          }
        } catch { /* clipboard permission denied — ignore */ }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [processText]);

  return (
    <div className="viz-preset-upload">
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", top: "-9999px" }}
      />

      {loadedPresetName ? (
        <div className="viz-preset-badge">
          <FileJson size={14} />
          <span>{loadedPresetName}</span>
          <button onClick={onClearPreset} className="viz-preset-clear" title="Remove preset">
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="viz-preset-btns">
          <button
            className={`viz-icon-btn viz-preset-btn ${dragOver ? "drag-over" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            title="Load JSON preset file"
          >
            <FileJson size={14} />
          </button>
          <button
            className="viz-icon-btn viz-preset-paste-btn"
            onClick={() => setShowPaste(!showPaste)}
            title="Paste JSON from clipboard"
          >
            <Clipboard size={14} />
          </button>
        </div>
      )}

      {showPaste && !loadedPresetName && (
        <div className="viz-paste-popover">
          <textarea
            className="viz-paste-input"
            placeholder='Paste JSON here then click Apply...'
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={4}
            autoFocus
          />
          <div className="viz-paste-actions">
            <button className="viz-paste-apply" onClick={handlePasteSubmit} disabled={!pasteText.trim()}>Apply</button>
            <button className="viz-paste-cancel" onClick={() => { setShowPaste(false); setPasteText(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {error && <span className="viz-preset-error">{error}</span>}
    </div>
  );
}
