/**
 * Kinetic Typography Presets for Track-Specific Visuals
 * 
 * Each preset is designed for a specific genre/mood found in the track library:
 * - Phonk/Drift: Aggressive glitch, distortion
 * - Synthwave: Neon glow, retro aesthetics  
 * - Ambient/Trance: Ethereal, slow floating
 * - West Coast G-Funk: Smooth, groovy bounce
 * - UK Grime: Sharp, angular, fast
 * - Dubstep: Heavy bass impact, screen shake
 * - Lo-Fi: Warm, gentle, nostalgic
 * - Cinematic: Dramatic, orchestral swells
 */

import { animate } from "animejs";

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  section: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    probability?: number;
  }>;
}

export interface KineticPreset {
  id: string;
  name: string;
  description: string;
  genres: string[];
  containerClass: string;
  wordClass: string;
  enterAnimation: (el: HTMLElement) => void;
  exitAnimation: (el: HTMLElement) => void;
  beatAnimation?: (el: HTMLElement) => void;
}

// ============================================================
// PRESET: PHONK — Aggressive glitch, distortion
// ============================================================
const phonkPreset: KineticPreset = {
  id: "phonk",
  name: "Phonk Drift",
  description: "Aggressive glitch with RGB split and shake",
  genres: ["phonk", "drift", "trap"],
  containerClass: "kinetic-phonk",
  wordClass: "kinetic-word-phonk",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      translateX: [-30, 0],
      scale: [1.3, 1],
      duration: 200,
      ease: "outExpo",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      translateX: [0, 30],
      scale: [1, 0.8],
      duration: 150,
      ease: "inExpo",
    });
  },
  beatAnimation: (el) => {
    animate(el, {
      translateX: [0, -3, 3, -2, 2, 0],
      duration: 100,
      ease: "linear",
    });
  },
};

// ============================================================
// PRESET: SYNTHWAVE — Neon glow, retro grid
// ============================================================
const synthwavePreset: KineticPreset = {
  id: "synthwave",
  name: "Synthwave",
  description: "Neon glow with retro chrome aesthetics",
  genres: ["synthwave", "retro", "neon", "80s"],
  containerClass: "kinetic-synthwave",
  wordClass: "kinetic-word-synthwave",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      translateY: [40, 0],
      duration: 600,
      ease: "outExpo",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      translateY: [0, -20],
      duration: 400,
      ease: "inExpo",
    });
  },
  beatAnimation: (el) => {
    animate(el, {
      textShadow: [
        "0 0 10px #ff00ff, 0 0 20px #ff00ff",
        "0 0 30px #00ffff, 0 0 60px #00ffff",
        "0 0 10px #ff00ff, 0 0 20px #ff00ff",
      ],
      duration: 300,
      ease: "linear",
    });
  },
};

// ============================================================
// PRESET: AMBIENT — Ethereal, slow floating
// ============================================================
const ambientPreset: KineticPreset = {
  id: "ambient",
  name: "Ambient Flow",
  description: "Ethereal floating text with soft glow",
  genres: ["ambient", "trance", "progressive", "ethereal"],
  containerClass: "kinetic-ambient",
  wordClass: "kinetic-word-ambient",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      translateY: [20, 0],
      filter: ["blur(8px)", "blur(0px)"],
      duration: 1200,
      ease: "outExpo",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      translateY: [0, -15],
      filter: ["blur(0px)", "blur(6px)"],
      duration: 800,
      ease: "inExpo",
    });
  },
};

// ============================================================
// PRESET: G-FUNK — Smooth, groovy bounce
// ============================================================
const gfunkPreset: KineticPreset = {
  id: "gfunk",
  name: "West Coast G-Funk",
  description: "Smooth groovy bounce with warm colors",
  genres: ["g-funk", "funk", "west coast", "smooth"],
  containerClass: "kinetic-gfunk",
  wordClass: "kinetic-word-gfunk",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      translateY: [30, 0],
      rotateZ: [-5, 0],
      duration: 500,
      ease: "outBounce",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      translateY: [0, -20],
      duration: 300,
      ease: "inExpo",
    });
  },
  beatAnimation: (el) => {
    animate(el, {
      translateY: [0, -8, 0],
      duration: 200,
      ease: "outQuad",
    });
  },
};

// ============================================================
// PRESET: GRIME — Sharp, angular, fast
// ============================================================
const grimePreset: KineticPreset = {
  id: "grime",
  name: "UK Grime",
  description: "Sharp angular entrance with fast cuts",
  genres: ["grime", "uk", "fast", "aggressive"],
  containerClass: "kinetic-grime",
  wordClass: "kinetic-word-grime",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      translateX: [-50, 0],
      skewX: [-10, 0],
      duration: 150,
      ease: "outExpo",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      translateX: [0, 50],
      duration: 100,
      ease: "inExpo",
    });
  },
  beatAnimation: (el) => {
    animate(el, {
      scale: [1, 1.15, 1],
      duration: 80,
      ease: "linear",
    });
  },
};

// ============================================================
// PRESET: DUBSTEP — Heavy bass impact
// ============================================================
const dubstepPreset: KineticPreset = {
  id: "dubstep",
  name: "Dubstep Impact",
  description: "Heavy bass-reactive screen shake",
  genres: ["dubstep", "brostep", "bass", "heavy"],
  containerClass: "kinetic-dubstep",
  wordClass: "kinetic-word-dubstep",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      scale: [2, 1],
      duration: 250,
      ease: "outExpo",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      scale: [1, 0.5],
      duration: 200,
      ease: "inExpo",
    });
  },
  beatAnimation: (el) => {
    animate(el, {
      scale: [1, 1.3, 1],
      translateX: [0, -5, 5, -3, 3, 0],
      duration: 150,
      ease: "linear",
    });
  },
};

// ============================================================
// PRESET: LO-FI — Warm, gentle, nostalgic
// ============================================================
const lofiPreset: KineticPreset = {
  id: "lofi",
  name: "Lo-Fi Warmth",
  description: "Warm gentle fade with nostalgic feel",
  genres: ["lo-fi", "lofi", "chill", "warm", "nostalgic"],
  containerClass: "kinetic-lofi",
  wordClass: "kinetic-word-lofi",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      duration: 800,
      ease: "outQuad",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      duration: 600,
      ease: "inQuad",
    });
  },
};

// ============================================================
// PRESET: CINEMATIC — Dramatic, orchestral
// ============================================================
const cinematicPreset: KineticPreset = {
  id: "cinematic",
  name: "Cinematic",
  description: "Dramatic orchestral swells with wide letters",
  genres: ["cinematic", "orchestral", "dramatic", "epic"],
  containerClass: "kinetic-cinematic",
  wordClass: "kinetic-word-cinematic",
  enterAnimation: (el) => {
    animate(el, {
      opacity: [0, 1],
      letterSpacing: ["20px", "8px"],
      duration: 1000,
      ease: "outExpo",
    });
  },
  exitAnimation: (el) => {
    animate(el, {
      opacity: [1, 0],
      letterSpacing: ["8px", "30px"],
      duration: 600,
      ease: "inExpo",
    });
  },
  beatAnimation: (el) => {
    animate(el, {
      letterSpacing: ["8px", "12px", "8px"],
      duration: 200,
      ease: "outQuad",
    });
  },
};

// ============================================================
// ENHANCED PRESETS WITH LRC TIMING SUPPORT
// ============================================================

/** Word-level animation - highlights individual words on beat */
export function animateWordsOnBeat(el: HTMLElement, words: HTMLElement[], currentWordIdx: number) {
  words.forEach((wordEl, idx) => {
    if (idx === currentWordIdx) {
      animate(wordEl, {
        scale: [1, 1.2, 1],
        textShadow: [
          "0 0 8px currentColor",
          "0 0 24px currentColor, 0 0 48px currentColor",
          "0 0 8px currentColor",
        ],
        duration: 200,
        ease: "outQuad",
      });
      wordEl.classList.add("active");
    } else {
      wordEl.classList.remove("active");
    }
  });
}

/** Section transition animation - dramatic effect on section change */
export function animateSectionTransition(el: HTMLElement, fromSection: string, toSection: string) {
  // Different transitions for different section changes
  const intensity = getSectionIntensity(toSection);
  
  if (toSection === "DROP" || toSection === "FINAL DROP") {
    // Explosive entrance for drops
    animate(el, {
      scale: [2.5, 1],
      opacity: [0, 1],
      rotateZ: [-5, 0],
      duration: 300,
      ease: "outExpo",
    });
  } else if (toSection === "CHORUS" || toSection === "FINAL CHORUS") {
    // Swelling entrance for chorus
    animate(el, {
      scale: [0.8, 1.1, 1],
      opacity: [0, 1],
      letterSpacing: ["15px", "8px"],
      duration: 500,
      ease: "outExpo",
    });
  } else if (toSection === "BUILD-UP") {
    // Tension building
    animate(el, {
      scale: [1, 1.05],
      opacity: [0.8, 1],
      duration: 400,
      ease: "inOutQuad",
    });
  } else {
    // Standard smooth transition
    animate(el, {
      opacity: [0, 1],
      translateY: [20, 0],
      duration: 300,
      ease: "outExpo",
    });
  }
}

/** Get visual intensity based on section type */
function getSectionIntensity(section: string): number {
  const intensityMap: Record<string, number> = {
    INTRO: 0.3,
    VERSE: 0.5,
    "PRE-CHORUS": 0.6,
    CHORUS: 0.9,
    BRIDGE: 0.6,
    BREAKDOWN: 0.4,
    "BUILD-UP": 0.7,
    DROP: 1.0,
    "FINAL CHORUS": 0.95,
    "FINAL DROP": 1.0,
    OUTRO: 0.3,
  };
  return intensityMap[section] ?? 0.5;
}

/** Estimate word-level timing from line timing */
export function estimateWordTiming(text: string, lineStart: number, lineEnd: number): Array<{ word: string; start: number; end: number }> {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];
  
  const duration = lineEnd - lineStart;
  const timePerWord = duration / words.length;
  
  return words.map((word, idx) => ({
    word,
    start: lineStart + idx * timePerWord,
    end: lineStart + (idx + 1) * timePerWord,
  }));
}

/** Find current word index based on elapsed time */
export function findCurrentWord(words: Array<{ start: number; end: number }>, elapsed: number): number {
  for (let i = 0; i < words.length; i++) {
    if (elapsed >= words[i].start && elapsed < words[i].end) {
      return i;
    }
  }
  return -1;
}
export const kineticPresets: Record<string, KineticPreset> = {
  phonk: phonkPreset,
  synthwave: synthwavePreset,
  ambient: ambientPreset,
  gfunk: gfunkPreset,
  grime: grimePreset,
  dubstep: dubstepPreset,
  lofi: lofiPreset,
  cinematic: cinematicPreset,
};

export const kineticPresetList = Object.values(kineticPresets);

/** Auto-select preset based on track characteristics */
export function selectPresetForTrack(genre: string, energy: number): string {
  const g = genre.toLowerCase();
  if (g.includes("phonk") || g.includes("drift") || g.includes("trap")) return "phonk";
  if (g.includes("synthwave") || g.includes("neon") || g.includes("retro")) return "synthwave";
  if (g.includes("ambient") || g.includes("trance") || g.includes("progressive")) return "ambient";
  if (g.includes("g-funk") || g.includes("funk") || g.includes("west coast")) return "gfunk";
  if (g.includes("grime") || g.includes("uk")) return "grime";
  if (g.includes("dubstep") || g.includes("brostep") || g.includes("bass")) return "dubstep";
  if (g.includes("lo-fi") || g.includes("lofi") || g.includes("chill")) return "lofi";
  if (energy > 0.7) return "dubstep";
  if (energy < 0.3) return "ambient";
  return "cinematic";
}
