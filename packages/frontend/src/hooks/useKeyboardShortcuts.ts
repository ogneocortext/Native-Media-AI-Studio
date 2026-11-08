import { useEffect } from "react";

interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  action: () => void;
  description: string;
  category: string;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      for (const shortcut of shortcuts) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = shortcut.ctrlKey === (e.ctrlKey || e.metaKey);
        const shiftMatch = shortcut.shiftKey === e.shiftKey;
        const altMatch = shortcut.altKey === e.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          shortcut.action();
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);
}

export function getDefaultShortcuts(navigate: (path: string) => void): Shortcut[] {
  return [
    // Global
    { key: "k", ctrlKey: true, action: () => window.dispatchEvent(new CustomEvent("cmd-palette-open")), description: "Open Command Palette", category: "Global" },
    { key: "d", ctrlKey: true, shiftKey: true, action: () => window.dispatchEvent(new CustomEvent("debug-panel-toggle")), description: "Toggle Debug Panel", category: "Global" },

    // Navigation
    { key: "d", ctrlKey: true, shiftKey: false, metaKey: false, action: () => navigate("/system"), description: "Go to Dashboard", category: "Navigation" },
    { key: "a", ctrlKey: true, action: () => navigate("/system/admin"), description: "Go to Admin Dashboard", category: "Navigation" },
    { key: "h", ctrlKey: true, action: () => navigate("/system/health"), description: "Go to Health", category: "Navigation" },
    { key: "q", ctrlKey: true, action: () => navigate("/system/queue"), description: "Go to Queue", category: "Navigation" },
    { key: "s", ctrlKey: true, action: () => navigate("/system/settings"), description: "Go to Settings", category: "Navigation" },
    { key: "g", ctrlKey: true, action: () => navigate("/system/gpu"), description: "Go to GPU Monitor", category: "Navigation" },

    // Create
    { key: "m", ctrlKey: true, shiftKey: true, action: () => navigate("/create/music-video"), description: "New Music Video", category: "Create" },
    { key: "v", ctrlKey: true, shiftKey: true, action: () => navigate("/create/video"), description: "New Video Generation", category: "Create" },
    { key: "3", ctrlKey: true, shiftKey: true, action: () => navigate("/create/3d"), description: "New 3D Generation", category: "Create" },
    { key: "i", ctrlKey: true, shiftKey: true, action: () => navigate("/create/image"), description: "New Image Generation", category: "Create" },

    // Actions
    { key: "r", ctrlKey: true, shiftKey: true, action: () => navigate("/create/remix"), description: "New Remix", category: "Actions" },
    { key: "m", ctrlKey: true, action: () => navigate("/create/music"), description: "New Music Generation", category: "Actions" },
    { key: "a", ctrlKey: true, shiftKey: true, action: () => navigate("/create/animation"), description: "New Animation", category: "Actions" },
  ];
}

export function useGlobalShortcuts(navigate: (path: string) => void) {
  const shortcuts = getDefaultShortcuts(navigate);
  useKeyboardShortcuts(shortcuts);
}