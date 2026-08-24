import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Derive __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PortConfig {
  backend_url: string;
  backend_port: number;
  frontend_port: number;
  ws_port: number;
}

/**
 * Load port configuration from config/ports.json
 * Falls back to environment variables or defaults
 */
function getPortConfig(mode: string): PortConfig {
  // Load env vars - pass empty prefix to get all env vars
  const env = loadEnv(mode, process.cwd(), "");
  
  // Try to read from config/ports.json relative to project root (monorepo: packages/frontend -> ../../config)
  const configPath = path.resolve(__dirname, "../../config/ports.json");
  let config: PortConfig = {
    backend_url: env.VITE_BACKEND_URL || "http://localhost:8000",
    backend_port: parseInt(env.VITE_BACKEND_PORT || "8000", 10),
    frontend_port: parseInt(env.VITE_FRONTEND_PORT || "5173", 10),
    ws_port: parseInt(env.VITE_WS_PORT || "8000", 10),
  };

  try {
    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      config = {
        backend_url: fileConfig.backend_url || config.backend_url,
        backend_port: fileConfig.backend_port || config.backend_port,
        frontend_port: fileConfig.frontend_port || config.frontend_port,
        ws_port: fileConfig.ws_port || config.ws_port,
      };
      console.log(`[Vite] Loaded port config from ${configPath}:`, config);
    }
  } catch (e) {
    console.warn("[Vite] Failed to load config/ports.json, using defaults/env vars:", e);
  }

  return config;
}

export default defineConfig(({ mode }) => {
  const portConfig = getPortConfig(mode);
  
  // Extract host and port from backend_url for proxy target
  const backendUrl = portConfig.backend_url;
  
  // Ensure backendUrl has a protocol for URL constructor
  const backendUrlWithProtocol = backendUrl.startsWith("http") 
    ? backendUrl 
    : `http://${backendUrl}`;
  
  const backendHost = portConfig.backend_url.includes("localhost") || portConfig.backend_url.includes("127.0.0.1")
    ? "localhost"
    : new URL(backendUrlWithProtocol).hostname;
  
  const proxyTarget = `http://${backendHost}:${portConfig.backend_port}`;
  
  // WebSocket proxy target
  const wsTarget = `ws://${backendHost}:${portConfig.ws_port}`;

  console.log(`[Vite] Starting with backend proxy: ${proxyTarget}`);
  console.log(`[Vite] Starting with WS proxy: ${wsTarget}`);
  console.log(`[Vite] Frontend will serve on port: ${portConfig.frontend_port}`);

  return {
    plugins: [react(), tailwindcss()],
    css: {
      transformer: 'postcss',
    },
    build: {
      cssMinify: 'esbuild',
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@shared": path.resolve(__dirname, "../../shared"),
      },
    },
    server: {
      port: portConfig.frontend_port,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
        "/ws": {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
        },
        "/output": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      // Ensure assets are properly referenced
      outDir: "dist",
      sourcemap: mode !== "production",
    },
  };
});
