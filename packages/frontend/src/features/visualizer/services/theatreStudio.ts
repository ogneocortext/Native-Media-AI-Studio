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

// Module-level state
let initPromise: Promise<any> | null = null;
let isReady = false;
let studioInstance: any = null;
let theatreCore: any = null;

/**
 * Initialize Theatre.js studio. Safe to call multiple times.
 * Uses dynamic imports to avoid the initialization warning on module load.
 */
export async function getStudio(): Promise<any> {
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
      await studioInstance.initialize();
    } catch {
      // Already initialized - safe to ignore
    }

    // Hide Theatre.js default UI since we have our own custom panel
    try {
      if (studioInstance.ui && typeof studioInstance.ui.hide === "function") {
        studioInstance.ui.hide();
      }
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
export async function createTheatreProject(
  projectId: string,
  sheetId: string = "Scene"
) {
  await getStudio();
  
  const project = theatreCore.getProject(projectId);
  const sheet = project.sheet(sheetId);
  return { project, sheet, studio: studioInstance };
}

/**
 * Create animation tracks on a sheet.
 */
export function createAnimationTracks(
  sheet: any,
  trackDefs: Array<{ label: string; prop: string; min: number; max: number }>
) {
  const objects: Record<string, any> = {};
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
export function readObjectValues(
  objects: Record<string, any>
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, obj] of Object.entries(objects)) {
    try {
      values[key] = (obj.value as Record<string, number>)[key] ?? 0;
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
  objects: Record<string, any>,
  values: Record<string, number>
) {
  for (const [key, value] of Object.entries(values)) {
    const obj = objects[key];
    if (obj) {
      try {
        obj.value = { [key]: value };
      } catch {
        // Ignore write errors
      }
    }
  }
}
