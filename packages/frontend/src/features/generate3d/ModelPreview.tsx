import { Suspense, useEffect, useMemo, useRef, useState, Component, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Eye, AlertCircle, RotateCw } from "lucide-react";

/**
 * Frame any GLB for clean studio-quality preview.
 *
 * Why this exists:
 * Hunyuan3D-2mini (the 3D-gen model in this app's ComfyUI pipeline) emits
 * GLBs that are "geometry-only": they ship with POSITION but no NORMAL,
 * TANGENT, TEXCOORD_0, or material index. Three.js renders these as a
 * forest of flat per-face triangles ("spike forest") because the shader
 * has no smooth normals to interpolate. The fix is to recompute the
 * vertex normals from the position data after load.
 *
 * What this does:
 * 1. Clone the loaded scene
 * 2. For every BufferGeometry: ensureIndex + computeVertexNormals so the
 *    PBR shader gets smooth shading
 * 3. Apply a tasteful PBR material (no GLB-supplied material to read)
 * 4. Compute the bounding box, recenter the clone, and scale to fit a
 *    2-unit target so the camera can frame the whole subject
 * 5. Add a subtle ground disk + soft contact shadow for spatial context
 * 6. Render inside an Environment (RoomEnvironment preset) so PBR
 *    materials have IBL reflections and look real instead of flat
 */
function ModelView({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const outerGroupRef = useRef<THREE.Group>(null);
  const [ready, setReady] = useState(false);

  // Clone the scene so re-mounting the same URL doesn't accumulate meshes.
  // Then walk every mesh, recompute missing normals, and apply a tasteful
  // PBR material so the model reads as 3D instead of as flat triangles.
  const { cloned, framed } = useMemo(() => {
    if (!scene) return { cloned: null, framed: false };
    const c = scene.clone(true);

    c.traverse((obj: any) => {
      if (!obj.isMesh || !obj.geometry) return;

      const geom = obj.geometry as THREE.BufferGeometry;
      // Ensure the geometry is indexed (computeVertexNormals needs indices
      // for correct smoothing across shared vertices). If the GLB emits
      // a non-indexed buffer, computeVertexNormals on it produces flat
      // per-face normals. mergeVertices welds coincident vertices first
      // so the resulting normals are smooth across the mesh.
      if (!geom.index) {
        const merged = mergeVertices(geom, 0.0001);
        if (merged) {
          obj.geometry = merged;
        }
      }
      const g = obj.geometry as THREE.BufferGeometry;

      // Recompute normals from positions. This is the key fix — without
      // it, the "spike forest" rendering happens.
      g.computeVertexNormals();
      // Recompute the bounding sphere/box so OrbitControls + framing work.
      g.computeBoundingBox();
      g.computeBoundingSphere();

      // Apply a high-quality PBR material. The GLB has no material slot,
      // so we set one explicitly. Use a slight roughness so the model
      // catches highlights without being mirror-shiny (which exposes
      // every mesh imperfection).
      obj.material = new THREE.MeshStandardMaterial({
        color: 0xb8b8c4,
        metalness: 0.35,
        roughness: 0.45,
        envMapIntensity: 0.8,
        flatShading: false,
      });
      obj.castShadow = true;
      obj.receiveShadow = true;
    });

    // Center + scale the model so it fits a 2-unit target cube.
    const box = new THREE.Box3().setFromObject(c);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      c.position.set(-center.x, -center.y, -center.z);
      c.scale.setScalar(2.0 / maxDim);
      return { cloned: c, framed: true };
    }
    return { cloned: c, framed: false };
  }, [scene]);

  // Mark ready after the first paint so the auto-hover starts from a
  // framed state. Without this gate the hover offset fights the
  // recentering on the first few frames.
  useEffect(() => {
    if (framed) setReady(true);
  }, [framed]);

  // Gentle hover so the model feels alive while auto-rotating. Only
  // after framing; otherwise the y-offset fights the recenter.
  useFrame(({ clock }) => {
    if (outerGroupRef.current && ready) {
      outerGroupRef.current.position.y = Math.sin(clock.elapsedTime * 1.0) * 0.06;
    }
  });

  if (!cloned) return null;
  return (
    <group ref={outerGroupRef}>
      <primitive object={cloned} />
    </group>
  );
}

export function ModelPreview({ url }: { url: string }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [url]);

  if (hasError) {
    return (
      <div className="aspect-square rounded-lg border border-red-500/40 bg-red-950/30 overflow-hidden flex flex-col items-center justify-center text-center p-4">
        <AlertCircle className="text-red-400 mb-2" size={32} />
        <p className="text-sm text-red-200">Failed to load model</p>
        <p className="text-xs text-red-300/70 mt-1 break-all">Check the file exists at {url}</p>
      </div>
    );
  }

  return (
    <div className="aspect-square rounded-lg border border-violet-500/30 bg-gradient-to-b from-gray-900 to-black overflow-hidden relative">
      <Canvas
        camera={{ position: [2.8, 1.8, 3.4], fov: 38, near: 0.05, far: 100 }}
        dpr={[1, 2]}
        shadows="soft"
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        onCreated={({ gl }) => {
          gl.setClearColor("#0a0a0f", 1);
        }}
      >
        {/* IBL: drei's <Environment> with the built-in 'studio' preset
            (a soft warm-cool HDR cubemap) gives PBR materials real
            reflections so the metalness 0.35 / roughness 0.45 actually
            shows highlights. Without this, PBR materials look matte. */}
        <Suspense fallback={null}>
          <Environment preset="studio" background={false} blur={0.6} />
        </Suspense>

        <ambientLight intensity={0.35} />
        {/* Key light — warm white from upper-right, casts shadow */}
        <directionalLight
          position={[4, 5, 3]}
          intensity={1.8}
          color="#fff4e0"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0005}
        />
        {/* Fill light — cool violet from below-left */}
        <directionalLight position={[-4, -1, -3]} intensity={0.55} color="#a78bfa" />
        {/* Rim light — saturated cyan from behind */}
        <directionalLight position={[0, 3, -5]} intensity={1.0} color="#22d3ee" />

        {/* Ground disk + soft contact shadow. Helps the model feel
            grounded in the scene. */}
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.05, 0]}>
          <circleGeometry args={[1.6, 64]} />
          <meshStandardMaterial
            color="#1a1a22"
            metalness={0.1}
            roughness={0.85}
            envMapIntensity={0.4}
          />
        </mesh>

        <Suspense fallback={null}>
          <ErrorCatcher onError={() => setHasError(true)}>
            <ModelView url={url} />
          </ErrorCatcher>
        </Suspense>

        <OrbitControls
          enablePan={false}
          autoRotate
          autoRotateSpeed={1.2}
          minDistance={1.8}
          maxDistance={6}
          target={[0, 0, 0]}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-gray-400 bg-black/60 px-2 py-0.5 rounded flex items-center gap-1">
        <Eye size={10} /> Drag to orbit · scroll to zoom · auto-rotating
      </div>
      <div className="pointer-events-none absolute top-2 right-2 text-[10px] text-gray-500 bg-black/50 px-1.5 py-0.5 rounded flex items-center gap-1">
        <RotateCw size={9} /> GLB
      </div>
    </div>
  );
}

/**
 * Inline error-catcher for the GLTF loader. drei's useGLTF throws into
 * the nearest error boundary, but we don't have one — this provides
 * the equivalent via componentDidCatch.
 */
class ErrorCatcher extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
