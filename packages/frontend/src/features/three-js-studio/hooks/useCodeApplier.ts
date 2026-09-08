import type React from "react";
import { useCallback, useRef } from "react";
import * as THREE from "three";

export function useCodeApplier({
  sceneRef,
  setCodeError,
}: {
  sceneRef: React.RefObject<THREE.Scene | null>;
  setCodeError: (err: string | null) => void;
}) {
  const generatedSceneUpdateRef = useRef<((time: number, delta: number) => void) | null>(null);
  const generatedSceneInitRef = useRef<(() => void) | null>(null);

  const createSceneObject = useCallback(
    (objDesc: any, THREE: any, scene: any) => {
      let geometry: any;
      const t = objDesc.type;
      if (t === "sphere") geometry = new THREE.SphereGeometry(0.8, 32, 32);
      else if (t === "box") geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
      else if (t === "cylinder")
        geometry = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 32);
      else if (t === "cone") geometry = new THREE.ConeGeometry(0.8, 1.5, 32);
      else if (t === "torus")
        geometry = new THREE.TorusGeometry(0.8, 0.25, 16, 32);
      else if (t === "crown") {
        const group = new THREE.Group();
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(1, 0.15, 16, 32),
          new THREE.MeshStandardMaterial({
            color: 0xffd700,
            metalness: 0.9,
            roughness: 0.1,
          }),
        );
        group.add(band);
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const spike = new THREE.Mesh(
            new THREE.ConeGeometry(0.08, 0.5, 8),
            new THREE.MeshStandardMaterial({
              color: 0xffd700,
              metalness: 0.9,
              roughness: 0.1,
            }),
          );
          spike.position.set(
            Math.cos(angle) * 0.85,
            0.4,
            Math.sin(angle) * 0.85,
          );
          group.add(spike);
        }
        const gem = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.2),
          new THREE.MeshStandardMaterial({
            color: 0x8b5cf6,
            metalness: 0.5,
            roughness: 0,
            emissive: 0x8b5cf6,
            emissiveIntensity: 0.8,
          }),
        );
        gem.position.y = 0.3;
        group.add(gem);
        const gpos = (objDesc.position as [number, number, number]) || [
          0, 0.5, 0,
        ];
        const gscl = (objDesc.scale as [number, number, number]) || [1, 1, 1];
        group.position.set(gpos[0], gpos[1], gpos[2]);
        group.scale.set(gscl[0], gscl[1], gscl[2]);
        group.castShadow = true;
        scene.add(group);
        return;
      } else if (t === "orb") geometry = new THREE.SphereGeometry(1, 64, 64);
      else if (t === "ring")
        geometry = new THREE.TorusGeometry(1.5, 0.05, 16, 64);
      else if (t === "spiral")
        geometry = new THREE.TorusKnotGeometry(0.8, 0.2, 128, 16);
      else if (t === "mountain") geometry = new THREE.ConeGeometry(2, 4, 6);
      else if (t === "tree") geometry = new THREE.ConeGeometry(0.8, 3, 8);
      else if (t === "city" || t === "skyline")
        geometry = new THREE.BoxGeometry(0.5, 3, 0.5);
      else if (t === "stage") geometry = new THREE.BoxGeometry(8, 0.3, 5);
      else if (t === "equalizer" || t === "bar")
        geometry = new THREE.BoxGeometry(0.12, 1, 0.12);
      else if (t === "pillar")
        geometry = new THREE.CylinderGeometry(0.3, 0.3, 4, 16);
      else if (t === "vinyl")
        geometry = new THREE.CylinderGeometry(1.5, 1.5, 0.05, 64);
      else if (t === "wave") geometry = new THREE.TorusGeometry(2, 0.3, 16, 32);
      else if (t === "galaxy")
        geometry = new THREE.TorusGeometry(3, 0.8, 16, 64);
      else if (t === "neuron") geometry = new THREE.IcosahedronGeometry(0.5, 1);
      else if (t === "fractal") geometry = new THREE.OctahedronGeometry(1, 2);
      else if (t === "lightning") geometry = new THREE.ConeGeometry(0.1, 3, 4);
      else if (t === "fire") geometry = new THREE.ConeGeometry(0.5, 2, 8);
      else if (t === "snow" || t === "rain")
        geometry = new THREE.SphereGeometry(0.05, 8, 8);
      else if (t === "character") {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(objDesc.color || "#fbbf24"),
          metalness: objDesc.metalness ?? 0.1,
          roughness: objDesc.roughness ?? 0.7,
          emissive: new THREE.Color(objDesc.emissive || "#1a1000"),
          emissiveIntensity: objDesc.emissiveIntensity ?? 0.1,
        });
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.3, 1.0, 8, 16),
          bodyMat,
        );
        body.position.y = 0.8;
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.25, 16, 16),
          bodyMat,
        );
        head.position.y = 1.6;
        group.add(body, head);
        group.castShadow = true;
        const gpos = (objDesc.position as [number, number, number]) || [
          0, 0, 0,
        ];
        const gscl = (objDesc.scale as [number, number, number]) || [
          1.5, 1.5, 1.5,
        ];
        group.position.set(gpos[0], gpos[1], gpos[2]);
        group.scale.set(gscl[0], gscl[1], gscl[2]);
        if (objDesc.rotation)
          group.rotation.set(...(objDesc.rotation as [number, number, number]));
        scene.add(group);
        return;
      } else if (
        t === "text" ||
        t === "particle_field" ||
        t === "light_rays" ||
        t === "lens_flare"
      ) {
        return; // Special effects, skip geometry
      } else geometry = new THREE.BoxGeometry(1, 1, 1);

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(objDesc.color || "#ffffff"),
        metalness: objDesc.metalness ?? 0.6,
        roughness: objDesc.roughness ?? 0.3,
        emissive: new THREE.Color(objDesc.emissive || "#000000"),
        emissiveIntensity: objDesc.emissiveIntensity ?? 0.1,
      });
      const mesh = new THREE.Mesh(geometry, mat);
      const pos = (objDesc.position as [number, number, number]) || [0, 0.5, 0];
      const scl = (objDesc.scale as [number, number, number]) || [1, 1, 1];
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scl[0], scl[1], scl[2]);
      if (objDesc.rotation)
        mesh.rotation.set(...(objDesc.rotation as [number, number, number]));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    },
    [],
  );

  const handleApplyCode = useCallback(
    (code: string) => {
      if (!sceneRef.current || !code) return;
      setCodeError(null);

      const stripFences = (s: string) => {
        const fenceRe = /```(?:javascript|js|json)?\s*\n([\s\S]*?)```/gi;
        let out = s;
        let m: RegExpExecArray | null;
        let last: string | null = null;
        while ((m = fenceRe.exec(s)) !== null) last = m[1];
        if (last !== null) out = last;
        out = out.replace(/^```[a-z]*\s*\n?/i, "").replace(/```\s*$/i, "");
        return out.trim();
      };

      const looksLikeJson = (s: string) => {
        const t = s.trim();
        return (
          (t.startsWith("{") || t.startsWith("[")) &&
          !t.includes("function ") &&
          !t.includes("=>") &&
          !t.includes("THREE.")
        );
      };

      const rawTrimmed = code.trim();
      if (looksLikeJson(rawTrimmed) || looksLikeJson(stripFences(code))) {
        try {
          let jsonStr = stripFences(code);
          if (!jsonStr) jsonStr = code;
          const startIdx = jsonStr.search(/[\[{]/);
          if (startIdx >= 0) jsonStr = jsonStr.substring(startIdx);
          const sceneDesc = JSON.parse(jsonStr);
          {
            const scene = sceneRef.current;
            const toRemove: any[] = [];
            scene.traverse((child: any) => {
              if (
                child.isMesh &&
                child.geometry &&
                child.geometry.type !== "PlaneGeometry"
              ) {
                toRemove.push(child);
              }
            });
            toRemove.forEach((obj) => scene.remove(obj));
            if (sceneDesc.objects) {
              for (const objDesc of sceneDesc.objects) {
                createSceneObject(objDesc, THREE, scene);
              }
            }
          }
          generatedSceneUpdateRef.current = null;
          generatedSceneInitRef.current = null;
          (window as any).__sceneUpdate = null;
          (window as any).__sceneInit = null;
          return;
        } catch {
          // fall through to JS path
        }
      }

      try {
        let jsCode = stripFences(code);
        if (!jsCode) jsCode = code;

        const applyIdx = jsCode.lastIndexOf("function applyScene");
        if (applyIdx > 0) {
          const firstIdx = jsCode.indexOf("function applyScene");
          if (firstIdx !== applyIdx) {
            jsCode = jsCode.slice(applyIdx);
          }
        }

        if (
          !jsCode.includes("function applyScene") &&
          !jsCode.includes("THREE.")
        ) {
          setCodeError(
            "No applyScene(scene,camera,renderer,THREE) found in code.",
          );
          console.warn(
            "handleApplyCode: no applyScene or THREE usage detected",
          );
          return;
        }

        const disposeGroup = (g: any) => {
          if (!g) return;
          g.traverse((c: any) => {
            if (c.geometry) {
              try {
                c.geometry.dispose();
              } catch {}
            }
            if (c.material) {
              const mats = Array.isArray(c.material)
                ? c.material
                : [c.material];
              mats.forEach((m: any) => {
                try {
                  m.dispose();
                } catch {}
              });
            }
          });
        };
        const scene = sceneRef.current;
        if (!scene) return;
        const oldGroup = scene.getObjectByName("__aiGenerated");
        if (oldGroup) {
          disposeGroup(oldGroup);
          scene.remove(oldGroup);
        }
        scene.children.slice().forEach((c: any) => {
          if (c.userData && c.userData.__ai) {
            disposeGroup(c);
            scene.remove(c);
          }
        });
        (window as any).__sceneUpdate = null;
        (window as any).__sceneInit = null;
        generatedSceneUpdateRef.current = null;
        generatedSceneInitRef.current = null;

        const sanitized = jsCode
          .replace(
            /requestAnimationFrame\s*\([^)]+\)\s*;?/g,
            "/* rAF stripped — studio drives loop */",
          )
          .replace(
            /setInterval\s*\([^)]+\)\s*;?/g,
            "/* setInterval stripped */",
          )
          .replace(/setTimeout\s*\([^)]+\)\s*;?/g, "/* setTimeout stripped */")
          .replace(/\beval\s*\(/g, "/* eval stripped */(")
          .replace(/\bnew\s+Function\s*\(/g, "/* new Function stripped */(")
          .replace(/\bFunction\s*\(/g, "/* Function stripped */(")
          .replace(
            /renderer\s*\.\s*setSize\s*\(\s*window\.innerWidth[^)]+\)\s*;?/g,
            "/* renderer.setSize stripped */",
          )
          .replace(
            /renderer\s*\.\s*setPixelRatio\s*\([^)]+\)\s*;?/g,
            "/* setPixelRatio stripped */",
          )
          .replace(
            /window\s*\.\s*addEventListener\s*\(\s*['\"]resize['\"][^)]+\)\s*;?/g,
            "/* resize listener stripped */",
          )
          .replace(
            /^\s*animate\s*\(\s*[^)]*\)\s*;?\s*$/gm,
            "/* animate() stripped */",
          )
          .replace(
            /window\s*\.\s*addEventListener\s*\([^)]+\)\s*;?/g,
            "/* window event listener stripped */",
          )
          .replace(
            /document\s*\.\s*addEventListener\s*\([^)]+\)\s*;?/g,
            "/* document event listener stripped */",
          )
          .replace(/\bfetch\s*\(/g, "/* fetch stripped */(")
          .replace(/\bXMLHttpRequest\s*\(/g, "/* XMLHttpRequest stripped */(")
          .replace(
            /localStorage\s*\.\s*(get|set|remove)Item\s*\(/g,
            "/* localStorage stripped */(",
          )
          .replace(
            /sessionStorage\s*\.\s*(get|set|remove)Item\s*\(/g,
            "/* sessionStorage stripped */(",
          )
          .replace(
            /document\.getElementById\s*\(\s*['\"]three-container['\"]\s*\)/g,
            "null",
          );

        const wrapped =
          sanitized +
          `
        let __ret = null;
        if (typeof applyScene === 'function') {
          __ret = applyScene(scene, camera, renderer, THREE);
          if (typeof __ret === 'function') {
            window.__sceneUpdate = __ret;
            window.__sceneInit = () => __ret(0, 0);
          }
        }
        if (!window.__sceneUpdate && typeof update === 'function') {
          window.__sceneUpdate = update;
        }
        if (!window.__sceneInit && typeof init === 'function') {
          window.__sceneInit = init;
        }
      `;

        const fn = new Function(
          "scene",
          "camera",
          "renderer",
          "THREE",
          wrapped,
        );
        fn(
          sceneRef.current,
          (window as any).__camera,
          (window as any).__renderer,
          (window as any).THREE,
        );

        const upd = (window as any).__sceneUpdate;
        const init = (window as any).__sceneInit;
        if (typeof upd === "function") {
          generatedSceneUpdateRef.current = upd;
          generatedSceneInitRef.current =
            typeof init === "function" ? init : null;
          try {
            generatedSceneInitRef.current?.();
          } catch (e) {
            console.warn("sceneInit error", e);
          }
          try {
            upd(0, 0);
          } catch (e) {
            console.warn("sceneUpdate(0) error", e);
          }
        } else {
          console.info("Applied static AI scene (no per-frame update)");
        }
      } catch (err) {
        console.error("Failed to apply generated scene:", err);
        setCodeError(err instanceof Error ? err.message : String(err));
      }
    },
    [createSceneObject, sceneRef, setCodeError],
  );

  return {
    handleApplyCode,
    createSceneObject,
    generatedSceneUpdateRef,
    generatedSceneInitRef,
  };
}
