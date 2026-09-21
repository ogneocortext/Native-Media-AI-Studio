import { getApiBase } from "./core";
import { fetchWithTimeout } from "../fetchWithTimeout";

export async function searchDocs(q: string, limit: number = 20): Promise<Array<{
  path: string; title: string; score: number; snippet: string | null;
}>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/docs/search?q=${encodeURIComponent(q)}&limit=${limit}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to search docs");
  return res.json();
}

export async function getDocsBootstrap(): Promise<Record<string, unknown>> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/docs/bootstrap`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get docs bootstrap");
  return res.json();
}

export async function getProjectStructure(depth: number = 3): Promise<{
  root: string; structure: Record<string, unknown>;
}> {
  const base = getApiBase();
  const res = await fetchWithTimeout(`${base}/api/docs/structure?depth=${depth}`, { timeout: 30000 });
  if (!res.ok) throw new Error("Failed to get project structure");
  return res.json();
}
