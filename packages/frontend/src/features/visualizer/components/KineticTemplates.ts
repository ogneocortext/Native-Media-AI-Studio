/**
 * Kinetic Typography Templates
 * CSS-based text animation effects for lyric displays.
 * Each template provides a different visual style for rendering
 * synced lyrics over the 3D visualization.
 */
export const kineticTemplates = {
  /**
   * FADE_REVEAL — Words fade in sequentially with subtle scale
   */
  fadeReveal: {
    name: "Fade Reveal",
    description: "Words gently fade and scale into view",
    wordClass: "kinetic-word-fade",
    containerClass: "kinetic-container-fade",
  },

  /**
   * BEAT_PULSE — Text pulses on each beat
   */
  beatPulse: {
    name: "Beat Pulse",
    description: "Text scales with the beat",
    wordClass: "kinetic-word-pulse",
    containerClass: "kinetic-container-pulse",
  },

  /**
   * SLIDE_UP — Lines slide up from below
   */
  slideUp: {
    name: "Slide Up",
    description: "Lyric lines slide up into position",
    wordClass: "kinetic-word-slide",
    containerClass: "kinetic-container-slide",
  },

  /**
   * GLOW_REVEAL — Neon glow with word-by-word reveal
   */
  glowReveal: {
    name: "Glow Reveal",
    description: "Neon glow effect with sequential word reveal",
    wordClass: "kinetic-word-glow",
    containerClass: "kinetic-container-glow",
  },

  /**
   * TYPEWRITER — Character-by-character typing effect
   */
  typewriter: {
    name: "Typewriter",
    description: "Characters appear one at a time",
    wordClass: "kinetic-word-typewriter",
    containerClass: "kinetic-container-typewriter",
  },
} as const;

export type KineticTemplateId = keyof typeof kineticTemplates;

export const kineticTemplateList = Object.entries(kineticTemplates).map(([id, t]) => ({
  id: id as KineticTemplateId,
  name: t.name,
  description: t.description,
}));
