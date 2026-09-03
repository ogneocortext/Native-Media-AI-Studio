// GLSL Fragment Shaders for Audio-Reactive Visualizations
// Each shader receives uniforms: u_time, u_bass, u_mid, u_treble, u_beat, u_energy, u_peak, u_resolution

export const SHADER_PRESETS = {
  // ============================================================
  // ELECTRIC HORIZON — "The Signal Breaking Through the Noise"
  // Infinite dawn landscape, electric blue horizon, signal waves
  // ============================================================
  electricHorizon: `
    precision highp float;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_treble;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_peak;
    uniform vec2 u_resolution;

    // Simplex noise helper
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m; m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time * 0.3;

      // Horizon line moves with bass
      float horizon = 0.2 + u_bass * 0.15;

      // Electric signal waves
      float wave = 0.0;
      for (float i = 1.0; i <= 4.0; i++) {
        float freq = 8.0 * i + u_mid * 4.0;
        float amp = 0.03 / i;
        wave += sin(p.x * freq + t * i * 2.0) * amp * (1.0 + u_treble);
      }

      // Horizon glow
      float horizonGlow = exp(-abs(p.y - horizon - wave) * (8.0 - u_bass * 4.0));

      // Sky gradient (dawn colors)
      vec3 skyTop = vec3(0.02, 0.02, 0.08);
      vec3 skyMid = vec3(0.1, 0.05, 0.2);
      vec3 skyBot = vec3(0.3, 0.1, 0.4);
      vec3 sky = mix(skyBot, skyMid, smoothstep(-1.0, horizon, p.y));
      sky = mix(sky, skyTop, smoothstep(horizon + 0.5, 1.0, p.y));

      // Electric blue horizon line
      vec3 horizonColor = vec3(0.2, 0.5, 1.0) * horizonGlow * (1.0 + u_peak * 2.0);

      // Signal particles rising
      float particles = 0.0;
      for (float i = 0.0; i < 20.0; i++) {
        float px = fract(sin(i * 127.1) * 43758.5453) * 2.0 - 1.0;
        float py = fract(t * 0.1 + i * 0.05);
        float dist = length(vec2(p.x - px, p.y - py * 2.0 + 0.5));
        particles += 0.002 / (dist + 0.01) * (1.0 + u_energy);
      }

      // Beat flash
      float beatFlash = u_beat * 0.3 * exp(-abs(p.y - horizon) * 3.0);

      vec3 color = sky + horizonColor + vec3(0.1, 0.3, 0.8) * particles + vec3(0.5, 0.7, 1.0) * beatFlash;

      // Vignette
      float vig = 1.0 - dot(p * 0.5, p * 0.5);
      color *= vig;

      gl_FragColor = vec4(color, 1.0);
    }
  `,

  // ============================================================
  // FOGGY NOIR — "Before the Fade"
  // Fog, reverb, warm sub-bass, nocturnal atmosphere
  // ============================================================
  foggyNoir: `
    precision highp float;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_treble;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_peak;
    uniform vec2 u_resolution;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time * 0.2;

      // Layered fog
      float fog = fbm(p * 2.0 + vec2(t, t * 0.5));
      fog += fbm(p * 4.0 - vec2(t * 0.7, t * 0.3)) * 0.5;
      fog *= 0.7 + u_bass * 0.5;

      // Warm sub-bass glow at bottom
      float glow = exp(-abs(p.y + 0.5) * (2.0 - u_bass));
      vec3 warmGlow = vec3(0.8, 0.3, 0.1) * glow * (0.5 + u_bass);

      // Cool fog color
      vec3 fogColor = mix(vec3(0.05, 0.07, 0.12), vec3(0.15, 0.12, 0.2), fog);

      // Light shafts through fog
      float shafts = 0.0;
      for (float i = 0.0; i < 3.0; i++) {
        float x = sin(i * 2.0 + t) * 0.5;
        float shaft = exp(-abs(p.x - x) * (10.0 - u_mid * 5.0));
        shaft *= exp(-abs(p.y) * 2.0);
        shafts += shaft * 0.15 * (1.0 + u_mid);
      }

      // Beat pulse
      float pulse = u_beat * 0.2;

      vec3 color = fogColor + warmGlow + vec3(0.3, 0.4, 0.5) * shafts + vec3(0.2, 0.1, 0.05) * pulse;

      // Dark vignette
      float vig = 1.0 - dot(p * 0.7, p * 0.7);
      color *= vig * 1.2;

      gl_FragColor = vec4(color, 1.0);
    }
  `,

  // ============================================================
  // NEON RAIN — "Learning How to Stay"
  // Rain-soaked neon, cyberpunk, exhausted atmosphere
  // ============================================================
  neonRain: `
    precision highp float;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_treble;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_peak;
    uniform vec2 u_resolution;

    float hash(float n) { return fract(sin(n) * 43758.5453123); }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time;

      // Rain drops
      float rain = 0.0;
      for (float i = 0.0; i < 30.0; i++) {
        float speed = 0.5 + hash(i * 3.0) * 1.0;
        float x = hash(i) * 2.0 - 1.0;
        float y = fract(hash(i + 100.0) - t * speed * 0.3);
        y = y * 2.0 - 1.0;
        float drop = 0.0;
        drop += 0.003 / (abs(p.x - x) + 0.001) * exp(-abs(p.y - y) * 20.0);
        rain += drop * (0.5 + u_mid * 0.5);
      }

      // Neon reflections on wet ground
      float ground = smoothstep(0.0, -0.3, p.y);
      float neonReflect = 0.0;
      for (float i = 0.0; i < 8.0; i++) {
        float nx = hash(i * 7.0) * 2.0 - 1.0;
        float dist = length(vec2(p.x - nx, p.y + 0.5));
        vec3 neonColor = vec3(hash(i * 3.0), 0.2 + hash(i * 5.0) * 0.3, 0.8 + hash(i * 7.0) * 0.2);
        neonReflect += exp(-dist * (4.0 - u_bass * 2.0)) * 0.15 * ground;
      }

      // Background cyberpunk gradient
      vec3 bg = mix(vec3(0.02, 0.01, 0.05), vec3(0.05, 0.02, 0.1), uv.y);

      // Neon signs
      float signs = 0.0;
      for (float i = 0.0; i < 5.0; i++) {
        float sx = hash(i * 13.0) * 1.6 - 0.8;
        float sy = 0.2 + hash(i * 17.0) * 0.4;
        float dist = length(vec2(p.x - sx, p.y - sy));
        vec3 signColor = vec3(0.0, 0.8 + hash(i) * 0.2, 1.0);
        signs += exp(-dist * 8.0) * 0.3 * (0.5 + u_energy);
      }

      // Bass pulse
      float bassPulse = u_bass * 0.15 * exp(-abs(p.y + 0.3) * 2.0);

      vec3 color = bg + vec3(0.3, 0.5, 0.9) * rain + vec3(0.0, 0.5, 1.0) * neonReflect + signs + vec3(0.5, 0.2, 0.1) * bassPulse;

      // Scanlines
      color *= 0.95 + 0.05 * sin(gl_FragCoord.y * 2.0);

      gl_FragColor = vec4(color, 1.0);
    }
  `,

  // ============================================================
  // NEON GRID — "System Override"
  // Retro-futuristic, grid, glitch, aggressive
  // ============================================================
  neonGrid: `
    precision highp float;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_treble;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_peak;
    uniform vec2 u_resolution;

    float hash(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time;

      // Perspective grid (receding to horizon)
      float horizon = 0.3;
      vec2 gp = vec2(p.x, p.y - horizon);
      float perspective = 1.0 / (abs(gp.y) + 0.1);
      vec2 gridUV = vec2(gp.x * perspective, t * 0.5 + perspective * 0.5);

      // Grid lines
      float grid = 0.0;
      float gridSize = 0.1 + u_bass * 0.05;
      grid += smoothstep(gridSize, 0.0, abs(fract(gridUV.x) - 0.5));
      grid += smoothstep(gridSize, 0.0, abs(fract(gridUV.y) - 0.5));
      grid *= smoothstep(horizon, -0.5, p.y);

      // Glitch distortion
      float glitch = step(0.98, hash(floor(t * 10.0))) * u_beat;
      p.x += glitch * 0.1 * (hash(floor(t * 20.0)) - 0.5);

      // Neon grid color
      vec3 gridColor = vec3(0.0, 0.8, 1.0) * grid * (0.5 + u_energy);

      // Secondary magenta grid
      vec2 gridUV2 = vec2(gp.x * perspective + 0.5, t * 0.3 + perspective * 0.3);
      float grid2 = 0.0;
      grid2 += smoothstep(gridSize * 1.5, 0.0, abs(fract(gridUV2.x) - 0.5));
      grid2 += smoothstep(gridSize * 1.5, 0.0, abs(fract(gridUV2.y) - 0.5));
      grid2 *= smoothstep(horizon, -0.5, p.y);
      vec3 gridColor2 = vec3(1.0, 0.0, 0.5) * grid2 * (0.3 + u_mid);

      // Sky / sun
      float sun = exp(-length(vec2(p.x, p.y - 0.6)) * (3.0 - u_bass * 2.0));
      vec3 sunColor = vec3(1.0, 0.3, 0.1) * sun;

      // Horizontal scan lines
      float scanline = 0.9 + 0.1 * sin(gl_FragCoord.y * 3.0 + t * 5.0);

      // Beat flash
      float flash = u_beat * 0.2;

      vec3 color = gridColor + gridColor2 + sunColor + vec3(0.1) * flash;
      color *= scanline;

      // Dark background
      color += vec3(0.02, 0.01, 0.04) * (1.0 - grid * 0.5);

      gl_FragColor = vec4(color, 1.0);
    }
  `,

  // ============================================================
  // FIRE CROWN — "Take the Crown"
  // Fire, triumphant, dark-to-light arc, burning
  // ============================================================
  fireCrown: `
    precision highp float;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_treble;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_peak;
    uniform vec2 u_resolution;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0; float a = 0.6;
      for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time * 0.5;

      // Fire rising from bottom
      float fire = 0.0;
      for (float i = 0.0; i < 3.0; i++) {
        float offset = i * 0.3;
        vec2 fp = vec2(p.x * (2.0 + i), p.y + 1.0 - t * 0.2 + offset);
        float n = fbm(fp * 3.0 + vec2(offset, 0.0));
        float flame = smoothstep(0.4, 0.8, n) * smoothstep(0.0, -0.8, p.y);
        fire += flame * (0.5 + u_bass * 0.5);
      }

      // Fire colors: red → orange → yellow → white
      vec3 fireColor = mix(vec3(0.5, 0.0, 0.0), vec3(1.0, 0.3, 0.0), fire);
      fireColor = mix(fireColor, vec3(1.0, 0.8, 0.2), fire * fire);
      fireColor = mix(fireColor, vec3(1.0, 1.0, 0.8), fire * fire * fire * u_peak);

      // Embers rising
      float embers = 0.0;
      for (float i = 0.0; i < 15.0; i++) {
        float ex = hash(vec2(i, 0.0)) * 2.0 - 1.0;
        float ey = fract(hash(vec2(i, 1.0)) - t * 0.1 * (0.5 + hash(vec2(i, 2.0))));
        float dist = length(vec2(p.x - ex * 0.5, p.y - ey * 2.0 + 0.5));
        embers += 0.003 / (dist + 0.01) * (1.0 + u_energy);
      }
      vec3 emberColor = vec3(1.0, 0.5, 0.1) * embers;

      // Crown glow at top
      float crown = exp(-abs(p.y - 0.7) * 5.0) * exp(-abs(p.x) * 2.0);
      vec3 crownColor = vec3(1.0, 0.8, 0.2) * crown * (0.5 + u_peak * 1.5);

      // Beat explosion
      float explosion = u_beat * exp(-length(p) * 2.0) * 0.3;

      vec3 color = fireColor + emberColor + crownColor + vec3(1.0, 0.7, 0.3) * explosion;

      // Dark background with slight red tint
      color += vec3(0.05, 0.01, 0.0);

      gl_FragColor = vec4(color, 1.0);
    }
  `,

  // ============================================================
  // WEST COAST SUNSET — "Borrowed Flame"
  // Smooth, laid-back, warm G-Funk atmosphere
  // ============================================================
  westCoastSunset: `
    precision highp float;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_treble;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_peak;
    uniform vec2 u_resolution;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time * 0.15;

      // Sunset gradient
      vec3 skyTop = vec3(0.1, 0.0, 0.2);
      vec3 skyMid = vec3(0.8, 0.2, 0.3);
      vec3 skyBot = vec3(1.0, 0.6, 0.1);
      float skyGrad = smoothstep(-1.0, 0.5, p.y);
      vec3 sky = mix(skyBot, skyMid, smoothstep(-0.5, 0.2, p.y));
      sky = mix(sky, skyTop, smoothstep(0.2, 1.0, p.y));

      // Sun
      float sun = exp(-length(vec2(p.x, p.y - 0.3)) * (4.0 - u_bass * 2.0));
      vec3 sunColor = vec3(1.0, 0.7, 0.2) * sun;

      // Sun rays
      float rays = 0.0;
      for (float i = 0.0; i < 8.0; i++) {
        float angle = i * 0.785 + t * 0.2;
        float ray = abs(sin(atan(p.y - 0.3, p.x) - angle));
        ray = smoothstep(0.1, 0.0, ray);
        ray *= exp(-length(vec2(p.x, p.y - 0.3)) * 1.5);
        rays += ray * 0.05 * (1.0 + u_energy);
      }

      // Palm tree silhouettes
      float palms = 0.0;
      for (float i = 0.0; i < 4.0; i++) {
        float px = -0.8 + i * 0.5 + hash(vec2(i, 0.0)) * 0.2;
        float trunk = smoothstep(0.02, 0.0, abs(p.x - px)) * smoothstep(-1.0, -0.2, p.y);
        palms += trunk * 0.8;
      }

      // Ocean reflection
      float ocean = smoothstep(-0.3, -1.0, p.y);
      vec3 oceanColor = mix(vec3(0.0, 0.1, 0.3), vec3(0.8, 0.4, 0.1), ocean) * (0.5 + u_mid * 0.3);

      // Smooth wave motion
      float waves = sin(p.x * 10.0 + t * 3.0) * 0.02 * ocean;

      // Beat pulse warmth
      float warmth = u_beat * 0.1 * exp(-abs(p.y) * 2.0);

      vec3 color = sky + sunColor + vec3(1.0, 0.5, 0.2) * rays + oceanColor + waves + vec3(1.0, 0.3, 0.1) * warmth;

      // Palm silhouettes (darken)
      color = mix(color, vec3(0.0), palms);

      gl_FragColor = vec4(color, 1.0);
    }
  `,

  // ============================================================
  // ABSTRACT WAVES — Default fallback
  // Flowing abstract waveform visualization
  // ============================================================
  abstractWaves: `
    precision highp float;
    uniform float u_time;
    uniform float u_bass;
    uniform float u_mid;
    uniform float u_treble;
    uniform float u_beat;
    uniform float u_energy;
    uniform float u_peak;
    uniform vec2 u_resolution;

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time * 0.5;

      // Layered wave interference — amplitude pumps with bass + beat pulse
      // (u_beat arrives pre-decayed from the CPU loop, ~8-frame tail)
      float wave = 0.0;
      for (float i = 1.0; i <= 5.0; i++) {
        float freq = 3.0 * i + u_mid * 2.0;
        float amp = (0.1 / i) * (1.0 + u_bass * 1.5 + u_beat * 1.2);
        float phase = t * (1.0 + i * 0.3) + p.x * freq;
        wave += sin(phase) * amp;
      }

      // Distance from wave line
      float dist = abs(p.y - wave);

      // Glow bands — width breathes with bass and punches on beats
      float bands = exp(-dist * max(1.5, 7.0 - u_bass * 4.0 - u_beat * 1.5));

      // Color based on frequency
      vec3 color1 = vec3(0.2, 0.4, 1.0);
      vec3 color2 = vec3(1.0, 0.2, 0.5);
      vec3 color3 = vec3(0.0, 0.8, 0.6);
      vec3 bandColor = mix(color1, color2, sin(p.x * 2.0 + t) * 0.5 + 0.5);
      bandColor = mix(bandColor, color3, u_treble);

      // Background
      vec3 bg = vec3(0.02, 0.02, 0.05);

      // Beat flash — strong enough to read as a pulse, focused at center
      float flash = u_beat * 0.55 * exp(-length(p) * 1.5);

      vec3 color = bg + bandColor * bands * (0.4 + u_energy * 1.2) + vec3(1.0) * flash;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
} as const;

export type ShaderPresetName = keyof typeof SHADER_PRESETS;
