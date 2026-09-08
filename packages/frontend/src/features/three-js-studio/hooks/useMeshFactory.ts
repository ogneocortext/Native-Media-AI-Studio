import { useCallback, useRef } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BLOOM_LAYER } from "../threeStudioConfig";

export function useMeshFactory() {
  const characterMixersRef = useRef<Map<string, any>>(new Map());
  const characterAnimDataRef = useRef<
    Map<string, { mixer: any; action: any; clips: string[] }>
  >(new Map());

  const createMeshForObject = useCallback(
    async (obj: any, THREE: any) => {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(obj.color),
        metalness: obj.metalness,
        roughness: obj.roughness,
        emissive: new THREE.Color(obj.emissive),
        emissiveIntensity: obj.emissiveIntensity,
      });
      let meshGroup: any;
      if (obj.type === "crown") {
        const group = new THREE.Group();
        group.add(
          new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 16, 32), mat),
        );
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const spike = new THREE.Mesh(
            new THREE.ConeGeometry(0.08, 0.5, 8),
            mat,
          );
          spike.position.set(
            Math.cos(angle) * 0.85,
            0.4,
            Math.sin(angle) * 0.85,
          );
          group.add(spike);
        }
        const gemMat = new THREE.MeshStandardMaterial({
          color: 0x8b5cf6,
          metalness: 0.5,
          roughness: 0,
          emissive: 0x8b5cf6,
          emissiveIntensity: 0.8,
        });
        group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2), gemMat));
        meshGroup = group;
      } else if (obj.type === "sphere") {
        meshGroup = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), mat);
      } else if (obj.type === "box") {
        meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
      } else if (obj.type === "cylinder") {
        meshGroup = new THREE.Mesh(
          new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32),
          mat,
        );
      } else if (obj.type === "cone") {
        meshGroup = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 32), mat);
      } else if (obj.type === "torus") {
        meshGroup = new THREE.Mesh(
          new THREE.TorusGeometry(0.8, 0.25, 16, 32),
          mat,
        );
      } else if (obj.type === "bars") {
        meshGroup = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.12), mat);
      } else if (obj.modelUrl) {
        const loader = new GLTFLoader();
        const url = obj.modelUrl;
        meshGroup = await new Promise<any>((resolve, _reject) => {
          loader.load(
            url,
            (gltf) => {
              const model = gltf.scene;
              model.traverse((child: any) => {
                if (child.isMesh) {
                  child.castShadow = true;
                  child.receiveShadow = true;
                  child.layers.set(0);
                  if (obj.bloom) child.layers.enable(BLOOM_LAYER);
                }
              });
              const mixer = new THREE.AnimationMixer(model);
              if (gltf.animations && gltf.animations.length > 0) {
                const requestedName =
                  obj.animationName || gltf.animations[0].name;
                const clipName = gltf.animations.find(
                  (a: any) => a.name === requestedName,
                )
                  ? requestedName
                  : gltf.animations[0].name;
                const action = mixer.clipAction(
                  gltf.animations.find((a: any) => a.name === clipName) ||
                    gltf.animations[0],
                );
                action.setLoop(
                  obj.animationLoop !== false
                    ? THREE.LoopRepeat
                    : THREE.LoopOnce,
                  Infinity,
                );
                action.setEffectiveTimeScale(obj.animationSpeed ?? 1);
                action.play();
                characterAnimDataRef.current.set(obj.id, {
                  mixer,
                  action,
                  clips: gltf.animations.map((a: any) => a.name),
                });
              } else {
                characterAnimDataRef.current.set(obj.id, {
                  mixer,
                  action: null,
                  clips: [],
                });
              }
              characterMixersRef.current.set(obj.id, mixer);
              resolve(model);
            },
            undefined,
            (error) => {
              console.warn("[useMeshFactory] GLTF load failed, using fallback", error);
              const fallback = new THREE.Group();
              const bodyMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(obj.color),
                metalness: 0.1,
                roughness: 0.7,
                emissive: new THREE.Color(obj.emissive),
                emissiveIntensity: obj.emissiveIntensity,
              });
              const headMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(obj.color).multiplyScalar(1.1),
                metalness: 0.8,
                roughness: 0.2,
                emissive: new THREE.Color(obj.emissive),
                emissiveIntensity: obj.emissiveIntensity * 0.5,
              });
              const body = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.3, 1.0, 8, 16),
                bodyMat,
              );
              body.position.y = 0.8;
              const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.22, 24, 24),
                headMat,
              );
              head.position.set(0, 1.58, 0.02);
              const armL = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.08, 0.6, 4, 8),
                bodyMat,
              );
              armL.position.set(-0.42, 1.0, 0);
              armL.rotation.z = 0.15;
              armL.rotation.x = -0.05;
              const armR = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.08, 0.6, 4, 8),
                bodyMat,
              );
              armR.position.set(0.42, 1.0, 0);
              armR.rotation.z = -0.15;
              armR.rotation.x = -0.05;
              const legL = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.1, 0.5, 4, 8),
                bodyMat,
              );
              legL.position.set(-0.15, 0.15, 0);
              const legR = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.1, 0.5, 4, 8),
                bodyMat,
              );
              legR.position.set(0.15, 0.15, 0);
              const shadowCanvas = document.createElement("canvas");
              shadowCanvas.width = 128;
              shadowCanvas.height = 128;
              const ctx = shadowCanvas.getContext("2d")!;
              const gradient = ctx.createRadialGradient(
                64,
                64,
                0,
                64,
                64,
                64,
              );
              gradient.addColorStop(0, "rgba(0,0,0,0.5)");
              gradient.addColorStop(0.5, "rgba(0,0,0,0.3)");
              gradient.addColorStop(1, "rgba(0,0,0,0)");
              ctx.fillStyle = gradient;
              ctx.fillRect(0, 0, 128, 128);
              const shadowTex = new THREE.CanvasTexture(shadowCanvas);
              const shadowContact = new THREE.Mesh(
                new THREE.PlaneGeometry(1.2, 1.2),
                new THREE.MeshBasicMaterial({
                  map: shadowTex,
                  transparent: true,
                  depthWrite: false,
                }),
              );
              shadowContact.rotation.x = -Math.PI / 2;
              shadowContact.position.y = 0.01;
              fallback.rotation.x = 0.03;
              fallback.add(body, head, armL, armR, legL, legR, shadowContact);
              fallback.traverse((c: any) => {
                if (c.isMesh) {
                  c.castShadow = true;
                  c.receiveShadow = true;
                }
              });
              resolve(fallback);
            },
          );
        });
      } else {
        meshGroup = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      }
      meshGroup.position.set(...obj.position);
      meshGroup.rotation.set(...obj.rotation);
      meshGroup.scale.set(...obj.scale);
      meshGroup.visible = obj.visible;
      meshGroup.castShadow = true;
      meshGroup.receiveShadow = true;
      meshGroup.traverse((child: any) => {
        if (child.isMesh) {
          child.layers.set(0);
          if (obj.bloom) child.layers.enable(BLOOM_LAYER);
        }
      });
      return meshGroup;
    },
    [],
  );

  return {
    createMeshForObject,
    characterMixersRef,
    characterAnimDataRef,
  };
}
