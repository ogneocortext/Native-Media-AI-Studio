#!/usr/bin/env python3
"""Regenerate all HyperFrames sub-compositions with correct applyFrame scripts."""

import os

BASE = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\tools\hyperframes-built-this-from-a-dream"
V3_BASE = os.path.join(BASE, "v3")

# Read DATA from original files
def extract_data(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()

root_data = extract_data(os.path.join(BASE, "compositions", "data.json"))
v3_data = extract_data(os.path.join(V3_BASE, "compositions", "data.json"))

def sub_comp_html(comp_id, styles, markup, script, z_index="auto"):
    return f"""<!doctype html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<template>
  <style>
    #root {{
      position: relative; width: 1920px; height: 1080px;
      overflow: hidden; background: transparent;
      z-index: {z_index};
    }}
    {styles}
  </style>
  <div id="root" data-composition-id="{comp_id}" data-width="1920" data-height="1080">
    {markup}
  </div>
  <script>
    {script}
    window.__timelines = window.__timelines || {{}};
    const tl = gsap.timeline({{ paused: true }});
    tl.to({{}}, {{
      duration: window.DATA.duration,
      ease: 'none',
      onUpdate: function() {{ applyFrame(this.time()); }}
    }});
    window.__timelines['{comp_id}'] = tl;
  </script>
</template>
</body>
</html>"""

# ─── ROOT PROJECT ────────────────────────────────────────────────────────────

# backgrounds
bg_script = ""
bg_html = sub_comp_html("bg", """
    .bg-deep {
      position: absolute; inset: -160px; z-index: 0;
      background:
        radial-gradient(ellipse 180% 120% at 50% 25%, rgba(8,18,50,0.95), transparent 55%),
        radial-gradient(ellipse 140% 100% at 15% 75%, rgba(0,30,70,0.7), transparent 50%),
        radial-gradient(ellipse 120% 80% at 90% 15%, rgba(30,8,55,0.65), transparent 50%);
      filter: blur(50px) saturate(1.4);
    }
    .bg-aurora {
      position: absolute; inset: -100px; z-index: 1;
      background:
        radial-gradient(ellipse 130% 80% at 50% 35%, rgba(15,90,170,0.4), transparent 50%),
        radial-gradient(ellipse 100% 60% at 20% 65%, rgba(0,140,120,0.28), transparent 45%),
        radial-gradient(ellipse 90% 55% at 85% 20%, rgba(80,40,160,0.32), transparent 45%);
      filter: blur(32px) saturate(1.7); opacity: 0.95;
    }
    .bg-haze {
      position: absolute; inset: -60px; z-index: 2;
      background:
        radial-gradient(ellipse 100% 60% at 50% 50%, rgba(180,210,255,0.08), transparent 60%),
        radial-gradient(ellipse 80% 40% at 30% 80%, rgba(255,255,255,0.04), transparent 50%);
      filter: blur(18px); opacity: 0.7;
    }
    .bg-grid {
      position: absolute; inset: 0; z-index: 3; opacity: 0.04;
      background-image:
        linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px);
      background-size: 100px 100px;
    }
""", """
    <div class="bg-deep" id="bgDeep"></div>
    <div class="bg-aurora" id="bgAurora"></div>
    <div class="bg-haze" id="bgHaze"></div>
    <div class="bg-grid"></div>
""", bg_script, "0")

# canvas-effects
canvas_script = """
    const DATA = window.DATA;
    const FPS = DATA.fps;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const { mulberry32, getEnergy, getBandFrame } = window.HF;

    const sCanvas = document.getElementById('starCanvas');
    const sCtx = sCanvas.getContext('2d');
    const pCanvas = document.getElementById('particleCanvas');
    const pCtx = pCanvas.getContext('2d');
    sCanvas.width = 1920; sCanvas.height = 1080;
    pCanvas.width = 1920; pCanvas.height = 1080;

    const STAR_COUNT = 260;
    const stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: mulberry32() * 1920, y: mulberry32() * 1080,
        r: mulberry32() * 1.6 + 0.3,
        vx: (mulberry32() - 0.5) * 0.25, vy: (mulberry32() - 0.5) * 0.18,
        alpha: mulberry32() * 0.6 + 0.2,
        twinkleSpeed: mulberry32() * 2.5 + 0.8,
        twinkleOffset: mulberry32() * Math.PI * 2,
      });
    }

    const FG_COUNT = 90;
    const fgParticles = [];
    for (let i = 0; i < FG_COUNT; i++) {
      fgParticles.push({
        x: mulberry32() * 1920, y: mulberry32() * 1080,
        r: mulberry32() * 2.4 + 0.8,
        vx: (mulberry32() - 0.5) * 0.35, vy: (mulberry32() - 0.5) * 0.28,
        alpha: mulberry32() * 0.35 + 0.08,
        haze: mulberry32() * 0.5 + 0.3,
      });
    }

    function applyFrame(t) {
      const energy = getEnergy(t);
      const bands = getBandFrame(t);

      sCtx.clearRect(0, 0, 1920, 1080);
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.x += s.vx * (0.8 + energy * 1.4);
        s.y += s.vy * (0.8 + energy * 1.4);
        if (s.x < 0) s.x = 1920;
        if (s.x > 1920) s.x = 0;
        if (s.y < 0) s.y = 1080;
        if (s.y > 1080) s.y = 0;
        const twinkle = 0.55 + 0.45 * Math.sin(t * s.twinkleSpeed + s.twinkleOffset);
        sCtx.beginPath();
        sCtx.arc(s.x, s.y, s.r * (0.85 + energy * 0.5), 0, Math.PI * 2);
        sCtx.fillStyle = 'rgba(200,220,255,' + (s.alpha * twinkle) + ')';
        sCtx.fill();
      }

      pCtx.clearRect(0, 0, 1920, 1080);
      const eScale = 0.5 + energy * 2.0;
      for (let i = 0; i < fgParticles.length; i++) {
        const p = fgParticles[i];
        p.x += p.vx * eScale;
        p.y += p.vy * eScale;
        if (p.x < -20) p.x = 1920 + 20;
        if (p.x > 1920 + 20) p.x = -20;
        if (p.y < -20) p.y = 1080 + 20;
        if (p.y > 1080 + 20) p.y = -20;
        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.r * (0.9 + energy * 0.7), 0, Math.PI * 2);
        const haze = p.haze * (0.6 + energy * 0.4);
        pCtx.fillStyle = 'rgba(180,210,255,' + (p.alpha * haze) + ')';
        pCtx.fill();
      }

      const cx = 960, cy = 540, baseR = 210;
      pCtx.beginPath();
      pCtx.strokeStyle = 'rgba(140,200,255,' + (0.18 + energy * 0.32) + ')';
      pCtx.lineWidth = 1.4;
      for (let i = 0; i <= 160; i++) {
        const angle = (i / 160) * Math.PI * 2;
        const bi = Math.floor((i / 160) * bands.length);
        const bv = bands[Math.min(bi, bands.length - 1)] || 0;
        const r = baseR + bv * 55 + Math.sin(angle * 8 + t * 3.5) * 10 + Math.cos(angle * 3 - t * 2.2) * 6;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) pCtx.moveTo(x, y);
        else pCtx.lineTo(x, y);
      }
      pCtx.closePath();
      pCtx.stroke();
    }
"""

canvas_html = sub_comp_html("canvas", """
    #starCanvas {
      position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0.9;
    }
    #particleCanvas {
      position: absolute; inset: 0; z-index: 4; pointer-events: none;
    }
""", """
    <canvas id="starCanvas"></canvas>
    <canvas id="particleCanvas"></canvas>
""", canvas_script, "4")

# overlays (root)
overlays_script = """
    const DATA = window.DATA;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const { getEnergy, nextBeat, currentSection } = window.HF;

    const colorGrade = document.getElementById('colorGrade');
    const flash = document.getElementById('beatFlash');

    function applyFrame(t) {
      const energy = getEnergy(t);
      const beatHit = nextBeat(t, 0.14);
      const section = currentSection(t);

      colorGrade.style.background =
        'linear-gradient(180deg, rgba(20,40,80,' + (0.25 + energy * 0.3) + '), rgba(0,0,0,0.2), rgba(10,30,60,' + (0.2 + energy * 0.25) + '))';

      if (beatHit) {
        flash.style.opacity = 0.65 + energy * 0.35;
        setTimeout(() => { flash.style.opacity = 0; }, 110);
      }
    }
"""

overlays_html = sub_comp_html("overlays", """
    .vignette {
      position: absolute; inset: 0; z-index: 5; pointer-events: none;
      background: radial-gradient(ellipse 65% 60% at 50% 50%, transparent 35%, rgba(0,0,0,0.75) 100%);
    }
    .grain {
      position: absolute; inset: 0; z-index: 6; pointer-events: none; opacity: 0.1;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    .color-grade {
      position: absolute; inset: 0; z-index: 7; pointer-events: none; mix-blend-mode: overlay; opacity: 0.35;
      background: linear-gradient(180deg, rgba(20,40,80,0.4), rgba(80,20,60,0.25), rgba(10,30,60,0.35));
    }
    .beat-flash {
      position: absolute; inset: 0; z-index: 8; pointer-events: none;
      background: radial-gradient(circle at 50% 40%, rgba(200,230,255,0.28), transparent 55%);
      opacity: 0; mix-blend-mode: screen;
    }
""", """
    <div class="vignette"></div>
    <div class="grain"></div>
    <div class="color-grade" id="colorGrade"></div>
    <div class="beat-flash" id="beatFlash"></div>
""", overlays_script, "5")

# orb (root)
orb_script = """
    const DATA = window.DATA;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const { mulberry32, getEnergy, nextBeat, currentSection } = window.HF;
    const SECTION_COLORS = {
      intro:     { orb: 'rgba(180,220,255,0.95)', ring: 'rgba(140,200,255,0.4)' },
      verse:     { orb: 'rgba(200,240,220,0.95)', ring: 'rgba(120,220,180,0.4)' },
      chorus:    { orb: 'rgba(220,200,255,0.95)', ring: 'rgba(160,120,255,0.45)' },
      drop:      { orb: 'rgba(255,200,180,0.98)', ring: 'rgba(255,140,100,0.5)' },
      final_drop:{ orb: 'rgba(255,225,180,0.98)', ring: 'rgba(255,180,100,0.55)' },
      outro:     { orb: 'rgba(180,200,220,0.9)',  ring: 'rgba(120,160,200,0.35)' },
    };

    const orb = document.getElementById('orb');
    const orbRing = document.getElementById('orbRing');

    function applyFrame(t) {
      const energy = getEnergy(t);
      const beatHit = nextBeat(t, 0.14);
      const section = currentSection(t);
      const colors = SECTION_COLORS[section] || SECTION_COLORS.intro;

      const orbX = Math.sin(t * 0.4) * 18;
      const orbY = Math.cos(t * 0.55) * 14;
      const scale = 0.8 + energy * 0.6 + (beatHit ? 0.14 : 0);
      orb.style.transform = 'translate(calc(-50% + ' + orbX + 'px), calc(-50% + ' + orbY + 'px)) scale(' + scale + ')';
      orb.style.opacity = 0.6 + energy * 0.4;
      orb.style.background = 'radial-gradient(circle at 35% 30%, ' + colors.orb + ', transparent 70%)';

      const ringX = Math.cos(t * 0.35) * 12;
      const ringY = Math.sin(t * 0.45) * 10;
      orbRing.style.transform = 'translate(calc(-50% + ' + ringX + 'px), calc(-50% + ' + ringY + 'px)) scale(' + (0.85 + energy * 0.28) + ')';
      orbRing.style.opacity = 0.4 + energy * 0.5;
      orbRing.style.borderColor = colors.ring;
      orbRing.style.boxShadow = '0 0 40px ' + colors.ring + ', inset 0 0 40px ' + colors.ring;
    }
"""

orb_html = sub_comp_html("orb", """
    .center-orb {
      position: absolute; left: 50%; top: 50%; z-index: 9; pointer-events: none;
      width: 420px; height: 420px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.8); opacity: 0;
      background: radial-gradient(circle at 35% 30%, rgba(230,245,255,0.95) 0%, rgba(100,160,255,0.5) 28%, rgba(30,60,180,0.18) 58%, transparent 100%);
      filter: blur(26px); mix-blend-mode: screen;
      will-change: transform, opacity;
    }
    .orb-ring {
      position: absolute; left: 50%; top: 50%; z-index: 10; pointer-events: none;
      width: 520px; height: 520px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.85); opacity: 0;
      border: 1.2px solid rgba(140,200,255,0.3);
      box-shadow: 0 0 40px rgba(80,140,255,0.3), inset 0 0 40px rgba(80,140,255,0.12);
    }
""", """
    <div class="center-orb" id="orb"></div>
    <div class="orb-ring" id="orbRing"></div>
""", orb_script, "9")

# spectrum
spectrum_script = """
    const DATA = window.DATA;
    const ENERGY = DATA.energy_curve;
    const { getEnergy, getBandFrame, currentSection } = window.HF;
    const SECTION_COLORS = {
      intro:     { bar1: 'rgba(60,150,255,0.85)', bar2: 'rgba(140,100,255,0.55)' },
      verse:     { bar1: 'rgba(60,200,160,0.85)', bar2: 'rgba(120,200,140,0.55)' },
      chorus:    { bar1: 'rgba(140,100,255,0.9)', bar2: 'rgba(180,120,255,0.6)' },
      drop:      { bar1: 'rgba(255,100,80,0.9)',  bar2: 'rgba(255,160,80,0.65)' },
      final_drop:{ bar1: 'rgba(255,160,60,0.95)', bar2: 'rgba(255,200,100,0.7)' },
      outro:     { bar1: 'rgba(100,160,220,0.75)', bar2: 'rgba(120,160,200,0.5)' },
    };

    const spectrumEl = document.getElementById('spectrum');
    const BAR_COUNT = 64;
    const barEls = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const b = document.createElement('div');
      b.className = 'bar';
      b.style.height = '3px';
      spectrumEl.appendChild(b);
      barEls.push(b);
    }

    function applyFrame(t) {
      const energy = getEnergy(t);
      const bands = getBandFrame(t);
      const section = currentSection(t);
      const colors = SECTION_COLORS[section] || SECTION_COLORS.intro;

      for (let i = 0; i < BAR_COUNT; i++) {
        const idx = Math.floor((i / BAR_COUNT) * bands.length);
        const val = bands[Math.min(idx, bands.length - 1)] || 0;
        const h = 4 + val * 260;
        barEls[i].style.height = h + 'px';
        barEls[i].style.background = 'linear-gradient(to top, ' + colors.bar1 + ', ' + colors.bar2 + ')';
        barEls[i].style.boxShadow = '0 0 16px ' + colors.bar1;
      }
    }
"""

spectrum_html = sub_comp_html("spectrum", """
    .spectrum {
      position: absolute; bottom: 0; left: 0; right: 0; z-index: 11; pointer-events: none;
      height: 280px; display: flex; align-items: flex-end; gap: 4px; padding: 0 90px;
    }
    .bar {
      flex: 1; border-radius: 4px 4px 0 0; min-height: 3px;
      background: linear-gradient(to top, rgba(60,150,255,0.8), rgba(140,100,255,0.5));
      box-shadow: 0 0 14px rgba(100,180,255,0.55);
      transform-origin: bottom; opacity: 0.92;
      will-change: height;
    }
""", """
    <div class="spectrum" id="spectrum"></div>
""", spectrum_script, "11")

# lyrics
lyrics_script = """
    const DATA = window.DATA;
    const LYRICS = DATA.lyrics;

    const lyricWrap = document.getElementById('lyricWrap');
    const lineEls = [];
    LYRICS.forEach((lyric) => {
      const el = document.createElement('div');
      el.className = 'lyric-line';
      const words = lyric.text.split(' ');
      el.innerHTML = words.map((w, wi) => '<span class="word" data-wi="' + wi + '">' + w + '</span>').join(' ');
      lyricWrap.appendChild(el);
      lineEls.push(el);
    });

    function applyFrame(t) {
      for (let i = 0; i < LYRICS.length; i++) {
        const lyric = LYRICS[i];
        const active = t >= lyric.start && t <= lyric.end;
        lineEls[i].classList.toggle('active', active);
        if (active) {
          const progress = (t - lyric.start) / (lyric.end - lyric.start);
          const words = lineEls[i].querySelectorAll('.word');
          const wordCount = words.length;
          const litCount = Math.floor(progress * wordCount);
          words.forEach((w, wi) => {
            w.classList.toggle('lit', wi < litCount);
          });
        }
      }
    }
"""

lyrics_html = sub_comp_html("lyrics", """
    .lyric-wrap {
      position: absolute; inset: 0; z-index: 12;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      pointer-events: none; padding: 0 200px; text-align: center;
    }
    .lyric-line {
      font-size: 68px; font-weight: 600; line-height: 1.35; letter-spacing: 0.01em;
      color: rgba(255,255,255,0.94);
      text-shadow: 0 0 50px rgba(140,200,255,0.7), 0 0 100px rgba(80,120,255,0.4);
      margin: 0.14em 0; opacity: 0; transform: translateY(28px) scale(0.94);
      will-change: transform, opacity;
    }
    .lyric-line.active {
      opacity: 1; transform: translateY(0) scale(1);
    }
    .lyric-line .word {
      display: inline-block; opacity: 0.25; transform: scale(0.94);
      transition: opacity 0.22s, transform 0.22s, color 0.22s, text-shadow 0.22s;
      margin: 0 0.24em;
    }
    .lyric-line .word.lit {
      opacity: 1; transform: scale(1.1); color: #fff;
      text-shadow: 0 0 28px rgba(220,240,255,1), 0 0 56px rgba(120,180,255,0.9);
    }
""", """
    <div class="lyric-wrap" id="lyricWrap"></div>
""", lyrics_script, "12")

# labels
labels_script = """
    const DATA = window.DATA;
    const LYRICS = DATA.lyrics;
    const { currentSection } = window.HF;

    const sectionLabel = document.getElementById('sectionLabel');
    const timeLabel = document.getElementById('timeLabel');

    function applyFrame(t) {
      sectionLabel.textContent = currentSection(t).toUpperCase().replace('_', ' ');
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      timeLabel.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
    }
"""

labels_html = sub_comp_html("labels", """
    .section-label {
      position: absolute; top: 48px; right: 80px; z-index: 20;
      font-size: 14px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
      color: rgba(255,255,255,0.75); font-family: ui-monospace, monospace;
    }
    .bpm-label {
      position: absolute; bottom: 48px; left: 80px; z-index: 20;
      font-size: 14px; font-weight: 500; letter-spacing: 0.14em;
      color: rgba(255,255,255,0.9); font-family: ui-monospace, monospace;
    }
    .time-label {
      position: absolute; top: 48px; left: 80px; z-index: 20;
      font-size: 13px; font-weight: 500; letter-spacing: 0.12em;
      color: rgba(255,255,255,0.6); font-family: ui-monospace, monospace;
    }
""", """
    <div class="section-label" id="sectionLabel">INTRO</div>
    <div class="time-label" id="timeLabel">0:00</div>
    <div class="bpm-label" id="bpmLabel">143.6 BPM</div>
""", labels_script, "20")

# Write root sub-compositions
for name, content in [
    ("backgrounds.html", bg_html),
    ("canvas-effects.html", canvas_html),
    ("overlays.html", overlays_html),
    ("orb.html", orb_html),
    ("spectrum.html", spectrum_html),
    ("lyrics.html", lyrics_html),
    ("labels.html", labels_html),
]:
    with open(os.path.join(BASE, "compositions", name), "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Wrote root/{name}")

# ─── V3 PROJECT ──────────────────────────────────────────────────────────────

v3_canvas_script = canvas_script  # same as root
v3_canvas_html = sub_comp_html("canvas", """
    #starCanvas {
      position: absolute; inset: 0; z-index: 3; pointer-events: none; opacity: 0.9;
    }
    #particleCanvas {
      position: absolute; inset: 0; z-index: 4; pointer-events: none;
    }
""", """
    <canvas id="starCanvas"></canvas>
    <canvas id="particleCanvas"></canvas>
""", v3_canvas_script, "4")

v3_overlays_script = """
    const DATA = window.DATA;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const { getEnergy, nextBeat, currentSection } = window.HF;
    const SECTION_COLORS = {
      intro:     { orb: 'rgba(180,220,255,0.95)', ring: 'rgba(140,200,255,0.4)', bar1: 'rgba(60,150,255,0.85)', bar2: 'rgba(140,100,255,0.55)', grade: 'rgba(20,40,80,0.5)' },
      verse:     { orb: 'rgba(200,240,220,0.95)', ring: 'rgba(120,220,180,0.4)',  bar1: 'rgba(60,200,160,0.85)', bar2: 'rgba(120,200,140,0.55)', grade: 'rgba(20,60,40,0.45)' },
      chorus:    { orb: 'rgba(220,200,255,0.95)', ring: 'rgba(160,120,255,0.45)', bar1: 'rgba(140,100,255,0.9)', bar2: 'rgba(180,120,255,0.6)', grade: 'rgba(50,20,80,0.5)' },
      drop:      { orb: 'rgba(255,200,180,0.98)', ring: 'rgba(255,140,100,0.5)',  bar1: 'rgba(255,100,80,0.9)',  bar2: 'rgba(255,160,80,0.65)', grade: 'rgba(80,25,15,0.55)' },
      final_drop:{ orb: 'rgba(255,225,180,0.98)', ring: 'rgba(255,180,100,0.55)', bar1: 'rgba(255,160,60,0.95)', bar2: 'rgba(255,200,100,0.7)', grade: 'rgba(80,50,10,0.6)' },
      outro:     { orb: 'rgba(180,200,220,0.9)',  ring: 'rgba(120,160,200,0.35)', bar1: 'rgba(100,160,220,0.75)', bar2: 'rgba(120,160,200,0.5)', grade: 'rgba(10,20,40,0.45)' },
    };

    let activeSection = currentSection(0);
    let targetColors = SECTION_COLORS[activeSection] || SECTION_COLORS.intro;
    if (!window.COLOR_STATE) {
      window.COLOR_STATE = { liveColors: { ...targetColors } };
    }

    const colorGrade = document.getElementById('colorGrade');
    const flash = document.getElementById('beatFlash');

    function applyFrame(t) {
      const energy = getEnergy(t);
      const beatHit = nextBeat(t, 0.14);
      const section = currentSection(t);

      if (section !== activeSection) {
        activeSection = section;
        targetColors = SECTION_COLORS[section] || SECTION_COLORS.intro;
      }
      window.HF.updateLiveColors(targetColors, 0.05);

      colorGrade.style.background =
        'linear-gradient(180deg, ' + window.COLOR_STATE.liveColors.grade + ', rgba(0,0,0,0.2), ' + window.COLOR_STATE.liveColors.grade + ')';

      if (beatHit) {
        flash.style.opacity = 0.65 + energy * 0.35;
        setTimeout(() => { flash.style.opacity = 0; }, 110);
      }
    }
"""

v3_overlays_html = sub_comp_html("overlays", """
    .vignette {
      position: absolute; inset: 0; z-index: 5; pointer-events: none;
      background: radial-gradient(ellipse 65% 60% at 50% 50%, transparent 35%, rgba(0,0,0,0.75) 100%);
    }
    .grain {
      position: absolute; inset: 0; z-index: 6; pointer-events: none; opacity: 0.1;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    .color-grade {
      position: absolute; inset: 0; z-index: 7; pointer-events: none; mix-blend-mode: overlay; opacity: 0.35;
      background: linear-gradient(180deg, rgba(20,40,80,0.4), rgba(80,20,60,0.25), rgba(10,30,60,0.35));
    }
    .beat-flash {
      position: absolute; inset: 0; z-index: 8; pointer-events: none;
      background: radial-gradient(circle at 50% 40%, rgba(200,230,255,0.28), transparent 55%);
      opacity: 0; mix-blend-mode: screen;
    }
""", """
    <div class="vignette"></div>
    <div class="grain"></div>
    <div class="color-grade" id="colorGrade"></div>
    <div class="beat-flash" id="beatFlash"></div>
""", v3_overlays_script, "5")

v3_orb_script = """
    const DATA = window.DATA;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const { mulberry32, getEnergy, nextBeat, currentSection } = window.HF;
    const SECTION_COLORS = {
      intro:     { orb: 'rgba(180,220,255,0.95)', ring: 'rgba(140,200,255,0.4)' },
      verse:     { orb: 'rgba(200,240,220,0.95)', ring: 'rgba(120,220,180,0.4)' },
      chorus:    { orb: 'rgba(220,200,255,0.95)', ring: 'rgba(160,120,255,0.45)' },
      drop:      { orb: 'rgba(255,200,180,0.98)', ring: 'rgba(255,140,100,0.5)' },
      final_drop:{ orb: 'rgba(255,225,180,0.98)', ring: 'rgba(255,180,100,0.55)' },
      outro:     { orb: 'rgba(180,200,220,0.9)',  ring: 'rgba(120,160,200,0.35)' },
    };

    const orb = document.getElementById('orb');
    const orbTrail = document.getElementById('orbTrail');
    const orbRing = document.getElementById('orbRing');

    function applyFrame(t) {
      const energy = getEnergy(t);
      const beatHit = nextBeat(t, 0.14);
      const section = currentSection(t);
      const colors = window.COLOR_STATE.liveColors || (SECTION_COLORS[section] || SECTION_COLORS.intro);

      const orbX = Math.sin(t * 0.4) * 18;
      const orbY = Math.cos(t * 0.55) * 14;
      const scale = 0.8 + energy * 0.6 + (beatHit ? 0.14 : 0);
      orb.style.transform = 'translate(calc(-50% + ' + orbX + 'px), calc(-50% + ' + orbY + 'px)) scale(' + scale + ')';
      orb.style.opacity = 0.6 + energy * 0.4;
      orb.style.background = 'radial-gradient(circle at 35% 30%, ' + colors.orb + ', transparent 70%)';

      const trailX = Math.sin(t * 0.35 + 0.6) * 22;
      const trailY = Math.cos(t * 0.5 + 0.6) * 18;
      const trailScale = scale * 1.35;
      orbTrail.style.transform = 'translate(calc(-50% + ' + trailX + 'px), calc(-50% + ' + trailY + 'px)) scale(' + trailScale + ')';
      orbTrail.style.opacity = Math.max(0, (0.35 + energy * 0.35 - 0.15));
      orbTrail.style.background = 'radial-gradient(circle at 35% 30%, ' + colors.orb + ', transparent 65%)';

      const ringX = Math.cos(t * 0.35) * 12;
      const ringY = Math.sin(t * 0.45) * 10;
      orbRing.style.transform = 'translate(calc(-50% + ' + ringX + 'px), calc(-50% + ' + ringY + 'px)) scale(' + (0.85 + energy * 0.28) + ')';
      orbRing.style.opacity = 0.4 + energy * 0.5;
      orbRing.style.borderColor = colors.ring;
      orbRing.style.boxShadow = '0 0 40px ' + colors.ring + ', inset 0 0 40px ' + colors.ring;
    }
"""

v3_orb_html = sub_comp_html("orb", """
    .center-orb {
      position: absolute; left: 50%; top: 50%; z-index: 9; pointer-events: none;
      width: 420px; height: 420px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.8); opacity: 0;
      background: radial-gradient(circle at 35% 30%, rgba(230,245,255,0.95) 0%, rgba(100,160,255,0.5) 28%, rgba(30,60,180,0.18) 58%, transparent 100%);
      filter: blur(26px); mix-blend-mode: screen;
      will-change: transform, opacity;
    }
    .orb-trail {
      position: absolute; left: 50%; top: 50%; z-index: 8; pointer-events: none;
      width: 640px; height: 640px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.8); opacity: 0;
      background: radial-gradient(circle at 35% 30%, rgba(180,220,255,0.35) 0%, rgba(80,140,255,0.12) 35%, transparent 65%);
      filter: blur(50px); mix-blend-mode: screen;
      will-change: transform, opacity;
    }
    .orb-ring {
      position: absolute; left: 50%; top: 50%; z-index: 10; pointer-events: none;
      width: 520px; height: 520px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.85); opacity: 0;
      border: 1.2px solid rgba(140,200,255,0.3);
      box-shadow: 0 0 40px rgba(80,140,255,0.3), inset 0 0 40px rgba(80,140,255,0.12);
      transition: border-color 0.8s ease, box-shadow 0.8s ease;
    }
""", """
    <div class="orb-trail" id="orbTrail"></div>
    <div class="center-orb" id="orb"></div>
    <div class="orb-ring" id="orbRing"></div>
""", v3_orb_script, "9")

v3_spectrum_script = """
    const DATA = window.DATA;
    const ENERGY = DATA.energy_curve;
    const { getEnergy, getBandFrame, currentSection } = window.HF;
    const SECTION_COLORS = {
      intro:     { bar1: 'rgba(60,150,255,0.85)', bar2: 'rgba(140,100,255,0.55)' },
      verse:     { bar1: 'rgba(60,200,160,0.85)', bar2: 'rgba(120,200,140,0.55)' },
      chorus:    { bar1: 'rgba(140,100,255,0.9)', bar2: 'rgba(180,120,255,0.6)' },
      drop:      { bar1: 'rgba(255,100,80,0.9)',  bar2: 'rgba(255,160,80,0.65)' },
      final_drop:{ bar1: 'rgba(255,160,60,0.95)', bar2: 'rgba(255,200,100,0.7)' },
      outro:     { bar1: 'rgba(100,160,220,0.75)', bar2: 'rgba(120,160,200,0.5)' },
    };

    const spectrumEl = document.getElementById('spectrum');
    const BAR_COUNT = 64;
    const barEls = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const b = document.createElement('div');
      b.className = 'bar';
      b.style.height = '3px';
      spectrumEl.appendChild(b);
      barEls.push(b);
    }

    function applyFrame(t) {
      const energy = getEnergy(t);
      const bands = getBandFrame(t);
      const section = currentSection(t);
      const colors = window.COLOR_STATE.liveColors || (SECTION_COLORS[section] || SECTION_COLORS.intro);

      for (let i = 0; i < BAR_COUNT; i++) {
        const idx = Math.floor((i / BAR_COUNT) * bands.length);
        const val = bands[Math.min(idx, bands.length - 1)] || 0;
        const h = 4 + val * 260;
        barEls[i].style.height = h + 'px';
        barEls[i].style.background = 'linear-gradient(to top, ' + colors.bar1 + ', ' + colors.bar2 + ')';
        barEls[i].style.boxShadow = '0 0 16px ' + colors.bar1;
      }
    }
"""

v3_spectrum_html = sub_comp_html("spectrum", """
    .spectrum {
      position: absolute; bottom: 0; left: 0; right: 0; z-index: 11; pointer-events: none;
      height: 280px; display: flex; align-items: flex-end; gap: 4px; padding: 0 90px;
    }
    .bar {
      flex: 1; border-radius: 4px 4px 0 0; min-height: 3px;
      background: linear-gradient(to top, rgba(60,150,255,0.8), rgba(140,100,255,0.5));
      box-shadow: 0 0 14px rgba(100,180,255,0.55);
      transform-origin: bottom; opacity: 0.92;
      will-change: height;
    }
""", """
    <div class="spectrum" id="spectrum"></div>
""", v3_spectrum_script, "11")

# lyrics and labels are the same for v3
v3_lyrics_html = lyrics_html.replace('data-composition-id="lyrics"', 'data-composition-id="lyrics"')
v3_labels_html = labels_html.replace('data-composition-id="labels"', 'data-composition-id="labels"')

# Write v3 sub-compositions
for name, content in [
    ("backgrounds.html", bg_html),
    ("canvas-effects.html", v3_canvas_html),
    ("overlays.html", v3_overlays_html),
    ("orb.html", v3_orb_html),
    ("spectrum.html", v3_spectrum_html),
    ("lyrics.html", v3_lyrics_html),
    ("labels.html", v3_labels_html),
]:
    with open(os.path.join(V3_BASE, "compositions", name), "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Wrote v3/{name}")

# Write hosts
HOST_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1920, height=1080">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{
      width: 1920px; height: 1080px; overflow: hidden;
      background: #010208; font-family: 'Inter', ui-sans-serif, system-ui;
    }}
    #root-host {{
      position: relative; width: 1920px; height: 1080px;
      overflow: hidden; background: #010208;
      filter: contrast(1.08) saturate(1.15);
    }}
  </style>
</head>
<body>
  <div id="root-host" data-composition-id="built-this-from-a-dream" data-start="0" data-duration="218.76" data-width="1920" data-height="1080">
    <div data-composition-id="bg" data-composition-src="compositions/backgrounds.html" data-start="0" data-duration="218.76" data-track-index="0" data-width="1920" data-height="1080"></div>
    <div data-composition-id="canvas" data-composition-src="compositions/canvas-effects.html" data-start="0" data-duration="218.76" data-track-index="1" data-width="1920" data-height="1080"></div>
    <div data-composition-id="overlays" data-composition-src="compositions/overlays.html" data-start="0" data-duration="218.76" data-track-index="2" data-width="1920" data-height="1080"></div>
    <div data-composition-id="orb" data-composition-src="compositions/orb.html" data-start="0" data-duration="218.76" data-track-index="3" data-width="1920" data-height="1080"></div>
    <div data-composition-id="spectrum" data-composition-src="compositions/spectrum.html" data-start="0" data-duration="218.76" data-track-index="4" data-width="1920" data-height="1080"></div>
    <div data-composition-id="lyrics" data-composition-src="compositions/lyrics.html" data-start="0" data-duration="218.76" data-track-index="5" data-width="1920" data-height="1080"></div>
    <div data-composition-id="labels" data-composition-src="compositions/labels.html" data-start="0" data-duration="218.76" data-track-index="6" data-width="1920" data-height="1080"></div>

    <audio id="audioTrack" src="Built This From A Dream.mp3" data-start="0" data-duration="218.76" preload="auto"></audio>
  </div>

  <script>
    window.DATA = {{data}};
    window._seed = 42;
    window.mulberry32 = function() {{
      window._seed |= 0; window._seed = window._seed + 0x6D2B79F5 | 0;
      let t = Math.imul(window._seed ^ window._seed >>> 15, 1 | window._seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }};
    window.HF = window.HF || {{}};
    window.HF.getEnergy = function(t) {{
      const idx = Math.min(Math.floor(t * FPS), ENERGY.length - 1);
      return ENERGY[Math.max(0, idx)] || 0;
    }};
    window.HF.getBandFrame = function(t) {{
      const base = 0.15 + window.HF.getEnergy(t) * 0.55;
      const bands = [];
      for (let i = 0; i < 64; i++) {{
        const f = i / 64;
        const shape = Math.exp(-((f - 0.35) * (f - 0.35)) / 0.18) * 0.7 +
                      Math.exp(-((f - 0.7) * (f - 0.7)) / 0.12) * 0.5 +
                      window.mulberry32() * 0.25;
        bands.push(Math.min(1, Math.max(0.02, base * shape)));
      }}
      return bands;
    }};
    window.HF.nextBeat = function(t, lookAhead) {{
      lookAhead = lookAhead || 0.18;
      for (let i = 0; i < BEATS.length; i++) {{
        if (BEATS[i] > t && BEATS[i] - t <= lookAhead) return BEATS[i];
      }}
      return null;
    }};
    window.HF.currentSection = function(t) {{
      let sec = 'intro';
      for (let i = 0; i < LYRICS.length; i++) {{
        if (t >= LYRICS[i].start) sec = LYRICS[i].section;
      }}
      return sec;
    }};
    window.HF.rgbaInterp = function(a, b, t) {{
      const pa = a.match(/[\\d.]+/g).map(Number);
      const pb = b.match(/[\\d.]+/g).map(Number);
      if (!pa.length || !pb.length) return a;
      const r = Math.round(pa[0] + (pb[0]-pa[0]) * t);
      const g = Math.round(pa[1] + (pb[1]-pa[1]) * t);
      const bl = Math.round(pa[2] + (pb[2]-pa[2]) * t);
      const al = (pa[3] + (pb[3]-pa[3]) * t).toFixed(2);
      return 'rgba(' + r + ',' + g + ',' + bl + ',' + al + ')';
    }};
    window.HF.updateLiveColors = function(target, dt) {{
      const speed = 1 - Math.pow(0.0001, dt);
      window.COLOR_STATE.liveColors.orb = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.orb, target.orb, speed);
      window.COLOR_STATE.liveColors.ring = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.ring, target.ring, speed);
      window.COLOR_STATE.liveColors.bar1 = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.bar1, target.bar1, speed);
      window.COLOR_STATE.liveColors.bar2 = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.bar2, target.bar2, speed);
      window.COLOR_STATE.liveColors.grade = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.grade, target.grade, speed);
    }};

    window.__timelines = window.__timelines || {{}};
    const FPS = DATA.fps;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const LYRICS = DATA.lyrics;
    const DURATION = DATA.duration;
    const SECTION_COLORS = {{
      intro:     {{ orb: 'rgba(180,220,255,0.95)', ring: 'rgba(140,200,255,0.4)', bar1: 'rgba(60,150,255,0.85)', bar2: 'rgba(140,100,255,0.55)', grade: 'rgba(20,40,80,0.5)' }},
      verse:     {{ orb: 'rgba(200,240,220,0.95)', ring: 'rgba(120,220,180,0.4)',  bar1: 'rgba(60,200,160,0.85)', bar2: 'rgba(120,200,140,0.55)', grade: 'rgba(20,60,40,0.45)' }},
      chorus:    {{ orb: 'rgba(220,200,255,0.95)', ring: 'rgba(160,120,255,0.45)', bar1: 'rgba(140,100,255,0.9)', bar2: 'rgba(180,120,255,0.6)', grade: 'rgba(50,20,80,0.5)' }},
      drop:      {{ orb: 'rgba(255,200,180,0.98)', ring: 'rgba(255,140,100,0.5)',  bar1: 'rgba(255,100,80,0.9)',  bar2: 'rgba(255,160,80,0.65)', grade: 'rgba(80,25,15,0.55)' }},
      final_drop:{{ orb: 'rgba(255,225,180,0.98)', ring: 'rgba(255,180,100,0.55)', bar1: 'rgba(255,160,60,0.95)', bar2: 'rgba(255,200,100,0.7)', grade: 'rgba(80,50,10,0.6)' }},
      outro:     {{ orb: 'rgba(180,200,220,0.9)',  ring: 'rgba(120,160,200,0.35)', bar1: 'rgba(100,160,220,0.75)', bar2: 'rgba(120,160,200,0.5)', grade: 'rgba(10,20,40,0.45)' }},
    }};
    let activeSection = 'intro';
    let targetColors = SECTION_COLORS['intro'];
    window.COLOR_STATE = {{ liveColors: {{ ...targetColors }} }};

    let shakeX = 0, shakeY = 0, zoom = 1;
    let targetShakeX = 0, targetShakeY = 0, targetZoom = 1;
    let lastTime = 0;
    function applyFrame(t) {{
      const dt = Math.min(0.1, t - lastTime);
      lastTime = t;
      const energy = window.HF.getEnergy(t);
      const section = window.HF.currentSection(t);
      const bassHit = window.HF.nextBeat(t, 0.06);
      if (bassHit) {{
        const intensity = (section === 'drop' || section === 'final_drop') ? 6 : 3;
        targetShakeX = (window.mulberry32() - 0.5) * intensity;
        targetShakeY = (window.mulberry32() - 0.5) * intensity;
        targetZoom = 1 + ((section === 'drop' || section === 'final_drop') ? 0.04 : 0.015);
      }} else {{
        targetShakeX = 0; targetShakeY = 0; targetZoom = 1;
      }}
      shakeX += (targetShakeX - shakeX) * 0.18;
      shakeY += (targetShakeY - shakeY) * 0.18;
      zoom += (targetZoom - zoom) * 0.1;
      const root = document.getElementById('root-host');
      root.style.transform = 'translate(' + shakeX.toFixed(2) + 'px,' + shakeY.toFixed(2) + 'px) scale(' + zoom.toFixed(4) + ')';
    }}

    const tl = gsap.timeline({{ paused: true }});
    tl.to({{}}, {{
      duration: DURATION,
      ease: 'none',
      onUpdate: function() {{ applyFrame(this.time()); }}
    }});
    window.__timelines['built-this-from-a-dream'] = tl;
  </script>
</body>
</html>"""

# Root host
root_host = HOST_TMPL.replace("{{data}}", root_data)
root_host = root_host.replace("let activeSection = 'intro';\n    let targetColors = SECTION_COLORS['intro'];\n    window.COLOR_STATE = { liveColors: { ...targetColors } };", "")
root_host = root_host.replace("    const SECTION_COLORS = {\n      intro:     { orb: 'rgba(180,220,255,0.95)', ring: 'rgba(140,200,255,0.4)', bar1: 'rgba(60,150,255,0.85)', bar2: 'rgba(140,100,255,0.55)', grade: 'rgba(20,40,80,0.5)' },\n      verse:     { orb: 'rgba(200,240,220,0.95)', ring: 'rgba(120,220,180,0.4)',  bar1: 'rgba(60,200,160,0.85)', bar2: 'rgba(120,200,140,0.55)', grade: 'rgba(20,60,40,0.45)' },\n      chorus:    { orb: 'rgba(220,200,255,0.95)', ring: 'rgba(160,120,255,0.45)', bar1: 'rgba(140,100,255,0.9)', bar2: 'rgba(180,120,255,0.6)', grade: 'rgba(50,20,80,0.5)' },\n      drop:      { orb: 'rgba(255,200,180,0.98)', ring: 'rgba(255,140,100,0.5)',  bar1: 'rgba(255,100,80,0.9)',  bar2: 'rgba(255,160,80,0.65)', grade: 'rgba(80,25,15,0.55)' },\n      final_drop:{ orb: 'rgba(255,225,180,0.98)', ring: 'rgba(255,180,100,0.55)', bar1: 'rgba(255,160,60,0.95)', bar2: 'rgba(255,200,100,0.7)', grade: 'rgba(80,50,10,0.6)' },\n      outro:     { orb: 'rgba(180,200,220,0.9)',  ring: 'rgba(120,160,200,0.35)', bar1: 'rgba(100,160,220,0.75)', bar2: 'rgba(120,160,200,0.5)', grade: 'rgba(10,20,40,0.45)' },\n    };", "")
root_host = root_host.replace("    const ENERGY = DATA.energy_curve;\n    const BEATS = DATA.beat_times;\n    const LYRICS = DATA.lyrics;\n    const DURATION = DATA.duration;\n    const SECTION_COLORS = {\n      intro:     { orb: 'rgba(180,220,255,0.95)', ring: 'rgba(140,200,255,0.4)', bar1: 'rgba(60,150,255,0.85)', bar2: 'rgba(140,100,255,0.55)', grade: 'rgba(20,40,80,0.5)' },\n      verse:     { orb: 'rgba(200,240,220,0.95)', ring: 'rgba(120,220,180,0.4)',  bar1: 'rgba(60,200,160,0.85)', bar2: 'rgba(120,200,140,0.55)', grade: 'rgba(20,60,40,0.45)' },\n      chorus:    { orb: 'rgba(220,200,255,0.95)', ring: 'rgba(160,120,255,0.45)', bar1: 'rgba(140,100,255,0.9)', bar2: 'rgba(180,120,255,0.6)', grade: 'rgba(50,20,80,0.5)' },\n      drop:      { orb: 'rgba(255,200,180,0.98)', ring: 'rgba(255,140,100,0.5)',  bar1: 'rgba(255,100,80,0.9)',  bar2: 'rgba(255,160,80,0.65)', grade: 'rgba(80,25,15,0.55)' },\n      final_drop:{ orb: 'rgba(255,225,180,0.98)', ring: 'rgba(255,180,100,0.55)', bar1: 'rgba(255,160,60,0.95)', bar2: 'rgba(255,200,100,0.7)', grade: 'rgba(80,50,10,0.6)' },\n      outro:     { orb: 'rgba(180,200,220,0.9)',  ring: 'rgba(120,160,200,0.35)', bar1: 'rgba(100,160,220,0.75)', bar2: 'rgba(120,160,200,0.5)', grade: 'rgba(10,20,40,0.45)' },\n    };\n    let activeSection = 'intro';\n    let targetColors = SECTION_COLORS['intro'];\n    window.COLOR_STATE = { liveColors: { ...targetColors } };\n\n", "")

with open(os.path.join(BASE, "index.html"), "w", encoding="utf-8") as f:
    f.write(root_host)
print("Wrote root/index.html")

# v3 host
v3_host = HOST_TMPL.replace("{{data}}", v3_data)

with open(os.path.join(V3_BASE, "index.html"), "w", encoding="utf-8") as f:
    f.write(v3_host)
print("Wrote v3/index.html")

print("Done!")
