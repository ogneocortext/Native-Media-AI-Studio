import * as THREE from "three";
import {
  getSectionColor as getSectionColorHelper,
  getSectionIntensity as getSectionIntensityHelper,
} from "../sectionHelpers";

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
