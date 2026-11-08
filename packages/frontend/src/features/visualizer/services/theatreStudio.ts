/**
 * Theatre.js Studio Service
 *
 * Singleton that manages Theatre.js initialization globally.
 * Uses dynamic imports to avoid the "not initialized" warning.
 *
 * Usage:
 *   import { useTheatreStudio } from './theatreStudio';
 *
 *   // In component:
 *   const { studio, ready } = useTheatreStudio();
 */

import type { IStudio } from "@theatre/studio";
import type { IProject, ISheet, types as theatreCoreTypes } from "@theatre/core";

/**
 * The slice of `@theatre/core`'s module namespace this service uses.
 * `types.number` keeps its real signature so `sheet.object()` infers
 * proper prop types instead of collapsing to `any`.
 */
interface TheatreCoreLike {
  getProject: (id: string) => IProject;
  types: { number: typeof theatreCoreTypes.number };
}

/**
 * Writable view of an ISheetObject. Theatre declares `value` readonly,
 * but assignment through it is supported at runtime — the panel writes
 * animated values back through this handle every frame.
 */
export interface WritableSheetObject {
  value: unknown;
}

// Module-level state
let initPromise: Promise<IStudio> | null = null;
let isReady = false;
let studioInstance: IStudio | null = null;
let theatreCore: TheatreCoreLike | null = null;

/**
 * Initialize Theatre.js studio. Safe to call multiple times.
 * Uses dynamic imports to avoid the initialization warning on module load.
 */
export async function getStudio(): Promise<IStudio> {
  if (isReady && studioInstance) return studioInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const [studioModule, coreModule] = await Promise.all([
      import("@theatre/studio"),
      import("@theatre/core"),
    ]);

    studioInstance = studioModule.default;
    theatreCore = coreModule;

    try {
      // IStudio.initialize() is synchronous (returns void).
      studioInstance.initialize();
    } catch {
      // Already initialized - safe to ignore
    }

    // Hide Theatre.js default UI since we have our own custom panel
    try {
      studioInstance.ui.hide();
    } catch {
      // UI hide not available
    }

    isReady = true;
    return studioInstance;
  })();

  return initPromise;
}

/**
 * Check if studio is initialized (synchronous).
 */
export function isStudioReady(): boolean {
  return isReady;
}

/**
 * Create a Theatre.js project. Ensures studio is initialized first.
 */
export async function createTheatreProject(projectId: string, sheetId = "Scene") {
  const studio = await getStudio();
  if (!theatreCore) throw new Error("Theatre.js core failed to initialize");

  const project = theatreCore.getProject(projectId);
  const sheet = project.sheet(sheetId);
  return { project, sheet, studio };
}

/**
 * Create animation tracks on a sheet.
 */
export function createAnimationTracks(
  sheet: ISheet,
  trackDefs: { label: string; prop: string; min: number; max: number }[],
): Record<string, WritableSheetObject> {
  if (!theatreCore) throw new Error("Theatre.js core failed to initialize");
  const objects: Record<string, WritableSheetObject> = {};
  for (const def of trackDefs) {
    const obj = sheet.object(def.label, {
      [def.prop]: theatreCore.types.number(0, { range: [def.min, def.max] }),
    });
    objects[def.prop] = obj;
  }
  return objects;
}

/**
 * Read current values from all objects.
 */
export function readObjectValues(objects: Record<string, WritableSheetObject>): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, obj] of Object.entries(objects)) {
    try {
      values[key] = (obj.value as Partial<Record<string, number>>)[key] ?? 0;
    } catch {
      values[key] = 0;
    }
  }
  return values;
}

/**
 * Write values to objects.
 */
export function writeObjectValues(
  objects: Record<string, WritableSheetObject>,
  values: Record<string, number>,
) {
  for (const [key, value] of Object.entries(values)) {
    // Record lookups can be absent at runtime despite the index type.
    const obj = objects[key] as WritableSheetObject | undefined;
    if (obj) {
      try {
        obj.value = { [key]: value };
      } catch {
        // Ignore write errors
      }
    }
  }
}
