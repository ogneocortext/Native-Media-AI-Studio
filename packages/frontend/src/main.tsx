import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { applyTheme, getStoredTheme } from "./utils/theme";

// Apply the persisted theme before the first paint to avoid a flash of the
// default (dark) theme on startup.
applyTheme(getStoredTheme());

// Suppress Theatre.js "not initialized" dev warning
// This warning is a false positive since we initialize the studio on app start
const originalError = console.error;
console.error = (...args: any[]) => {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (msg.includes("@theatre/studio") && msg.includes("haven't initialized")) {
    return; // Suppress this specific warning
  }
  originalError.apply(console, args);
};
const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (msg.includes("@theatre/studio") && msg.includes("haven't initialized")) {
    return; // Suppress this specific warning
  }
  originalWarn.apply(console, args);
};

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
