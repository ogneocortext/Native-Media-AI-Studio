import type * as THREE from "three";

/**
 * Diffuse-wrap lighting (T-VIZ-23): remaps the direct-light N·L term so the
 * terminator softens instead of clipping to black — the "wrapped diffuse"
 * look used for stylized/game-toon shading.
 *
 * Implemented as an `onBeforeCompile` patch on MeshStandardMaterial (and
 * subclasses like MeshPhysicalMaterial from GLBs) that rewrites the
 * `dotNL` computation inside `RE_Direct_Physical`. Specular BRDFs keep the
 * physical saturate — only the diffuse irradiance wraps.
 *
 * The wrap amount lives in a single shared uniform object referenced by
 * every patched shader, so changing the slider is a uniform write — no
 * program rebuild, no per-material state.
 */

export const diffuseWrapUniform = { value: 0 };

const PATCH_FLAG = "__studioDiffuseWrap";

// u=0 must reproduce stock `saturate(dotNL)` exactly; u=1 wraps the
// terminator fully ((dotNL + 1) / 2 reaches 0 only at dotNL = -1).
const DOT_NL_STOCK = "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );";
const DOT_NL_WRAP =
  "float dotNL = clamp( ( dot( geometryNormal, directLight.direction ) + uDiffuseWrap ) / ( 1.0 + uDiffuseWrap ), 0.0, 1.0 );";

export function applyDiffuseWrap(material: THREE.Material): void {
  const std = material as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  const userData = std.userData as Record<string, unknown>;
  if (userData[PATCH_FLAG]) return;
  userData[PATCH_FLAG] = true;

  // onBeforeCompile lives on Material.prototype as a no-op; an own-property
  // override (e.g. from applied AI scene code) must keep running, so the
  // patch chains it. The unbound-method rule cannot see that `.call(std)`
  // below rebinds it.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const previous = std.onBeforeCompile;
  std.onBeforeCompile = (shader, renderer) => {
    previous.call(std, shader, renderer);
    shader.uniforms.uDiffuseWrap = diffuseWrapUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uDiffuseWrap;")
      .replace(DOT_NL_STOCK, DOT_NL_WRAP);
  };
  // All patched materials share one program per pre-existing
  // onBeforeCompile variant: the wrap amount is a uniform, not a #define,
  // so there is nothing per-material to key on beyond what was already
  // in the material's program key.
  std.customProgramCacheKey = () => `studio-diffuse-wrap:${previous.toString()}`;
  std.needsUpdate = true;
}

/** Patch every standard material under `root` (idempotent). */
export function applyDiffuseWrapToScene(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    if (Array.isArray(material)) material.forEach(applyDiffuseWrap);
    else applyDiffuseWrap(material);
  });
}

export function setDiffuseWrap(value: number): void {
  diffuseWrapUniform.value = value;
}

// QA probe handle — same pattern as window.__scene/__camera in types.ts.
if (typeof window !== "undefined") {
  window.__diffuseWrapUniform = diffuseWrapUniform;
}
