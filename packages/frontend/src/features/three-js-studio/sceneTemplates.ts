/**
 * Scene Templates — pre-built music video scenes
 *
 * Each template is a complete preset: mesh layouts, particle config,
 * camera defaults, and post-fx tuning. The studio applies a template by
 * replacing the current `objects` and `particleConfig` state, so the user
 * can load a polished-looking scene in one click and then tweak it like
 * any other object.
 *
 * Music-video-focused templates:
 *  - Concert Stage: spotlight rig with hero object + orbiting spotlights
 *  - Cosmic Void: hero object floating in space with dust particles
 *  - Equalizer Wall: 32 vertical bars that respond to the audio (special
 *    "bars" type that the animation loop scales per-frame)
 *  - Geometric City: grid of glowing pillars that pulse on the beat
 *  - Vinyl Spin: turntable + hero object (album cover / center art)
 */

import type { AnimObject, ParticleConfig, SceneConfig, CameraMode } from "./types";

export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  /** Object list to load. The animation loop handles the standard `type`
   *  values (box/sphere/etc.). The special type `bars` is a custom mini-primitive
   *  rendered by the studio for equalizer-style scenes. */
  objects: AnimObject[];
  particleConfig: ParticleConfig;
  cameraMode: CameraMode;
  sceneConfig: Partial<SceneConfig>;
  /** Optional: a special audio-driven mode for templates with reactive
   *  primitives (equalizer bars, geometric city). When set, the animation
   *  loop reads live audio FFT (bass/treble) and modulates this field
   *  per object per frame. */
  audioDriven?: "bars" | "pillars" | "pulse";
}

// ----------------------------------------------------------------------------
// Shared template helpers
// ----------------------------------------------------------------------------

/**
 * Build N evenly-spaced vertical "bars" objects for equalizer / pillar
 * scenes. Each bar is a tall box centered at the origin and offset along
 * the X axis. They animate to live audio bass when `audioDriven: "bars"`.
 */
function buildBars(count: number, opts: { color: string; emissive: string; y?: number; gap?: number }): AnimObject[] {
  const gap = opts.gap ?? 0.18;
  const y = opts.y ?? 0;
  const totalWidth = (count - 1) * gap;
  return Array.from({ length: count }, (_, i) => {
    const x = i * gap - totalWidth / 2;
    return {
      id: `bar-${i}`,
      name: `Bar ${i + 1}`,
      type: "bars" as any, // special type — see animation loop
      position: [x, y, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: opts.color,
      metalness: 0.3,
      roughness: 0.4,
      emissive: opts.emissive,
      emissiveIntensity: 1.2,
      visible: true,
      bobSpeed: 0,
      bobAmount: 0,
      rotateSpeed: 0,
      bloom: true,
    };
  });
}

// ----------------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------------

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: "concert",
    name: "Concert Stage",
    description: "Hero object on a lit stage with orbital spotlights",
    emoji: "🎤",
    objects: [
      {
        id: "stage-floor",
        name: "Stage Floor",
        type: "cylinder",
        position: [0, -0.5, 0],
        rotation: [0, 0, 0],
        scale: [8, 0.1, 8],
        color: "#1a1a24",
        metalness: 0.4,
        roughness: 0.6,
        emissive: "#220033",
        emissiveIntensity: 0.2,
        visible: true,
        bobSpeed: 0,
        bobAmount: 0,
        rotateSpeed: 0,
        bloom: false,
      },
      {
        id: "hero",
        name: "Hero",
        type: "crown",
        position: [0, 1.5, 0],
        rotation: [0, 0, 0],
        scale: [1.2, 1.2, 1.2],
        color: "#ffd700",
        metalness: 0.9,
        roughness: 0.1,
        emissive: "#ff8c00",
        emissiveIntensity: 0.6,
        visible: true,
        bobSpeed: 1.0,
        bobAmount: 0.15,
        rotateSpeed: 0.5,
        bloom: true,
      },
      {
        id: "spot-1",
        name: "Spotlight L",
        type: "sphere",
        position: [-3.5, 4, 2],
        rotation: [0, 0, 0],
        scale: [0.3, 0.3, 0.3],
        color: "#ff3399",
        metalness: 0,
        roughness: 1,
        emissive: "#ff3399",
        emissiveIntensity: 2.5,
        visible: true,
        bobSpeed: 0.7,
        bobAmount: 0.2,
        rotateSpeed: 1.2,
        bloom: true,
      },
      {
        id: "spot-2",
        name: "Spotlight R",
        type: "sphere",
        position: [3.5, 4, 2],
        rotation: [0, 0, 0],
        scale: [0.3, 0.3, 0.3],
        color: "#3399ff",
        metalness: 0,
        roughness: 1,
        emissive: "#3399ff",
        emissiveIntensity: 2.5,
        visible: true,
        bobSpeed: 0.7,
        bobAmount: 0.2,
        rotateSpeed: -1.2,
        bloom: true,
      },
      {
        id: "spot-3",
        name: "Spotlight Back",
        type: "sphere",
        position: [0, 4, -3.5],
        rotation: [0, 0, 0],
        scale: [0.3, 0.3, 0.3],
        color: "#ffffff",
        metalness: 0,
        roughness: 1,
        emissive: "#ffffff",
        emissiveIntensity: 2,
        visible: true,
        bobSpeed: 0.5,
        bobAmount: 0.15,
        rotateSpeed: 0.8,
        bloom: true,
      },
    ],
    particleConfig: { enabled: true, count: 200, size: 0.02, color: "#ff66cc", spread: 6, speed: 0.4, opacity: 0.7 },
    cameraMode: "orbit",
    sceneConfig: { fogDensity: 0.018, bloomStrength: 0.9, vignetteStrength: 0.6 },
  },
  {
    id: "cosmic-void",
    name: "Cosmic Void",
    description: "Lone object floating in deep space with dust particles",
    emoji: "🌌",
    objects: [
      {
        id: "planet",
        name: "Planet",
        type: "sphere",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1.8, 1.8, 1.8],
        color: "#4466ff",
        metalness: 0.6,
        roughness: 0.3,
        emissive: "#1133aa",
        emissiveIntensity: 0.4,
        visible: true,
        bobSpeed: 0.4,
        bobAmount: 0.1,
        rotateSpeed: 0.3,
        bloom: true,
      },
      {
        id: "ring-1",
        name: "Ring",
        type: "torus",
        position: [0, 0, 0],
        rotation: [1.5, 0, 0],
        scale: [3, 3, 0.3],
        color: "#ffaa33",
        metalness: 0.8,
        roughness: 0.2,
        emissive: "#ff7700",
        emissiveIntensity: 0.6,
        visible: true,
        bobSpeed: 0,
        bobAmount: 0,
        rotateSpeed: 0.2,
        bloom: true,
      },
    ],
    particleConfig: { enabled: true, count: 400, size: 0.03, color: "#ffffff", spread: 10, speed: 0.05, opacity: 0.6 },
    cameraMode: "orbit",
    sceneConfig: { fogDensity: 0.005, backgroundColor: "#000005", bloomStrength: 1.1, vignetteStrength: 0.7 },
  },
  {
    id: "equalizer",
    name: "Equalizer Wall",
    description: "32 bars that pulse to live audio bass",
    emoji: "🎚️",
    objects: buildBars(32, { color: "#00ffcc", emissive: "#00ccaa" }),
    particleConfig: { enabled: true, count: 80, size: 0.02, color: "#00ffff", spread: 4, speed: 0.2, opacity: 0.7 },
    cameraMode: "orbit",
    sceneConfig: { fogDensity: 0.012, bloomStrength: 1.2, chromaticAberration: 0.003, beatPunch: 0.25 },
    audioDriven: "bars",
  },
  {
    id: "geometric-city",
    name: "Geometric City",
    description: "Grid of glowing pillars that pulse on the beat",
    emoji: "🏙️",
    objects: (() => {
      const pillars: AnimObject[] = [];
      const grid = 5;
      const spacing = 2.0;
      const offset = ((grid - 1) * spacing) / 2;
      let idx = 0;
      for (let x = 0; x < grid; x++) {
        for (let z = 0; z < grid; z++) {
          const px = x * spacing - offset;
          const pz = z * spacing - offset;
          // Skip the very center so there's a clear focal point
          if (Math.abs(px) < 0.5 && Math.abs(pz) < 0.5) continue;
          const h = 1 + Math.random() * 2;
          pillars.push({
            id: `pillar-${idx++}`,
            name: `Pillar ${idx}`,
            type: "box",
            position: [px, h / 2, pz],
            rotation: [0, 0, 0],
            scale: [0.6, h, 0.6],
            color: "#aa88ff",
            metalness: 0.7,
            roughness: 0.3,
            emissive: "#6644ff",
            emissiveIntensity: 0.5,
            visible: true,
            bobSpeed: 0,
            bobAmount: 0,
            rotateSpeed: 0,
            bloom: true,
          });
        }
      }
      // Add a central "skyline" hero in the gap
      pillars.push({
        id: "skyline",
        name: "Skyline",
        type: "cone",
        position: [0, 3, 0],
        rotation: [0, 0, 0],
        scale: [1.2, 6, 1.2],
        color: "#ff66ff",
        metalness: 0.8,
        roughness: 0.2,
        emissive: "#cc44cc",
        emissiveIntensity: 0.7,
        visible: true,
        bobSpeed: 0.3,
        bobAmount: 0.05,
        rotateSpeed: 0,
        bloom: true,
      });
      return pillars;
    })(),
    particleConfig: { enabled: true, count: 150, size: 0.02, color: "#aaaaff", spread: 8, speed: 0.1, opacity: 0.5 },
    cameraMode: "dolly",
    sceneConfig: { fogDensity: 0.02, backgroundColor: "#0a0014", bloomStrength: 1.0 },
    audioDriven: "pillars",
  },
  {
    id: "vinyl-spin",
    name: "Vinyl Spin",
    description: "Turntable with a spinning vinyl record",
    emoji: "💿",
    objects: [
      {
        id: "turntable",
        name: "Turntable",
        type: "box",
        position: [0, -0.3, 0],
        rotation: [0, 0, 0],
        scale: [4, 0.2, 3],
        color: "#1a1a1a",
        metalness: 0.3,
        roughness: 0.7,
        emissive: "#000000",
        emissiveIntensity: 0,
        visible: true,
        bobSpeed: 0,
        bobAmount: 0,
        rotateSpeed: 0,
        bloom: false,
      },
      {
        id: "vinyl",
        name: "Vinyl",
        type: "cylinder",
        position: [0, 0, 0],
        rotation: [Math.PI / 2, 0, 0],
        scale: [1.4, 0.05, 1.4],
        color: "#0a0a0a",
        metalness: 0.9,
        roughness: 0.2,
        emissive: "#220022",
        emissiveIntensity: 0.1,
        visible: true,
        bobSpeed: 0,
        bobAmount: 0,
        rotateSpeed: 2.0,
        bloom: false,
      },
      {
        id: "label",
        name: "Album Label",
        type: "cylinder",
        position: [0, 0.06, 0],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.5, 0.06, 0.5],
        color: "#ff6600",
        metalness: 0.4,
        roughness: 0.5,
        emissive: "#ff3300",
        emissiveIntensity: 0.3,
        visible: true,
        bobSpeed: 0,
        bobAmount: 0,
        rotateSpeed: 2.0,
        bloom: true,
      },
      {
        id: "tonearm",
        name: "Tonearm",
        type: "cylinder",
        position: [1.6, 0.15, -0.4],
        rotation: [0, 0, 0.6],
        scale: [0.05, 1.2, 0.05],
        color: "#cccccc",
        metalness: 0.9,
        roughness: 0.1,
        emissive: "#222222",
        emissiveIntensity: 0,
        visible: true,
        bobSpeed: 0,
        bobAmount: 0,
        rotateSpeed: 0,
        bloom: false,
      },
    ],
    particleConfig: { enabled: false, count: 0, size: 0.02, color: "#ffffff", spread: 0, speed: 0, opacity: 0.5 },
    cameraMode: "dolly",
    sceneConfig: { fogDensity: 0.008, backgroundColor: "#18181c", bloomStrength: 0.5, vignetteStrength: 0.4 },
  },
  {
    id: "pulse-orb",
    name: "Pulse Orb",
    description: "Minimalist single sphere with strong beat punch",
    emoji: "✨",
    objects: [
      {
        id: "orb",
        name: "Orb",
        type: "sphere",
        position: [0, 1.5, 0],
        rotation: [0, 0, 0],
        scale: [1.5, 1.5, 1.5],
        color: "#ff3399",
        metalness: 0.3,
        roughness: 0.2,
        emissive: "#ff66cc",
        emissiveIntensity: 1.5,
        visible: true,
        bobSpeed: 0.8,
        bobAmount: 0.1,
        rotateSpeed: 0.4,
        bloom: true,
      },
    ],
    particleConfig: { enabled: true, count: 300, size: 0.02, color: "#ff66cc", spread: 5, speed: 0.3, opacity: 0.7 },
    cameraMode: "orbit",
    sceneConfig: { fogDensity: 0.015, backgroundColor: "#100018", bloomStrength: 1.3, beatPunch: 0.35 },
  },
];
