import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { visualizer } from "rollup-plugin-visualizer";

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
 * Shared proxy targets used by both `server` and `preview`.
 * Kept in one place so a backend URL change only needs one edit.
 */
const PROXY_TARGETS = {
  "/api": { target: "", changeOrigin: true },
  "/output": { target: "", changeOrigin: true },
  "/ws": { target: "", changeOrigin: true, ws: true },
} as const;

/**
 * Hosts allowed to reach the dev/preview server.
 * Public tunnel provider hostnames (randomized per start) are suffix-matched.
 */
const ALLOWED_HOSTS = [
  "localhost",
  ".localhost",
  ".loca.lt",
  ".ngrok-free.app",
  ".ngrok-free.dev",
  ".ngrok.app",
  ".ngrok.io",
  ".trycloudflare.com",
  ".serveo.net",
];

/**
 * Load port configuration from config/ports.json (single source of truth).
 * Falls back to environment variables or defaults that match ports.json.
 *
 * Tunnel mode: VITE_PUBLIC_BACKEND_URL overrides backend_url so the frontend
 * code calls the public tunnel endpoint instead of localhost when accessed
 * from a sandbox VM.  The Vite dev proxy still targets localhost because
 * Vite itself runs locally; only browser-origin API calls use the tunnel URL.
 */
function getPortConfig(mode: string): PortConfig {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  const publicBackend = (env.VITE_PUBLIC_BACKEND_URL || "").trim();
  const publicFrontend = (env.VITE_PUBLIC_FRONTEND_URL || "").trim();

  const configPath = path.resolve(__dirname, "../../config/ports.json");
  let config: PortConfig = {
    backend_url: publicBackend || env.VITE_BACKEND_URL || "http://127.0.0.1:8000",
    backend_port: parseInt(env.VITE_BACKEND_PORT || "8000", 10),
    frontend_port: publicFrontend ? parseInt(publicFrontend.split(":")[2] || "5173", 10) : parseInt(env.VITE_FRONTEND_PORT || "5173", 10),
    ws_port: parseInt(env.VITE_WS_PORT || "8000", 10),
  };

  try {
    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      // Only override from file if we are NOT in tunnel mode.
      if (!publicBackend) {
        config = {
          backend_url: fileConfig.backend_url || config.backend_url,
          backend_port: fileConfig.backend_port || config.backend_port,
          frontend_port: fileConfig.frontend_port || config.frontend_port,
          ws_port: fileConfig.ws_port || config.ws_port,
        };
      }
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
  const backendTarget = new URL(backendUrlWithProtocol);
  const proxyTarget = backendTarget.origin;
  const isProd = mode === "production";
  const isAnalyze = mode === "analyze";

  // Apply proxyTarget after we know the backend URL.
  const proxy = {
    "/api": { ...PROXY_TARGETS["/api"], target: proxyTarget },
    "/output": { ...PROXY_TARGETS["/output"], target: proxyTarget },
    "/ws": { ...PROXY_TARGETS["/ws"], target: proxyTarget },
  };

  return {
    // Use the project tsconfig.json for path resolution (Vite 8 feature)
    tsconfig: "tsconfig.json",
    // Vite 8 built-in devtools integration. clientAuth:false skips the
    // authorization dialog (which blocks the UI) while keeping all DevTools
    // data-extraction features functional.
    devtools: { apply: "serve", clientAuth: false },
    plugins: [
      react(),
      tailwindcss(),
      isAnalyze &&
        visualizer({
          open: true,
          gzipSize: true,
          brotliSize: true,
          filename: "dist/stats.html",
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        // tsconfig.json already defines @/* and @shared/*; tsconfigPaths:true
        // picks them up automatically. The manual aliases below are kept only
        // for entries that aren't in tsconfig (e.g. bare three/addons).
        "three/addons": path.resolve(__dirname, "./node_modules/three/examples/jsm"),
      },
      dedupe: ["three", "three-stdlib"],
      // Use tsconfig.json paths for alias resolution (Vite 8 feature)
      tsconfigPaths: true,
    },
    server: {
      host: "0.0.0.0",
      port: portConfig.frontend_port,
      strictPort: true,
      // Vite 8 no longer treats the string "all" as a wildcard: allowedHosts is
      // a list of hostnames, so "all" matched nothing and every public tunnel
      // host was rejected with 403 "Blocked request. This host is not allowed".
      // Entries may be a bare hostname or a leading-dot suffix match
      // (".loca.lt" matches any subdomain). The dev server is only reachable
      // via the tunnel or the LAN, so this is tighter than "all" on purpose.
      allowedHosts: ALLOWED_HOSTS,
      proxy,
      // Stable file watching on Windows (usePolling only needed on Windows
      // where native file-system events are unreliable in WSL/Docker).
      watch: {
        usePolling: process.platform === "win32",
        interval: process.platform === "win32" ? 1000 : undefined,
        ignored: [
          "**/node_modules/**",
          "**/dist/**",
          "**/.git/**",
          "**/.vite/**",
          "**/.turbo/**",
          "**/public/docs/**",
          "**/public/stems/**",
          "**/public/renders/**",
        ],
      },
      hmr: {
        overlay: true,
      },
      // Auto-open browser in dev mode for better DX.
      open: mode === "development",
      // Forward browser runtime errors and warnings to the dev server terminal
      // so coding agents can see client-side exceptions without opening the
      // browser console. Vite 8 enables this automatically when an agent is
      // detected; we set it explicitly for reliability.
      forwardConsole: {
        unhandledErrors: true,
        logLevels: ["warn", "error"],
      },
      // Restrict filesystem access for the dev server.
      fs: {
        allow: [__dirname, path.resolve(__dirname, "../../shared")],
        deny: [
          "**/.env",
          "**/.env.*",
          "**/*.key",
          "**/*.pem",
          "**/*.{crt,p12,pfx,cer,der}",
          "**/.npmrc",
          "**/.yarnrc.yml",
        ],
      },
    },
    // Pre-bundle common dependencies for faster dev startup.
    // Heavy optional deps (@theatre/studio, @react-three/drei) are intentionally
    // omitted so the optimizer doesn't spend minutes scanning their large trees.
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "three",
        "@react-three/fiber",
        "animejs",
        "lucide-react",
        "zustand",
      ],
    },
    // Replace __DEV__ so dev-only code paths can be tree-shaken in production.
    define: {
      __DEV__: !isProd,
    },
    build: {
      outDir: "dist",
      sourcemap: !isProd,
      cssMinify: "esbuild",
      chunkSizeWarningLimit: 500,
      // Target modern browsers for smaller bundles
      target: "es2022",
      modulePreload: true,
      // Always minify production builds regardless of Vite mode.
      minify: "esbuild",
      // Reduce console noise in production
      reportCompressedSize: false,
      // Vite 8.1: keep chunk hashes stable when only one source file changes,
      // improving browser cache efficiency across deploys.
      chunkImportMap: true,
      rollupOptions: {
        output: {
          // Manual chunk splitting for better caching
          // Rolldown/Vite 8 requires a function for manualChunks
          manualChunks(id: string) {
            if (id.includes("node_modules")) {
              if (id.includes("three/examples") || (id.includes("three") && id.includes("examples"))) {
                return "three-examples";
              }
              if (id.includes("three") && !id.includes("@react-three")) {
                return "three-core";
              }
              if (id.includes("@react-three")) {
                return "react-three";
              }
              if (id.includes("react") || id.includes("react-dom")) {
                return "react-vendor";
              }
              if (id.includes("animejs")) {
                return "animejs-vendor";
              }
              if (id.includes("@theatre")) {
                return "theatre-vendor";
              }
              if (id.includes("lucide-react") || id.includes("zustand")) {
                return "ui-vendor";
              }
            }
            return undefined;
          },
        },
      },
    },
    preview: {
      port: portConfig.frontend_port + 1, // Avoid colliding with dev server port
      // Same host policy as `server`: `vite preview` is also reachable through
      // the tunnel when an agent is pointed at a built bundle.
      allowedHosts: ALLOWED_HOSTS,
      proxy,
    },
  };
});
