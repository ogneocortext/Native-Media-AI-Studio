import { useCallback, useState } from "react";
import { parsePanelOpen, panelStorageKey, serializePanelOpen } from "./panelCollapse";

/**
 * Collapsible panel state that survives reloads (plan 1.2).
 *
 * Defaults to **collapsed**: STEM MIXER and MASTER EQ render expanded below
 * the transport on every load and squeeze the canvas out of the viewport.
 * A localStorage write failure (private mode, quota) must never break the
 * toggle — it just means the state is session-only.
 */
export function usePanelCollapsed(panelId: string, defaultOpen = false): {
  open: boolean;
  toggle: () => void;
} {
  const [open, setOpen] = useState(() => {
    try {
      return parsePanelOpen(localStorage.getItem(panelStorageKey(panelId)), defaultOpen);
    } catch {
      return defaultOpen;
    }
  });

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(panelStorageKey(panelId), serializePanelOpen(next));
      } catch {
        // session-only fallback; the toggle still works
      }
      return next;
    });
  }, [panelId]);

  return { open, toggle };
}
