/**
 * Scene design guidelines extracted from production docs.
 * These rules come from MINDFUL_LAYERING_2026.md and VISUAL_STORYTELLING_2026.md
 */

export interface SceneGuidelines {
  motion: {
    maxFocalPerShot: number;
    durationMs: { min: number; max: number };
    easingTokens: Record<string, string>;
    properties: string[];
    budgetMs: number;
  };
  layers: {
    max: number;
    hierarchy: string[];
  };
  color: {
    dominantMaxPercent: number;
    accentMaxPercent: number;
  };
  typography: {
    maxFamilies: number;
    maxLevels: number;
  };
  transitions: {
    maxTypes: number;
  };
  depth: {
    layers: string[];
  };
}

export const SCENE_GUIDELINES: SceneGuidelines = {
  motion: {
    maxFocalPerShot: 3,
    durationMs: { min: 150, max: 500 },
    easingTokens: {
      enter: "cubic-bezier(0, 0, 0.2, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
      standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    },
    properties: ["opacity", "translate", "scale", "rotate", "filter: blur()"],
    budgetMs: 800,
  },
  layers: {
    max: 3,
    hierarchy: ["primary", "secondary", "ambient"],
  },
  color: {
    dominantMaxPercent: 70,
    accentMaxPercent: 20,
  },
  typography: {
    maxFamilies: 2,
    maxLevels: 3,
  },
  transitions: {
    maxTypes: 2,
  },
  depth: {
    layers: ["foreground", "midground", "background"],
  },
};

export function getGuidelinesPrompt(): string {
  return `
## Scene Design Guidelines (MUST FOLLOW)

### Motion Budget
- Max ${SCENE_GUIDELINES.motion.maxFocalPerShot} focal movements per shot
- Animation duration: ${SCENE_GUIDELINES.motion.durationMs.min}-${SCENE_GUIDELINES.motion.durationMs.max}ms, never >${SCENE_GUIDELINES.motion.durationMs.max}ms
- Total motion per shot budget: <${SCENE_GUIDELINES.motion.budgetMs}ms
- Only animate: ${SCENE_GUIDELINES.motion.properties.join(", ")}

### Layer Hierarchy (max ${SCENE_GUIDELINES.layers.max} focal)
- Primary: 1 element (moves first, most prominent)
- Secondary: 1 element (starts after primary, lower weight)
- Ambient: 0-1 elements (background, never competes)

### Depth Layers
- Foreground: sharp (text, HUD, particles)
- Midground: subject (character, hero object, crystal)
- Background: blurred, desaturated (scenery, haze)

### Color Budget
- Dominant color: ≤${SCENE_GUIDELINES.color.dominantMaxPercent}% of frame
- Accent color: ≤${SCENE_GUIDELINES.color.accentMaxPercent}% of frame

### Typography
- Max ${SCENE_GUIDELINES.typography.maxFamilies} font families
- Max ${SCENE_GUIDELINES.typography.maxLevels} size levels

### Transitions
- Max ${SCENE_GUIDELINES.transitions.maxTypes} transition types per project
- Use: cut (hard, on snare) OR soft wipe (0.9s ease-out at section boundaries)

### Keyframe Rules
- Each object: 1 primary motion idea, staggered 2-4 frames
- Durations: 6-12f micro, 12-20f text, never >500ms
- Use interpolate with easing bezier, not sin() functions
- Max 3 simultaneous animated properties per object
`;
}
