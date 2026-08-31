import { useState, useCallback, useEffect } from "react";
import { X, Plus, Trash2, Save, FileJson, Clock, ChevronDown, ChevronRight, Zap, Eye } from "lucide-react";
import {
  type LyricsData,
  type LyricLine,
  ANIMATION_TYPES,
  EXIT_ANIMATION_TYPES,
  LOOP_ANIMATION_TYPES,
  createDefaultAnimation,
  exportLyricsToJSON,
  importLyricsFromJSON,
  validateLyricsData,
} from "../../visualizer/lyricsData";

interface LyricsEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  lyricsData: LyricsData;
  onSave: (data: LyricsData) => void;
  trackName?: string;
  currentTime?: number;
  isPlaying?: boolean;
  onCaptureTime?: (type: "start" | "end") => number | null;
}

export function LyricsEditorModal({
  isOpen,
  onClose,
  lyricsData,
  onSave,
  trackName,
  currentTime = 0,
  isPlaying = false,
  onCaptureTime,
}: LyricsEditorModalProps) {
  const [data, setData] = useState<LyricsData>(lyricsData);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"lines" | "theme" | "effects">("lines");

  // Sync data when lyricsData changes (e.g., loaded from DB)
  useEffect(() => {
    if (isOpen) {
      setData(lyricsData);
      setErrors([]);
      setJsonMode(false);
    }
  }, [isOpen, lyricsData]);

  const toggleLineExpanded = useCallback((id: string) => {
    setExpandedLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddLine = useCallback(() => {
    const lastLine = data.lines[data.lines.length - 1];
    const startTime = lastLine ? lastLine.end : Math.floor(currentTime);
    const newLine: LyricLine = {
      id: `line-${Date.now()}`,
      start: startTime,
      end: startTime + 5,
      text: "",
      section: "VERSE",
      animation: createDefaultAnimation(),
      transition: { type: "dissolve", duration: 0.3, easing: "easeInOut" },
    };
    setData((prev) => ({ ...prev, lines: [...prev.lines, newLine] }));
    // Auto-expand the new line
    setExpandedLines((prev) => new Set([...prev, newLine.id]));
  }, [data.lines, currentTime]);

  const handleDeleteLine = useCallback((id: string) => {
    setData((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.id !== id) }));
    setExpandedLines((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleLineChange = useCallback((id: string, field: keyof LyricLine, value: unknown) => {
    setData((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    }));
  }, []);

  const handleCaptureStart = useCallback((id: string) => {
    const time = onCaptureTime ? onCaptureTime("start") : currentTime;
    if (time !== null) {
      handleLineChange(id, "start", Math.round(time * 10) / 10);
    }
  }, [currentTime, onCaptureTime, handleLineChange]);

  const handleCaptureEnd = useCallback((id: string) => {
    const time = onCaptureTime ? onCaptureTime("end") : currentTime;
    if (time !== null) {
      handleLineChange(id, "end", Math.round(time * 10) / 10);
    }
  }, [currentTime, onCaptureTime, handleLineChange]);

  const handleToggleJson = useCallback(() => {
    if (jsonMode) {
      try {
        const parsed = importLyricsFromJSON(jsonText);
        setData(parsed);
        setErrors([]);
        setJsonMode(false);
      } catch (e) {
        setErrors([`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`]);
      }
    } else {
      setJsonText(exportLyricsToJSON(data));
      setJsonMode(true);
    }
  }, [jsonMode, jsonText, data]);

  const handleSave = useCallback(() => {
    const validationErrors = validateLyricsData(data);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    onSave(data);
  }, [data, onSave]);

  const handleImportJson = useCallback(() => {
    try {
      const parsed = importLyricsFromJSON(jsonText);
      setData(parsed);
      setErrors([]);
    } catch (e) {
      setErrors([`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`]);
    }
  }, [jsonText]);

  // Helper for animation sub-fields
  const handleAnimChange = useCallback((id: string, phase: "enter" | "exit" | "loop", field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => {
        if (l.id !== id) return l;
        const currentPhase = l.animation?.[phase] || {};
        return { ...l, animation: { ...l.animation, [phase]: { ...currentPhase, [field]: value } } };
      }),
    }));
  }, []);

  const handleBeatReactChange = useCallback((id: string, field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => {
        if (l.id !== id) return l;
        const current = l.animation?.beatReact || {};
        return { ...l, animation: { ...l.animation, beatReact: { ...current, [field]: value } } };
      }),
    }));
  }, []);

  if (!isOpen) return null;

  return (
    <div className="kt-modal-overlay" onClick={onClose}>
      <div className="kt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kt-modal-header">
          <div className="kt-modal-title-row">
            <FileJson size={18} />
            <h2 className="kt-modal-title">Lyrics Editor{trackName ? ` — ${trackName}` : ""}</h2>
          </div>
          <div className="kt-modal-actions">
            <button className="kt-btn kt-btn-sm" onClick={handleToggleJson} title={jsonMode ? "Visual Editor" : "JSON Editor"}>
              {jsonMode ? <><Eye size={14} /> Visual</> : <><FileJson size={14} /> JSON</>}
            </button>
            <button className="kt-btn kt-btn-sm" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="kt-errors">
            {errors.map((e, i) => <div key={i} className="kt-error">{e}</div>)}
          </div>
        )}

        {jsonMode ? (
          <div className="kt-json-editor">
            <textarea
              className="kt-json-textarea"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
            />
            <div className="kt-json-actions">
              <button className="kt-btn" onClick={handleImportJson}>Import from JSON</button>
              <button className="kt-btn" onClick={() => setJsonText(exportLyricsToJSON(data))}>Format JSON</button>
            </div>
          </div>
        ) : (
          <>
            {/* Tab Navigation */}
            <div className="kt-tabs">
              <button
                className={`kt-tab ${activeTab === "lines" ? "active" : ""}`}
                onClick={() => setActiveTab("lines")}
              >
                Lines ({data.lines.length})
              </button>
              <button
                className={`kt-tab ${activeTab === "theme" ? "active" : ""}`}
                onClick={() => setActiveTab("theme")}
              >
                Colors
              </button>
              <button
                className={`kt-tab ${activeTab === "effects" ? "active" : ""}`}
                onClick={() => setActiveTab("effects")}
              >
                Effects
              </button>
            </div>

            <div className="kt-modal-body">
              {/* Lines Tab */}
              {activeTab === "lines" && (
                <div className="kt-lines-tab">
                  <div className="kt-lines-toolbar">
                    <button className="kt-btn kt-btn-primary" onClick={handleAddLine}>
                      <Plus size={14} /> Add Line
                    </button>
                    {isPlaying && (
                      <span className="kt-live-badge">
                        <Eye size={12} /> Live — {currentTime.toFixed(1)}s
                      </span>
                    )}
                  </div>

                  {data.lines.length === 0 ? (
                    <div className="kt-empty-state">
                      <p>No lyrics yet. Click "Add Line" to start.</p>
                      <p className="kt-empty-hint">Tip: Play the track and use the ⏱ button to capture exact timings.</p>
                    </div>
                  ) : (
                    <div className="kt-lines-list">
                      {data.lines.map((line, i) => (
                        <div key={line.id} className="kt-line-item">
                          <div className="kt-line-header">
                            <button className="kt-line-toggle" onClick={() => toggleLineExpanded(line.id)}>
                              {expandedLines.has(line.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <span className="kt-line-number">{i + 1}</span>
                            <div
                              className="kt-line-section-dot"
                              style={{ background: data.colorScheme?.[line.section] || "#808080" }}
                              title={line.section}
                            />
                            <input
                              className="kt-line-text-input"
                              value={line.text}
                              onChange={(e) => handleLineChange(line.id, "text", e.target.value)}
                              placeholder="Type lyric text..."
                            />
                            <span className="kt-line-time">
                              {line.start.toFixed(1)}s – {line.end.toFixed(1)}s
                            </span>
                            <button className="kt-line-delete" onClick={() => handleDeleteLine(line.id)} title="Delete line">
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {expandedLines.has(line.id) && (
                            <div className="kt-line-details">
                              {/* Timing with capture buttons */}
                              <div className="kt-detail-group">
                                <h4><Clock size={12} /> Timing</h4>
                                <div className="kt-detail-row">
                                  <label>Start</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={line.start}
                                    onChange={(e) => handleLineChange(line.id, "start", parseFloat(e.target.value) || 0)}
                                  />
                                  <button className="kt-btn kt-btn-xs" onClick={() => handleCaptureStart(line.id)} title="Set to current playback time">
                                    ⏱
                                  </button>
                                </div>
                                <div className="kt-detail-row">
                                  <label>End</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={line.end}
                                    onChange={(e) => handleLineChange(line.id, "end", parseFloat(e.target.value) || 0)}
                                  />
                                  <button className="kt-btn kt-btn-xs" onClick={() => handleCaptureEnd(line.id)} title="Set to current playback time">
                                    ⏱
                                  </button>
                                </div>
                                <div className="kt-detail-row">
                                  <label>Section</label>
                                  <select
                                    value={line.section}
                                    onChange={(e) => handleLineChange(line.id, "section", e.target.value)}
                                    className="kt-select-inline"
                                  >
                                    {Object.keys(data.colorScheme || {}).map((s) => (
                                      <option key={s} value={s}>{s}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {/* Animation (collapsed by default into a single row) */}
                              <div className="kt-detail-group">
                                <h4><Zap size={12} /> Animation</h4>
                                <div className="kt-detail-row">
                                  <label>Enter</label>
                                  <select
                                    value={line.animation?.enter?.type || "fadeInUp"}
                                    onChange={(e) => handleAnimChange(line.id, "enter", "type", e.target.value)}
                                  >
                                    {ANIMATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <label>Exit</label>
                                  <select
                                    value={line.animation?.exit?.type || "fadeOut"}
                                    onChange={(e) => handleAnimChange(line.id, "exit", "type", e.target.value)}
                                  >
                                    {EXIT_ANIMATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                <div className="kt-detail-row">
                                  <label>Loop</label>
                                  <select
                                    value={line.animation?.loop?.type || "none"}
                                    onChange={(e) => handleAnimChange(line.id, "loop", "type", e.target.value)}
                                  >
                                    {LOOP_ANIMATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                  <label>Intensity</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="1"
                                    value={line.animation?.loop?.intensity || 0.5}
                                    onChange={(e) => handleAnimChange(line.id, "loop", "intensity", parseFloat(e.target.value) || 0.5)}
                                  />
                                </div>
                              </div>

                              {/* Beat React */}
                              <div className="kt-detail-group">
                                <h4>Beat React</h4>
                                <div className="kt-detail-row">
                                  <label>Scale</label>
                                  <input
                                    type="range"
                                    min="0.5"
                                    max="2"
                                    step="0.1"
                                    value={line.animation?.beatReact?.scale || 1}
                                    onChange={(e) => handleBeatReactChange(line.id, "scale", parseFloat(e.target.value))}
                                  />
                                  <span className="kt-range-val">{(line.animation?.beatReact?.scale || 1).toFixed(1)}</span>
                                </div>
                                <div className="kt-detail-row">
                                  <label>Glow</label>
                                  <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={line.animation?.beatReact?.glow || 0.5}
                                    onChange={(e) => handleBeatReactChange(line.id, "glow", parseFloat(e.target.value))}
                                  />
                                  <span className="kt-range-val">{(line.animation?.beatReact?.glow || 0.5).toFixed(1)}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Colors Tab */}
              {activeTab === "theme" && (
                <div className="kt-theme-tab">
                  <div className="kt-section">
                    <div className="kt-section-header"><h3>Section Colors</h3></div>
                    <div className="kt-colors-grid">
                      {Object.entries(data.colorScheme || {}).map(([section, color]) => (
                        <div key={section} className="kt-color-row">
                          <input
                            type="color"
                            value={color}
                            onChange={(e) =>
                              setData((prev) => ({
                                ...prev,
                                colorScheme: { ...prev.colorScheme, [section]: e.target.value },
                              }))
                            }
                          />
                          <span className="kt-color-label">{section}</span>
                          <span className="kt-color-hex">{color}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Effects Tab */}
              {activeTab === "effects" && (
                <div className="kt-effects-tab">
                  <div className="kt-section">
                    <div className="kt-section-header"><h3>Global Effects</h3></div>
                    <div className="kt-toggles-grid">
                      {Object.entries(data.globalEffects || {}).map(([key, val]) => (
                        <label key={key} className="kt-toggle">
                          <input
                            type="checkbox"
                            checked={!!val}
                            onChange={(e) =>
                              setData((prev) => ({
                                ...prev,
                                globalEffects: { ...prev.globalEffects, [key]: e.target.checked },
                              }))
                            }
                          />
                          <span>{key}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="kt-modal-footer">
          <button className="kt-btn" onClick={onClose}>Cancel</button>
          <button className="kt-btn kt-btn-primary" onClick={handleSave}><Save size={14} /> Save Lyrics</button>
        </div>
      </div>
    </div>
  );
}
