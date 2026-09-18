import { useEffect } from "react";
import * as THREE from "three";
import {
  getSectionColor as getSectionColorHelper,
  getSectionIntensity as getSectionIntensityHelper,
} from "../sectionHelpers";

/** Any three.js resource with a dispose() method. */
export interface Disposable {
  dispose?: () => void;
}

/**
 * Dispose manually-created three.js resources when the owning component unmounts.
 *
 * Why this is needed: R3F only auto-disposes objects *it* created from JSX
 * (`<meshStandardMaterial />`). Materials/geometries we build ourselves (via
 * `useMemo`) and hand over with `<primitive object={mat} attach="material" />`
 * or as `material={m}` / `geometry={g}` props are never disposed. Style
 * switches unmount whole scene subtrees, so without this every preset change
 * leaks a compiled shader program + GPU buffers until the context dies
 * (a long session accumulates one leak per switch).
 *
 * Safe to pass a module-scoped shared resource (e.g. the particle texture):
 * only call this for instances the component owns.
 */
export function useDisposeOnUnmount(...resources: Disposable[]): void {
  useEffect(() => {
    return () => {
      for (const resource of resources) {
        try {
          resource?.dispose?.();
        } catch {
          /* already disposed / renderer gone */
        }
      }
    };
    // Deliberately keyed on the resources themselves: they are useMemo'd, so
    // their identity only changes when the resource is rebuilt.
  }, resources);
}

/**
 * Remove a geometry attribute created per-frame-safe: replaces the attribute
 * only when its array length changed, otherwise updates in place. Per-frame
 * `setAttribute(new Float32BufferAttribute(...))` churns a GPU buffer per frame
 * (three's attribute cache is a WeakMap, so orphaned buffers are never freed).
 */
export function setPositionAttribute(
  geometry: THREE.BufferGeometry,
  values: Float32Array,
  count: number,
): void {
  const existing = geometry.getAttribute("position") as
    | THREE.BufferAttribute
    | undefined;
  if (existing && existing.array === values) {
    existing.needsUpdate = true;
    geometry.setDrawRange(0, count);
    return;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
  geometry.setDrawRange(0, count);
}

/** Get color based on current LRC section */
export function getSectionColor(
  section: string,
  meshColor: string,
): THREE.Color {
  return new THREE.Color(getSectionColorHelper(section, meshColor));
}

/** Get intensity multiplier based on section */
export function getSectionIntensity(section: string): number {
  return getSectionIntensityHelper(section);
}

