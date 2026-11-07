import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/**
 * Shared GLTFLoader factory with KTX2 (Basis) texture support.
 *
 * The backend 3D pipeline emits GLBs whose embedded textures are
 * KTX2/Basis-compressed (KHR_texture_basisu, ETC1S). drei's `useGLTF`
 * uses a bare GLTFLoader with no KTX2Loader attached, so those textures
 * fail to decode and the model renders untextured. This module wires a
 * KTX2Loader (transcoder assets served from `/basis/`, copied from
 * `three/examples/jsm/libs/basis/` into `public/basis/`) into every
 * GLTFLoader we create.
 *
 * `KTX2Loader.detectSupport(renderer)` is required — it probes which
 * GPU compressed-texture formats the renderer supports so the transcoder
 * worker picks the right output format. Loaders are therefore cached per
 * WebGLRenderer via WeakMap.
 */

/** Public path to the Basis transcoder files (basis_transcoder.js/.wasm). */
export const BASIS_TRANSCODER_PATH = "/basis/";

const ktx2Loaders = new WeakMap<THREE.WebGLRenderer, KTX2Loader>();
const gltfLoaders = new WeakMap<THREE.WebGLRenderer, GLTFLoader>();

/**
 * Returns a GLTFLoader with KTX2 support bound to `renderer`, cached so
 * repeated calls for the same renderer reuse one loader (important for
 * @react-three/fiber's useLoader cache key, which is [loader, url]).
 */
export function getGLTFLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  let loader = gltfLoaders.get(renderer);
  if (!loader) {
    let ktx2 = ktx2Loaders.get(renderer);
    if (!ktx2) {
      ktx2 = new KTX2Loader()
        .setTranscoderPath(BASIS_TRANSCODER_PATH)
        .detectSupport(renderer);
      ktx2Loaders.set(renderer, ktx2);
    }
    loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2);
    gltfLoaders.set(renderer, loader);
  }
  return loader;
}

// ---------------------------------------------------------------------------
// Fallback for non-R3F code paths (e.g. three-js-studio's vanilla THREE scene)
// that create GLTFLoaders without a renderer in scope. The scene's renderer
// registers itself here on creation; until then loaders are created plain.
// ---------------------------------------------------------------------------

let registeredRenderer: THREE.WebGLRenderer | null = null;

/** Called once by scene bootstraps that own a WebGLRenderer. */
export function registerGLTFRenderer(renderer: THREE.WebGLRenderer): void {
  registeredRenderer = renderer;
}

/**
 * Creates a GLTFLoader for ad-hoc loads. Attaches KTX2 support when a
 * renderer has been registered via {@link registerGLTFRenderer}; otherwise
 * returns a plain GLTFLoader (KTX2 textures will not decode).
 */
export function createGLTFLoader(): GLTFLoader {
  if (registeredRenderer) return getGLTFLoader(registeredRenderer);
  return new GLTFLoader();
}
