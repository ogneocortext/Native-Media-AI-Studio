import { useState, useEffect } from "react";
import {
  Cpu,
  Music,
  FolderOpen,
  FileAudio,
  Sparkles,
  PlugZap,
} from "lucide-react";
import { getApiBase } from "../../services/api/core";
import { DS } from "../../styles/designSystem";
import { Card } from "../../components/common";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { VSTPluginCard } from "./components/VSTPluginCard";
import { VSTChainBuilder } from "./components/VSTChainBuilder";
import type { PluginInfo, Chain, ProcessResult } from "./types";
import styles from "./VSTPage.module.css";

export const fmtTime = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const api = getApiBase();

export function VSTPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null);
  const [selectedChain, setSelectedChain] = useState<Chain | null>(null);
  const [activeTab, setActiveTab] = useState<"plugins" | "chains" | "presets">("plugins");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingChain, setProcessingChain] = useState<string | null>(null);
  const [availableInputs, setAvailableInputs] = useState<string[]>([]);
  const [processingResult, setProcessingResult] = useState<ProcessResult | null>(null);

  void chains;
  void processingChain;

  const { refresh: refreshAudioLibrary } = useAudioLibrary();

  useEffect(() => {
    void loadAll();
  }, []);

  const loadAll = async (): Promise<void> => {
    setLoading(true);
    try {
      const [pluginsRes, chainsRes] = await Promise.all([
        fetch(`${api}/api/vst/plugins`).then(async (r) => (await r.json()) as { plugins: PluginInfo[] }),
        fetch(`${api}/api/vst/chains`).then(async (r) => (await r.json()) as { chains: Chain[] }),
      ]);
      setPlugins(pluginsRes.plugins);
      setChains(chainsRes.chains);
    } catch (e) {
      console.error("Failed to load VST data:", e);
    } finally {
      setLoading(false);
    }
  };

  const scanPlugins = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch(`${api}/api/vst/scan`, { method: "GET" });
      const data = await res.json() as { plugins: PluginInfo[] };
      setPlugins(data.plugins);
    } catch (e) {
      console.error("Scan failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChain = async (chain: Chain) => {
    try {
      const res = await fetch(`${api}/api/vst/chains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chain),
      });
      const saved = await res.json() as Chain;
      setChains(prev => [...prev.filter(c => c.name !== chain.name), saved]);
      setSelectedChain(saved);
    } catch (e) {
      console.error("Save chain failed:", e);
    }
  };

  const handleDeleteChain = async () => {
    if (!selectedChain) return;
    try {
      await fetch(`${api}/api/vst/chains/${selectedChain.name}`, { method: "DELETE" });
      setChains(prev => prev.filter(c => c.name !== selectedChain.name));
      setSelectedChain(null);
    } catch (e) {
      console.error("Delete chain failed:", e);
    }
  };

  const handleProcessChain = async (chainName: string, inputPath?: string) => {
    setProcessing(true);
    setProcessingChain(chainName);
    try {
      const res = await fetch(`${api}/api/vst/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain_name: chainName, input_path: inputPath }),
      });
      const result = await res.json() as ProcessResult;
      setProcessingResult(result);
      await refreshAudioLibrary();
      await refreshInputs();
    } catch (e) {
      console.error("Process failed:", e);
    } finally {
      setProcessing(false);
      setProcessingChain(null);
    }
  };

  const refreshInputs = async () => {
    try {
      const res = await fetch(`${api}/api/audio/files`);
      const data = await res.json() as { files: { relative_path: string; filename: string }[] };
      // /api/vst/process resolves input_path under output/, so prefix the
      // audio-dir-relative path with "audio/".
      setAvailableInputs(data.files.map(f => `audio/${f.relative_path}`));
    } catch (e) {
      console.error("Failed to refresh inputs:", e);
    }
  };

  const handlePluginSelect = (plugin: PluginInfo) => {
    setSelectedPlugin(plugin);
  };

  const handleLoadParams = (_plugin: PluginInfo) => {
    // Params are loaded inline in the plugin card
  };

  const tabs: { id: "plugins" | "chains" | "presets"; label: string; icon: React.ReactNode }[] = [
    { id: "plugins", label: "Plugins", icon: <PlugZap size={16} /> },
    { id: "chains", label: "Chains", icon: <Music size={16} /> },
    { id: "presets", label: "Presets", icon: <Sparkles size={16} /> },
  ];

  return (
    <div className={DS.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Cpu size={24} className="text-accent" />
            VST Host
          </h1>
          <p className={styles.subtitle}>
            Load VST3 plugins, build chains, process audio - AI-powered sound design
          </p>
        </div>
        <button
          onClick={() => void scanPlugins()}
          disabled={loading}
          className={styles.scanBtn}
        >
          <FolderOpen size={14} />
          {loading ? <div className={styles.spinner} /> : <Sparkles size={14} />}
          Scan VST3
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "plugins" && (
        <div className={styles.pluginGrid}>
          {plugins.length === 0 ? (
            <div className={styles.emptyState}>
              <PlugZap size={48} className={styles.emptyIcon} />
              <p className={styles.emptyText}>No plugins found</p>
              <p className={styles.emptySubtext}>Click "Scan VST3" to discover plugins</p>
            </div>
          ) : (
            plugins.map(plugin => (
              <VSTPluginCard
                key={plugin.name}
                plugin={plugin}
                onSelect={handlePluginSelect}
                onLoadParams={handleLoadParams}
                isSelected={selectedPlugin?.name === plugin.name}
              />
            ))
          )}
        </div>
      )}

      {activeTab === "chains" && (
        <VSTChainBuilder
          chain={selectedChain}
          plugins={plugins}
          onSave={(c) => void handleSaveChain(c)}
          onDelete={() => void handleDeleteChain()}
          onProcess={(name, input) => void handleProcessChain(name, input)}
          isProcessing={processing}
          availableInputs={availableInputs}
        />
      )}

      {activeTab === "presets" && (
        <div className="space-y-4">
          <p className={DS.textSm}>
            Preset management - select a plugin in the Plugins tab to manage its presets
          </p>
          {selectedPlugin && (
            <Card title={`Presets for ${selectedPlugin.name}`} icon={<Sparkles size={18} />}>
              {null}
            </Card>
          )}
        </div>
      )}

      {/* Processing Result */}
      {processingResult && (
        <Card title="Processing Result" icon={<FileAudio size={18} />} className={styles.resultCard}>
          <div className={styles.resultGrid}>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Output</span>
              <a
                href={`/api/audio/file/${processingResult.output_path.replace(/^.*output[\\/]audio[\\/]/, '')}`}
                target="_blank"
                rel="noopener"
                className={styles.resultValueCyan}
              >
                {processingResult.output_path.split('/').pop()}
              </a>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Duration</span>
              <span className={styles.resultValue}>
                {fmtTime(processingResult.duration)}
              </span>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Sample Rate</span>
              <span className={styles.resultValue}>
                {processingResult.sample_rate} Hz
              </span>
            </div>
            <div className={styles.resultItem}>
              <span className={styles.resultLabel}>Channels</span>
              <span className={styles.resultValue}>
                {processingResult.channels}
              </span>
            </div>
          </div>
          <audio controls src={`/api/audio/file/${processingResult.output_path.replace(/^.*output[\\/]audio[\\/]/, '')}`} className={styles.audioPlayer} />
        </Card>
      )}
    </div>
  );
}