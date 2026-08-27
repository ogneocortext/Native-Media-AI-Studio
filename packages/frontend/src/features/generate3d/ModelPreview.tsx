import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { EyeOff } from "lucide-react";

function ModelView({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  // Center + normalize the mesh so it fills the viewport nicely.
  useMemo(() => {
    if (!clone) return;
    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    clone.position.set(-center.x, -center.y, -center.z);
    if (maxDim > 0) clone.scale.multiplyScalar(1.6 / maxDim);
  }, [clone]);

  // Gentle hover so the model feels alive even when paused.
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.position.y = Math.sin(clock.elapsedTime * 1.2) * 0.03;
  });

  return (
    <group ref={groupRef}>
      <primitive object={clone} />
    </group>
  );
}

export function ModelPreview({ url }: { url: string }) {
  return (
    <div className="aspect-square rounded-lg border border-violet-500/30 bg-gradient-to-b from-gray-900 to-black overflow-hidden">
      <Canvas camera={{ position: [2.4, 1.8, 2.6], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 5, 3]} intensity={1.4} />
        <directionalLight position={[-4, -2, -3]} intensity={0.5} color="#a78bfa" />
        <Suspense fallback={<Fallback />}>
          <ModelView url={url} />
        </Suspense>
        <OrbitControls enablePan={false} autoRotate autoRotateSpeed={2.5} minDistance={1.5} maxDistance={8} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-gray-400 bg-black/50 px-2 py-0.5 rounded flex items-center gap-1">
        <EyeOff size={10} /> Drag to orbit • auto-rotating
      </div>
    </div>
  );
}

function Fallback() {
  return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshStandardMaterial color="#6366f1" /></mesh>;
}