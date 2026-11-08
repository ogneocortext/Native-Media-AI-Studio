import { useState, useCallback } from "react";

/**
 * History management hook for undo/redo functionality.
 * Provides a simple state history with push, undo, and redo operations.
 */
export function useHistory<T>(initialState: T) {
  const [history, setHistory] = useState<T[]>([initialState]);
  const [index, setIndex] = useState(0);

  const push = useCallback((newState: T) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, index + 1);
      return [...truncated, newState];
    });
    setIndex((prev) => prev + 1);
  }, [index]);

  const undo = useCallback(() => {
    setIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setIndex((prev) => Math.min(history.length - 1, prev + 1));
  }, [history.length]);

  const canUndo = index > 0;
  const canRedo = index < history.length - 1;
  const current = history[index];

  return { current, push, undo, redo, canUndo, canRedo };
}