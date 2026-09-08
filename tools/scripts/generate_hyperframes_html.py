#!/usr/bin/env python3
"""Generate index.html for Built This From A Dream HyperFrames project."""
import json
from pathlib import Path

ROOT = Path("tools/hyperframes-built-this-from-a-dream")
data = json.loads((ROOT / "data.json").read_text(encoding="utf-8"))

beat_times = data["beat_times"]
energy_curve = data["energy_curve"]
band_frames = data["band_frames"]
lyrics = data["lyrics"]
tempo = data["tempo"]
duration = data["duration"]
fps = data["fps"]

lyric_js = json.dumps(lyrics, ensure_ascii=False)
beat_times_js = json.dumps(beat_times)
energy_js = json.dumps(energy_curve)
band_frames_js = json.dumps(band_frames)

html = r'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1920, height=1080">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 1920px; height: 1080px; overflow: hidden;
      background: #030308; font-family: 'Inter', ui-sans-serif, system-ui;
    }
    #root {
      position: relative; width: 1920px; height: 1080px;
      overflow: hidden; background: #030308;
    }
    .bg-aurora {
      position: absolute; inset: -100px; z-index: 0;
      background:
        radial-gradient(ellipse 140% 80% at 50% 40%, rgba(30,80,180,0.35), transparent 50%),
        radial-gradient(ellipse 100% 60% at 30% 70%, rgba(0,180,160,0.2), transparent 45%),
        radial-gradient(ellipse 90% 50% at 80% 20%, rgba(120,60,200,0.25), transparent 45%);
      filter: blur(30px) saturate(1.4);
    }
    .bg-grid {
      position: absolute; inset: 0; z-index: 1; opacity: 0.06;
      background-image:
        linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px);
      background-size: 80px 80px;
    }
    .beat-flash {
      position: absolute; inset: 0; z-index: 2; pointer-events: none;
      background: radial-gradient(circle at 50% 40%, rgba(180,220,255,0.25), transparent 55%);
      opacity: 0; mix-blend-mode: screen;
    }
    .lyric-wrap {
      position: absolute; inset: 0; z-index: 10;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      pointer-events: none; padding: 0 160px; text-align: center;
    }
    .lyric-line {
      font-size: 56px; font-weight: 600; line-height: 1.35; letter-spacing: 0.01em;
      color: rgba(255,255,255,0.92);
      text-shadow: 0 0 30px rgba(140,200,255,0.5), 0 0 60px rgba(80,120,255,0.3);
      margin: 0.15em 0; opacity: 0; transform: translateY(18px) scale(0.97);
    }
    .lyric-line.active {
      opacity: 1; transform: translateY(0) scale(1);
    }
    .lyric-line .word {
      display: inline-block; opacity: 0.35; transform: scale(0.96);
      transition: opacity 0.18s, transform 0.18s, color 0.18s, text-shadow 0.18s;
      margin: 0 0.25em;
    }
    .lyric-line .word.lit {
      opacity: 1; transform: scale(1.06); color: #fff;
      text-shadow: 0 0 16px rgba(200,230,255,0.9), 0 0 32px rgba(100,160,255,0.6);
    }
    .section-label {
      position: absolute; top: 40px; right: 60px; z-index: 20;
      font-size: 13px; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase;
      color: rgba(255,255,255,0.55); font-family: ui-monospace, monospace;
    }
    .bpm-label {
      position: absolute; bottom: 40px; left: 60px; z-index: 20;
      font-size: 13px; font-weight: 500; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.45); font-family: ui-monospace, monospace;
    }
    .center-orb {
      position: absolute; left: 50%; top: 50%; z-index: 3; pointer-events: none;
      width: 320px; height: 320px; border-radius: 50%;
      transform: translate(-50%, -50%) scale(0.8); opacity: 0;
      background: radial-gradient(circle at 40% 35%, rgba(200,230,255,0.9) 0%, rgba(80,140,255,0.5) 35%, rgba(30,60,180,0.2) 65%, transparent 100%);
      filter: blur(18px); mix-blend-mode: screen;
    }
    .spectrum {
      position: absolute; bottom: 0; left: 0; right: 0; z-index: 8; pointer-events: none;
      height: 220px; display: flex; align-items: flex-end; gap: 3px; padding: 0 60px;
    }
    .bar {
      flex: 1; border-radius: 3px 3px 0 0; min-height: 3px;
      background: linear-gradient(to top, rgba(80,160,255,0.7), rgba(160,120,255,0.4));
      box-shadow: 0 0 8px rgba(100,180,255,0.5);
      transform-origin: bottom; opacity: 0.85;
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="built-this-from-a-dream" data-start="0" data-duration="''' + str(duration) + '''" data-width="1920" data-height="1080">
    <div class="bg-aurora"></div>
    <div class="bg-grid"></div>
    <div class="beat-flash" id="beatFlash"></div>
    <div class="center-orb" id="orb"></div>
    <div class="spectrum" id="spectrum"></div>
    <div class="lyric-wrap" id="lyricWrap"></div>
    <div class="section-label" id="sectionLabel">INTRO</div>
    <div class="bpm-label" id="bpmLabel">''' + f"{tempo:.1f} BPM" + '''</div>
  </div>

  <script>
    // ─── PRE-EXTRACTED DATA ─────────────────────────────────────────────────
    const DATA = ''' + lyric_js + r'''.map(l => l); // lyrics array preserved below
    const AUDIO = {
      fps: ''' + str(fps) + r''',
      duration: ''' + str(duration) + r''',
      tempo: ''' + str(tempo) + r''',
      beat_times: ''' + beat_times_js + r''',
      energy_curve: ''' + energy_js + r''',
      band_frames: ''' + band_frames_js + r''',
      lyrics: ''' + lyric_js + r'''
    };

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
    const lyricWrap = document.getElementById('lyricWrap');
    const spectrumEl = document.getElementById('spectrum');
    const sectionLabel = document.getElementById('sectionLabel');
    const bpmLabel = document.getElementById('bpmLabel');
    const root = document.getElementById('root');

    // ─── BUILD LYRIC ELEMENTS ────────────────────────────────────────────────
    const lineEls = [];
    LYRICS.forEach((lyric) => {
      const el = document.createElement('div');
      el.className = 'lyric-line';
      const words = lyric.text.split(' ');
      el.innerHTML = words.map((w, wi) => '<span class="word" data-wi="' + wi + '">' + w + '</span>').join(' ');
      lyricWrap.appendChild(el);
      lineEls.push(el);
    });

    // ─── BUILD SPECTRUM BARS ─────────────────────────────────────────────────
    const BAR_COUNT = 64;
    const barEls = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const b = document.createElement('div');
      b.className = 'bar';
      b.style.height = '3px';
      spectrumEl.appendChild(b);
      barEls.push(b);
    }

    // ─── HELPERS ─────────────────────────────────────────────────────────────
    function getEnergy(t) {
      const f = Math.min(Math.floor(t * FPS), ENERGY.length - 1);
      return ENERGY[f] || 0.5;
    }
    function getBands(t) {
      let idx = BANDS.findIndex(bf => bf.t > t);
      if (idx <= 0) idx = 1;
      return BANDS[idx - 1].b || [0.5,0.5,0.5,0.5,0.5,0.5,0.5];
    }
    function nearestBeatDist(t) {
      let best = 999;
      for (let i = 0; i < BEATS.length; i++) {
        const d = Math.abs(BEATS[i] - t);
        if (d < best) best = d;
      }
      return best;
    }
    function getSection(t) {
      let sec = 'verse';
      for (const l of LYRICS) {
        if (t >= l.start && t < l.end) { sec = l.section; break; }
      }
      return sec;
    }

    const SECTION_PALETTES = {
      intro:      { bg: 'rgba(20,40,100,0.35)',  glow: 'rgba(80,160,255,0.5)',  accent: '#4a9eff' },
      verse:      { bg: 'rgba(20,80,80,0.3)',    glow: 'rgba(0,200,180,0.5)',   accent: '#00ffcc' },
      drop:       { bg: 'rgba(100,30,120,0.35)', glow: 'rgba(200,80,255,0.6)',  accent: '#c050ff' },
      final_drop: { bg: 'rgba(120,40,40,0.4)',   glow: 'rgba(255,120,60,0.6)',  accent: '#ff8844' },
    };

    // ─── GSAP TIMELINE ───────────────────────────────────────────────────────
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });

    // Per-frame audio reactivity (pre-computed bands + energy)
    const bandUpdates = [];
    for (let f = 0; f < TOTAL_FRAMES; f++) {
      const t = f / FPS;
      const bands = getBands(t);
      const bass = bands[0];
      const mid = bands[2];
      const treble = bands[6];
      const e = getEnergy(t);
      bandUpdates.push({ t, bass, mid, treble, e });
    }

    bandUpdates.forEach((u) => {
      tl.call(
        (function(frame) {
          return function() {
            const bass = frame.bass;
            const mid = frame.mid;
            const treble = frame.treble;
            const e = frame.e;
            const t = frame.t;

            // Orb pulse
            const orbScale = 0.8 + bass * 0.5 + e * 0.4;
            orb.style.transform = 'translate(-50%, -50%) scale(' + orbScale + ')';
            orb.style.opacity = (0.25 + e * 0.45).toFixed(3);

            // Spectrum bars
            const baseIdx = Math.floor(t * 10) % BANDS.length;
            for (let i = 0; i < BAR_COUNT; i++) {
              const bandIdx = (baseIdx + Math.floor(i / 8)) % BANDS.length;
              const safeIdx = Math.min(bandIdx, BANDS.length - 1);
              const val = BANDS[safeIdx].b[Math.min(i % 7, 6)];
              const h = Math.max(3, val * 200);
              barEls[i].style.height = h + 'px';
            }

            // Section + background
            const sec = getSection(t);
            const pal = SECTION_PALETTES[sec] || SECTION_PALETTES.verse;
            sectionLabel.textContent = sec.replace('_', ' ').toUpperCase();
            sectionLabel.style.color = pal.accent;
            root.style.background = 'radial-gradient(ellipse 120% 80% at 50% 40%, ' + pal.bg + ', #030308 60%)';
          };
        })(u),
        [],
        u.t
      );
    });

    // ─── LYRIC ANIMATION ─────────────────────────────────────────────────────
    LYRICS.forEach((lyric) => {
      const lineEl = lineEls[LYRICS.indexOf(lyric)];
      const words = lineEl.querySelectorAll('.word');
      const wordDur = (lyric.end - lyric.start) / words.length;

      // Line entrance
      tl.to(lineEl, {
        opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'power2.out',
      }, lyric.start);

      // Word karaoke
      words.forEach((w, wi) => {
        const wt = lyric.start + wi * wordDur;
        tl.to(w, {
          opacity: 1, scale: 1.06, color: '#fff',
          textShadow: '0 0 16px rgba(200,230,255,0.9), 0 0 32px rgba(100,160,255,0.6)',
          duration: 0.18, ease: 'power1.out',
        }, wt);
        tl.to(w, {
          opacity: 0.55, scale: 1.0, color: 'rgba(255,255,255,0.85)',
          textShadow: '0 0 8px rgba(140,200,255,0.4)',
          duration: 0.25, ease: 'power1.in',
        }, wt + wordDur * 0.7);
      });

      // Line exit
      tl.to(lineEl, {
        opacity: 0, y: -12, scale: 0.97, duration: 0.3, ease: 'power2.in',
      }, lyric.end - 0.15);
    });

    // ─── BEAT PULSE ──────────────────────────────────────────────────────────
    BEATS.forEach((bt, bi) => {
      const down = bi % 4 === 0;
      tl.to(flash, {
        opacity: down ? 0.9 : 0.5, duration: 0.06, ease: 'power4.out',
      }, bt);
      tl.to(flash, {
        opacity: 0, duration: 0.35, ease: 'power2.out',
      }, bt + 0.08);
      tl.to(orb, {
        scale: 1 + (down ? 0.35 : 0.2), duration: 0.08, ease: 'power4.out',
      }, bt);
      tl.to(orb, {
        scale: 1, duration: 0.4, ease: 'elastic.out(1, 0.5)',
      }, bt + 0.08);
    });

    // Hold final frame
    tl.set({}, {}, DURATION - 0.5);

    window.__timelines['built-this-from-a-dream'] = tl;
  </script>
</body>
</html>'''

out_path = ROOT / "index.html"
out_path.write_text(html, encoding="utf-8")
print(f"Wrote {out_path} ({out_path.stat().st_size // 1024} KB)")
