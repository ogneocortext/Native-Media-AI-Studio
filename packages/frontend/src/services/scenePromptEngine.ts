/**
 * Prompt engineering service for generating Three.js scene prompts from track metadata.
 * Transforms audio analysis data into multiple prompt variations to test model strengths.
 */

import type { AudioAnalysisResult } from "../services/api";

export interface TrackMetadata {
  filename: string;
  bpm: number;
  duration: number;
  sections: AudioAnalysisResult["sections"];
  energyCurve: number[];
  confidence: number;
}

export interface PromptVariation {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

/**
 * Analyze track metadata to extract mood, energy, and visual characteristics
 */
function analyzeTrackCharacteristics(meta: TrackMetadata) {
  const avgEnergy = meta.energyCurve.length > 0
    ? meta.energyCurve.reduce((a, b) => a + b, 0) / meta.energyCurve.length
    : 0.5;

  const energyVariance = meta.energyCurve.length > 0
    ? meta.energyCurve.reduce((sum, e) => sum + Math.pow(e - avgEnergy, 2), 0) / meta.energyCurve.length
    : 0;

  const hasBuildups = meta.sections.some(s => s.type === "chorus" || s.type === "bridge");
  const hasDrops = meta.sections.filter(s => s.energy > 0.7).length > meta.sections.length * 0.3;
  const isHighEnergy = avgEnergy > 0.65;
  const isLowEnergy = avgEnergy < 0.35;
  const isDynamic = energyVariance > 0.05;
  const isSteady = energyVariance < 0.02;

  // Tempo classification
  const isFast = meta.bpm > 140;
  const isMidTempo = meta.bpm >= 100 && meta.bpm <= 140;
  const isSlow = meta.bpm < 100;

  // Mood inference
  const moods: string[] = [];
  if (isHighEnergy && isFast) moods.push("intenergetic", "euphoric", "driving");
  else if (isHighEnergy && isSlow) moods.push("powerful", "heavy", "intense");
  else if (isLowEnergy && isSlow) moods.push("melancholic", "atmospheric", "ambient");
  else if (isLowEnergy && isFast) moods.push("glitchy", "frantic", "chaotic");
  else if (isDynamic) moods.push("dynamic", "evolving", "cinematic");
  else moods.push("balanced", "steady", "hypnotic");

  // Visual style
  const visualStyles: string[] = [];
  if (isHighEnergy) visualStyles.push("vibrant neon", "explosive particles", "sharp geometric");
  if (isLowEnergy) visualStyles.push("soft gradients", "flowing organic", "minimalist");
  if (isDynamic) visualStyles.push("pulsing transitions", "morphing shapes", "lightning effects");
  if (isSteady) visualStyles.push("smooth rotations", "breathing glow", "continuous motion");
  if (hasBuildups) visualStyles.push("building tension", "rising structures", "crescendo bursts");
  if (hasDrops) visualStyles.push("impact flashes", "shockwave rings", "color explosions");

  return { avgEnergy, energyVariance, isHighEnergy, isLowEnergy, isDynamic, isSteady, isFast, isMidTempo, isSlow, hasBuildups, hasDrops, moods, visualStyles };
}

/**
 * Generate multiple prompt variations from track metadata
 * Each variation emphasizes different aspects to test model strengths
 */
export function generatePromptVariations(meta: TrackMetadata): PromptVariation[] {
  const chars = analyzeTrackCharacteristics(meta);
  const { bpm, duration, sections } = meta;

  const moodStr = chars.moods.slice(0, 2).join(", ");
  const styleStr = chars.visualStyles.slice(0, 3).join(", ");
  const sectionSummary = sections.length > 0
    ? `The track has ${sections.length} sections: ${sections.map(s => s.type).join(", ")}.`
    : "";

  return [
    {
      id: "cinematic",
      name: "Cinematic Director",
      description: "Focuses on camera work, lighting, and dramatic composition",
      prompt: `Create a Three.js scene for a ${bpm} BPM track with ${moodStr} mood.

${sectionSummary}
Average energy: ${Math.round(chars.avgEnergy * 100)}%. ${chars.isDynamic ? "Dynamic energy changes throughout." : "Steady energy level."}

Visual style: ${styleStr}.

Requirements:
- Dramatic camera movement (orbit, dolly, or handheld)
- Atmospheric lighting that shifts with the music
- ${chars.isHighEnergy ? "Fast-paced particle explosions on beats" : "Gentle ambient particle drift"}
- ${chars.hasBuildups ? "Build tension with rising objects before drops" : "Maintain consistent visual rhythm"}
- Color palette: deep purples, electric blues, with ${chars.isHighEnergy ? "hot pink/orange accents" : "soft cyan/teal highlights"}

Return ONLY valid JavaScript code that creates a Three.js scene. Use the global THREE object. Create a function called applyScene(scene, camera, renderer) that configures the scene.`,
    },
    {
      id: "geometric",
      name: "Geometric Architect",
      description: "Emphasizes 3D objects, shapes, and structural composition",
      prompt: `Design a geometric Three.js visualization for a ${bpm} BPM electronic track.

Track characteristics:
- Tempo: ${bpm} BPM (${chars.isFast ? "fast" : chars.isSlow ? "slow" : "mid-tempo"})
- Mood: ${moodStr}
- Energy: ${Math.round(chars.avgEnergy * 100)}% average, ${chars.isDynamic ? "dynamic" : "steady"}
- Visual approach: ${styleStr}

Create:
- ${chars.isHighEnergy ? "Sharp, angular geometries (icosahedrons, octahedrons)" : "Smooth, organic shapes (spheres, torus knots)"}
- ${chars.isDynamic ? "Objects that morph and transform between sections" : "Stable structures with subtle breathing motion"}
- ${chars.hasDrops ? "Impact rings that expand on beat drops" : "Continuous rotation and floating motion"}
- Grid-based or radial arrangement that pulses to the ${bpm} BPM rhythm
- Materials: ${chars.isHighEnergy ? "emissive, metallic with high bloom" : "matte, translucent with soft glow"}

Return ONLY valid JavaScript code. Use global THREE object. Create function applyScene(scene, camera, renderer).`,
    },
    {
      id: "particle",
      name: "Particle Physicist",
      description: "Focuses on particle systems, physics, and fluid dynamics",
      prompt: `Build a particle system Three.js visualization for a ${bpm} BPM track.

Track analysis:
- Duration: ${Math.round(duration)}s at ${bpm} BPM
- Energy profile: ${Math.round(chars.avgEnergy * 100)}% avg, variance: ${Math.round(chars.energyVariance * 1000) / 1000}
- Style: ${moodStr}, ${styleStr}

Particle system requirements:
- ${chars.isHighEnergy ? "5000+ particles with explosive burst behavior" : "1000-2000 particles with gentle flow"}
- ${chars.isFast ? "Rapid particle movement and fast orbital speeds" : "Slow, drifting particle motion"}
- ${chars.hasBuildups ? "Particles converge before drops, then explode outward" : "Continuous orbital flow around center"}
- Color: ${chars.isHighEnergy ? "hot gradient (red→orange→white on beats)" : "cool gradient (blue→purple→cyan)"}
- ${chars.isDynamic ? "Particle count and speed vary with energy curve" : "Consistent particle behavior"}
- Additive blending for glow effect

Return ONLY valid JavaScript code. Use global THREE object. Create function applyScene(scene, camera, renderer).`,
    },
    {
      id: "shader",
      name: "Shader Artist",
      description: "Emphasizes custom shaders, materials, and visual effects",
      prompt: `Create a shader-based Three.js visualization for a ${bpm} BPM ${moodStr} track.

Track properties:
- BPM: ${bpm} (${chars.isFast ? "energetic" : chars.isSlow ? "atmospheric" : "moderate"})
- Energy: ${Math.round(chars.avgEnergy * 100)}%
- Visual style: ${styleStr}

Shader requirements:
- Custom vertex shader that displaces geometry based on ${bpm} BPM rhythm
- Fragment shader with ${chars.isHighEnergy ? "high-contrast neon color palette" : "soft, pastel color gradients"}
- ${chars.isDynamic ? "Uniform-driven animation that responds to simulated audio data" : "Smooth, continuous animation loop"}
- ${chars.hasDrops ? "Flash/distortion effect on beat drops" : "Subtle wave distortion"}
- Post-processing: bloom, ${chars.isHighEnergy ? "chromatic aberration" : "soft vignette"}
- ${chars.isHighEnergy ? "High-frequency detail and sharp edges" : "Smooth, flowing organic patterns"}

Return ONLY valid JavaScript code. Use global THREE object. Create function applyScene(scene, camera, renderer).`,
    },
    {
      id: "minimal",
      name: "Minimalist",
      description: "Clean, simple, elegant visuals with focus on essential elements",
      prompt: `Create a minimalist Three.js scene for a ${bpm} BPM track.

Track feel: ${moodStr}, ${Math.round(chars.avgEnergy * 100)}% energy, ${chars.isDynamic ? "dynamic" : "steady"}

Minimalist approach:
- Single hero object (${chars.isHighEnergy ? "sharp geometric shape" : "smooth organic form"})
- ${chars.isHighEnergy ? "Bold, saturated accent color on dark background" : "Monochromatic palette with subtle variation"}
- ${chars.isFast ? "Quick, precise movements" : "Slow, deliberate motion"}
- Clean composition with negative space
- ${chars.hasBuildups ? "Single element that grows/transforms with tension" : "Consistent, meditative motion"}
- Subtle bloom or glow, no clutter
- Camera: ${chars.isDynamic ? "slow orbit" : "static or minimal drift"}

Return ONLY valid JavaScript code. Use global THREE object. Create function applyScene(scene, camera, renderer).`,
    },
  ];
}

/**
 * Generate a system prompt for the coding model
 */
export function getSystemPrompt(): string {
  return `You are a Three.js expert who creates stunning audio-reactive visualizations.
You write clean, performant JavaScript code that works with Three.js r160+.
You ONLY return valid JavaScript code - no explanations, no markdown, no comments outside the code.
Your code must define a function: function applyScene(scene, camera, renderer) { ... }
This function receives the Three.js scene, camera, and renderer objects.
Use the global THREE object for all Three.js classes.
Create visually impressive scenes with proper lighting, materials, and animation.
Make the visualization pulse/animate to a simulated beat at the specified BPM.`;
}
