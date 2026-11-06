import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { applyTheme, getStoredTheme } from "./utils/theme";
import { installDebugFetch } from "./services/debugApi";
import { fetchPortConfig } from "./services/portConfig";

// Apply the persisted theme before the first paint to avoid a flash of the
// default (dark) theme on startup.
applyTheme(getStoredTheme());

const origWarn = console.warn;
const origError = console.error;
console.warn = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("@theatre/studio") ||
      args[0].includes("THREE.Clock: This module has been deprecated"))
  )
    return;
  origWarn.apply(console, args);
};
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("@theatre/studio")) return;
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

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("DOM element #root not found — cannot mount React app");
  createRoot(rootEl).render(<App />);
}

void initApp();
