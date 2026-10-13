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
  /** Force a state without toggling — used by cross-page handoffs (A1). */
  setOpen: (open: boolean) => void;
} {
  const [open, setOpen] = useState(() => {
    try {
      return parsePanelOpen(localStorage.getItem(panelStorageKey(panelId)), defaultOpen);
    } catch {
      return defaultOpen;
    }
  });

  const persist = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(panelStorageKey(panelId), serializePanelOpen(next));
      } catch {
        // session-only fallback; the toggle still works
      }
    },
    [panelId],
  );

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, [persist]);

  const setOpenAndPersist = useCallback(
    (next: boolean) => {
      setOpen(next);
      persist(next);
    },
    [persist],
  );

  return { open, toggle, setOpen: setOpenAndPersist };
}
