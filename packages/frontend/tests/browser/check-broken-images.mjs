// Diagnostic script v2: crawl the frontend SPA and report broken images,
// including request-level failures (DNS, CORS, 404-without-response, etc.).
// Run: node tests/browser/check-broken-images.mjs  (from packages/frontend)
import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";

const ROUTES = [
  "/system",
  "/system/onboarding",
  "/system/queue",
  "/system/settings",
  "/system/health",
  "/system/data-management",
  "/system/database",
  "/system/gpu",
  "/system/notifications",
  "/system/docs",
  "/create/music-video",
  "/create/3d",
  "/create/video",
  "/create/image",
  "/create/image-processing",
  "/create/typography",
  "/create/music",
  "/create/remix",
  "/create/animation",
  "/create/unity",
  "/create/hyperframes",
  "/library",
  "/library/storyboards",
  "/analyze/audio",
  "/analyze/ai",
  "/analyze/chat",
  "/mastering",
  "/render/visualizer",
  "/render/preview",
];

const isImageRequest = (url) =>
  /\.(png|jpe?g|gif|svg|webp|ico|avif)(\?|#|$)/i.test(url) ||
  /\/output\//i.test(url) ||
  /\/api\/audio\/file\//i.test(url) ||
  /api\.iconify\.design/i.test(url);

const failures = []; // { route, url, kind, detail }
const allImageEvents = []; // { route, url, kind, status }

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--enable-unsafe-swiftshader",
      "--enable-features=UnsafeSwiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const tag = (route) => {
    for (const e of allImageEvents) if (e.route === null) e.route = route;
  };

  page.on("response", (res) => {
    const url = res.url();
    if (!isImageRequest(url)) return;
    const status = res.status();
    const entry = { route: null, url, kind: "response", status };
    allImageEvents.push(entry);
    if (status >= 400)
      failures.push({ route: null, url, kind: "response", detail: `${status} ${res.statusText()}` });
  });

  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!isImageRequest(url)) return;
    const entry = { route: null, url, kind: "requestfailed", status: null };
    allImageEvents.push(entry);
    failures.push({ route: null, url, kind: "requestfailed", detail: req.failure?.errorText ?? "failed" });
  });

  page.on("requestfinished", (req) => {
    // not needed for failure reporting
  });

  let currentRoute = null;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) currentRoute = new URL(frame.url()).pathname;
  });

  console.log(`Crawling ${ROUTES.length} routes against ${BASE_URL}\n`);

  for (const route of ROUTES) {
    currentRoute = route;
    try {
      await withTimeout(
        page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 25000 }),
        28000,
      );
      await page.waitForTimeout(1200);
      tag(route);
      console.log(`  ok   ${route}`);
    } catch (err) {
      console.log(`  FAIL ${route}: ${err.message}`);
    }
  }
  tag(currentRoute);

  await browser.close();

  console.log(`\n=== BROKEN / FAILED IMAGE REQUESTS (${failures.length}) ===`);
  if (failures.length === 0) {
    console.log("  None found.");
  } else {
    for (const f of failures) {
      console.log(`  ${f.route ?? "-"} | ${f.kind} | ${f.detail} | ${f.url}`);
    }
  }

  console.log(`\n=== ALL IMAGE REQUEST EVENTS (${allImageEvents.length}) ===`);
  for (const a of allImageEvents) {
    const flag = a.kind === "requestfailed" || (a.status != null && a.status >= 400) ? "FAIL" : "ok";
    const status = a.status ?? "-";
    console.log(`  ${flag.padEnd(5)} | ${a.route ?? "-"} | ${status} | ${a.kind} | ${a.url}`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
