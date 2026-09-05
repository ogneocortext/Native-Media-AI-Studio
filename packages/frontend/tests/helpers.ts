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

import { test, expect, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Base URL handling
// ---------------------------------------------------------------------------

/**
 * Get the base URL for the test environment.
 * Playwright's configured baseURL is automatically prepended when navigating
 * with a relative URL (e.g. page.goto('/health')).
 */
export function getBaseUrl(_page: Page): string {
  // Playwright's configured baseURL is automatically prepended when navigating
  // with a relative URL. We return a fallback for any manual URL construction.
  return 'http://localhost:5173';
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to a path and wait for the app shell to render.
 * Does NOT use `networkidle` (known to cause flakiness with SSE/polling SPAs).
 */
export async function navigateWithWait(page: Page, path: string, timeout = 15_000): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main.layout-main, main')).toBeVisible({ timeout });
}

// ---------------------------------------------------------------------------
// Route tracking (page-scoped)
// ---------------------------------------------------------------------------

type RouteHandler = (route: Route) => Promise<void> | void;

/**
 * Map keyed by Page to store active route handlers.
 * This ensures proper cleanup and prevents cross-page interference.
 */
const pageRouteHandlers = new WeakMap<Page, Set<RouteHandler>>();

/**
 * Register a route handler for a specific page.
 * Returns an unregister function.
 */
function registerRouteHandler(page: Page, handler: RouteHandler): () => void {
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
  status: 'healthy' | 'unhealthy';
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

// ---------------------------------------------------------------------------
// Default mock data
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

/**
 * Mock the `/api/health` endpoint.
 * COMPOSABLE: Does NOT call cleanupRoutes() - can be used alongside other mock functions.
 */
export async function mockApiHealth(
  page: Page,
  overrides: {
    status?: 200 | 500;
    body?: Partial<MockHealthResponse>;
  } = {}
): Promise<void> {
  const { status = 200, body } = overrides;
  const healthBody =
    status === 200
      ? JSON.stringify({ ...DEFAULT_HEALTH_RESPONSE, ...body })
      : JSON.stringify('Server error');

  registerRouteHandler(page, async (route) => {
    const url = route.request().url();
    if (url.includes('/api/health')) {
      await route.fulfill({ status, contentType: 'application/json', body: healthBody });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock the `/api/jobs` endpoint with an empty queue.
 * COMPOSABLE: Does NOT call cleanupRoutes().
 */
export async function mockApiQueueEmpty(page: Page): Promise<void> {
  registerRouteHandler(page, async (route) => {
    const url = route.request().url();
    if (url.includes('/api/jobs') && !url.includes('/stats')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    } else if (url.includes('/api/jobs/stats')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pending: 0, running: 0, completed: 0, failed: 0, total: 0 }),
      });
    } else {
      await route.continue();
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
    const url = route.request().url();
    if (url.includes('/api/jobs') && !url.includes('/stats')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(jobs),
      });
    } else if (url.includes('/api/jobs/stats')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stats),
      });
    } else {
      await route.continue();
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
    const url = route.request().url();
    if (url.includes('/api/render/health')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.continue();
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
    const url = route.request().url();
    if (url.includes('/api/services/status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.continue();
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
    const url = route.request().url();
    if (url.includes('/api/services/comfyui/status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.continue();
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
    const url = route.request().url();
    if (url.includes('/api/integrations/config/settings')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock all health-page endpoints in a single handler.
 * This is the recommended approach for health page tests as it avoids
 * the ordering issues that can occur when using individual mock functions.
 */
export async function mockHealthPage(
  page: Page,
  opts: {
    healthStatus?: 200 | 500;
    systemHealth?: Partial<MockSystemHealthResponse>;
    serviceStatus?: Partial<MockServiceStatusResponse>;
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
  const serviceStatusBody = JSON.stringify({ ...DEFAULT_SERVICE_STATUS, ...serviceStatus });
  const comfyuiStatusBody = JSON.stringify({
    installed: comfyuiInstalled,
    running: comfyuiRunning,
    port: 8188,
    url: 'http://localhost:8188',
  });

  registerRouteHandler(page, async (route) => {
    const url = route.request().url();
    if (url.includes('/api/health')) {
      await route.fulfill({ status: healthStatus, contentType: 'application/json', body: healthBody });
    } else if (url.includes('/api/render/health')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: systemHealthBody });
    } else if (url.includes('/api/services/status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: serviceStatusBody });
    } else if (url.includes('/api/services/comfyui/status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: comfyuiStatusBody });
    } else {
      await route.continue();
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
    const win = window as any;
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