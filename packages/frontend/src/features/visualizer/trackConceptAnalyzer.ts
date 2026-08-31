export interface TrackConcept {
  trackName: string;
  prompt: string;
  lyrics: string;
  mood: string[];
  genre: string[];
  bpm: number;
  energy: "low" | "medium" | "high";
  recommendedViz: VisualizationStyle;
}

export type VisualizationStyle = 
  | "geometric" 
  | "waveform" 
  | "particles" 
  | "neural" 
  | "cosmic" 
  | "fractal"
  | "pulse"
  | "storm"
  | "vinyl"
  | "synthwave"
  | "aurora"
  | "inferno"
  | "ocean";

export interface VisualizationOption {
  id: VisualizationStyle;
  name: string;
  description: string;
  icon: string;
  bestFor: string[];
}

export const VISUALIZATION_OPTIONS: VisualizationOption[] = [
  {
    id: "geometric",
    name: "Geometric",
    description: "Classic 3D mesh with reactive scaling and rotation",
    icon: "hexagon",
    bestFor: ["electronic", "techno", "house", "trance"],
  },
  {
    id: "waveform",
    name: "Waveform",
    description: "Flowing wave patterns that ripple with the beat",
    icon: "activity",
    bestFor: ["ambient", "downtempo", "chill", "lo-fi"],
  },
  {
    id: "particles",
    name: "Particle Storm",
    description: "Explosive particle systems driven by frequency data",
    icon: "cloud",
    bestFor: ["dubstep", "drum-and-bass", "edm", "brostep"],
  },
  {
    id: "neural",
    name: "Neural Network",
    description: "Connected nodes that pulse with audio energy",
    icon: "git-branch",
    bestFor: ["cyberpunk", "synthwave", "retro", "futuristic"],
  },
  {
    id: "cosmic",
    name: "Cosmic Dust",
    description: "Ethereal nebula-like particles drifting in space",
    icon: "sparkles",
    bestFor: ["ambient", "space", "ethereal", "dream"],
  },
  {
    id: "fractal",
    name: "Fractal",
    description: "Self-similar patterns that evolve with the music",
    icon: "infinity",
    bestFor: ["psychedelic", "experimental", "trippy", "abstract"],
  },
  {
    id: "pulse",
    name: "Pulse",
    description: "Rhythmic pulsating rings synchronized to beats",
    icon: "circle",
    bestFor: ["pop", "dance", "disco", "funk"],
  },
  {
    id: "storm",
    name: "Storm",
    description: "Intense lightning and energy discharges",
    icon: "zap",
    bestFor: ["metal", "rock", "aggressive", "intense"],
  },
  {
    id: "vinyl",
    name: "Vinyl",
    description: "Spinning vinyl records with retro vibes",
    icon: "disc",
    bestFor: ["funk", "g-funk", "retro", "west-coast"],
  },
  {
    id: "synthwave",
    name: "Synthwave",
    description: "Neon sunset with retro-futuristic grid",
    icon: "sunset",
    bestFor: ["synthwave", "cyberpunk", "neon", "retrowave"],
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "Flowing northern lights effect",
    icon: "sparkles",
    bestFor: ["ambient", "ethereal", "dream", "peaceful"],
  },
  {
    id: "inferno",
    name: "Inferno",
    description: "Rising fire and ember particles",
    icon: "flame",
    bestFor: ["metal", "aggressive", "heavy", "intense"],
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Calming ocean waves with fluid motion",
    icon: "waves",
    bestFor: ["peaceful", "calm", "chill", "lo-fi"],
  },
];

export function parseTrackCSV(csvContent: string): TrackConcept[] {
  const lines = csvContent.trim().split("\n");
  const tracks: TrackConcept[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Parse CSV with quoted fields
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    
    if (fields.length >= 4) {
      const trackName = fields[1]?.replace(/^["']|["']$/g, "") || "";
      const prompt = fields[2]?.replace(/^["']|["']$/g, "") || "";
      const lyrics = fields[3]?.replace(/^["']|["']$/g, "") || "";
      
      const analysis = analyzeTrackConcept(trackName, prompt, lyrics);
      tracks.push(analysis);
    }
  }
  
  return tracks;
}

function analyzeTrackConcept(trackName: string, prompt: string, lyrics: string): TrackConcept {
  const combined = `${trackName} ${prompt} ${lyrics}`.toLowerCase();
  
  // Extract mood keywords — expanded to cover NeoCortext library (ghost, burnout, grind, etc.)
  const moodKeywords: string[] = [];
  const moodMap: Record<string, string[]> = {
    melancholic: ["melancholic", "sad", "grief", "mournful", "somber", "ghost", "fade", "stay", "learning"],
    euphoric: ["euphoric", "triumphant", "uplifting", "euphoria", "crown", "triumph", "light"],
    aggressive: ["aggressive", "intense", "heavy", "dark", "distorted", "burn", "fire", "phonk", "cowbell", "808"],
    dreamy: ["dream", "ethereal", "ambient", "space", "cosmic", "aether", "signal", "noise", "horizon"],
    energetic: ["energetic", "fast", "upbeat", "dance", "party", "grind", "hustle", "ship it"],
    introspective: ["introspective", "reflective", "thoughtful", "meditative", "window", "context", "clever", "architect"],
    futuristic: ["futuristic", "cyberpunk", "synthwave", "retro", "neon", "system", "override", "grid", "override"],
    peaceful: ["peaceful", "calm", "serene", "gentle", "soft", "still", "rise", "ground"],
  };
  
  for (const [mood, keywords] of Object.entries(moodMap)) {
    if (keywords.some(k => combined.includes(k))) {
      moodKeywords.push(mood);
    }
  }
  
  // Extract genre keywords — expanded for NeoCortext catalog
  const genreKeywords: string[] = [];
  const genreMap: Record<string, string[]> = {
    trance: ["trance", "progressive", "uplifting"],
    dubstep: ["dubstep", "brostep", "wobble", "hybrid", "heavy hybrid"],
    "drum-and-bass": ["drum-and-bass", "dnb", "jungle"],
    house: ["house", "deep-house", "tech-house"],
    techno: ["techno", "minimal", "industrial"],
    ambient: ["ambient", "downtempo", "chillout", "aether", "mmorpg"],
    synthwave: ["synthwave", "retrowave", "outrun", "architect", "synthwave mix"],
    "g-funk": ["g-funk", "funk", "west-coast", "west coast", "automatic grind", "solid ground"],
    phonk: ["phonk", "drift", "who am i", "crown", "take the crown"],
    cyberpunk: ["cyberpunk", "neon", "system override", "agentic"],
    grime: ["grime", "uk grime"],
    rap: ["rap", "ghost", "junkyard", "cleaning up"],
  };
  
  for (const [genre, keywords] of Object.entries(genreMap)) {
    if (keywords.some(k => combined.includes(k))) {
      genreKeywords.push(genre);
    }
  }
  
  // Extract BPM
  const bpmMatch = combined.match(/(\d+)\s*bpm/);
  const bpm = bpmMatch ? parseInt(bpmMatch[1]) : 120;
  
  // Determine energy level
  let energy: "low" | "medium" | "high" = "medium";
  if (combined.includes("aggressive") || combined.includes("heavy") || combined.includes("intense") || bpm > 140) {
    energy = "high";
  } else if (combined.includes("ambient") || combined.includes("calm") || combined.includes("peaceful") || bpm < 100) {
    energy = "low";
  }
  
  // Recommend visualization based on analysis
  const recommendedViz = recommendVisualization(moodKeywords, genreKeywords, energy);
  
  return {
    trackName,
    prompt,
    lyrics,
    mood: moodKeywords,
    genre: genreKeywords,
    bpm,
    energy,
    recommendedViz,
  };
}

function recommendVisualization(
  mood: string[],
  genre: string[],
  energy: "low" | "medium" | "high"
): VisualizationStyle {
  const combined = [...mood, ...genre].join(" ");
  
  // High energy aggressive → Inferno or Storm
  if (energy === "high" && (combined.includes("metal") || combined.includes("heavy"))) {
    return "inferno";
  }
  if (energy === "high" && (combined.includes("dubstep") || combined.includes("brostep") || combined.includes("drum-and-bass"))) {
    return "particles";
  }
  if (combined.includes("metal") || combined.includes("rock") || combined.includes("aggressive")) {
    return "storm";
  }
  
  // Cyberpunk/synthwave → Synthwave or Neural
  if (combined.includes("cyberpunk") || combined.includes("neon") || combined.includes("retrowave")) {
    return "synthwave";
  }
  if (combined.includes("synthwave") || combined.includes("futuristic")) {
    return "neural";
  }
  
  // Ambient/ethereal → Aurora or Cosmic
  if (combined.includes("ethereal") || combined.includes("dream") || combined.includes("peaceful")) {
    return "aurora";
  }
  if (combined.includes("ambient") || combined.includes("space") || combined.includes("cosmic")) {
    return "cosmic";
  }
  
  // Peaceful/calm → Ocean or Waveform
  if (combined.includes("peaceful") || combined.includes("calm") || combined.includes("chill") || combined.includes("lo-fi")) {
    return "ocean";
  }
  if (combined.includes("ambient") || combined.includes("downtempo")) {
    return "waveform";
  }
  
  // Funk/retro → Vinyl
  if (combined.includes("funk") || combined.includes("g-funk") || combined.includes("retro") || combined.includes("west-coast")) {
    return "vinyl";
  }
  
  // Psychedelic → Fractal
  if (combined.includes("psychedelic") || combined.includes("experimental") || combined.includes("trippy")) {
    return "fractal";
  }
  
  // Dance/pop → Pulse
  if (combined.includes("pop") || combined.includes("dance") || combined.includes("disco")) {
    return "pulse";
  }
  
  return "geometric";
}

export function getVisualizationForTrack(trackName: string, csvContent: string): TrackConcept | null {
  const tracks = parseTrackCSV(csvContent);
  return tracks.find(t => t.trackName.toLowerCase().includes(trackName.toLowerCase()) || 
                          trackName.toLowerCase().includes(t.trackName.toLowerCase())) || null;
}