import React, { useState, useCallback } from "react";
import {
  PlugZap,
  Plus,
  Settings,
  X,
  Zap,
  Piano,
  ListMusic,
} from "lucide-react";
import { getApiBase } from "../../../services/api/core";
import type { PluginInfo, PluginParameter } from "../types";
import styles from "./VSTPluginCard.module.css";

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

export const getCategoryColor = (category: string): string => {
  return CATEGORY_COLORS[category] ?? "#00F0FF";
};

export const getCategoryIcon = (category: string): React.ReactNode => {
  return CATEGORY_ICONS[category] ?? <PlugZap size={14} />;
};

/* ------------------------------------------------------------------ */
/* Component: VSTPluginCard                                           */
/* ------------------------------------------------------------------ */

interface VSTPluginCardProps {
  plugin: PluginInfo;
  onSelect: (plugin: PluginInfo) => void;
  onLoadParams: (plugin: PluginInfo) => void;
  isSelected: boolean;
}

export const VSTPluginCard = React.memo<VSTPluginCardProps>(({
  plugin,
  onSelect,
  onLoadParams,
  isSelected,
}) => {
  const [showParams, setShowParams] = useState(false);
  const [params, setParams] = useState<PluginParameter[]>([]);
  const [loadingParams, setLoadingParams] = useState(false);

  const handleLoadParams = useCallback(async () => {
    if (params.length > 0) {
      setShowParams(!showParams);
      return;
    }
    setLoadingParams(true);
    try {
      const res = await fetch(`${api}/api/vst/plugins/${plugin.name}/parameters`);
      const data = await res.json() as { parameters: PluginParameter[] };
      setParams(data.parameters);
      setShowParams(true);
    } catch (e) {
      console.error("Failed to load params:", e);
    } finally {
      setLoadingParams(false);
    }
  }, [plugin.name, params.length, showParams]);

  const cardClass = isSelected ? styles.cardSelected : styles.card;

  return (
    <div
      onClick={() => onSelect(plugin)}
      className={cardClass}
    >
      <div className={styles.header}>
        <div className={styles.mainInfo}>
          <div className={styles.iconWrapper}>
            {getCategoryIcon(plugin.category)}
          </div>
          <div className={styles.pluginDetails}>
            <div className={styles.nameRow}>
              <span className={styles.name}>{plugin.name}</span>
              <span
                className={styles.categoryBadge}
                style={{
                  background: `${getCategoryColor(plugin.category)}33`,
                  color: getCategoryColor(plugin.category),
                  border: `1px solid ${getCategoryColor(plugin.category)}55`,
                }}
              >
                {plugin.category}
              </span>
              {!plugin.is_valid && (
                <span className={styles.errorBadge}>
                  Error
                </span>
              )}
            </div>
            <div className={styles.vendor}>
              {plugin.vendor} {plugin.version && `v${plugin.version}`}
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaItem}>
                <span>I/O:</span>
                <span className={styles.metaValue}>{plugin.num_inputs}→{plugin.num_outputs}</span>
              </span>
              <span className={styles.metaItem}>
                <span>Params:</span>
                <span className={styles.metaValue}>{plugin.parameters.length}</span>
              </span>
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            onClick={(e) => { e.stopPropagation(); void handleLoadParams(); }}
            disabled={loadingParams}
            className={styles.iconBtn}
            title="Load Parameters"
          >
            {loadingParams ? <div className={styles.spinner} /> : <Settings size={14} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onLoadParams(plugin); }}
            className={`${styles.iconBtn} ${styles.iconBtnViolet}`}
            title="Add to Chain"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      {showParams && params.length > 0 && (
        <div className={styles.paramsSection}>
          <div className={styles.paramsHeader}>
            <span className={styles.paramsTitle}>
              Parameters ({params.length})
            </span>
            <button
              onClick={() => setShowParams(false)}
              className={styles.closeBtn}
            >
              <X size={12} />
            </button>
          </div>
          <div className={styles.paramsList}>
            {params.map((param) => (
              <div key={param.name} className={styles.paramRow}>
                <div className={styles.paramLabelRow}>
                  <span className={styles.paramName}>{param.name}</span>
                  <span className={styles.paramValue}>
                    {param.value.toFixed(param.unit === "dB" ? 1 : 3)} {param.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={(param.max - param.min) / 1000}
                  value={param.value}
                  className={styles.paramSlider}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

VSTPluginCard.displayName = "VSTPluginCard";