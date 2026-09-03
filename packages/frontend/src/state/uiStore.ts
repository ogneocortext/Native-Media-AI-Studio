/**
 * Shared UI state — focus mode, sidebar visibility, panel states.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface UIState {
  focusMode: boolean;
  setFocusMode: (active: boolean) => void;
  toggleFocusMode: () => void;
}

export const useUIStore = create<UIState>()(
  devtools((set) => ({
    focusMode: false,
    setFocusMode: (active) => set({ focusMode: active }),
    toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  }), { name: "UIStore" })
);
