import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { applyTheme, getStoredTheme } from "./utils/theme";
import { installDebugFetch } from "./services/debugApi";

// Apply the persisted theme before the first paint to avoid a flash of the
// default (dark) theme on startup.
applyTheme(getStoredTheme());

// Suppress Theatre.js "not initialized" warning — we intentionally lazy-load
// and initialize it in initApp().
const theatreWarn = /@theatre\/studio/;
const origWarn = console.warn;
const origError = console.error;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && theatreWarn.test(args[0])) return;
  origWarn.apply(console, args);
};
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && theatreWarn.test(args[0])) return;
  origError.apply(console, args);
};

// Install API debug logger in development
if (import.meta.env.DEV) {
  installDebugFetch();
}

// Initialize Theatre.js studio before rendering the app
async function initApp() {
  const { getStudio } = await import("./features/visualizer/services/theatreStudio");
  await getStudio();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

initApp();
