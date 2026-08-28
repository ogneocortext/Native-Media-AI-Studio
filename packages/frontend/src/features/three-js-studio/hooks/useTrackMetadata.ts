import { useEffect, useState } from "react";
import type { AudioAnalysisResult } from "../../../services/api";

export interface TrackMetadata {
  filename: string;
  bpm: number;
  duration: number;
  sections: AudioAnalysisResult["sections"];
  energyCurve: number[];
  confidence: number;
}

export function useTrackMetadata(selectedTrack: string | null) {
  const [metadata, setMetadata] = useState<TrackMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTrack) {
      setMetadata(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/audio/analysis/${encodeURIComponent(selectedTrack)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Analysis not found (${r.status})`);
        return r.json();
      })
      .then((data: AudioAnalysisResult) => {
        if (cancelled) return;
        setMetadata({
          filename: selectedTrack,
          bpm: data.tempo_bpm,
          duration: data.duration_seconds,
          sections: data.sections,
          energyCurve: data.energy_curve,
          confidence: data.confidence,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setMetadata(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedTrack]);

  return { metadata, loading, error };
}

export interface PromptVariation {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

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
  const isFast = meta.bpm > 140;
  const isSlow = meta.bpm < 100;

  const moods: string[] = [];
  if (isHighEnergy && isFast) moods.push("intense", "euphoric", "driving");
  else if (isHighEnergy && isSlow) moods.push("powerful", "heavy");
  else if (isLowEnergy && isSlow) moods.push("melancholic", "atmospheric");
  else if (isLowEnergy && isFast) moods.push("glitchy", "frantic");
  else if (isDynamic) moods.push("dynamic", "evolving", "cinematic");
  else moods.push("balanced", "steady");

  const visualStyles: string[] = [];
  if (isHighEnergy) visualStyles.push("vibrant neon", "explosive particles", "sharp geometric");
  if (isLowEnergy) visualStyles.push("soft gradients", "flowing organic", "minimalist");
  if (isDynamic) visualStyles.push("pulsing transitions", "morphing shapes");
  if (hasBuildups) visualStyles.push("building tension", "rising structures");
  if (hasDrops) visualStyles.push("impact flashes", "shockwave rings");

  return { avgEnergy, isHighEnergy, isLowEnergy, isDynamic, isFast, isSlow, hasBuildups, hasDrops, moods, visualStyles };
}

export function generatePromptVariations(meta: TrackMetadata): PromptVariation[] {
  const c = analyzeTrackCharacteristics(meta);
  const { bpm, duration, sections } = meta;
  const moodStr = c.moods.slice(0, 2).join(", ");
  const styleStr = c.visualStyles.slice(0, 3).join(", ");
  const sectionSummary = sections.length > 0
    ? `Sections: ${sections.map(s => s.type).join(", ")}.`
    : "";

  return [
    {
      id: "cinematic",
      name: "Cinematic Director",
      description: "Camera work, lighting, dramatic composition",
      prompt: `Create a Three.js scene for a ${bpm} BPM track (${moodStr}).
${sectionSummary} Energy: ${Math.round(c.avgEnergy * 100)}%. ${c.isDynamic ? "Dynamic." : "Steady."}
Style: ${styleStr}.
- Dramatic camera (orbit/dolly/handheld)
- Atmospheric lighting shifting with music
- ${c.isHighEnergy ? "Fast particle explosions on beats" : "Gentle ambient particles"}
- ${c.hasBuildups ? "Build tension before drops" : "Consistent rhythm"}
- Palette: deep purples, electric blues, ${c.isHighEnergy ? "hot pink/orange" : "soft cyan/teal"}
Return ONLY valid JavaScript. Define: function applyScene(scene, camera, renderer) { ... }`,
    },
    {
      id: "geometric",
      name: "Geometric Architect",
      description: "3D objects, shapes, structural composition",
      prompt: `Design a geometric Three.js viz for ${bpm} BPM (${moodStr}).
Energy: ${Math.round(c.avgEnergy * 100)}%, ${c.isDynamic ? "dynamic" : "steady"}. Style: ${styleStr}.
- ${c.isHighEnergy ? "Sharp angular (icosahedrons, octahedrons)" : "Smooth organic (spheres, torus knots)"}
- ${c.isDynamic ? "Morphing objects" : "Stable breathing structures"}
- ${c.hasDrops ? "Impact rings on drops" : "Continuous rotation"}
- Grid/radial arrangement pulsing to ${bpm} BPM
- Materials: ${c.isHighEnergy ? "emissive, metallic, high bloom" : "matte, translucent, soft glow"}
Return ONLY valid JavaScript. Define: function applyScene(scene, camera, renderer) { ... }`,
    },
    {
      id: "particle",
      name: "Particle Physicist",
      description: "Particle systems, physics, fluid dynamics",
      prompt: `Build a particle Three.js viz for ${bpm} BPM.
Duration: ${Math.round(duration)}s. Energy: ${Math.round(c.avgEnergy * 100)}%. Style: ${moodStr}, ${styleStr}.
- ${c.isHighEnergy ? "5000+ particles, explosive bursts" : "1000-2000 particles, gentle flow"}
- ${c.isFast ? "Rapid movement" : "Slow drift"}
- ${c.hasBuildups ? "Converge before drops, explode outward" : "Continuous orbital flow"}
- Color: ${c.isHighEnergy ? "hot gradient (red→orange→white)" : "cool gradient (blue→purple→cyan)"}
Return ONLY valid JavaScript. Define: function applyScene(scene, camera, renderer) { ... }`,
    },
    {
      id: "minimal",
      name: "Minimalist",
      description: "Clean, simple, elegant essentials",
      prompt: `Minimalist Three.js scene for ${bpm} BPM (${moodStr}).
Energy: ${Math.round(c.avgEnergy * 100)}%, ${c.isDynamic ? "dynamic" : "steady"}.
- Single hero object (${c.isHighEnergy ? "sharp geometric" : "smooth organic"})
- ${c.isHighEnergy ? "Bold saturated accent on dark" : "Monochromatic with subtle variation"}
- ${c.isFast ? "Quick precise movements" : "Slow deliberate motion"}
- Clean composition, negative space, subtle bloom
Return ONLY valid JavaScript. Define: function applyScene(scene, camera, renderer) { ... }`,
    },
  ];
}
