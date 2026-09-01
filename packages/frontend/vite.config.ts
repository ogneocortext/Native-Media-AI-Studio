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
  events_url?: string;
  sse_url?: string;
}

/**
 * Load port configuration from config/ports.json
 * Falls back to environment variables or defaults
 */
function getPortConfig(mode: string): PortConfig {
  const env = loadEnv(mode, process.cwd(), "");
  
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
    }
  } catch (e) {
    console.warn("[Vite] Failed to load config/ports.json, using defaults/env vars:", e);
  }

  return config;
}

export default defineConfig(({ mode }) => {
  const portConfig = getPortConfig(mode);
  const backendUrl = portConfig.backend_url;
  const backendUrlWithProtocol = backendUrl.startsWith("http") ? backendUrl : `http://${backendUrl}`;
  const backendHost = backendUrl.includes("localhost") || backendUrl.includes("127.0.0.1")
    ? "localhost"
    : new URL(backendUrlWithProtocol).hostname;
  const proxyTarget = `http://${backendHost}:${portConfig.backend_port}`;
  const isProd = mode === "production";

  return {
    plugins: [react(), tailwindcss()],
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
        "/output": {
          target: proxyTarget,
          changeOrigin: true,
        },
        "/ws": {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
      // Stable file watching on Windows
      watch: {
        usePolling: true,
        interval: 1000,
        ignored: [
          "**/node_modules/**",
          "**/dist/**",
          "**/.git/**",
          "**/public/docs/**",
          "**/public/stems/**",
          "**/public/renders/**",
        ],
      },
      hmr: {
        overlay: false,
      },
    },
    // Pre-bundle large dependencies for faster dev startup
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "three",
        "@react-three/fiber",
        "@react-three/drei",
        "animejs",
        "lucide-react",
        "zustand",
        "@theatre/core",
        "@theatre/studio",
      ],
    },
    build: {
      outDir: "dist",
      sourcemap: !isProd,
      cssMinify: "esbuild",
      chunkSizeWarningLimit: 1500,
      // Target modern browsers for smaller bundles
      target: "es2022",
      rollupOptions: {
        output: {
          // Manual chunk splitting for better caching
          // Rolldown/Vite 8 requires a function for manualChunks
          manualChunks(id: string) {
            if (id.includes("node_modules")) {
              if (id.includes("three") || id.includes("@react-three")) {
                return "three-vendor";
              }
              if (id.includes("react") || id.includes("react-dom")) {
                return "react-vendor";
              }
              if (id.includes("animejs") || id.includes("@theatre")) {
                return "animation-vendor";
              }
              if (id.includes("lucide-react") || id.includes("zustand")) {
                return "ui-vendor";
              }
            }
            return undefined;
          },
        },
      },
      // Minification settings
      minify: isProd ? "esbuild" : false,
      // Reduce console noise in production
      reportCompressedSize: false,
    },
  };
});
