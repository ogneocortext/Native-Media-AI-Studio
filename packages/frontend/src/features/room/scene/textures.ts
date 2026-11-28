/**
 * Room textures — CC0 Poly Haven 2K sets (see packet report for sources)
 * plus procedural canvas for plaster / plain fabrics / rug (allowed by
 * knowledge doc §5: procedural is for plaster, plain fabric, variation).
 */

import * as THREE from "three";
import { useMemo } from "react";
import { useTexture } from "@react-three/drei";

const TEX = "/room/textures";

export interface PbrMaps {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
}

function configure(t: THREE.Texture, srgb: boolean, repeat = 1): THREE.Texture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  else t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Walnut veneer — bookcase, record player, side table, shelves. */
export function useWalnut(repeat = 1): PbrMaps {
  const [map, normalMap, roughnessMap, aoMap] = useTexture([
    `${TEX}/walnut_veneer_Diffuse_2k.jpg`,
    `${TEX}/walnut_veneer_nor_gl_2k.jpg`,
    `${TEX}/walnut_veneer_Rough_2k.jpg`,
    `${TEX}/walnut_veneer_AO_2k.jpg`,
  ]);
  return useMemo(
    () => ({
      map: configure(map, true, repeat),
      normalMap: configure(normalMap, false, repeat),
      roughnessMap: configure(roughnessMap, false, repeat),
      aoMap: configure(aoMap, false, repeat),
    }),
    [map, normalMap, roughnessMap, aoMap, repeat],
  );
}

/** Herringbone parquet floor. */
export function useFloor(repeat = 3): PbrMaps {
  const [map, normalMap, roughnessMap, aoMap] = useTexture([
    `${TEX}/herringbone_parquet_Diffuse_2k.jpg`,
    `${TEX}/herringbone_parquet_nor_gl_2k.jpg`,
    `${TEX}/herringbone_parquet_Rough_2k.jpg`,
    `${TEX}/herringbone_parquet_AO_2k.jpg`,
  ]);
  return useMemo(
    () => ({
      map: configure(map, true, repeat),
      normalMap: configure(normalMap, false, repeat),
      roughnessMap: configure(roughnessMap, false, repeat),
      aoMap: configure(aoMap, false, repeat),
    }),
    [map, normalMap, roughnessMap, aoMap, repeat],
  );
}

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  repeat = 1,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  configure(tex, true, repeat);
  return tex;
}

/** Warm plaster wall — subtle noise, cream palette. */
export function usePlaster(): THREE.Texture {
  return useMemo(
    () =>
      canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = "#e2d8c4";
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 9000; i++) {
          const v = 205 + Math.floor(Math.random() * 28);
          ctx.fillStyle = `rgba(${v},${v - 8},${v - 22},0.05)`;
          ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
        }
      }, 2),
    [],
  );
}

/** Deep indigo velvet for her chair — near-black violet nap. */
export function useVelvet(): THREE.Texture {
  return useMemo(
    () =>
      canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = "#4A3566";
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 6000; i++) {
          const l = Math.random();
          ctx.fillStyle =
            l > 0.5
              ? "rgba(120,95,160,0.06)"
              : "rgba(20,12,35,0.08)";
          ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
        }
      }),
    [],
  );
}

/** Cognac leather for the second seat — warm grain. */
export function useLeather(): THREE.Texture {
  return useMemo(
    () =>
      canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = "#A65E2E";
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 5000; i++) {
          const v = Math.random();
          ctx.fillStyle =
            v > 0.6
              ? "rgba(220,150,90,0.07)"
              : "rgba(90,40,15,0.08)";
          ctx.fillRect(Math.random() * s, Math.random() * s, 2.5, 1.5);
        }
      }),
    [],
  );
}

/** Indigo-wool rug with cream border — the seating anchor. */
export function useRug(): THREE.Texture {
  return useMemo(
    () =>
      canvasTexture(1024, (ctx, s) => {
        ctx.fillStyle = "#232344";
        ctx.fillRect(0, 0, s, s);
        // border
        ctx.strokeStyle = "#F7F1E5";
        ctx.lineWidth = s * 0.02;
        ctx.strokeRect(s * 0.04, s * 0.04, s * 0.92, s * 0.92);
        ctx.strokeStyle = "#4A3566";
        ctx.lineWidth = s * 0.008;
        ctx.strokeRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);
        // faint diamond motif, very low contrast
        ctx.strokeStyle = "rgba(247,241,229,0.08)";
        ctx.lineWidth = s * 0.004;
        for (let i = 0; i < 6; i++) {
          const x = s * (0.2 + i * 0.12);
          const y = s * 0.5;
          ctx.beginPath();
          ctx.moveTo(x - s * 0.05, y);
          ctx.lineTo(x, y - s * 0.06);
          ctx.lineTo(x + s * 0.05, y);
          ctx.lineTo(x, y + s * 0.06);
          ctx.closePath();
          ctx.stroke();
        }
        // weave noise
        for (let i = 0; i < 14000; i++) {
          ctx.fillStyle = `rgba(${20 + Math.random() * 30},${20 + Math.random() * 30},${60 + Math.random() * 40},0.05)`;
          ctx.fillRect(Math.random() * s, Math.random() * s, 2, 1);
        }
      }),
    [],
  );
}

/** Aged paper for book/page surfaces. */
export function usePaper(): THREE.Texture {
  return useMemo(
    () =>
      canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = "#d9c9a8";
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 1200; i++) {
          ctx.fillStyle = `rgba(160,140,100,${Math.random() * 0.08})`;
          ctx.fillRect(Math.random() * s, Math.random() * s, 2, 1);
        }
      }),
    [],
  );
}

/** Indigo night for the window — deep blue-black with faint city glow. */
export function useNightWindow(): THREE.Texture {
  return useMemo(
    () =>
      canvasTexture(512, (ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, 0, s);
        g.addColorStop(0, "#05060f");
        g.addColorStop(0.7, "#0d0d24");
        g.addColorStop(1, "#1a1a3d");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
        // sparse warm pinpricks — distant windows across the night
        for (let i = 0; i < 60; i++) {
          const warm = Math.random() > 0.4;
          ctx.fillStyle = warm
            ? `rgba(255,${170 + Math.floor(Math.random() * 60)},120,${0.25 + Math.random() * 0.5})`
            : `rgba(140,160,220,${0.15 + Math.random() * 0.3})`;
          const w = 1 + Math.random() * 3;
          ctx.fillRect(Math.random() * s, Math.random() * s * 0.8, w, w * 0.6);
        }
      }),
    [],
  );
}
