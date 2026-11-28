/**
 * Frontend client for the canonical storyboard board store
 * (services/storyboard_boards.py on the backend).
 */

import { getApiBase } from "./core";
import { fetchJson, getJson } from "./typed-fetch";
import type { StoryboardBoard, StoryboardBoardSummary } from "../../features/storyboards/boardTypes";

const BOARDS_BASE = "/api/storyboards";

export async function listStoryboardBoards(): Promise<StoryboardBoardSummary[]> {
  const base = getApiBase();
  const data = await getJson<{ boards: StoryboardBoardSummary[] }>(`${base}${BOARDS_BASE}`, {
    timeout: 30000,
  });
  return data.boards;
}

export async function getStoryboardBoard(slug: string): Promise<StoryboardBoard> {
  const base = getApiBase();
  return getJson<StoryboardBoard>(`${base}${BOARDS_BASE}/${encodeURIComponent(slug)}`, {
    timeout: 30000,
  });
}

export async function saveStoryboardBoard(
  slug: string,
  board: StoryboardBoard,
): Promise<{ success: boolean; scene_count: number; board: StoryboardBoard }> {
  const base = getApiBase();
  return fetchJson(`${base}${BOARDS_BASE}/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ board }),
    timeout: 30000,
  });
}
