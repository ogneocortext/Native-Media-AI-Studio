# Unity Animation & Content Creation (2026 Standards)

*Research gathered 2026-08-24*
*Focus: Open-source tools only — no subscription fees*

## Audio-Reactive Animation (Open Source)

### CHOR (chor.studio)
- Beat-synchronized animation templates for Unity
- <1ms precision, no drift
- Import .chor.json, connect animations to beat events
- Works with Mecanim, Timeline, Cinemachine
- Free during beta

### Audio Sync Pro (Unity Asset Store)
- Sync any game element to audio
- Audio Timeline for precise events
- Reactors for dynamic animation (objects, effects, lighting)
- Works outside Play Mode for editor preview

### Music Lights (Unity Asset Store)
- Audio-reactive lighting and object scaling
- Envelope-based response: fast attack, slow decay, noise gate, smoothing
- Four frequency bands: Bass, Mid, Treble, Full
- Reactor API for custom behavior
- No raw FFT flicker

### Koreographer (koreographer.com)
- Proactive audio synchronization
- Animation time measured in beats, not seconds
- Auto-adjusts to tempo changes
- MIDI converter, color events, audio analysis

### Honami Animation System (GitHub)
- Zero-allocation alternative to Unity Animator
- Node-graph editor for states, transitions, blends
- Built-in procedural rigging (LookAt, Pose, Pseudo-Physics)
- Linked Brain: broadcast state changes by tag/radius/wave
- FPS Cap LOD for distant characters

## AI Texturing

### Unity Material Generator (beta)
- Text → PBR material in-editor
- Base map + PBR tab (normal, height, metallic, smoothness, emission, occlusion)
- Upscale tab for resolution enhancement
- Requires Unity 6.0+, Unity Cloud, AI credits
- Pattern reference images for seamless tiling

### Meshy (meshy.ai)
- AI PBR textures baked to model UVs (not flat-tiled)
- Up to 8K base color, 4K PBR maps
- Delighting: removes baked lighting from albedo
- Export: GLB, FBX, OBJ, USDZ
- 2K/4K: ~10 credits, ~1 min
- 8K: ~15 credits, ~2 min

### Unity Muse Texture
- Photo-Real-Unity-Texture-2 model
- 16-bit heightmaps by default
- Improved: wood, brick, concrete, leather, metal, gravel, soil
- $30/month subscription

## 3D Modeling

### Unity 3D Object Generator (beta)
- Text/image → 3D mesh prefab
- Simple, single-part props
- Standard Unity prefab with mesh + materials
- AI-tagged metadata

### Blender MCP + Hunyuan3D-2mini
- Text/image → 3D in Blender
- 5-6GB VRAM for shape generation
- ComfyUI integration

## Viral Content Techniques

### Beat-Synced Animation
- Envelope-based response (not raw FFT)
- Bass band → strong pulses
- Treble band → light flicker
- Smooth attack/decay to avoid jerky motion

### Procedural Audio Reactivity
- Scale, rotation, color, emission all driven by audio
- Use frequency bands for varied response
- Combine multiple reactors for complex scenes

### AI-Assisted Workflow
- Generate materials from text prompts
- Generate 3D props from text/images
- Prototype entire scenes before committing to final art
- All AI assets tagged for easy identification/replacement

## Recommended Pipeline for HappyShrimp Tracks

1. **Analyze**: GPU audio analysis (torch.stft) → beat times, spectral features
2. **Generate**: AI materials (Unity Material Generator) for surfaces
3. **Animate**: Beat-synced keyframes using envelope-based response
4. **Enhance**: Audio-reactive lighting (bass = strong pulses)
5. **Render**: GPU render (Cycles CUDA) → frames → FFmpeg video

## Installation

### Unity Packages
```
Window → Package Manager → Add by name:
- com.unity.timeline (for Timeline-based animation)
- com.unity.ai.generators (for Material Generator, beta)
- com.unity.cinemachine (for camera control)
```

### Asset Store
- Audio Sync Pro
- Music Lights
- Koreographer

### External
- CHOR: download .chor.json from chor.studio
- Meshy: meshy.ai for PBR textures
- Honami: GitHub loyal-studio/Honami-Animation-System
