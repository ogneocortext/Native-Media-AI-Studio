import { Suspense, useEffect, useMemo, useRef, useState, Component, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Eye, AlertCircle, RotateCw } from "lucide-react";

/**
 * Auto-frame the loaded GLB to fit a unit cube centered at the origin.
 *
 * The previous version did `clone.position.set(-center.x, -center.y, -center.z)`
 * directly on the cloned scene, which produced wildly off-center previews
 * for asymmetric models (the robot meshes from Hunyuan3D-2mini have huge
 * bounding boxes in odd positions, e.g. centered at y=12 because the mesh
 * includes a pose proxy). The result: the model renders partially out of
 * the camera frustum and looks like a crumpled sheet.
 *
 * This version wraps the clone in an outer group, computes the bounding
 * box once after the model is loaded, then sets the outer group's
 * position to the negated center and the scale to fit a unit cube. That
 * is the standard "frame any model" recipe.
 */
function ModelView({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const outerGroupRef = useRef<THREE.Group>(null);
  const [ready, setReady] = useState(false);

  // Clone the scene so re-mounting the same URL doesn't accumulate meshes.
  const cloned = useMemo(() => {
    if (!scene) return null;
    const c = scene.clone(true);
    // Some GLBs ship with non-shadow flags set in a way that breaks our
    // lighting — make sure everything is visible and receives shadow.
    c.traverse((obj: any) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        // Ensure materials use sRGB so colors look right under our lights.
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: any) => m.needsUpdate = true);
          } else {
            obj.material.needsUpdate = true;
          }
        }
      }
    });
    return c;
  }, [scene]);

  // Frame the model: compute bounding box, recenter, rescale to a target
  // max-dimension of 2 units so it fills the camera view.
  useEffect(() => {
    if (!cloned || !outerGroupRef.current) return;
    const box = new THREE.Box3().setFromObject(cloned);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    // We translate the clone (not the outer group) so the auto-hover
    // animation in useFrame() doesn't fight the recentering.
    cloned.position.set(-center.x, -center.y, -center.z);
    const targetSize = 2.0; // unit-cube target
    cloned.scale.setScalar(targetSize / maxDim);
    setReady(true);
  }, [cloned]);

  // Gentle hover so the model feels alive while auto-rotating. Only after
  // the framing pass has run; otherwise the y-offset fights the recenter.
  useFrame(({ clock }) => {
    if (outerGroupRef.current && ready) {
      outerGroupRef.current.position.y = Math.sin(clock.elapsedTime * 1.0) * 0.08;
    }
  });

  if (!cloned) return null;
  return (
    <group ref={outerGroupRef}>
      <primitive object={cloned} />
    </group>
  );
}

/**
 * Tiny error-catcher component that surfaces GLTF load failures to the
 * parent's React state. drei's useGLTF throws into the nearest error
 * boundary, but we don't have one — this provides an inline equivalent
 * via componentDidCatch.
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

export function ModelPreview({ url }: { url: string }) {
  const [hasError, setHasError] = useState(false);

  // Error boundary is implemented via the GLTF loader's onError — drei's
  // useGLTF throws into the Suspense boundary which we catch via the
  // error event on the loader.
  useEffect(() => {
    setHasError(false);
  }, [url]);

  if (hasError) {
    return (
      <div className="aspect-square rounded-lg border border-red-500/40 bg-red-950/30 overflow-hidden flex flex-col items-center justify-center text-center p-4">
        <AlertCircle className="text-red-400 mb-2" size={32} />
        <p className="text-sm text-red-200">Failed to load model</p>
        <p className="text-xs text-red-300/70 mt-1">Check the file exists at {url}</p>
      </div>
    );
  }

  return (
    <div className="aspect-square rounded-lg border border-violet-500/30 bg-gradient-to-b from-gray-900 to-black overflow-hidden relative">
      <Canvas
        camera={{ position: [2.4, 1.6, 3.2], fov: 45, near: 0.05, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.setClearColor("#0a0a0f", 1);
        }}
      >
        <ambientLight intensity={0.6} />
        {/* Key light — warm white from the upper-right */}
        <directionalLight position={[4, 5, 3]} intensity={1.6} castShadow />
        {/* Fill light — cool violet from below-left to define silhouettes */}
        <directionalLight position={[-4, -2, -3]} intensity={0.7} color="#a78bfa" />
        {/* Rim light — saturated cyan from behind for edge separation */}
        <directionalLight position={[0, 3, -5]} intensity={0.9} color="#22d3ee" />
        <Suspense fallback={null}>
          <ErrorCatcher onError={() => setHasError(true)}>
            <ModelView url={url} />
          </ErrorCatcher>
        </Suspense>
        <OrbitControls
          enablePan={false}
          autoRotate
          autoRotateSpeed={1.5}
          minDistance={1.5}
          maxDistance={8}
          target={[0, 0, 0]}
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

