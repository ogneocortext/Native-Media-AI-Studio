import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { applyTheme, getStoredTheme } from "./utils/theme";
import { installDebugFetch } from "./services/debugApi";
import { fetchPortConfig } from "./services/portConfig";

// Apply the persisted theme before the first paint to avoid a flash of the
// default (dark) theme on startup.
applyTheme(getStoredTheme());

// Suppress Theatre.js "not initialized" warning — we intentionally lazy-load
// Theatre only when the Visualizer's Theatre Studio panel is opened.
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

// Initialize the app. Theatre.js is NOT loaded here — it is ~1 MB (266 KB gzip)
// and only needed by the Visualizer's Theatre Studio panel, which initializes
// it on demand via createTheatreProject() (see theatreStudio.ts).
async function initApp() {
  // Load port configuration first so all services use the correct backend URL
  await fetchPortConfig();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

initApp();
