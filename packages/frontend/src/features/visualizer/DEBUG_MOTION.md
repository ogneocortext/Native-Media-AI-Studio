# Visualizer Debug & Motion Verification

## ffmpeg Screen-Recording Approach (Preferred)

When canvas-based capture gives false negatives (e.g., 0.00% motion for an animating shader), use ffmpeg to record the actual display output and analyze extracted frames.

### Why this works
- CDP/canvas screenshots can return blank or stale frames for WebGL contexts due to compositor timing or context loss.
- ffmpeg `gdigrab` captures the real rendered output, bypassing canvas probing issues entirely.

### Setup
```powershell
# Verify ffmpeg is on PATH
ffmpeg -version
```

### Record
```powershell
# 10 seconds of primary monitor at 30fps
ffmpeg -f gdigrab -framerate 30 -i desktop `
  -c:v libx264 -pix_fmt yuv420p `
  -t 10 `
  browser-test\\out\\visualizer_capture.mp4
```

### Extract frames
```powershell
# 1fps extraction to numbered PNGs
$framesDir = "browser-test\\out\\visualizer_frames"
New-Item -ItemType Directory -Force -Path $framesDir | Out-Null
ffmpeg -i browser-test\\out\\visualizer_capture.mp4 `
  -vf "fps=1,scale=3840:-1" `
  $framesDir\\frame_%03d.png
```

### Analyze with Sharp
```js
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const FRAMES_DIR = 'browser-test/out/visualizer_frames';
const files = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).sort();

function crop(img) {
  const { width, height } = img.metadata;
  return img.extract({
    left: Math.floor(width * 0.13),
    top: Math.floor(height * 0.05),
    width: Math.floor(width * 0.83),
    height: Math.floor(height * 0.88)
  });
}

async function diff(a, b) {
  const [ra, ga, ba] = await Promise.all([
    crop(sharp(path.join(FRAMES_DIR, a)).raw()).ensureAlpha().toBuffer(),
    crop(sharp(path.join(FRAMES_DIR, b)).raw()).ensureAlpha().toBuffer()
  ]);
  const len = Math.min(ra.length, ga.length, ba.length);
  let changed = 0;
  for (let i = 0; i < len; i++) {
    if (Math.abs(ra[i] - ga[i]) > 20) changed++;
  }
  return (changed / (len / 3)) * 100;
}

(async () => {
  for (let i = 1; i < files.length; i++) {
    const pct = await diff(files[i-1], files[i]);
    const max = await maxDiff(files[i-1], files[i]);
    console.log(`${files[i-1]} -> ${files[i]}: ${pct.toFixed(2)}% changed, max intensity ${max.toFixed(2)}%`);
  }
})();
```

### Interpreting results
- **Smooth continuous motion** (e.g., `abstractWaves`): 0.05–0.4% avg, peaks ~1%. This is real motion undercounted by per-frame differencing.
- **Abrupt changes** (e.g., 2D bars, beat drops): 2–16%+.
- **Static / broken**: 0.00% consistently, with max pixel diff near 0%.
- Confirm with `maxDiff`: sample the highest-diff pixel pair between two frames; >50% intensity shift proves the shader is updating.

### Built-in debug toggle (ShaderCanvas)
Append `#shader-debug` to the visualizer URL to enable lightweight motion logging:
- Logs a 3×3 pixel-grid diff every ~1s
- Output: `[ShaderCanvas debug] frame=60 time=1.0s avgPixelDiff=12.3`
- Remove the hash to disable; no code changes needed

### Quick verification script
Use `scripts/verify-shader-motion.mjs` instead of the old canvas-screenshot capture script. It records the actual display with ffmpeg, extracts frames, and analyzes with sharp.

```powershell
# 10s capture, 1fps analysis, default track
node scripts/verify-shader-motion.mjs

# Specify track + duration
node scripts/verify-shader-motion.mjs --track "NeoCortext - Built This From A Dream" --duration 15 --fps 2 --threshold 15
```

### Known values for this project
- Canvas area on 3000x1920 desktop: crop `{left:400, top:100, width:2500, height:1700}` (adjust for your resolution).
- Track "NeoCortext - Built This From A Dream" maps to `abstractWaves` preset.
