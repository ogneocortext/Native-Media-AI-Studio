/**
 * Shared Playwright helpers for Native Media AI Studio frontend tests.
 *
 * Improvements over the initial version:
 * - Uses Playwright's configured `baseURL` via `page.context().baseURL()` instead of
 *   hardcoded `http://localhost:5173`, so tests work with Vite proxy and alternate ports.
 * - Properly typed (`Page` from `@playwright/test`) instead of `any`.
 * - Route handlers are tracked per-page (using Map) and cleaned up between tests.
 * - `navigateWithWait` no longer uses `networkidle` (known to cause flakiness with SSE /
 *   polling SPAs); it waits for `domcontentloaded` plus a stable locator.
 * - `expectNoConsoleErrors` attaches the listener BEFORE navigation so early errors are caught.
 * - Added helpers for SSE mock dispatch, system health, and ComfyUI status.
 * - Individual mock functions are now COMPOSABLE - they can be called together without
 *   one wiping the others' routes. Each mock function now takes an optional `overrides`
 *   parameter and does NOT call cleanupRoutes() internally.
 * - Added TypeScript interfaces for mock data types.
 * - Added utility functions for common testing patterns.
 */

import { expect, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Base URL handling
// ---------------------------------------------------------------------------

/**
 * Get the base URL for the test environment.
 * Playwright's configured baseURL is automatically prepended when navigating
 * with a relative URL (e.g. page.goto('/health')).
 */
/** Base URL used when a test has to build an absolute URL by hand. */
const DEFAULT_TEST_BASE_URL = 'http://localhost:5173';

/**
 * Base URL for manually constructed URLs.
 *
 * Playwright prepends `use.baseURL` to relative navigations, and 1.63 exposes no
 * runtime accessor for it — `BrowserContext.baseURL()` does not exist (calling
 * it throws `TypeError`), so it must not be used here. Prefer `page.goto('/path')`;
 * this helper only exists for the rare absolute-URL case and mirrors
 * `use.baseURL` from playwright.config.ts (override with `PW_BASE_URL`).
 */
export function getBaseUrl(_page?: Page): string {
  return (process.env.PW_BASE_URL ?? DEFAULT_TEST_BASE_URL).replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to a path and wait for the app shell to render.
 * Does NOT use `networkidle` (known to cause flakiness with SSE/polling SPAs).
 */
export async function navigateWithWait(page: Page, path: string, timeout = 15_000): Promise<void> {
  const browserErrors: string[] = [];
  const onPageError = (error: Error) => browserErrors.push(error.message);
  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  try {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).toHaveCount(1, { timeout });
    await expect(page.locator('main.layout-main, main')).toBeVisible({ timeout });
    // After navigation, not just in beforeEach: the Vite dev server injects its
    // overlay on every page load, so cleaning only in `beforeEach` leaves it in
    // place for the entire test — which is what made the sidebar footer toggle
    // unclickable.
    await removeDevToolOverlays(page);
  } catch (error) {
    const url = page.url();
    const details = browserErrors.length ? ` Browser errors: ${browserErrors.join(' | ')}` : '';
    throw new Error(`Navigation to ${path} failed at ${url}.${details}`, { cause: error });
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

/**
 * Assert that the page was redirected to a target path.
 *
 * IMPORTANT: Use this instead of `expect(page.url()).toContain(...)` after
 * `navigateWithWait`. React Router's client-side `<Navigate>` fires asynchronously
 * after `domcontentloaded`, so a synchronous `page.url()` check races the redirect
 * and sees the source URL. `toHaveURL` retries until the pattern matches or the
 * assertion timeout elapses.
 */
export async function expectRedirectedTo(page: Page, pathPattern: string | RegExp, timeout = 5_000): Promise<void> {
  await expect(page).toHaveURL(pathPattern, { timeout });
}

// ---------------------------------------------------------------------------
// Route tracking (page-scoped)
// ---------------------------------------------------------------------------

type RouteHandler = (route: Route) => Promise<void> | void;

/**
 * Extract pathname from a full URL string.
 * Falls back to the raw string if parsing fails.
 */
function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Map keyed by Page to store active route handlers.
 * This ensures proper cleanup and prevents cross-page interference.
 */
const pageRouteHandlers = new WeakMap<Page, Set<RouteHandler>>();

/**
 * Register a route handler for a specific page.
 * Returns an unregister function.
 */
export function registerRouteHandler(page: Page, handler: RouteHandler): () => void {
  if (!pageRouteHandlers.has(page)) {
    pageRouteHandlers.set(page, new Set());
  }
  const handlers = pageRouteHandlers.get(page)!;
  handlers.add(handler);
  page.route('**', handler);

  return () => {
    handlers.delete(handler);
    page.unroute('**', handler).catch(() => {});
  };
}

/**
 * Clean up all route handlers for a specific page.
 * Called automatically via test.afterEach in playwright.config.ts.
 */
export async function cleanupRoutes(page: Page): Promise<void> {
  const handlers = pageRouteHandlers.get(page);
  if (handlers) {
    const handlersArray = Array.from(handlers);
    handlers.clear();
    for (const handler of handlersArray) {
      await page.unroute('**', handler).catch(() => {});
    }
  }
  await removeDevToolOverlays(page);
}

/**
 * Remove dev-only overlay elements that intercept pointer events.
 *
 * The Vite dev server injects `<devframes-dock-embedded>` (and the HMR error
 * overlay) into `<body>`. They sit above the app and swallow clicks aimed at
 * whatever is beneath them. `sidebar.spec.ts` failed on exactly this: the System
 * footer toggle reported "visible, enabled and stable" and still timed out,
 * because `document.elementFromPoint` at its centre returned the overlay rather
 * than the button.
 *
 * It is a test-environment artifact, not an app defect — the same click works
 * in a production build — so the fix belongs here rather than in a spec, and
 * every suite that calls `cleanupRoutes` in `beforeEach` inherits it.
 *
 * These tags only exist in dev, so this is a no-op against a preview build.
 */
export async function removeDevToolOverlays(page: Page): Promise<void> {
  // Block the overlay's script at the network level first.
  //
  // Removing the DOM node is not enough on its own: `/__devtools/embedded.js`
  // fetches its icons from `https://api.iconify.design` at runtime, and those
  // cross-origin requests log CORS errors that `expectNoConsoleErrors` then
  // fails on. That is what made two `unity.spec.ts` tests fail — not the app.
  // Blocking the request keeps the CDN out of the test entirely.
  await page
    .route('**/__devtools/**', (route) => route.abort())
    .catch(() => {
      // Already routed by this page; ignore.
    });
  await page
    .evaluate(() => {
      const DEV_TAGS = ['devframes-dock-embedded', 'vite-error-overlay', 'react-refresh'];
      for (const tag of DEV_TAGS) {
        // Removing is correct: none of these carry app content, and the HMR
        // overlay is re-injected after a rebuild, so `cleanupRoutes` runs again
        // on the next test.
        document.querySelectorAll(tag).forEach((node) => node.remove());
      }
      // `vite-plugin-inspect` and similar can leave a full-screen wrapper.
      document
        .querySelectorAll('body > [data-vite-dev-overlay], body > vite-error-overlay')
        .forEach((node) => node.remove());
    })
    .catch(() => {
      // The page may not be navigated yet; this is best-effort cleanup.
    });
}

// ---------------------------------------------------------------------------
// TypeScript interfaces for mock data
// ---------------------------------------------------------------------------

export interface MockHealthResponse {
  backend: 'online' | 'offline';
  overall: 'healthy' | 'unhealthy';
  adapters: {
    comfyui: { name: string; status: string; response_time_ms: number };
    ollama: { name: string; status: string; response_time_ms: number };
  };
  timestamp: string;
}

export interface MockSystemHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  platform: string;
  platform_version: string;
  cpu: {
    usage_percent: number;
    count: number;
    count_logical: number;
  };
  memory: {
    total_gb: number;
    available_gb: number;
    used_gb: number;
    percent: number;
  };
  disk: {
    total_gb: number;
    free_gb: number;
    percent: number;
  };
}

export interface MockServiceStatusResponse {
  adapters: { comfyui: string; ollama: string };
  adapter_details: {
    comfyui: { status: string; url: string };
    ollama: { status: string; url: string };
  };
  connections: number;
}

export interface MockComfyUIStatusResponse {
  installed: boolean;
  running: boolean;
  port: number;
  url: string;
}

export interface MockGoServiceHealthResponse {
  status: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Go sidecar mock data
// ---------------------------------------------------------------------------

// Go service ports — consolidated from config/ports.json (single source of truth).
// Do not edit here; update config/ports.json instead.
function loadGoServicePorts(): Record<string, number> {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const raw = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../config/ports.json"), "utf-8"),
    );
    // Extract port from URLs like "http://127.0.0.1:3847"
    const portFromUrl = (key: string): number => {
      const url = raw[key] as string | undefined;
      if (!url) return 0;
      const m = url.match(/:(\d+)(?:\/|$)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    return {
      "go-dashboard": portFromUrl("go_dashboard_url"),
      "go-media": portFromUrl("go_media_url"),
      "go-worker": portFromUrl("go_worker_url"),
      "go-gateway": portFromUrl("go_gateway_url"),
      "go-ports": portFromUrl("go_ports_url"),
    };
  } catch {
    // Fallback defaults matching config/ports.json
    return {
      "go-dashboard": 3847,
      "go-media": 3848,
      "go-worker": 3849,
      "go-gateway": 3850,
      "go-ports": 3851,
    };
  }
}

const GO_SERVICE_PORTS = loadGoServicePorts();

const DEFAULT_GO_HEALTH_RESPONSE: MockGoServiceHealthResponse = {
  status: 'ok',
  timestamp: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// API mocking helpers (COMPOSABLE)
// ---------------------------------------------------------------------------

const DEFAULT_HEALTH_RESPONSE: MockHealthResponse = {
  backend: 'online',
  overall: 'healthy',
  adapters: {
    comfyui: { name: 'ComfyUI', status: 'online', response_time_ms: 42 },
    ollama: { name: 'Ollama', status: 'online', response_time_ms: 18 },
  },
  timestamp: new Date().toISOString(),
};

const DEFAULT_SYSTEM_HEALTH: MockSystemHealthResponse = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  platform: 'Windows',
  platform_version: '10',
  cpu: { usage_percent: 12, count: 6, count_logical: 12 },
  memory: { total_gb: 32, available_gb: 24, used_gb: 8, percent: 25 },
  disk: { total_gb: 512, free_gb: 256, percent: 50 },
};

const DEFAULT_SERVICE_STATUS: MockServiceStatusResponse = {
  adapters: { comfyui: 'connected', ollama: 'connected' },
  adapter_details: {
    comfyui: { status: 'connected', url: 'http://localhost:8188' },
    ollama: { status: 'connected', url: 'http://localhost:11434' },
  },
  connections: 2,
};

// ---------------------------------------------------------------------------
// API mocking helpers (COMPOSABLE)
// ---------------------------------------------------------------------------

/** Options accepted by {@link mockApiHealth} (a bare status code also works). */
export type MockHealthOverrides = {
  status?: 200 | 500;
  body?: Partial<MockHealthResponse>;
};

/**
 * Mock the `/api/health` endpoint.
 *
 * Accepts either a bare status code (`mockApiHealth(page, 500)`, the form most
 * specs use) or an options object.
 * COMPOSABLE: Does NOT call cleanupRoutes() - can be used alongside other mock functions.
 */
export async function mockApiHealth(
  page: Page,
  overrides: 200 | 500 | MockHealthOverrides = {}
): Promise<void> {
  const options: MockHealthOverrides = typeof overrides === 'number' ? { status: overrides } : overrides;
  const { status = 200, body } = options;
  const healthBody =
    status === 200
      ? JSON.stringify({ ...DEFAULT_HEALTH_RESPONSE, ...body })
      : JSON.stringify('Server error');

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/health') {
      await route.fulfill({ status, contentType: 'application/json', body: healthBody });
    } else {
      await route.fallback();
    }
  });
}

/**
 * Mock the `/api/jobs` endpoint with an empty queue.
 * COMPOSABLE: Does NOT call cleanupRoutes().
 */
export async function mockApiQueueEmpty(page: Page): Promise<void> {
  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/jobs' || (pathname.startsWith('/api/jobs/') && !pathname.includes('/stats'))) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    } else if (pathname === '/api/jobs/stats' || pathname.startsWith('/api/jobs/stats/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pending: 0, running: 0, completed: 0, failed: 0, total: 0 }),
      });
    } else {
      await route.fallback();
    }
  });
}

/**
 * Mock the `/api/jobs` endpoint with a queue containing multiple jobs.
 * COMPOSABLE: Does NOT call cleanupRoutes().
 */
export async function mockApiQueueWithJobs(page: Page, count = 2): Promise<void> {
  const cycle: Array<'running' | 'pending' | 'completed' | 'failed'> = [
    'running',
    'completed',
    'failed',
    'pending',
  ];
  const jobs = Array.from({ length: count }, (_, i) => {
    const status = cycle[i % cycle.length];
    return {
      id: `job-${i + 1}`,
      job_type: 'image_generation',
      status,
      params: { prompt: `Test prompt ${i + 1}` },
      progress:
        status === 'running' ? 0.45 : status === 'completed' ? 1 : status === 'failed' ? 0.6 : 0,
      result_path: status === 'completed' ? '/output/video/test.mp4' : null,
      error: status === 'failed' ? 'Something went wrong' : null,
      created_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
    };
  });
  const stats = {
    pending: jobs.filter((j) => j.status === 'pending').length,
    running: jobs.filter((j) => j.status === 'running').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    total: count,
    total_jobs: count,
  };

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/jobs' || (pathname.startsWith('/api/jobs/') && !pathname.includes('/stats'))) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(jobs),
      });
    } else if (pathname === '/api/jobs/stats' || pathname.startsWith('/api/jobs/stats/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stats),
      });
    } else {
      await route.fallback();
    }
  });
}

/**
 * Mock the `/api/render/health` endpoint.
 * COMPOSABLE: Does NOT call cleanupRoutes() - can be used alongside other mock functions.
 */
export async function mockApiSystemHealth(
  page: Page,
  overrides: Partial<MockSystemHealthResponse> = {}
): Promise<void> {
  const body = JSON.stringify({ ...DEFAULT_SYSTEM_HEALTH, ...overrides });

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/render/health' || pathname.startsWith('/api/render/health/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.fallback();
    }
  });
}

/**
 * Mock the `/api/services/status` endpoint.
 * COMPOSABLE: Does NOT call cleanupRoutes() - can be used alongside other mock functions.
 */
export async function mockApiServiceStatus(
  page: Page,
  overrides: Partial<MockServiceStatusResponse> = {}
): Promise<void> {
  const body = JSON.stringify({ ...DEFAULT_SERVICE_STATUS, ...overrides });

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/services/status' || pathname.startsWith('/api/services/status/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.fallback();
    }
  });
}

/**
 * Mock the `/api/services/comfyui/status` endpoint.
 * COMPOSABLE: Does NOT call cleanupRoutes() - can be used alongside other mock functions.
 */
export async function mockApiComfyUIStatus(
  page: Page,
  installed = true,
  running = false
): Promise<void> {
  const body = JSON.stringify({
    installed,
    running,
    port: 8188,
    url: 'http://localhost:8188',
  } as MockComfyUIStatusResponse);

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/services/comfyui/status' || pathname.startsWith('/api/services/comfyui/status/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.fallback();
    }
  });
}

/**
 * Mock the `/api/integrations/config/settings` endpoint.
 * COMPOSABLE: Does NOT call cleanupRoutes().
 */
export async function mockApiSettings(
  page: Page,
  overrides: Partial<Record<string, string>> = {}
): Promise<void> {
  const defaultSettings: Record<string, string> = {
    comfyui_url: 'http://127.0.0.1:8188',
    ollama_url: 'http://127.0.0.1:11434',
    log_level: 'INFO',
    max_queue_workers: '1',
    backend_port: '8000',
    frontend_port: '5173',
    default_model: '',
  };
  const body = JSON.stringify({ ...defaultSettings, ...overrides });

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/integrations/config/settings' || pathname.startsWith('/api/integrations/config/settings/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.fallback();
    }
  });
}

export interface MockGpuSnapshot {
  available: boolean;
  name: string;
  memory_used_mb: number;
  memory_free_mb: number;
  memory_total_mb: number;
  memory_percent: number;
  gpu_utilization: number;
  temperature_c: number;
  processes: Array<{ pid: number; name: string; used_mb: number }>;
}

export const DEFAULT_GPU_SNAPSHOT: MockGpuSnapshot = {
  available: true,
  name: 'NVIDIA GeForce RTX 4070',
  memory_used_mb: 4096,
  memory_free_mb: 4096,
  memory_total_mb: 8192,
  memory_percent: 50,
  gpu_utilization: 35,
  temperature_c: 61,
  processes: [{ pid: 1234, name: 'ComfyUI.exe', used_mb: 3200 }],
};

/**
 * Mock the `/api/health/gpu*` telemetry endpoints used by the `/gpu` page.
 *
 * Without a snapshot the page renders its "GPU monitoring requires NVIDIA drivers
 * with NVML support" empty state, which deliberately has no `<h1>` — header
 * assertions then fail for the wrong reason. COMPOSABLE: does NOT call cleanupRoutes().
 */
export async function mockGpuTelemetry(
  page: Page,
  overrides: Partial<MockGpuSnapshot> = {}
): Promise<void> {
  const snapshotBody = JSON.stringify({ ...DEFAULT_GPU_SNAPSHOT, ...overrides });
  const processesBody = JSON.stringify({
    processes: [{ pid: 1234, name: 'ComfyUI.exe', mem_mb: 3200 }],
    count: 1,
  });
  // The page hydrates charts from history/stats on mount; empty series are valid.
  const emptyHistoryBody = JSON.stringify({ points: [], count: 0 });
  const emptyStatsBody = JSON.stringify({ avg_temp: 0, avg_vram: 0, avg_util: 0, samples: 0 });

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/health/gpu') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: snapshotBody });
    } else if (pathname === '/api/health/gpu/processes') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: processesBody });
    } else if (pathname === '/api/health/gpu/stats') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyStatsBody });
    } else if (pathname.startsWith('/api/health/gpu/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: emptyHistoryBody });
    } else {
      await route.fallback();
    }
  });
}

/**
 * Mock every `/api/logs/analytics/*` endpoint the Log Analytics page loads on mount.
 * The page runs them in `Promise.all` and logs "Failed to refresh log analytics"
 * when any of them misses, which trips `expectNoConsoleErrors`.
 * COMPOSABLE: does NOT call cleanupRoutes().
 */
export async function mockLogAnalytics(page: Page): Promise<void> {
  const tsIso = '2026-09-28T12:00:00+00:00';
  const tsMs = Date.parse(tsIso);
  const event = {
    ts_iso: tsIso,
    ts_ms: tsMs,
    level: 'INFO',
    logger: 'app.api',
    message: 'startup complete',
    source: 'app',
  };
  const bodies: Record<string, string> = {
    '/api/logs/analytics/summary': JSON.stringify({
      total_events: 3,
      last_event_at: tsIso,
      last_cleanup_at: null,
      levels: [
        { level: 'INFO', count: 2 },
        { level: 'ERROR', count: 1 },
      ],
      top_loggers: [{ logger: 'app.api', count: 3 }],
      top_messages: [{ message: 'startup complete', count: 1, level: 'INFO' }],
      sources: [{ source: 'app', count: 3 }],
    }),
    '/api/logs/analytics/patterns': JSON.stringify({
      levels: [
        { level: 'INFO', count: 2 },
        { level: 'ERROR', count: 1 },
      ],
      loggers: [{ logger: 'app.api', count: 3 }],
      messages: [{ message: 'startup complete', count: 1, level: 'INFO' }],
    }),
    '/api/logs/analytics/errors': JSON.stringify({ errors: [] }),
    '/api/logs/analytics/events': JSON.stringify({ count: 1, events: [event] }),
    '/api/logs/analytics/trends': JSON.stringify({
      count: 1,
      points: [{ ts_iso: tsIso, ts_ms: tsMs, level: 'INFO', logger: 'app.api', message: 'startup complete' }],
    }),
    '/api/logs/': JSON.stringify({ log_directory: 'logs', files: {} }),
  };

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    const body = bodies[pathname];
    if (body) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else if (pathname.startsWith('/api/logs/')) {
      // Raw log viewer requests (GET /api/logs/<name>): answer with an empty tail.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ log: pathname.split('/').pop(), lines: 0, content: [] }),
      });
    } else {
      await route.fallback();
    }
  });
}


/**
 * Mock all health-page endpoints in a single handler.
 * This is the recommended approach for health page tests as it avoids
 * the ordering issues that can occur when using individual mock functions.
 */
/** Service-status overrides whose nested adapter maps are merged, not replaced. */
export type MockServiceStatusOverrides = Omit<
  Partial<MockServiceStatusResponse>,
  'adapters' | 'adapter_details'
> & {
  adapters?: Partial<MockServiceStatusResponse['adapters']>;
  adapter_details?: Partial<MockServiceStatusResponse['adapter_details']>;
};

export async function mockHealthPage(
  page: Page,
  opts: {
    healthStatus?: 200 | 500;
    systemHealth?: Partial<MockSystemHealthResponse>;
    serviceStatus?: MockServiceStatusOverrides;
    comfyuiInstalled?: boolean;
    comfyuiRunning?: boolean;
  } = {}
): Promise<void> {
  const {
    healthStatus = 200,
    systemHealth = {},
    serviceStatus = {},
    comfyuiInstalled = true,
    comfyuiRunning = false,
  } = opts;

  const healthBody =
    healthStatus === 200
      ? JSON.stringify({ ...DEFAULT_HEALTH_RESPONSE })
      : JSON.stringify('Server error');

  const systemHealthBody = JSON.stringify({ ...DEFAULT_SYSTEM_HEALTH, ...systemHealth });
  // Merge the nested maps so an override such as { adapters: { comfyui: 'degraded' } }
  // keeps the untouched adapters instead of dropping them from the payload.
  const serviceStatusBody = JSON.stringify({
    ...DEFAULT_SERVICE_STATUS,
    ...serviceStatus,
    adapters: { ...DEFAULT_SERVICE_STATUS.adapters, ...serviceStatus.adapters },
    adapter_details: { ...DEFAULT_SERVICE_STATUS.adapter_details, ...serviceStatus.adapter_details },
  });
  const comfyuiStatusBody = JSON.stringify({
    installed: comfyuiInstalled,
    running: comfyuiRunning,
    port: 8188,
    url: 'http://localhost:8188',
  });

  registerRouteHandler(page, async (route) => {
    const pathname = getPathname(route.request().url());
    if (pathname === '/api/health') {
      await route.fulfill({ status: healthStatus, contentType: 'application/json', body: healthBody });
    } else if (pathname === '/api/render/health' || pathname.startsWith('/api/render/health/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: systemHealthBody });
    } else if (pathname === '/api/services/status' || pathname.startsWith('/api/services/status/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: serviceStatusBody });
    } else if (pathname === '/api/services/comfyui/status' || pathname.startsWith('/api/services/comfyui/status/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: comfyuiStatusBody });
    } else {
      await route.fallback();
    }
  });
}

// ---------------------------------------------------------------------------
// SSE mock dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a synthetic SSE `message` event to the frontend `sseService`.
 */
export async function dispatchSseEvent(page: Page, event: Record<string, unknown>): Promise<void> {
  await page.evaluate((msg) => {
    const win = window as unknown as {
      __healthStore?: { getState?: () => unknown };
      __jobStore?: { getState?: () => unknown };
      __sseService?: { feedMessage?: (msg: unknown) => void };
    };
    const store = win.__healthStore || win.__jobStore;
    if (!store) return;
    const sse = win.__sseService;
    if (sse?.feedMessage) {
      sse.feedMessage(msg);
    }
  }, event);
}

// ---------------------------------------------------------------------------
// Console / error helpers
// ---------------------------------------------------------------------------

/**
 * Categories of console errors that should be filtered out in tests.
 */
export const consoleErrorFilters = {
  connection: ['ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ECONNREFUSED'],
  network: ['net::', 'NetworkError'],
  cdn: ['Failed to load resource', 'script error'],
  vite: ['[vite]'],
};

/**
 * Set up a console error capture and return the errors array.
 * Attach the listener BEFORE navigation to catch early errors.
 */
export function setupConsoleErrorCapture(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

/**
 * Expect no console errors, filtering out known harmless errors.
 */
export function expectNoConsoleErrors(errors: string[], customExclude: string[] = []): void {
  const allExcludes = [
    ...customExclude,
    ...consoleErrorFilters.connection,
    ...consoleErrorFilters.network,
    ...consoleErrorFilters.cdn,
    ...consoleErrorFilters.vite,
  ];
  const filtered = errors.filter((e) => !allExcludes.some((ex) => e.includes(ex)));
  expect(filtered).toEqual([]);
}

/**
 * Check if an error is a known harmless error that should be filtered.
 */
export function isFilteredError(error: string): boolean {
  const allExcludes = [
    ...consoleErrorFilters.connection,
    ...consoleErrorFilters.network,
    ...consoleErrorFilters.cdn,
    ...consoleErrorFilters.vite,
  ];
  return allExcludes.some((ex) => error.includes(ex));
}

/**
 * Mock health endpoints for all Go sidecars.
 * COMPOSABLE: Does NOT call cleanupRoutes().
 */
export async function mockGoServiceHealth(
  page: Page,
  overrides: Record<string, Partial<MockGoServiceHealthResponse>> = {}
): Promise<void> {
  registerRouteHandler(page, async (route) => {
    const url = route.request().url();
    const pathname = getPathname(url);
    if (pathname === '/events') {
      await route.fallback();
      return;
    }
    if (pathname === '/api/health/diagnostics/services' || pathname.startsWith('/api/health/diagnostics/services/')) {
      const sidecars = Object.fromEntries(Object.keys(GO_SERVICE_PORTS).map((name) => [name, {
        status: 'online', url: `http://127.0.0.1:${GO_SERVICE_PORTS[name]}`,
      }]));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adapters: {}, sidecars }) });
      return;
    }
    for (const [name, port] of Object.entries(GO_SERVICE_PORTS)) {
      if (url.includes(`127.0.0.1:${port}`) || url.includes(`localhost:${port}`)) {
        const body = JSON.stringify({ ...DEFAULT_GO_HEALTH_RESPONSE, ...(overrides[name] || {}) });
        await route.fulfill({ status: 200, contentType: 'application/json', body });
        return;
      }
    }
    await route.fallback();
  });
}

/**
 * Mock health endpoints for Go sidecars with some services offline.
 * COMPOSABLE: Does NOT call cleanupRoutes().
 */
export async function mockGoServiceHealthDegraded(
  page: Page,
  offlineServices: string[] = []
): Promise<void> {
  registerRouteHandler(page, async (route) => {
    const url = route.request().url();
    const pathname = getPathname(url);
    if (pathname === '/events') {
      await route.fallback();
      return;
    }
    if (pathname === '/api/health/diagnostics/services' || pathname.startsWith('/api/health/diagnostics/services/')) {
      const sidecars = Object.fromEntries(Object.keys(GO_SERVICE_PORTS).map((name) => [name, {
        status: offlineServices.includes(name) ? 'offline' : 'online',
        url: `http://127.0.0.1:${GO_SERVICE_PORTS[name]}`,
      }]));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adapters: {}, sidecars }) });
      return;
    }
    for (const [name, port] of Object.entries(GO_SERVICE_PORTS)) {
      if (url.includes(`127.0.0.1:${port}`) || url.includes(`localhost:${port}`)) {
        const isOffline = offlineServices.includes(name);
        const body = JSON.stringify({
          status: isOffline ? 'error' : 'ok',
          timestamp: new Date().toISOString(),
        });
        await route.fulfill({ status: isOffline ? 503 : 200, contentType: 'application/json', body });
        return;
      }
    }
    await route.fallback();
  });
}

// ---------------------------------------------------------------------------
// Card and UI helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a card to be visible by checking its CSS class.
 */
export async function waitForCard(page: Page, className: string, timeout = 10_000): Promise<void> {
  await expect(page.locator(`.${className}`)).toBeVisible({ timeout });
}

/**
 * Get a card element by its CSS class.
 */
export function getCard(page: Page, className: string) {
  return page.locator(`.${className}`);
}

/**
 * Check if a card with the given class is visible.
 */
export async function isCardVisible(page: Page, className: string): Promise<boolean> {
  return page.locator(`.${className}`).isVisible();
}

/**
 * Wait for all resource cards to be rendered (used in health page tests).
 */
export async function waitForResourceCards(page: Page, count = 3, timeout = 10_000): Promise<void> {
  await expect(page.locator('.resource-card')).toHaveCount(count, { timeout });
}

/**
 * Wait for a card to have specific text content.
 */
export async function expectCardToHaveText(
  page: Page,
  className: string,
  text: string | RegExp,
  timeout = 5_000
): Promise<void> {
  const card = page.locator(`.${className}`);
  await expect(card).toHaveText(text, { timeout });
}

/**
 * Assert that a numeric value is within an expected range.
 */
export function expectInRange(actual: number, min: number, max: number): void {
  expect(actual).toBeGreaterThanOrEqual(min);
  expect(actual).toBeLessThanOrEqual(max);
}

/**
 * Round a number to a specific number of decimal places.
 */
export function roundTo(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}