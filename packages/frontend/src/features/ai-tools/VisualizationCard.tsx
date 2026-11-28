/**
 * VisualizationCard — renders an AI-generated visualization config inside a card.
 *
 * Extracted from AIToolsPage.tsx. Presentational: takes a config and renders
 * the VisualizationCanvas behind a Suspense boundary.
 */

import { Suspense } from "react";
import { Palette } from "lucide-react";
import { DS } from "../../styles/designSystem";
import { VisualizationCanvas } from "./VisualizationCanvas";
import type { VisualizationConfig } from "./VisualizationCanvas";

interface VisualizationCardProps {
  config: VisualizationConfig | null;
}

export function VisualizationCard({ config }: VisualizationCardProps) {
  if (!config) return null;

  return (
    <div className={DS.card}>
      <div className={DS.flexCenter + " mb-3"}>
        <Palette size={16} className="text-purple-400" />
        <span className={DS.textBold}>Visualization</span>
      </div>
      <Suspense
        fallback={
          <div className="viz-canvas-placeholder" style={{ width: 400, height: 300 }}>
            <p>Rendering visualization…</p>
          </div>
        }
      >
        <VisualizationCanvas config={config} width={400} height={300} />
      </Suspense>
    </div>
  );
}
