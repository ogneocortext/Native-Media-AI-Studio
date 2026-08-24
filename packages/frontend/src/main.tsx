import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { applyTheme, getStoredTheme } from "./utils/theme";

// Apply the persisted theme before the first paint to avoid a flash of the
// default (dark) theme on startup.
applyTheme(getStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
