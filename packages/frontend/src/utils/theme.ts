/**
 * Theme management utilities.
 *
 * Single source of truth for dark/light theme persistence and application.
 * `applyTheme` is called at app bootstrap (main.tsx) so the correct theme is
 * present at first paint - avoiding the FOUC where the Settings-only hook
 * previously left the page unthemed until navigation to /settings.
 */
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const THEME_KEY = "theme";

/** Read the persisted theme (localStorage) with a dark fallback. */
export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

/** Apply a theme to the document root immediately. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** React hook: state + side effects for theme toggling. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  return { theme, toggleTheme };
}
