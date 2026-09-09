#!/usr/bin/env python3
"""Fix sub-compositions: add camera shake to host, fix v3 color state, remove from overlays."""

import os

BASE = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\tools\hyperframes-built-this-from-a-dream"
V3_BASE = os.path.join(BASE, "v3")

# ─── Root project ────────────────────────────────────────────────────────────

# Fix host index.html to include camera shake timeline
with open(os.path.join(BASE, "index.html"), "r", encoding="utf-8") as f:
    host = f.read()

host = host.replace(
    """    window.__timelines = window.__timelines || {};
    window.__timelines['built-this-from-a-dream'] = { duration: 218.76, fps: 24 };""",
    """    window._seed = 42;
    window.mulberry32 = function() {
      window._seed |= 0; window._seed = window._seed + 0x6D2B79F5 | 0;
      let t = Math.imul(window._seed ^ window._seed >>> 15, 1 | window._seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    window.HF = window.HF || {};
    window.HF.getEnergy = function(t) {
      const idx = Math.min(Math.floor(t * FPS), ENERGY.length - 1);
      return ENERGY[Math.max(0, idx)] || 0;
    };
    window.HF.getBandFrame = function(t) {
      const base = 0.15 + window.HF.getEnergy(t) * 0.55;
      const bands = [];
      for (let i = 0; i < 64; i++) {
        const f = i / 64;
        const shape = Math.exp(-((f - 0.35) * (f - 0.35)) / 0.18) * 0.7 +
                      Math.exp(-((f - 0.7) * (f - 0.7)) / 0.12) * 0.5 +
                      window.mulberry32() * 0.25;
        bands.push(Math.min(1, Math.max(0.02, base * shape)));
      }
      return bands;
    };
    window.HF.nextBeat = function(t, lookAhead) {
      lookAhead = lookAhead || 0.18;
      for (let i = 0; i < BEATS.length; i++) {
        if (BEATS[i] > t && BEATS[i] - t <= lookAhead) return BEATS[i];
      }
      return null;
    };
    window.HF.currentSection = function(t) {
      let sec = 'intro';
      for (let i = 0; i < LYRICS.length; i++) {
        if (t >= LYRICS[i].start) sec = LYRICS[i].section;
      }
      return sec;
    };

    window.__timelines = window.__timelines || {};
    const FPS = DATA.fps;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const LYRICS = DATA.lyrics;
    const DURATION = DATA.duration;

    let shakeX = 0, shakeY = 0, zoom = 1;
    function applyFrame(t) {
      const energy = window.HF.getEnergy(t);
      const beatHit = window.HF.nextBeat(t, 0.14);
      const bassHit = window.HF.nextBeat(t, 0.06);
      const section = window.HF.currentSection(t);
      if (bassHit) {
        const intensity = (section === 'drop' || section === 'final_drop') ? 6 : 3;
        shakeX = (window.mulberry32() - 0.5) * intensity;
        shakeY = (window.mulberry32() - 0.5) * intensity;
        zoom = 1 + ((section === 'drop' || section === 'final_drop') ? 0.04 : 0.015);
      } else {
        shakeX *= 0.85; shakeY *= 0.85;
        zoom += (1 - zoom) * 0.08;
      }
      const root = document.getElementById('root-host');
      root.style.transform = 'translate(' + shakeX + 'px,' + shakeY + 'px) scale(' + zoom + ')';
    }

    const tl = gsap.timeline({ paused: true });
    tl.to({}, {
      duration: DURATION,
      ease: 'none',
      onUpdate: function() { applyFrame(this.time()); }
    });
    window.__timelines['built-this-from-a-dream'] = tl;"""
)

with open(os.path.join(BASE, "index.html"), "w", encoding="utf-8") as f:
    f.write(host)
print("Fixed root host index.html")

# Remove camera shake from root overlays
with open(os.path.join(BASE, "compositions", "overlays.html"), "r", encoding="utf-8") as f:
    overlays = f.read()

# The root overlays shouldn't have camera shake - host owns it
overlays = overlays.replace(
    """    const DATA = window.DATA;
    const DURATION = DATA.duration;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const { mulberry32, getEnergy, nextBeat, currentSection } = window.HF;
    const SECTION_COLORS = {
      intro:     { grade: 'rgba(20,40,80,0.5)' },
      verse:     { grade: 'rgba(20,60,40,0.45)' },
      chorus:    { grade: 'rgba(50,20,80,0.5)' },
      drop:      { grade: 'rgba(80,25,15,0.55)' },
      final_drop:{ grade: 'rgba(80,50,10,0.6)' },
      outro:     { grade: 'rgba(10,20,40,0.45)' },
    };

    const colorGrade = document.getElementById('colorGrade');
    const flash = document.getElementById('beatFlash');

    function applyFrame(t) {
      const energy = getEnergy(t);
      const beatHit = nextBeat(t, 0.14);
      const section = currentSection(t);
      const colors = SECTION_COLORS[section] || SECTION_COLORS.intro;

      colorGrade.style.background =
        'linear-gradient(180deg, ' + colors.grade + ', rgba(0,0,0,0.2), ' + colors.grade + ')';

      if (beatHit) {
        flash.style.opacity = 0.65 + energy * 0.35;
        setTimeout(() => { flash.style.opacity = 0; }, 110);
      }
    }""",
    """    const DATA = window.DATA;
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
    }"""
)

with open(os.path.join(BASE, "compositions", "overlays.html"), "w", encoding="utf-8") as f:
    f.write(overlays)
print("Fixed root overlays.html")

# ─── v3 project ──────────────────────────────────────────────────────────────

# Fix v3 host index.html
with open(os.path.join(V3_BASE, "index.html"), "r", encoding="utf-8") as f:
    v3_host = f.read()

v3_host = v3_host.replace(
    """    window.__timelines = window.__timelines || {};
    window.__timelines['built-this-from-a-dream'] = { duration: 218.76, fps: 24 };""",
    """    window._seed = 42;
    window.mulberry32 = function() {
      window._seed |= 0; window._seed = window._seed + 0x6D2B79F5 | 0;
      let t = Math.imul(window._seed ^ window._seed >>> 15, 1 | window._seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    window.HF = window.HF || {};
    window.HF.getEnergy = function(t) {
      const idx = Math.min(Math.floor(t * FPS), ENERGY.length - 1);
      return ENERGY[Math.max(0, idx)] || 0;
    };
    window.HF.getBandFrame = function(t) {
      const base = 0.15 + window.HF.getEnergy(t) * 0.55;
      const bands = [];
      for (let i = 0; i < 64; i++) {
        const f = i / 64;
        const shape = Math.exp(-((f - 0.35) * (f - 0.35)) / 0.18) * 0.7 +
                      Math.exp(-((f - 0.7) * (f - 0.7)) / 0.12) * 0.5 +
                      window.mulberry32() * 0.25;
        bands.push(Math.min(1, Math.max(0.02, base * shape)));
      }
      return bands;
    };
    window.HF.nextBeat = function(t, lookAhead) {
      lookAhead = lookAhead || 0.18;
      for (let i = 0; i < BEATS.length; i++) {
        if (BEATS[i] > t && BEATS[i] - t <= lookAhead) return BEATS[i];
      }
      return null;
    };
    window.HF.currentSection = function(t) {
      let sec = 'intro';
      for (let i = 0; i < LYRICS.length; i++) {
        if (t >= LYRICS[i].start) sec = LYRICS[i].section;
      }
      return sec;
    };
    window.HF.rgbaInterp = function(a, b, t) {
      const pa = a.match(/[\\d.]+/g).map(Number);
      const pb = b.match(/[\\d.]+/g).map(Number);
      if (!pa.length || !pb.length) return a;
      const r = Math.round(pa[0] + (pb[0]-pa[0]) * t);
      const g = Math.round(pa[1] + (pb[1]-pa[1]) * t);
      const bl = Math.round(pa[2] + (pb[2]-pa[2]) * t);
      const al = (pa[3] + (pb[3]-pa[3]) * t).toFixed(2);
      return 'rgba(' + r + ',' + g + ',' + bl + ',' + al + ')';
    };
    window.HF.updateLiveColors = function(target, dt) {
      const speed = 1 - Math.pow(0.0001, dt);
      window.COLOR_STATE.liveColors.orb = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.orb, target.orb, speed);
      window.COLOR_STATE.liveColors.ring = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.ring, target.ring, speed);
      window.COLOR_STATE.liveColors.bar1 = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.bar1, target.bar1, speed);
      window.COLOR_STATE.liveColors.bar2 = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.bar2, target.bar2, speed);
      window.COLOR_STATE.liveColors.grade = window.HF.rgbaInterp(window.COLOR_STATE.liveColors.grade, target.grade, speed);
    };

    window.__timelines = window.__timelines || {};
    const FPS = DATA.fps;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const LYRICS = DATA.lyrics;
    const DURATION = DATA.duration;

    let shakeX = 0, shakeY = 0, zoom = 1;
    let targetShakeX = 0, targetShakeY = 0, targetZoom = 1;
    let lastTime = 0;
    function applyFrame(t) {
      const dt = Math.min(0.1, t - lastTime);
      lastTime = t;
      const energy = window.HF.getEnergy(t);
      const section = window.HF.currentSection(t);
      const bassHit = window.HF.nextBeat(t, 0.06);
      if (bassHit) {
        const intensity = (section === 'drop' || section === 'final_drop') ? 6 : 3;
        targetShakeX = (window.mulberry32() - 0.5) * intensity;
        targetShakeY = (window.mulberry32() - 0.5) * intensity;
        targetZoom = 1 + ((section === 'drop' || section === 'final_drop') ? 0.04 : 0.015);
      } else {
        targetShakeX = 0; targetShakeY = 0; targetZoom = 1;
      }
      shakeX += (targetShakeX - shakeX) * 0.18;
      shakeY += (targetShakeY - shakeY) * 0.18;
      zoom += (targetZoom - zoom) * 0.1;
      const root = document.getElementById('root-host');
      root.style.transform = 'translate(' + shakeX.toFixed(2) + 'px,' + shakeY.toFixed(2) + 'px) scale(' + zoom.toFixed(4) + ')';
    }

    const tl = gsap.timeline({ paused: true });
    tl.to({}, {
      duration: DURATION,
      ease: 'none',
      onUpdate: function() { applyFrame(this.time()); }
    });
    window.__timelines['built-this-from-a-dream'] = tl;"""
)

with open(os.path.join(V3_BASE, "index.html"), "w", encoding="utf-8") as f:
    f.write(v3_host)
print("Fixed v3 host index.html")

# Fix v3 overlays to manage color state
with open(os.path.join(V3_BASE, "compositions", "overlays.html"), "r", encoding="utf-8") as f:
    v3_overlays = f.read()

v3_overlays = v3_overlays.replace(
    """    const DATA = window.DATA;
    const ENERGY = DATA.energy_curve;
    const BEATS = DATA.beat_times;
    const { getEnergy, nextBeat, currentSection } = window.HF;
    const SECTION_COLORS = {
      intro:     { grade: 'rgba(20,40,80,0.5)' },
      verse:     { grade: 'rgba(20,60,40,0.45)' },
      chorus:    { grade: 'rgba(50,20,80,0.5)' },
      drop:      { grade: 'rgba(80,25,15,0.55)' },
      final_drop:{ grade: 'rgba(80,50,10,0.6)' },
      outro:     { grade: 'rgba(10,20,40,0.45)' },
    };

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
    }""",
    """    const DATA = window.DATA;
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
    window.COLOR_STATE = { liveColors: { ...targetColors } };

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
    }"""
)

with open(os.path.join(V3_BASE, "compositions", "overlays.html"), "w", encoding="utf-8") as f:
    f.write(v3_overlays)
print("Fixed v3 overlays.html")

# Fix v3 orb to use liveColors
with open(os.path.join(V3_BASE, "compositions", "orb.html"), "r", encoding="utf-8") as f:
    v3_orb = f.read()

v3_orb = v3_orb.replace(
    """    const DATA = window.DATA;
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
      const colors = SECTION_COLORS[section] || SECTION_COLORS.intro;""",
    """    const DATA = window.DATA;
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
      const colors = window.COLOR_STATE.liveColors || (SECTION_COLORS[section] || SECTION_COLORS.intro);"""
)

# Also fix the color usage in v3 orb to use liveColors
v3_orb = v3_orb.replace(
    "      orb.style.background = 'radial-gradient(circle at 35% 30%, ' + colors.orb + ', transparent 70%)';",
    "      orb.style.background = 'radial-gradient(circle at 35% 30%, ' + colors.orb + ', transparent 70%)';"
)
v3_orb = v3_orb.replace(
    "      orbTrail.style.background = 'radial-gradient(circle at 35% 30%, ' + colors.orb + ', transparent 65%)';",
    "      orbTrail.style.background = 'radial-gradient(circle at 35% 30%, ' + colors.orb + ', transparent 65%)';"
)
v3_orb = v3_orb.replace(
    "      orbRing.style.borderColor = colors.ring;",
    "      orbRing.style.borderColor = colors.ring;"
)
v3_orb = v3_orb.replace(
    "      orbRing.style.boxShadow = '0 0 40px ' + colors.ring + ', inset 0 0 40px ' + colors.ring;",
    "      orbRing.style.boxShadow = '0 0 40px ' + colors.ring + ', inset 0 0 40px ' + colors.ring;"
)

with open(os.path.join(V3_BASE, "compositions", "orb.html"), "w", encoding="utf-8") as f:
    f.write(v3_orb)
print("Fixed v3 orb.html")

# Fix v3 spectrum to use liveColors
with open(os.path.join(V3_BASE, "compositions", "spectrum.html"), "r", encoding="utf-8") as f:
    v3_spectrum = f.read()

v3_spectrum = v3_spectrum.replace(
    """      const section = currentSection(t);
      const colors = SECTION_COLORS[section] || SECTION_COLORS.intro;""",
    """      const section = currentSection(t);
      const colors = window.COLOR_STATE.liveColors || (SECTION_COLORS[section] || SECTION_COLORS.intro);"""
)

with open(os.path.join(V3_BASE, "compositions", "spectrum.html"), "w", encoding="utf-8") as f:
    f.write(v3_spectrum)
print("Fixed v3 spectrum.html")

print("All fixes applied!")
