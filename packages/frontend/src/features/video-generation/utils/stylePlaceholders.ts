export const STYLE_GRADIENTS: Record<string, string> = {
  cyberpunk_neon: "linear-gradient(135deg, #ff00ff 0%, #00ffff 50%, #ff00aa 100%)",
  organic_flow: "linear-gradient(135deg, #4a7c59 0%, #8fbc8f 50%, #2d5016 100%)",
  geometric_pulse: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
  particle_dance: "linear-gradient(135deg, #ffd700 0%, #ff8c00 50%, #ff4500 100%)",
  vinyl_retro: "linear-gradient(135deg, #8b4513 0%, #d2691e 50%, #cd853f 100%)",
  waveform_classic: "linear-gradient(135deg, #00ff00 0%, #003300 50%, #001100 100%)",
  fire_energy: "linear-gradient(135deg, #ff0000 0%, #ff4500 50%, #ff8c00 100%)",
};

export function generateStylePlaceholder(
  styleId: string,
  styleName: string
): string {
  const colors =
    STYLE_GRADIENTS[styleId]?.match(/#[0-9a-f]{6}/gi) || ["#667eea", "#764ba2"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="144" viewBox="0 0 256 144">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${colors[0]}" />
        <stop offset="100%" style="stop-color:${colors[1] || colors[0]}" />
      </linearGradient>
    </defs>
    <rect width="256" height="144" fill="url(#g)" />
    <text x="128" y="72" font-family="Arial" font-size="14" fill="white" text-anchor="middle" dominant-baseline="middle" style="text-shadow: 1px 1px 2px rgba(0,0,0,0.5)">${styleName}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
