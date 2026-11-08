#!/usr/bin/env node
/**
 * Robust Vite Dev Server Startup Script
 * 
 * Handles cache cleanup, dependency optimization, and stable server startup.
 * Based on Vite 8 best practices for avoiding corruption and stale state.
 * 
 * Usage:
 *   node scripts/start-dev-server.js [--clean] [--force-reoptimize] [--warmup]
 * 
 * Options:
 *   --clean              Clean Vite cache before starting (recommended after branch switch)
 *   --force-reoptimize   Force dependency re-optimization (recommended after package changes)
 *   --warmup             Enable server.warmup (default: true in dev)
 *   --no-warmup          Disable server.warmup
 *   --port PORT          Override frontend port (default: from config/ports.json)
 *   --host HOST          Override host (default: 0.0.0.0)
 */

import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync, rmSync, readFileSync, writeFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const FRONTEND_DIR = resolve(PROJECT_ROOT, "packages/frontend");
const VITE_CACHE_DIR = resolve(FRONTEND_DIR, "node_modules/.vite");
const PORTS_CONFIG = resolve(PROJECT_ROOT, "config/ports.json");

interface PortsConfig {
  frontend_port: number;
  backend_port: number;
  backend_url: string;
  ws_port: number;
}

function loadPortsConfig(): PortsConfig {
  try {
    if (existsSync(PORTS_CONFIG)) {
      return JSON.parse(readFileSync(PORTS_CONFIG, "utf-8"));
    }
  } catch (e) {
    console.warn("[start-dev-server] Failed to load ports.json:", e);
  }
  return {
    frontend_port: 5173,
    backend_port: 8000,
    backend_url: "http://127.0.0.1:8000",
    ws_port: 8000,
  };
}

function cleanViteCache(): void {
  console.log("[start-dev-server] Cleaning Vite cache...");
  if (existsSync(VITE_CACHE_DIR)) {
    try {
      rmSync(VITE_CACHE_DIR, { recursive: true, force: true });
      console.log("[start-dev-server] ✓ Vite cache removed");
    } catch (e) {
      console.error("[start-dev-server] Failed to remove Vite cache:", e);
    }
  } else {
    console.log("[start-dev-server] No Vite cache to clean");
  }
  
  // Also clean Turbo cache if present
  const turboCache = resolve(PROJECT_ROOT, ".turbo");
  if (existsSync(turboCache)) {
    try {
      rmSync(turboCache, { recursive: true, force: true });
      console.log("[start-dev-server] ✓ Turbo cache removed");
    } catch (e) {
      console.warn("[start-dev-server] Failed to remove Turbo cache:", e);
    }
  }
}

function forceReoptimize(): void {
  console.log("[start-dev-server] Forcing dependency re-optimization...");
  // Set env var to trigger force re-optimization
  process.env.VITE_FORCE_REOPTIMIZE = "true";
  
  // Also clear the deps cache specifically
  const depsCache = resolve(FRONTEND_DIR, "node_modules/.vite/deps");
  if (existsSync(depsCache)) {
    try {
      rmSync(depsCache, { recursive: true, force: true });
      console.log("[start-dev-server] ✓ Dependency pre-bundle cache removed");
    } catch (e) {
      console.warn("[start-dev-server] Failed to remove deps cache:", e);
    }
  }
  
  // Clear deps temp dirs
  const depsTempDirs = resolve(FRONTEND_DIR, "node_modules/.vite/deps_temp_");
  try {
    // Note: we can't glob here easily, so just try the base
    console.log("[start-dev-server] Dependency pre-bundle will be rebuilt on startup");
  } catch (e) {
    // Ignore
  }
}

function verifyNodeModules(): boolean {
  console.log("[start-dev-server] Verifying node_modules integrity...");
  const nodeModules = resolve(FRONTEND_DIR, "node_modules");
  const pnpmLock = resolve(PROJECT_ROOT, "pnpm-lock.yaml");
  
  if (!existsSync(nodeModules)) {
    console.error("[start-dev-server] ❌ node_modules missing! Run 'pnpm install' first.");
    return false;
  }
  
  if (!existsSync(pnpmLock)) {
    console.warn("[start-dev-server] ⚠️  pnpm-lock.yaml not found at root");
  }
  
  // Check critical packages
  const criticalPackages = [
    "vite",
    "@vitejs/plugin-react",
    "@tailwindcss/vite",
    "react",
    "react-dom",
    "typescript",
  ];
  
  let allPresent = true;
  for (const pkg of criticalPackages) {
    const pkgPath = resolve(nodeModules, pkg);
    if (!existsSync(pkgPath)) {
      console.error(`[start-dev-server] ❌ Missing critical package: ${pkg}`);
      allPresent = false;
    }
  }
  
  if (allPresent) {
    console.log("[start-dev-server] ✓ Critical packages present");
  }
  
  return allPresent;
}

function startDevServer(args: {
  clean: boolean;
  forceReoptimize: boolean;
  warmup: boolean;
  port?: number;
  host?: string;
}): ChildProcess {
  const ports = loadPortsConfig();
  const port = args.port ?? ports.frontend_port;
  const host = args.host ?? "0.0.0.0";
  
  // Apply flags
  if (args.clean) {
    cleanViteCache();
  }
  
  if (args.forceReoptimize) {
    forceReoptimize();
  }
  
  if (!args.warmup) {
    process.env.VITE_DISABLE_WARMUP = "true";
  }
  
  // Verify node_modules before starting
  if (!verifyNodeModules()) {
    console.error("[start-dev-server] Cannot start: node_modules verification failed");
    process.exit(1);
  }
  
  console.log(`[start-dev-server] Starting Vite dev server on ${host}:${port}...`);
  console.log("[start-dev-server] Working directory:", FRONTEND_DIR);
  console.log("[start-dev-server] Vite cache dir:", VITE_CACHE_DIR);
  
  // Spawn Vite with proper stdio handling
  const vite = spawn("npx", ["vite", "--port", String(port), "--host", host], {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      NODE_ENV: "development",
    },
    shell: process.platform === "win32",
  });
  
  // Handle process events
  vite.on("error", (err) => {
    console.error("[start-dev-server] Failed to spawn Vite:", err);
    process.exit(1);
  });
  
  vite.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[start-dev-server] Vite exited with code ${code}`);
    }
    if (signal) {
      console.log(`[start-dev-server] Vite terminated by signal ${signal}`);
    }
    process.exit(code ?? 0);
  });
  
  // Forward signals
  process.on("SIGINT", () => {
    console.log("\n[start-dev-server] Received SIGINT, shutting down Vite...");
    vite.kill("SIGINT");
  });
  
  process.on("SIGTERM", () => {
    console.log("\n[start-dev-server] Received SIGTERM, shutting down Vite...");
    vite.kill("SIGTERM");
  });
  
  return vite;
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  clean: args.includes("--clean"),
  forceReoptimize: args.includes("--force-reoptimize") || args.includes("--force"),
  warmup: !args.includes("--no-warmup"),
  port: args.includes("--port") ? parseInt(args[args.indexOf("--port") + 1], 10) : undefined,
  host: args.includes("--host") ? args[args.indexOf("--host") + 1] : undefined,
};

// Show help
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Robust Vite Dev Server Startup Script

Usage:
  node scripts/start-dev-server.js [options]

Options:
  --clean              Clean Vite cache before starting (recommended after branch switch)
  --force-reoptimize   Force dependency re-optimization (recommended after package changes)
  --force              Alias for --force-reoptimize
  --warmup             Enable server.warmup (default: true)
  --no-warmup          Disable server.warmup
  --port PORT          Override frontend port (default: from config/ports.json)
  --host HOST          Override host (default: 0.0.0.0)
  --help, -h           Show this help

Examples:
  # Normal startup
  node scripts/start-dev-server.js
  
  # After switching branches or pulling changes
  node scripts/start-dev-server.js --clean
  
  # After package.json changes
  node scripts/start-dev-server.js --force-reoptimize
  
  # Full reset (cache + deps + warmup)
  node scripts/start-dev-server.js --clean --force-reoptimize
  
  # Custom port
  node scripts/start-dev-server.js --port 3000
`);
  process.exit(0);
}

console.log("[start-dev-server] Starting with options:", options);

// Start the server
startDevServer(options);