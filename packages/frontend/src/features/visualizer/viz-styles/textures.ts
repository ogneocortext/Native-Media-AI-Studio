import * as THREE from "three";

let _particleTex: THREE.Texture | null = null;
let _noiseTex: THREE.Texture | null = null;

export function getParticleTex(): THREE.Texture {
  if (_particleTex) return _particleTex;
  console.log("[VizStyles] Creating particle texture");
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _particleTex = new THREE.CanvasTexture(cv);
  return _particleTex;
}

export function getNoiseTex(): THREE.Texture {
  if (_noiseTex) return _noiseTex;
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = s;
  cv.height = s;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _noiseTex = new THREE.CanvasTexture(cv);
  _noiseTex.wrapS = _noiseTex.wrapT = THREE.RepeatWrapping;
  return _noiseTex;
}
