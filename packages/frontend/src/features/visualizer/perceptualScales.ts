/**
 * Perceptual Frequency Scales for Audio Visualization
 * 
 * Implements ERB (Equivalent Rectangular Bandwidth), Bark, and Mel scales
 * for more accurate frequency mapping that matches human hearing perception.
 * 
 * Source: Research from Cortix library and audioMotion-analyzer
 * Reference: docs/knowledge-library/advanced-visualization-techniques-2026.md
 */

/**
 * Perceptual Frequency Scale type
 */
export type PerceptualScale = 'bark' | 'erb' | 'mel' | 'log' | 'linear';

/**
 * Convert Hz to Bark scale (critical band rate)
 * Formula: bark = 13 * arctan(0.00076 * f) + 3.5 * arctan((f / 7500)^2)
 */
export function hzToBark(hz: number): number {
  return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan(Math.pow(hz / 7500, 2));
}

/**
 * Convert Bark to Hz (inverse of hzToBark)
 * Approximate formula: hz = 1960 * (f / (26.28 - f)) for f < 2
 */
export function barkToHz(bark: number): number {
  if (bark < 2) {
    return 1960 * (bark / (26.28 - bark));
  }
  // For higher bark values, use approximation
  return 1960 * (bark + 0.53) / (26.28 - bark);
}

/**
 * Convert Hz to ERB scale (Equivalent Rectangular Bandwidth)
 * Formula: erb = 21.4 * log10(1 + 0.00437 * f)
 */
export function hzToErb(hz: number): number {
  return 21.4 * Math.log10(1 + 0.00437 * hz);
}

/**
 * Convert ERB to Hz (inverse of hzToErb)
 * Formula: hz = (10^(erb / 21.4) - 1) / 0.00437
 */
export function erbToHz(erb: number): number {
  return (Math.pow(10, erb / 21.4) - 1) / 0.00437;
}

/**
 * Convert Hz to Mel scale (pitch perception)
 * Formula: mel = 2595 * log10(1 + f / 700)
 */
export function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

/**
 * Convert Mel to Hz (inverse of hzToMel)
 * Formula: hz = 700 * (10^(mel / 2595) - 1)
 */
export function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Generate frequency bins for a perceptual scale
 * 
 * @param scale - 'bark' | 'erb' | 'mel' | 'log' | 'linear'
 * @param numBands - Number of frequency bands to generate
 * @param minHz - Minimum frequency (default: 20 Hz)
 * @param maxHz - Maximum frequency (default: 22050 Hz, Nyquist for 44.1kHz)
 * @returns Array of frequency bin center frequencies in Hz
 */
export function generatePerceptualBands(
  scale: 'bark' | 'erb' | 'mel' | 'log' | 'linear',
  numBands: number,
  minHz: number = 20,
  maxHz: number = 22050
): number[] {
  // Band centers are interpolated with i / (numBands - 1): a single band would
  // divide by zero and return NaN centers, poisoning every mapped band value.
  const bands: number[] = [];
  const n = Math.max(2, Math.floor(numBands) || 2);
  
  switch (scale) {
    case 'bark': {
      const minBark = hzToBark(minHz);
      const maxBark = hzToBark(maxHz);
      for (let i = 0; i < n; i++) {
        const bark = minBark + (i / (n - 1)) * (maxBark - minBark);
        bands.push(barkToHz(bark));
      }
      break;
    }

    case 'erb': {
      const minErb = hzToErb(minHz);
      const maxErb = hzToErb(maxHz);
      for (let i = 0; i < n; i++) {
        const erb = minErb + (i / (n - 1)) * (maxErb - minErb);
        bands.push(erbToHz(erb));
      }
      break;
    }

    case 'mel': {
      const minMel = hzToMel(minHz);
      const maxMel = hzToMel(maxHz);
      for (let i = 0; i < n; i++) {
        const mel = minMel + (i / (n - 1)) * (maxMel - minMel);
        bands.push(melToHz(mel));
      }
      break;
    }

    case 'log': {
      // Logarithmic (octave-based) scale
      const minLog = Math.log10(minHz);
      const maxLog = Math.log10(maxHz);
      for (let i = 0; i < n; i++) {
        const log = minLog + (i / (n - 1)) * (maxLog - minLog);
        bands.push(Math.pow(10, log));
      }
      break;
    }

    case 'linear':
    default:
      // Linear frequency spacing
      for (let i = 0; i < n; i++) {
        bands.push(minHz + (i / (n - 1)) * (maxHz - minHz));
      }
      break;
  }
  
  return bands;
}

/**
 * Map frequency data to perceptual bands
 * 
 * @param freqData - Raw frequency data from AnalyserNode
 * @param sampleRate - Audio sample rate
 * @param scale - Perceptual scale to use
 * @param numBands - Number of output bands
 * @returns Array of energy values for each perceptual band
 */
export function mapToPerceptualBands(
  freqData: Uint8Array,
  sampleRate: number,
  scale: 'bark' | 'erb' | 'mel' | 'log' | 'linear' = 'mel',
  numBands: number = 40
): number[] {
  const bands = generatePerceptualBands(scale, numBands, 20, sampleRate / 2);
  // Size everything from the generated band count: generatePerceptualBands
  // clamps the requested count (min 2), so the accumulators must match.
  const bandCount = bands.length;
  const bandEnergies = new Array(bandCount).fill(0);
  const bandCounts = new Array(bandCount).fill(0);
  
  const binSize = sampleRate / (freqData.length * 2);
  
  // Map each frequency bin to the nearest perceptual band
  for (let i = 0; i < freqData.length; i++) {
    const hz = i * binSize;
    const energy = freqData[i] / 255;
    
    // Find the band this frequency belongs to
    let bandIdx = 0;
    for (let j = 0; j < bands.length - 1; j++) {
      if (hz >= bands[j] && hz < bands[j + 1]) {
        bandIdx = j;
        break;
      }
    }
    if (hz >= bands[bands.length - 1]) {
      bandIdx = bands.length - 1;
    }
    
    bandEnergies[bandIdx] += energy;
    bandCounts[bandIdx]++;
  }
  
  // Average energy per band
  return bandEnergies.map((energy, i) => 
    bandCounts[i] > 0 ? energy / bandCounts[i] : 0
  );
}

/**
 * Get center frequency for a specific band index
 * 
 * @param bandIndex - Index of the band (0-based)
 * @param numBands - Total number of bands
 * @param scale - Perceptual scale
 * @param minHz - Minimum frequency
 * @param maxHz - Maximum frequency
 * @returns Center frequency in Hz
 */
export function getBandCenterHz(
  bandIndex: number,
  numBands: number,
  scale: 'bark' | 'erb' | 'mel' | 'log' | 'linear' = 'mel',
  minHz: number = 20,
  maxHz: number = 22050
): number {
  const bands = generatePerceptualBands(scale, numBands, minHz, maxHz);
  return bands[bandIndex] || 0;
}

/**
 * Convert dB to linear amplitude
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert linear amplitude to dB
 */
export function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-10));
}

/**
 * Apply Hamming window to frequency data for improved frequency resolution
 * 
 * @param data - Input frequency or time-domain data
 * @returns Windowed data
 */
export function applyHammingWindow(data: Float32Array | Uint8Array): Float32Array {
  const N = data.length;
  const windowed = new Float32Array(N);
  
  for (let i = 0; i < N; i++) {
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1));
    windowed[i] = (data[i] / 255) * hamming;
  }
  
  return windowed;
}
