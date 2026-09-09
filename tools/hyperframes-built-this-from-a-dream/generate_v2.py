"""Generate HyperFrames v2 composition for Built This From A Dream (HyperFrames-compliant)."""
from pathlib import Path
import json

ROOT = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\tools\hyperframes-built-this-from-a-dream")
DATA_PATH = ROOT / "data.json"
V2_DIR = ROOT / "v2"
V2_DIR.mkdir(exist_ok=True)
OUT_PATH = V2_DIR / "index.html"

with open(DATA_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

data_json = json.dumps(data, separators=(",", ":"))

# Seeded PRNG (mulberry32) for deterministic particles
def mulberry32(a):
    a = a & 0xFFFFFFFF
    def f():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = (a ^ (a >> 15)) & 0xFFFFFFFF
        t = (t ^ (t << 1)) & 0xFFFFFFFF
        a = (t ^ (t >> 3)) & 0xFFFFFFFF
        t = (a ^ (a << 6)) & 0xFFFFFFFF
        t = (t ^ (t >> 7)) & 0xFFFFFFFF
        return (t ^ (t << 1)) & 0xFFFFFFFF
    return f

rng = mulberry32(123456789)
particles_js = []
for _ in range(140):
    particles_js.append({
        "x": (rng() / 0xFFFFFFFF) * 1920,
        "y": (rng() / 0xFFFFFFFF) * 1080,
        "r": (rng() / 0xFFFFFFFF) * 2.2 + 0.6,
        "vx": ((rng() / 0xFFFFFFFF) - 0.5) * 0.7,
        "vy": ((rng() / 0xFFFFFFFF) - 0.5) * 0.7,
        "alpha": (rng() / 0xFFFFFFFF) * 0.5 + 0.15,
    })
particles_json = json.dumps(particles_js, separators=(",", ":"))

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1920, height=1080">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{
      width: 1920px; height: 1080px; overflow: hidden;
      background: #020206; font-family: 'Inter', ui-sans-serif, system-ui;
    }}
    #root {{
      position: relative; width: 1920px; height: 1080px;
      overflow: hidden; background: #020206;
    }}
    .bg-deep {{
      position: absolute; inset: -120px; z-index: 0;
      background:
        radial-gradient(ellipse 160% 100% at 50% 30%, rgba(10,20,60,0.9), transparent 55%),
        radial-gradient(ellipse 120% 80% at 20% 80%, rgba(0,40,80,0.6), transparent 50%),
        radial-gradient(ellipse 100% 70% at 90% 20%, rgba(40,10,60,0.5), transparent 50%);
      filter: blur(40px) saturate(1.3);
    }}
    .bg-aurora {{
      position: absolute; inset: -80px; z-index: 1;
      background:
        radial-gradient(ellipse 120% 70% at 50% 35%, rgba(20,100,180,0.35), transparent 50%),
        radial-gradient(ellipse 90% 55% at 25% 65%, rgba(0,160,140,0.22), transparent 45%),
        radial-gradient(ellipse 80% 50% at 85% 25%, rgba(100,50,180,0.28), transparent 45%);
      filter: blur(28px) saturate(1.6); opacity: 0.9;
    }}
    .bg-grid {{
      position: absolute; inset: 0; z-index: 2; opacity: 0.05;
      background-image:
        linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px);
      background-size: 100px 100px;
    }}
    #particleCanvas {{
      position: absolute; inset: 0; z-index: 3; pointer-events: none;
    }}
    .vignette {{
      position: absolute; inset: 0; z-index: 4; pointer-events: none;
      background: radial-gradient(ellipse 70% 65% at 50% 50%, transparent 40%, rgba(0,0,0,0.65) 100%);
    }}
    .grain {{
      position: absolute; inset: 0; z-index: 5; pointer-events: none; opacity: 0.08;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }}
    .beat-flash {{
      position: absolute; inset: 0; z-index: 6; pointer-events: none;
      background: radial-gradient(circle at 50% 40%, rgba(200,230,255,0.22), transparent 55%);
      opacity: 0; mix-blend-mode: screen;
    }}
    .center-orb {{
      position: absolute; left: 50%; top: 50%; z-index: 7; pointer-events: none;
      width: 380px; height: 380px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.85); opacity: 0;
      background: radial-gradient(circle at 38% 32%, rgba(220,240,255,0.95) 0%, rgba(100,160,255,0.55) 30%, rgba(30,60,180,0.2) 60%, transparent 100%);
      filter: blur(22px); mix-blend-mode: screen;
    }}
    .orb-ring {{
      position: absolute; left: 50%; top: 50%; z-index: 8; pointer-events: none;
      width: 480px; height: 480px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.9); opacity: 0;
      border: 1px solid rgba(140,200,255,0.25);
      box-shadow: 0 0 30px rgba(80,140,255,0.25), inset 0 0 30px rgba(80,140,255,0.1);
    }}
    .spectrum {{
      position: absolute; bottom: 0; left: 0; right: 0; z-index: 9; pointer-events: none;
      height: 240px; display: flex; align-items: flex-end; gap: 4px; padding: 0 80px;
    }}
    .bar {{
      flex: 1; border-radius: 4px 4px 0 0; min-height: 3px;
      background: linear-gradient(to top, rgba(60,150,255,0.75), rgba(140,100,255,0.45));
      box-shadow: 0 0 10px rgba(100,180,255,0.45);
      transform-origin: bottom; opacity: 0.9;
    }}
    .lyric-wrap {{
      position: absolute; inset: 0; z-index: 10;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      pointer-events: none; padding: 0 180px; text-align: center;
    }}
    .lyric-line {{
      font-size: 64px; font-weight: 600; line-height: 1.4; letter-spacing: 0.01em;
      color: rgba(255,255,255,0.92);
      text-shadow: 0 0 40px rgba(140,200,255,0.6), 0 0 80px rgba(80,120,255,0.35);
      margin: 0.12em 0; opacity: 0; transform: translateY(22px) scale(0.96);
    }}
    .lyric-line.active {{
      opacity: 1; transform: translateY(0) scale(1);
    }}
    .lyric-line .word {{
      display: inline-block; opacity: 0.3; transform: scale(0.95);
      transition: opacity 0.2s, transform 0.2s, color 0.2s, text-shadow 0.2s;
      margin: 0 0.22em;
    }}
    .lyric-line .word.lit {{
      opacity: 1; transform: scale(1.08); color: #fff;
      text-shadow: 0 0 20px rgba(220,240,255,1), 0 0 40px rgba(120,180,255,0.8);
    }}
    .section-label {{
      position: absolute; top: 44px; right: 70px; z-index: 20;
      font-size: 14px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase;
      color: rgba(255,255,255,0.6); font-family: ui-monospace, monospace;
    }}
    .bpm-label {{
      position: absolute; bottom: 44px; left: 70px; z-index: 20;
      font-size: 14px; font-weight: 500; letter-spacing: 0.12em;
      color: rgba(255,255,255,0.85); font-family: ui-monospace, monospace;
    }}
  </style>
</head>
<body>
  <div id="root" data-composition-id="built-this-from-a-dream" data-start="0" data-duration="{data['duration']}" data-width="1920" data-height="1080">
    <div class="bg-deep"></div>
    <div class="bg-aurora"></div>
    <div class="bg-grid"></div>
    <canvas id="particleCanvas"></canvas>
    <div class="vignette"></div>
    <div class="grain"></div>
    <div class="beat-flash" id="beatFlash"></div>
    <div class="center-orb" id="orb"></div>
    <div class="orb-ring" id="orbRing"></div>
    <div class="spectrum" id="spectrum"></div>
    <div class="lyric-wrap" id="lyricWrap" data-layout-allow-overflow></div>
    <div class="section-label" id="sectionLabel">INTRO</div>
    <div class="bpm-label" id="bpmLabel">{data['tempo']:.1f} BPM</div>
    <audio id="audioTrack" src="Built This From A Dream.mp3" data-start="0" data-duration="{data['duration']}" preload="auto"></audio>
  </div>

  <script>
    window.__timelines = window.__timelines || {{}};
    window.__timelines['built-this-from-a-dream'] = {{ duration: {data['duration']}, fps: {data['fps']} }};

    const DATA = {data_json};
    const AUDIO = DATA;
    const BEATS = AUDIO.beat_times;
    const ENERGY = AUDIO.energy_curve;
    const BANDS = AUDIO.band_frames;
    const LYRICS = AUDIO.lyrics;
    const DURATION = AUDIO.duration;
    const FPS = AUDIO.fps;
    const TOTAL_FRAMES = Math.ceil(DURATION * FPS);

    // ─── DOM ────────────────────────────────────────────────────────────────
    const flash = document.getElementById('beatFlash');
    const orb = document.getElementById('orb');
    const orbRing = document.getElementById('orbRing');
    const lyricWrap = document.getElementById('lyricWrap');
    const spectrumEl = document.getElementById('spectrum');
    const sectionLabel = document.getElementById('sectionLabel');
    const bpmLabel = document.getElementById('bpmLabel');
    const root = document.getElementById('root');
    const canvas = document.getElementById('particleCanvas');
    const ctx = canvas.getContext('2d');

    // ─── CANVAS SETUP ───────────────────────────────────────────────────────
    canvas.width = 1920;
    canvas.height = 1080;
    const particles = {particles_json};

    // ─── HELPERS ────────────────────────────────────────────────────────────
    function getEnergy(t) {{
      const idx = Math.min(Math.floor(t * FPS), ENERGY.length - 1);
      return ENERGY[Math.max(0, idx)] || 0;
    }}
    function getBandFrame(t) {{
      const idx = Math.min(Math.floor(t * FPS), BANDS.length - 1);
      return (BANDS[Math.max(0, idx)] && BANDS[Math.max(0, idx)].b) || [0,0,0.2,0.25,0.2,0.15,0.1];
    }}
    function nextBeat(t, lookAhead) {{
      lookAhead = lookAhead || 0.18;
      for (let i = 0; i < BEATS.length; i++) {{
        if (BEATS[i] > t && BEATS[i] - t <= lookAhead) return BEATS[i];
      }}
      return null;
    }}
    function currentSection(t) {{
      let sec = 'intro';
      for (let i = 0; i < LYRICS.length; i++) {{
        if (t >= LYRICS[i].start) sec = LYRICS[i].section;
      }}
      return sec;
    }}
    const SECTION_COLORS = {{
      intro:   {{ orb: 'rgba(180,220,255,0.9)',  ring: 'rgba(140,200,255,0.35)', bar1: 'rgba(60,150,255,0.8)', bar2: 'rgba(140,100,255,0.5)' }},
      verse:   {{ orb: 'rgba(200,240,220,0.9)',  ring: 'rgba(120,220,180,0.35)', bar1: 'rgba(60,200,160,0.8)', bar2: 'rgba(120,200,140,0.5)' }},
      drop:    {{ orb: 'rgba(255,200,180,0.95)', ring: 'rgba(255,140,100,0.4)',  bar1: 'rgba(255,100,80,0.85)',  bar2: 'rgba(255,160,80,0.55)' }},
      chorus:  {{ orb: 'rgba(220,200,255,0.95)', ring: 'rgba(160,120,255,0.4)', bar1: 'rgba(140,100,255,0.85)', bar2: 'rgba(180,120,255,0.55)' }},
      final_drop: {{ orb: 'rgba(255,220,180,0.95)', ring: 'rgba(255,180,100,0.45)', bar1: 'rgba(255,160,60,0.9)', bar2: 'rgba(255,200,100,0.6)' }},
      outro:   {{ orb: 'rgba(180,200,220,0.85)', ring: 'rgba(120,160,200,0.3)', bar1: 'rgba(100,160,220,0.7)', bar2: 'rgba(120,160,200,0.45)' }},
    }};

    // ─── BUILD LYRIC ELEMENTS ────────────────────────────────────────────────
    const lineEls = [];
    LYRICS.forEach((lyric) => {{
      const el = document.createElement('div');
      el.className = 'lyric-line';
      const words = lyric.text.split(' ');
      el.innerHTML = words.map((w, wi) => '<span class="word" data-wi="' + wi + '">' + w + '</span>').join(' ');
      lyricWrap.appendChild(el);
      lineEls.push(el);
    }});

    // ─── BUILD SPECTRUM BARS ─────────────────────────────────────────────────
    const BAR_COUNT = 64;
    const barEls = [];
    for (let i = 0; i < BAR_COUNT; i++) {{
      const b = document.createElement('div');
      b.className = 'bar';
      b.style.height = '3px';
      spectrumEl.appendChild(b);
      barEls.push(b);
    }};

    // ─── GSAP TIMELINE ─────────────────────────────────────────────────────
    const tl = gsap.timeline({{ repeat: 0, defaults: {{ ease: 'none' }} }});
    tl.call(() => {{
      // initial state
      sectionLabel.textContent = currentSection(0).toUpperCase().replace('_', ' ');
    }});

    // ─── RENDER LOOP (HyperFrames-compatible via timeline onUpdate) ─────────
    let lastFrame = -1;
    function applyFrame(t) {{
      const frame = Math.floor(t * FPS);
      if (frame === lastFrame) return;
      lastFrame = frame;

      const energy = getEnergy(t);
      const bands = getBandFrame(t);
      const section = currentSection(t);
      const colors = SECTION_COLORS[section] || SECTION_COLORS.intro;

      // Beat detection
      const beatHit = nextBeat(t, 0.12);

      // Orb pulse
      const scale = 0.85 + energy * 0.55 + (beatHit ? 0.12 : 0);
      orb.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
      orb.style.opacity = 0.55 + energy * 0.45;
      orb.style.background = 'radial-gradient(circle at 38% 32%, ' + colors.orb + ', transparent 70%)';

      // Orb ring
      orbRing.style.transform = 'translate(-50%, -50%) scale(' + (0.9 + energy * 0.25) + ')';
      orbRing.style.opacity = 0.35 + energy * 0.45;
      orbRing.style.borderColor = colors.ring;
      orbRing.style.boxShadow = '0 0 30px ' + colors.ring + ', inset 0 0 30px ' + colors.ring;

      // Beat flash
      if (beatHit) {{
        flash.style.opacity = 0.7 + energy * 0.3;
        setTimeout(() => {{ flash.style.opacity = 0; }}, 120);
      }}

      // Spectrum
      const bandLen = bands.length;
      for (let i = 0; i < BAR_COUNT; i++) {{
        const idx = Math.floor((i / BAR_COUNT) * bandLen);
        const val = bands[Math.min(idx, bandLen - 1)] || 0;
        const h = 3 + val * 220;
        barEls[i].style.height = h + 'px';
        barEls[i].style.background = 'linear-gradient(to top, ' + colors.bar1 + ', ' + colors.bar2 + ')';
        barEls[i].style.boxShadow = '0 0 10px ' + colors.bar1;
      }}

      // Lyrics
      for (let i = 0; i < LYRICS.length; i++) {{
        const lyric = LYRICS[i];
        const active = t >= lyric.start && t <= lyric.end;
        lineEls[i].classList.toggle('active', active);
        if (active) {{
          const progress = (t - lyric.start) / (lyric.end - lyric.start);
          const words = lineEls[i].querySelectorAll('.word');
          const wordCount = words.length;
          const litCount = Math.floor(progress * wordCount);
          words.forEach((w, wi) => {{
            w.classList.toggle('lit', wi < litCount);
          }});
        }}
      }}

      // Section label
      sectionLabel.textContent = section.toUpperCase().replace('_', ' ');

      // Particles (deterministic)
      ctx.clearRect(0, 0, 1920, 1080);
      const eScale = 0.6 + energy * 1.8;
      for (let i = 0; i < particles.length; i++) {{
        const p = particles[i];
        p.x += p.vx * eScale;
        p.y += p.vy * eScale;
        if (p.x < 0) p.x = 1920;
        if (p.x > 1920) p.x = 0;
        if (p.y < 0) p.y = 1080;
        if (p.y > 1080) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.8 + energy * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180,220,255,' + (p.alpha * (0.4 + energy * 0.6)) + ')';
        ctx.fill();
      }}

      // Waveform ring (center)
      const cx = 960, cy = 540, baseR = 200;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(140,200,255,' + (0.15 + energy * 0.25) + ')';
      ctx.lineWidth = 1.2;
      for (let i = 0; i <= 128; i++) {{
        const angle = (i / 128) * Math.PI * 2;
        const bi = Math.floor((i / 128) * bands.length);
        const bv = bands[Math.min(bi, bands.length - 1)] || 0;
        const r = baseR + bv * 50 + Math.sin(angle * 6 + t * 2) * 8;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }}
      ctx.closePath();
      ctx.stroke();
    }}

    tl.to({{}}, {{
      duration: DURATION,
      ease: 'none',
      onUpdate: function() {{
        applyFrame(this.time());
      }},
    }});

    window.__timelines['built-this-from-a-dream'] = tl;
  </script>
</body>
</html>'''

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write(html)

print(f"Wrote {OUT_PATH} ({len(html.encode('utf-8'))} bytes)")
