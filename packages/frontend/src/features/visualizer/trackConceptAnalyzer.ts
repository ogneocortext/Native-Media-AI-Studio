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
  | "storm";

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
  
  // Extract mood keywords
  const moodKeywords: string[] = [];
  const moodMap: Record<string, string[]> = {
    melancholic: ["melancholic", "sad", "grief", "mournful", "somber"],
    euphoric: ["euphoric", "triumphant", "uplifting", "euphoria"],
    aggressive: ["aggressive", "intense", "heavy", "dark", "distorted"],
    dreamy: ["dream", "ethereal", "ambient", "space", "cosmic"],
    energetic: ["energetic", "fast", "upbeat", "dance", "party"],
    introspective: ["introspective", "reflective", "thoughtful", "meditative"],
    futuristic: ["futuristic", "cyberpunk", "synthwave", "retro", "neon"],
    peaceful: ["peaceful", "calm", "serene", "gentle", "soft"],
  };
  
  for (const [mood, keywords] of Object.entries(moodMap)) {
    if (keywords.some(k => combined.includes(k))) {
      moodKeywords.push(mood);
    }
  }
  
  // Extract genre keywords
  const genreKeywords: string[] = [];
  const genreMap: Record<string, string[]> = {
    trance: ["trance", "progressive", "uplifting"],
    dubstep: ["dubstep", "brostep", "wobble"],
    "drum-and-bass": ["drum-and-bass", "dnb", "jungle"],
    house: ["house", "deep-house", "tech-house"],
    techno: ["techno", "minimal", "industrial"],
    ambient: ["ambient", "downtempo", "chillout"],
    synthwave: ["synthwave", "retrowave", "outrun"],
    "g-funk": ["g-funk", "funk", "west-coast"],
    phonk: ["phonk", "drift"],
    cyberpunk: ["cyberpunk", "neon"],
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
  
  if (energy === "high" && (combined.includes("dubstep") || combined.includes("brostep") || combined.includes("drum-and-bass"))) {
    return "particles";
  }
  if (combined.includes("cyberpunk") || combined.includes("synthwave") || combined.includes("futuristic")) {
    return "neural";
  }
  if (combined.includes("ambient") || combined.includes("space") || combined.includes("ethereal")) {
    return "cosmic";
  }
  if (combined.includes("psychedelic") || combined.includes("experimental") || combined.includes("trippy")) {
    return "fractal";
  }
  if (combined.includes("pop") || combined.includes("dance") || combined.includes("disco")) {
    return "pulse";
  }
  if (combined.includes("metal") || combined.includes("rock") || combined.includes("aggressive")) {
    return "storm";
  }
  if (combined.includes("ambient") || combined.includes("downtempo") || combined.includes("chill")) {
    return "waveform";
  }
  
  return "geometric";
}

export function getVisualizationForTrack(trackName: string, csvContent: string): TrackConcept | null {
  const tracks = parseTrackCSV(csvContent);
  return tracks.find(t => t.trackName.toLowerCase().includes(trackName.toLowerCase()) || 
                          trackName.toLowerCase().includes(t.trackName.toLowerCase())) || null;
}