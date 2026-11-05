/**
 * Route preloader for sidebar navigation.
 *
 * Preloads lazy-loaded route modules when the user hovers over a nav link,
 * so the module is already in the browser's module cache when they click.
 * This can shave 200-600ms off navigation to heavy pages.
 *
 * Usage:
 *   import { preloadRoute, registerRouteLoader } from "./routePreloader";
 *
 *   // In App.tsx, register each lazy route:
 *   registerRouteLoader("/create/music-video", () => import("./features/music-video/MusicVideoWizard").then(m => m.MusicVideoWizard));
 *
 *   // In Sidebar, preload on hover:
 *   <NavLink onMouseEnter={() => preloadRoute("/create/music-video")} ...>
 */

type RouteLoader = () => Promise<unknown>;

// Route loaders registered by App.tsx
const routeLoaders = new Map<string, RouteLoader>();

// Modules that have been preloaded (or are currently loading)
const preloadedModules = new Map<string, Promise<unknown>>();

/**
 * Register a route loader for preloading.
 * Call this from App.tsx for each lazy-loaded route.
 */
export function registerRouteLoader(path: string, loader: RouteLoader) {
  routeLoaders.set(path, loader);
}

/**
 * Preload a route module. Returns a promise that resolves when the module is loaded.
 * Safe to call multiple times - subsequent calls return the cached promise.
 */
export function preloadRoute(path: string): Promise<unknown> | null {
  const existing = preloadedModules.get(path);
  if (existing) return existing;

  const loader = routeLoaders.get(path);
  if (!loader) {
    console.warn(`[routePreloader] No loader registered for ${path}`);
    return null;
  }

  const promise = loader().catch((err) => {
    console.warn(`[routePreloader] Failed to preload ${path}:`, err);
    preloadedModules.delete(path);
    throw err;
  });

  preloadedModules.set(path, promise);
  return promise;
}

/**
 * Check if a route module has been preloaded.
 */
export function isRoutePreloaded(path: string): boolean {
  return preloadedModules.has(path);
}

/**
 * Get all registered route paths.
 */
export function getRegisteredRoutes(): string[] {
  return Array.from(routeLoaders.keys());
}
