/**
 * Frontend client for /api/docs — documentation search and project structure.
 */

import { getJson } from "./typed-fetch";
import type { DocSearchResult, DocsBootstrap, ProjectStructure } from "./types";

const BASE = "/api/docs";

/**
 * Search documentation.
 */
export async function searchDocs(
  q: string,
  limit = 20,
): Promise<DocSearchResult[]> {
  return getJson<DocSearchResult[]>(
    `${BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    { timeout: 30000 },
  );
}

/**
 * Get docs bootstrap data (structure + index).
 */
export async function getDocsBootstrap(): Promise<DocsBootstrap> {
  return getJson<DocsBootstrap>(`${BASE}/bootstrap`, { timeout: 30000 });
}

/**
 * Get project structure (directory tree).
 */
export async function getProjectStructure(depth = 3): Promise<ProjectStructure> {
  return getJson<ProjectStructure>(
    `${BASE}/structure?depth=${depth}`,
    { timeout: 30000 },
  );
}

export type * from "./types";
