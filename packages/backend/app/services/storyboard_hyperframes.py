"""Compile structured storyboard data into a portable HyperFrames composition."""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CompiledStoryboard:
    composition_path: Path
    manifest_path: Path
    scene_count: int
    duration_seconds: float


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "storyboard"


def _scenes(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw_scenes = data.get("scenes") or data.get("beats")
    if not isinstance(raw_scenes, list) or not raw_scenes:
        raise ValueError("storyboard must contain a non-empty scenes or beats list")
    scenes: list[dict[str, Any]] = []
    previous_end = 0.0
    for index, raw in enumerate(raw_scenes):
        if not isinstance(raw, dict):
            raise ValueError(f"scene {index} must be an object")
        timing = raw.get("time_range", [0, 0])
        if "start" in raw or "end" in raw:
            start = float(raw["start"])
            end = float(raw["end"])
        elif "duration_seconds" in raw:
            start = previous_end
            end = start + float(raw["duration_seconds"])
        elif isinstance(timing, list) and len(timing) == 2:
            start = float(timing[0]); end = float(timing[1])
        else:
            raise ValueError(f"scene {index} has no start/end or duration_seconds")
        if start < 0 or end <= start or start < previous_end - 0.001:
            raise ValueError(f"scene {index} has invalid or overlapping timing")
        previous_end = end
        scenes.append({
            "id": str(raw.get("id") or f"scene-{index + 1}"),
            "title": str(raw.get("title") or raw.get("actTitle") or raw.get("section") or f"Scene {index + 1}"),
            "description": str(raw.get("description") or raw.get("visual") or raw.get("hook") or ""),
            "start": start,
            "end": end,
            "palette": raw.get("palette") if isinstance(raw.get("palette"), dict) else {},
            "camera": raw.get("camera") if isinstance(raw.get("camera"), dict) else {},
        })
    if scenes:
        scenes[0]["start"] = 0.0
        for index in range(len(scenes) - 1):
            scenes[index]["end"] = max(scenes[index]["end"], scenes[index + 1]["start"])
    return scenes


def build_hyperframes_audio_payload(
    analysis: dict[str, Any], transcript: dict[str, Any] | None = None, fps: int = 30, bands: int = 16
) -> dict[str, Any]:
    """Build deterministic, compact AUDIO_DATA from cached analysis + lyrics."""
    duration = float(analysis.get("duration_seconds") or analysis.get("duration") or 0)
    if duration <= 0:
        raise ValueError("analysis duration must be positive")
    fps = max(1, min(int(fps), 60))
    total_frames = max(1, int(duration * fps) + 1)
    energy_curve = [max(0.0, min(1.0, float(x))) for x in analysis.get("energy_curve", [])]
    beats = sorted(float(x) for x in analysis.get("beat_times", []) if float(x) >= 0)
    downbeats = set(float(x) for x in analysis.get("downbeat_times", []))
    if not downbeats and beats:
        # Beat analysis commonly returns the beat grid but omits downbeat_times.
        # Derive 4/4 downbeats as every other beat (beat 1 of each 2-beat half-measure),
        # matching the studio's audio-reactive default.
        downbeats = set(beats[::2])
    beat_frames = {round(t * fps) for t in beats}
    downbeat_frames = {round(t * fps) for t in downbeats}
    lines = (transcript or {}).get("lines") or (transcript or {}).get("segments", [])
    frames = []
    for index in range(total_frames):
        energy = energy_curve[min(index, len(energy_curve) - 1)] if energy_curve else 0.0
        band_values = [max(0.0, min(1.0, energy * (1.0 - band / (bands * 1.6)))) for band in range(bands)]
        frames.append({
            "time": round(index / fps, 4), "rms": energy, "energy": energy,
            "bands": band_values, "isBeat": index in beat_frames,
            "isDownbeat": index in downbeat_frames,
        })
    return {"fps": fps, "duration": duration, "bands": bands, "totalFrames": total_frames,
            "beat_times": beats, "downbeat_times": sorted(downbeats), "frames": frames,
            "lyrics": lines}


def _json_script(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def _composition_html(title: str, duration: float, scenes: list[dict[str, Any]], audio: str | None, audio_data: dict[str, Any] | None = None) -> str:
    safe_audio = html.escape(audio, quote=True) if audio else ""
    audio_tag = f'<audio data-hf-id="hf-storyboard-audio" src="{safe_audio}" data-start="0" data-duration="{duration:.3f}" preload="auto"></audio>' if safe_audio else ""
    audio_json = _json_script(audio_data) if audio_data else "null"
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080">
<style>*{{box-sizing:border-box}}html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:#050510;color:#fff;font-family:Inter,Arial,sans-serif}}#root{{position:relative;width:1920px;height:1080px;overflow:hidden;background:#050510}} .scene{{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 14%;opacity:0;background:radial-gradient(circle at 72% 45%,var(--primary) 0%,transparent 46%),linear-gradient(135deg,var(--base),#03040a 78%)}} .scene:before{{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.62),transparent 62%,rgba(0,0,0,.28));pointer-events:none}} .eyebrow{{position:relative;font-size:20px;letter-spacing:.28em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:24px}} .title{{position:relative;font-size:44px;font-weight:600;letter-spacing:.04em;max-width:920px;margin:0 0 34px;color:rgba(255,255,255,.9)}} .description{{position:relative;font-size:64px;font-weight:800;line-height:1.08;letter-spacing:-.025em;max-width:1240px;text-wrap:balance;text-shadow:0 8px 35px rgba(0,0,0,.5)}} .motif{{position:absolute;right:12%;top:23%;width:420px;height:420px;border:1px solid var(--accent);border-radius:50%;opacity:.55;box-shadow:0 0 80px var(--primary),inset 0 0 60px var(--primary)}} .motif:before,.motif:after{{content:"";position:absolute;inset:44px;border:1px solid var(--accent);border-radius:50%}} .motif:after{{inset:130px}} .scene-number{{position:absolute;right:11%;bottom:15%;font-size:140px;font-weight:800;line-height:1;color:rgba(255,255,255,.055)}} .progress{{position:absolute;left:7%;right:7%;bottom:7%;height:3px;background:rgba(255,255,255,.14);z-index:5}} .progress span{{display:block;height:100%;width:0;background:#fff}}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script></head><body>
<div id="root" data-hf-id="hf-storyboard-root" data-composition-id="storyboard" data-start="0" data-duration="{duration:.3f}" data-width="1920" data-height="1080">{audio_tag}<div class="progress"><span id="progress"></span></div></div>
<script>const AUDIO_DATA={audio_json};const STORYBOARD={_json_script(scenes)};const duration={duration:.3f};const root=document.getElementById('root');const progress=document.getElementById('progress');for(const [i,scene] of STORYBOARD.entries()){{const el=document.createElement('section');el.className='scene';el.id='storyboard-scene-'+i;el.style.setProperty('--base',scene.palette.base||'#050510');el.style.setProperty('--primary',scene.palette.primary||'#263238');el.style.setProperty('--accent',scene.palette.accent||'#a5b4fc');el.innerHTML='<div class="eyebrow">'+scene.id.replace(/^lyric-/,'LYRIC ')+'</div><div class="title">'+scene.title+'</div><div class="description">'+scene.description+'</div><div class="motif"></div><div class="scene-number">'+String(i+1).padStart(2,'0')+'</div>';root.appendChild(el)}}const elements=[...document.querySelectorAll('.scene')];const tl=gsap.timeline({{paused:true}});STORYBOARD.forEach((scene,i)=>{{const at=Math.max(0,scene.start);const end=Math.max(at+0.8,scene.end);tl.fromTo(elements[i],{{autoAlpha:0,scale:1.035}},{{autoAlpha:1,scale:1,duration:.75,ease:'power2.out'}},at);tl.to(elements[i],{{autoAlpha:0,duration:.55,ease:'power1.inOut'}},Math.max(at,end-.55));tl.to(elements[i].querySelector('.motif'),{{rotation:i%2?360:-360,scale:1.08,duration:Math.max(.8,end-at),ease:'none'}},at);}});tl.to(progress,{{width:'100%',duration:{duration:.3f},ease:'none'}},0);if(AUDIO_DATA&&AUDIO_DATA.frames){{for(let f=0;f<AUDIO_DATA.totalFrames;f++){{const frame=AUDIO_DATA.frames[f];const energy=frame.energy||0;const bass=(frame.bands&&frame.bands[0])||0;tl.to('.motif',{{scale:1+energy*.12+(frame.isBeat?.10:0),opacity:.45+energy*.55,boxShadow:'0 0 '+(40+bass*80)+'px var(--primary)'}},f/AUDIO_DATA.fps,0);}}}}window.__timelines=window.__timelines||{{}};window.__timelines.storyboard=tl;tl.progress(0);</script></body></html>'''


def compile_storyboard(
    storyboard: dict[str, Any], output_dir: str | Path, name: str = "storyboard",
    title: str | None = None, audio_path: str | None = None,
    audio_data: dict[str, Any] | None = None,
) -> CompiledStoryboard:
    """Validate and compile a storyboard into ``name.html`` plus ``name.json``."""
    if not isinstance(storyboard, dict):
        raise ValueError("storyboard must be an object")
    scenes = _scenes(storyboard)
    duration = max(float(storyboard.get("duration", 0) or 0), scenes[-1]["end"])
    if duration <= 0:
        raise ValueError("storyboard duration must be positive")
    scenes[-1]["end"] = duration
    safe_name = _slug(name)
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    composition_path = output / f"{safe_name}.html"
    manifest_path = output / f"{safe_name}.json"
    manifest = {"title": title or str(storyboard.get("title") or storyboard.get("track") or name), "track": storyboard.get("track"), "duration": duration, "scene_count": len(scenes), "scenes": scenes}
    resolved_audio = audio_path
    if audio_path:
        source = Path(audio_path)
        if not source.is_absolute():
            source = output.parent / source
        if not source.exists():
            source = Path.cwd() / audio_path
        if source.exists():
            project_root = output.parent
            destination = project_root / source.name
            if source.resolve() != destination.resolve():
                destination.write_bytes(source.read_bytes())
            resolved_audio = source.name
    composition_path.write_text(_composition_html(manifest["title"], duration, scenes, resolved_audio, audio_data), encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return CompiledStoryboard(composition_path, manifest_path, len(scenes), duration)
