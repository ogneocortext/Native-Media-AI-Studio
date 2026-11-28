/**
 * Canonical-board state for the Storyboards page (T-VID-35): loads the
 * board for the selected slug from the backend store, tracks edits, and
 * saves back through the API. A null board means the store has no board
 * for the slug and the page falls back to its Markdown-only view.
 */

import { useCallback, useEffect, useState } from "react";
import { getStoryboardBoard, saveStoryboardBoard } from "../../services/api/storyboards";
import type { BoardScene, StoryboardBoard } from "./boardTypes";

export function useStoryboardBoard(slug: string | null) {
  const [board, setBoard] = useState<StoryboardBoard | null>(null);
  const [boardDirty, setBoardDirty] = useState(false);
  const [savingBoard, setSavingBoard] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardSaved, setBoardSaved] = useState(false);

  useEffect(() => {
    if (!slug) {
      setBoard(null);
      setBoardDirty(false);
      setBoardError(null);
      setBoardSaved(false);
      return;
    }
    let cancelled = false;
    getStoryboardBoard(slug)
      .then((data) => {
        if (cancelled) return;
        setBoard(data);
        setBoardDirty(false);
        setBoardError(null);
        setBoardSaved(false);
      })
      .catch(() => {
        if (!cancelled) setBoard(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleSceneEdit = useCallback((idx: number, patch: Partial<BoardScene>) => {
    setBoard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map((scene, i) => (i === idx ? { ...scene, ...patch } : scene)),
      };
    });
    setBoardDirty(true);
    setBoardSaved(false);
  }, []);

  const handleSaveBoard = useCallback(async () => {
    if (!slug || !board) return;
    setSavingBoard(true);
    setBoardError(null);
    try {
      const result = await saveStoryboardBoard(slug, board);
      setBoard(result.board);
      setBoardDirty(false);
      setBoardSaved(true);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingBoard(false);
    }
  }, [board, slug]);

  return {
    board,
    boardDirty,
    savingBoard,
    boardError,
    boardSaved,
    handleSceneEdit,
    handleSaveBoard,
  };
}
