/**
 * Shared UI state — focus mode, sidebar visibility, panel states.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

const AUTO_PLAY_KEY = "autoPlay";

function getStoredAutoPlay(): boolean {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(AUTO_PLAY_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  }
  return false;
}

interface UIState {
  focusMode: boolean;
  autoPlay: boolean;
  setFocusMode: (active: boolean) => void;
  toggleFocusMode: () => void;
  setAutoPlay: (enabled: boolean) => void;
  toggleAutoPlay: () => void;
}

export const useUIStore = create<UIState>()(
  devtools((set) => ({
    focusMode: false,
    autoPlay: getStoredAutoPlay(),
    setFocusMode: (active) => set({ focusMode: active }),
    toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
    setAutoPlay: (enabled) => {
      set({ autoPlay: enabled });
      localStorage.setItem(AUTO_PLAY_KEY, String(enabled));
    },
    toggleAutoPlay: () => set((s) => {
      const next = !s.autoPlay;
      localStorage.setItem(AUTO_PLAY_KEY, String(next));
      return { autoPlay: next };
    }),
  }), { name: "UIStore" })
);
