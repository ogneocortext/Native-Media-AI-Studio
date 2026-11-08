import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Music,
  Plus,
  Trash2,
  Save,
  Play,
  X,
  GripVertical,
  RotateCcw,
  RotateCw,
  Settings,
  Loader2,
  Zap,
  Piano,
  ListMusic,
} from "lucide-react";
import { getApiBase } from "../../../services/api/core";
import type { PluginInfo, Chain, ChainPlugin } from "../types";
import { useHistory } from "../hooks/useHistory";
import styles from "./VSTChainBuilder.module.css";

const api = getApiBase();

/* ------------------------------------------------------------------ */
/* Category Utilities                                                 */
/* ------------------------------------------------------------------ */

const CATEGORY_COLORS: Record<string, string> = {
  effect: "#00F0FF",
  instrument: "#FF2E88",
  midi: "#7B5CFF",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  effect: <Zap size={14} />,
  instrument: <Piano size={14} />,
  midi: <ListMusic size={14} />,
};

const getCategoryColor = (category: string): string => {
  return CATEGORY_COLORS[category] ?? "#00F0FF";
};

const getCategoryIcon = (category: string): React.ReactNode => {
  return CATEGORY_ICONS[category] ?? <Zap size={14} />;
};

/* ------------------------------------------------------------------ */
/* Component: VSTChainBuilder                                         */
/* ------------------------------------------------------------------ */

interface VSTChainBuilderProps {
  chain: Chain | null;
  plugins: PluginInfo[];
  onSave: (chain: Chain) => void;
  onDelete: () => void;
  onProcess: (chainName: string, inputPath?: string) => void;
  isProcessing: boolean;
  availableInputs: string[];
}

export const VSTChainBuilder = React.memo<VSTChainBuilderProps>(({
  chain,
  plugins,
  onSave,
  onDelete,
  onProcess,
  isProcessing,
  availableInputs,
}) => {
  const [chainName, setChainName] = useState(chain?.name ?? "");
  const [sampleRate, setSampleRate] = useState(chain?.sample_rate ?? 48000);
  const [blockSize, setBlockSize] = useState(chain?.block_size ?? 512);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [editingParamsFor, setEditingParamsFor] = useState<string | null>(null);
  const [pluginParams, setPluginParams] = useState<Record<string, number>>({});
  const [loadingParamsFor, setLoadingParamsFor] = useState<string | null>(null);
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragOverRef = useRef<Set<number>>(new Set());

  // Chain plugins state with history
  const initialPlugins = useMemo(() => chain?.plugins ?? [], [chain]);
  const { current: chainPlugins, push: pushHistory, undo, redo, canUndo, canRedo } = useHistory<
    ChainPlugin[]
  >(initialPlugins);

  // Sync chainPlugins with incoming chain prop
  useEffect(() => {
    if (chain) {
      pushHistory(chain.plugins);
    }
  }, [chain, pushHistory]);

  const handleAddPlugin = useCallback((plugin: PluginInfo) => {
    const newPlugin: ChainPlugin = {
      name: plugin.name,
      parameters: {},
    };
    pushHistory([...chainPlugins, newPlugin]);
    setShowPluginSelector(false);
  }, [chainPlugins, pushHistory]);

  const handleRemovePlugin = useCallback((index: number) => {
    pushHistory(chainPlugins.filter((_, i) => i !== index));
  }, [chainPlugins, pushHistory]);

  const handleReorderPlugins = useCallback((fromIndex: number, toIndex: number) => {
    const newPlugins = [...chainPlugins];
    const [removed] = newPlugins.splice(fromIndex, 1);
    newPlugins.splice(toIndex, 0, removed);
    pushHistory(newPlugins);
  }, [chainPlugins, pushHistory]);

  const handleLoadPluginParams = useCallback(async (pluginName: string, index: number) => {
    if (editingParamsFor === pluginName) {
      setEditingParamsFor(null);
      return;
    }
    setLoadingParamsFor(pluginName);
    try {
      const res = await fetch(`${api}/api/vst/plugins/${pluginName}/parameters`);
      const data = (await res.json()) as { parameters: { name: string; value: number }[] };
      const params: Record<string, number> = {};
      data.parameters.forEach(p => { params[p.name] = p.value; });
      setPluginParams(params);
      setEditingParamsFor(pluginName);
      // Also update the chain plugin's parameters
      const newPlugins = chainPlugins.map((p, i) =>
        i === index ? { ...p, parameters: params } : p
      );
      pushHistory(newPlugins);
    } catch (e) {
      console.error("Failed to load params:", e);
    } finally {
      setLoadingParamsFor(null);
    }
  }, [chainPlugins, editingParamsFor, pushHistory]);

  const handleParamInputChange = useCallback((paramName: string, value: number) => {
    setPluginParams(prev => ({ ...prev, [paramName]: value }));
  }, []);

  const handleSaveParamChanges = useCallback((pluginIndex: number) => {
    const newPlugins = chainPlugins.map((p, i) =>
      i === pluginIndex ? { ...p, parameters: pluginParams } : p
    );
    pushHistory(newPlugins);
    setEditingParamsFor(null);
  }, [chainPlugins, pluginParams, pushHistory]);

  const handleSaveChain = useCallback(() => {
    if (!chainName.trim()) return;
    const newChain: Chain = {
      name: chainName.trim(),
      plugins: chainPlugins,
      sample_rate: sampleRate,
      block_size: blockSize,
    };
    onSave(newChain);
  }, [chainName, chainPlugins, sampleRate, blockSize, onSave]);

  const handleProcess = useCallback(() => {
    if (!chainName.trim()) return;
    onProcess(chainName.trim(), selectedInput || undefined);
  }, [chainName, selectedInput, onProcess]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dragOverRef.current.add(index);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverRef.current.delete(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverRef.current.delete(index);
    if (draggedIndex !== null && draggedIndex !== index) {
      handleReorderPlugins(draggedIndex, index);
    }
    setDraggedIndex(null);
  }, [draggedIndex, handleReorderPlugins]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    dragOverRef.current.clear();
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  if (!chain) {
    return (
      <div className={styles.emptyState}>
        <Music size={48} className={styles.emptyIcon} />
        <p className={styles.emptyText}>No chain selected</p>
        <p className={styles.emptySubtext}>
          Select a chain from the list or create a new one by adding plugins
        </p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Chain Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <input
            type="text"
            value={chainName}
            onChange={(e) => setChainName(e.target.value)}
            placeholder="Chain name"
            className={styles.nameInput}
          />
          <div className={styles.chainMeta}>
            <select
              value={sampleRate}
              onChange={(e) => setSampleRate(Number(e.target.value))}
              className={styles.select}
            >
              <option value={44100}>44.1 kHz</option>
              <option value={48000}>48 kHz</option>
              <option value={88200}>88.2 kHz</option>
              <option value={96000}>96 kHz</option>
            </select>
            <select
              value={blockSize}
              onChange={(e) => setBlockSize(Number(e.target.value))}
              className={styles.select}
            >
              <option value={128}>128</option>
              <option value={256}>256</option>
              <option value={512}>512</option>
              <option value={1024}>1024</option>
              <option value={2048}>2048</option>
            </select>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.historyControls}>
            <button
              onClick={undo}
              disabled={!canUndo}
              className={styles.iconBtn}
              title="Undo (Ctrl+Z)"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className={styles.iconBtn}
              title="Redo (Ctrl+Shift+Z)"
            >
              <RotateCw size={16} />
            </button>
          </div>
          <button onClick={onDelete} className={`${styles.iconBtn} ${styles.dangerBtn}`} title="Delete Chain">
            <Trash2 size={16} />
          </button>
          <button onClick={handleSaveChain} className={styles.saveBtn} disabled={isProcessing}>
            <Save size={16} /> Save
          </button>
        </div>
      </div>

      {/* Plugin Selector Modal */}
      {showPluginSelector && (
        <div className={styles.modalOverlay} onClick={() => setShowPluginSelector(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Add Plugin to Chain</h3>
              <button onClick={() => setShowPluginSelector(false)} className={styles.modalClose}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.modalContent}>
              {plugins.length === 0 ? (
                <p className={styles.emptyText}>No plugins available. Scan for VST3 plugins first.</p>
              ) : (
                plugins.map((plugin) => (
                  <button
                    key={plugin.name}
                    onClick={() => handleAddPlugin(plugin)}
                    className={styles.pluginOption}
                  >
                    <div
                      className={styles.pluginOptionIcon}
                      style={{
                        background: `${getCategoryColor(plugin.category)}22`,
                        borderColor: `${getCategoryColor(plugin.category)}44`,
                      }}
                    >
                      {getCategoryIcon(plugin.category)}
                    </div>
                    <div className={styles.pluginOptionInfo}>
                      <span className={styles.pluginOptionName}>{plugin.name}</span>
                      <span
                        className={styles.pluginOptionCategory}
                        style={{
                          background: `${getCategoryColor(plugin.category)}33`,
                          color: getCategoryColor(plugin.category),
                          borderColor: `${getCategoryColor(plugin.category)}55`,
                        }}
                      >
                        {plugin.category}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Plugin Chain */}
      <div className={styles.chainList}>
        {chainPlugins.length === 0 ? (
          <div className={styles.emptyDropZone} onClick={() => setShowPluginSelector(true)}>
            <Plus size={32} className={styles.emptyDropIcon} />
            <p className={styles.emptyDropText}>Click to add plugins to the chain</p>
            <p className={styles.emptyDropSubtext}>Drag to reorder • Click plugin to configure</p>
          </div>
        ) : (
          chainPlugins.map((chainPlugin, index) => {
            const plugin = plugins.find(p => p.name === chainPlugin.name);
            const isDragged = draggedIndex === index;
            const isDragOver = dragOverRef.current.has(index);

            return (
              <div
                key={`${chainPlugin.name}-${index}`}
                className={`${styles.chainItem} ${isDragged ? styles.dragging : ""} ${isDragOver ? styles.dragOver : ""}`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={(e) => handleDragLeave(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
              >
                <div className={styles.dragHandle} title="Drag to reorder">
                  <GripVertical size={16} />
                </div>
                <div className={styles.pluginInfo}>
                  {plugin && (
                    <div
                      className={styles.categoryBadge}
                      style={{
                        background: `${getCategoryColor(plugin.category)}22`,
                        borderColor: `${getCategoryColor(plugin.category)}44`,
                      }}
                    >
                      {getCategoryIcon(plugin.category)}
                    </div>
                  )}
                  <div className={styles.pluginDetails}>
                    <span className={styles.pluginName}>{chainPlugin.name}</span>
                    {plugin && (
                      <span
                        className={styles.pluginCategory}
                        style={{
                          background: `${getCategoryColor(plugin.category)}33`,
                          color: getCategoryColor(plugin.category),
                          borderColor: `${getCategoryColor(plugin.category)}55`,
                        }}
                      >
                        {plugin.category}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.pluginActions}>
                  {plugin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleLoadPluginParams(plugin.name, index);
                      }}
                      disabled={loadingParamsFor === plugin.name}
                      className={styles.iconBtn}
                      title="Load Parameters"
                    >
                      {loadingParamsFor === plugin.name ? (
                        <Loader2 size={14} className={styles.spinner} />
                      ) : (
                        <Settings size={14} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePlugin(index);
                    }}
                    className={`${styles.iconBtn} ${styles.dangerBtn}`}
                    title="Remove from Chain"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Parameter Editor */}
      {editingParamsFor && Object.keys(pluginParams).length > 0 && (
        <div className={styles.paramEditor}>
          <div className={styles.paramEditorHeader}>
            <h4>Parameters for {editingParamsFor}</h4>
            <div className={styles.paramEditorActions}>
              <button
                onClick={() => handleSaveParamChanges(
                  chainPlugins.findIndex(p => p.name === editingParamsFor)
                )}
                className={styles.saveBtn}
              >
                <Save size={14} /> Apply
              </button>
              <button
                onClick={() => setEditingParamsFor(null)}
                className={styles.iconBtn}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className={styles.paramList}>
            {Object.entries(pluginParams).map(([name, value]) => (
              <div key={name} className={styles.paramRow}>
                <label className={styles.paramLabel}>{name}</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={value}
                  onChange={(e) => handleParamInputChange(name, Number(e.target.value))}
                  className={styles.paramSlider}
                />
                <span className={styles.paramValue}>{value.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Process Section */}
      <div className={styles.processSection}>
        <div className={styles.processInputs}>
          <select
            value={selectedInput}
            onChange={(e) => setSelectedInput(e.target.value)}
            className={styles.select}
            disabled={isProcessing}
          >
            <option value="">Select input audio (optional)</option>
            {availableInputs.map((input) => (
              <option key={input} value={input}>{input.split("/").pop()}</option>
            ))}
          </select>
          <button
            onClick={handleProcess}
            disabled={isProcessing || !chainName.trim()}
            className={styles.processBtn}
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className={styles.spinner} />
                Processing...
              </>
            ) : (
              <>
                <Play size={16} />
                Process Audio
              </>
            )}
          </button>
        </div>
      </div>

      {/* Add Plugin Button */}
      <button
        onClick={() => setShowPluginSelector(true)}
        className={styles.addPluginBtn}
        disabled={isProcessing}
      >
        <Plus size={16} />
        Add Plugin to Chain
      </button>
    </div>
  );
});

VSTChainBuilder.displayName = "VSTChainBuilder";