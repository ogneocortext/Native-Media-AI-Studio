/**
 * StyleTemplateGallery - Visual style selection with preview thumbnails for music videos
 */

import React, { useState } from "react";
import { Check, Sparkles, Palette, Zap, Music, Disc, Flame, Droplets } from "lucide-react";

export interface StyleTemplate {
  id: string;
  name: string;
  description: string;
  category: "abstract" | "organic" | "geometric" | "energetic" | "atmospheric";
  prompt: string;
  negativePrompt?: string;
  colorScheme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  params: {
    motionStrength: number;
    complexity: number;
    beatReactivity: number;
  };
  icon: React.ReactNode;
  previewGradient: string;
}

export const defaultTemplates: StyleTemplate[] = [
  {
    id: "cyberpunk_neon",
    name: "Cyberpunk Neon",
    description: "Neon-lit cityscapes with synthwave aesthetics",
    category: "energetic",
    prompt:
      "cyberpunk cityscape, neon lights, synthwave aesthetic, glowing skyscrapers, purple and cyan colors, futuristic, 4k, highly detailed, cinematic lighting",
    negativePrompt: "blurry, low quality, daytime, natural lighting",
    colorScheme: {
      primary: "#00ffff",
      secondary: "#ff00ff",
      accent: "#ffff00",
      background: "#0a0a1a",
    },
    params: {
      motionStrength: 0.8,
      complexity: 0.9,
      beatReactivity: 0.9,
    },
    icon: <Zap size={20} />,
    previewGradient: "linear-gradient(135deg, #00ffff 0%, #ff00ff 100%)",
  },
  {
    id: "organic_flow",
    name: "Organic Flow",
    description: "Fluid, nature-inspired movements and forms",
    category: "organic",
    prompt:
      "flowing organic forms, nature inspired, water waves, smoke trails, earth tones, peaceful, flowing energy, gentle colors, 4k, ethereal",
    negativePrompt: "sharp edges, mechanical, geometric, harsh colors",
    colorScheme: {
      primary: "#22c55e",
      secondary: "#14b8a6",
      accent: "#f59e0b",
      background: "#0f1a0f",
    },
    params: {
      motionStrength: 0.4,
      complexity: 0.6,
      beatReactivity: 0.5,
    },
    icon: <Droplets size={20} />,
    previewGradient: "linear-gradient(135deg, #22c55e 0%, #14b8a6 50%, #f59e0b 100%)",
  },
  {
    id: "geometric_pulse",
    name: "Geometric Pulse",
    description: "Sharp geometric shapes that pulse to the beat",
    category: "geometric",
    prompt:
      "geometric shapes, triangles, squares, hexagons, pulsing to beat, sharp edges, minimal, black background, neon outlines, 4k, precise",
    negativePrompt: "organic, blurry, soft edges, nature",
    colorScheme: {
      primary: "#6366f1",
      secondary: "#a855f7",
      accent: "#ec4899",
      background: "#050510",
    },
    params: {
      motionStrength: 0.7,
      complexity: 0.8,
      beatReactivity: 1.0,
    },
    icon: <Palette size={20} />,
    previewGradient: "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
  },
  {
    id: "particle_dance",
    name: "Particle Dance",
    description: "Swirling particles that react to audio frequencies",
    category: "abstract",
    prompt:
      "swirling particles, particle system, bokeh effect, depth of field, thousands of particles, golden ratio spiral, magical, 4k, volumetric lighting",
    colorScheme: {
      primary: "#fbbf24",
      secondary: "#f59e0b",
      accent: "#ffffff",
      background: "#0a0a0a",
    },
    params: {
      motionStrength: 0.6,
      complexity: 0.9,
      beatReactivity: 0.8,
    },
    icon: <Sparkles size={20} />,
    previewGradient: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #ffffff 100%)",
  },
  {
    id: "vinyl_retro",
    name: "Vinyl Retro",
    description: "Vintage vinyl record style with classic aesthetics",
    category: "atmospheric",
    prompt:
      "vinyl record spinning, retro aesthetic, vintage colors, warm tones, analog feel, grain texture, 1970s style, 4k, nostalgic",
    negativePrompt: "modern, digital, cold colors, futuristic",
    colorScheme: {
      primary: "#d4a574",
      secondary: "#8b7355",
      accent: "#c2410c",
      background: "#1a1510",
    },
    params: {
      motionStrength: 0.3,
      complexity: 0.5,
      beatReactivity: 0.6,
    },
    icon: <Disc size={20} />,
    previewGradient: "linear-gradient(135deg, #d4a574 0%, #8b7355 50%, #c2410c 100%)",
  },
  {
    id: "waveform_classic",
    name: "Waveform Classic",
    description: "Classic oscilloscope and waveform visualization",
    category: "geometric",
    prompt:
      "oscilloscope waveform, green phosphor, crt monitor effect, retro tech, audio waveform, electronic, 4k, clean, minimal",
    colorScheme: {
      primary: "#4ade80",
      secondary: "#22c55e",
      accent: "#16a34a",
      background: "#001a00",
    },
    params: {
      motionStrength: 0.5,
      complexity: 0.4,
      beatReactivity: 1.0,
    },
    icon: <Music size={20} />,
    previewGradient: "linear-gradient(135deg, #4ade80 0%, #22c55e 100%)",
  },
  {
    id: "fire_energy",
    name: "Fire Energy",
    description: "Dynamic flames and heat visualizations",
    category: "energetic",
    prompt:
      "dynamic flames, fire particles, heat distortion, orange and red colors, energy, intense, powerful, 4k, dramatic lighting",
    colorScheme: {
      primary: "#f97316",
      secondary: "#ef4444",
      accent: "#fbbf24",
      background: "#1a0500",
    },
    params: {
      motionStrength: 0.9,
      complexity: 0.8,
      beatReactivity: 0.9,
    },
    icon: <Flame size={20} />,
    previewGradient: "linear-gradient(135deg, #f97316 0%, #ef4444 50%, #fbbf24 100%)",
  },
];

interface StyleTemplateGalleryProps {
  selectedTemplate: StyleTemplate | null;
  onSelect: (template: StyleTemplate) => void;
  templates?: StyleTemplate[];
}

export function StyleTemplateGallery({
  selectedTemplate,
  onSelect,
  templates = defaultTemplates,
}: StyleTemplateGalleryProps) {
  const [filterCategory, setFilterCategory] = useState<StyleTemplate["category"] | "all">("all");
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);

  const filteredTemplates =
    filterCategory === "all" ? templates : templates.filter((t) => t.category === filterCategory);

  const categories = ["all", "abstract", "organic", "geometric", "energetic", "atmospheric"] as const;

  return (
    <div className="space-y-4">
      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              filterCategory === cat
                ? "bg-primary text-primary-foreground"
                : "bg-background border border-border hover:border-primary"
            }`}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredTemplates.map((template) => {
          const isSelected = selectedTemplate?.id === template.id;
          const isHovered = hoveredTemplate === template.id;

          return (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              onMouseEnter={() => setHoveredTemplate(template.id)}
              onMouseLeave={() => setHoveredTemplate(null)}
              className={`relative group rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                isSelected
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {/* Preview background */}
              <div
                className="h-24 w-full relative"
                style={{ background: template.previewGradient }}
              >
                {/* Animated overlay on hover */}
                <div
                  className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
                    isHovered || isSelected ? "opacity-50" : "opacity-0"
                  }`}
                />

                {/* Icon */}
                <div className="absolute top-2 left-2 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white">
                  {template.icon}
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                    <Check size={14} />
                  </div>
                )}

                {/* Beat reactivity indicator */}
                <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-white/80">
                  <Zap size={12} />
                  {Math.round(template.params.beatReactivity * 100)}%
                </div>
              </div>

              {/* Info */}
              <div className="p-3 bg-card text-left">
                <h4 className="font-medium text-sm">{template.name}</h4>
                <p className="text-xs text-muted mt-1 line-clamp-2">{template.description}</p>

                {/* Color dots */}
                <div className="flex items-center gap-1 mt-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: template.colorScheme.primary }}
                  />
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: template.colorScheme.secondary }}
                  />
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: template.colorScheme.accent }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected template details */}
      {selectedTemplate && (
        <div className="p-4 bg-background/50 rounded-lg border border-border space-y-3">
          <div className="flex items-start gap-3">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center text-white"
              style={{ background: selectedTemplate.previewGradient }}
            >
              {selectedTemplate.icon}
            </div>
            <div className="flex-1">
              <h4 className="font-medium">{selectedTemplate.name}</h4>
              <p className="text-sm text-muted">{selectedTemplate.description}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 bg-black/20 rounded">
              <span className="text-muted">Motion</span>
              <div className="font-medium">{Math.round(selectedTemplate.params.motionStrength * 100)}%</div>
            </div>
            <div className="p-2 bg-black/20 rounded">
              <span className="text-muted">Complexity</span>
              <div className="font-medium">{Math.round(selectedTemplate.params.complexity * 100)}%</div>
            </div>
            <div className="p-2 bg-black/20 rounded">
              <span className="text-muted">Reactivity</span>
              <div className="font-medium">{Math.round(selectedTemplate.params.beatReactivity * 100)}%</div>
            </div>
          </div>

          <div className="text-xs text-muted">
            <span className="font-medium text-foreground">Prompt: </span>
            {selectedTemplate.prompt}
          </div>
        </div>
      )}
    </div>
  );
}

export default StyleTemplateGallery;
