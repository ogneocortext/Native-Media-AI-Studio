// T-VIZ-23 verification: mixer wiring + GPU disposal in Three.js Studio.
// Run from packages/frontend: node tests/browser/audit/verify-studio-dispose.mjs
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
});

let page;
const mem = () =>
  page.evaluate(() => ({
    geometries: window.__renderer.info.memory.geometries,
    textures: window.__renderer.info.memory.textures,
    programs: window.__renderer.info.programs.length,
  }));
const objCount = async () => {
  const t = await page.locator(".hud").innerText().catch(() => "");
  const m = t.match(/Objects\s*(\d+)/);
  return m ? m[1] : "?";
};
// Bone quats prove the AnimationMixer is advancing (was frozen before the
// characterMixersRef wiring fix — the loop iterated an empty map).
const boneQuat = () =>
  page.evaluate(() => {
    const scene = window.__scene;
    if (!scene) return null;
    let found = null;
    scene.traverse((n) => {
      if (found) return;
      if (/^Head$|UpperArm|Spine/i.test(n.name)) found = n;
    });
    if (!found) return null;
    const q = found.quaternion;
    return { name: found.name, x: q.x, y: q.y, z: q.z, w: q.w };
  });
const hasBones = () =>
  page.evaluate(() => {
    const scene = window.__scene;
    if (!scene) return false;
    let bones = 0;
    scene.traverse((n) => {
      if (n.isBone) bones++;
    });
    return bones > 0;
  });
const sceneHasBones = () => {
  const scene = window.__scene;
  if (!scene) return false;
  let bones = 0;
  scene.traverse((n) => {
    if (n.isBone) bones++;
  });
  return bones > 0;
};
const domClick = (locator) => locator.evaluate((el) => el.click());

try {
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${base}/create/3d`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Initializing 3D scene"),
    null,
    { timeout: 30000 },
  );
  await sleep(2500);
  console.log("baseline:", JSON.stringify(await mem()), "objects", await objCount());

  // 1) Add a character; wait for its armature to land in the scene.
  await page.locator('button[title*="Add character"]').first().click();
  try {
    await page.waitForFunction(sceneHasBones, null, { timeout: 25000 });
    console.log("armature loaded");
  } catch {
    console.log("NO armature after 25s — GLB load failed or fallback used");
  }
  await sleep(1000);
  console.log("after character add:", JSON.stringify(await mem()), "objects", await objCount());

  // 2) Drawer -> Inspector -> Detected models -> hero_dj.glb (modelUrl swap path)
  await domClick(page.locator('button[title="Toggle controls panel"]'));
  await sleep(700);
  const inspTab = page.locator(".bottom-drawer button", { hasText: "Inspector" }).first();
  if (await inspTab.count()) {
    await inspTab.click();
    await sleep(500);
  }
  const label = page.locator('.bottom-drawer >> text="Detected models"').first();
  if (await label.count()) {
    const select = label.locator("..").locator("select");
    const optLabel = await select.locator("option").allInnerTexts();
    const heroIdx = optLabel.findIndex((t) => /hero_dj/i.test(t));
    if (heroIdx >= 0) {
      await select.selectOption({ index: heroIdx });
      console.log("selected model option:", optLabel[heroIdx]);
      // wait for the swap: old armature disposed, new one loaded
      await sleep(5000);
      console.log("post-swap bones:", await hasBones());
    } else {
      console.log("hero_dj option NOT found; options:", optLabel.slice(0, 8));
    }
  } else {
    console.log("Detected models select not found");
    console.log(
      "drawer text:",
      (await page.locator(".bottom-drawer").innerText().catch(() => "n/a")).slice(0, 300),
    );
  }

  // 3) Mixer proof: mixers only advance while audio is playing (isPlay gate).
  // Load the first library track, hit "Play audio", then sample a bone quat.
  const trackSelect = page.locator("header select, .track-info-bar select, select").first();
  try {
    const optCount = await trackSelect.locator("option").count();
    if (optCount > 1) {
      await trackSelect.selectOption({ index: 1 });
      console.log("track selected:", await trackSelect.inputValue());
      await sleep(2500); // let handleSelectTrack fetch analysis + set element src
      await page.locator('button[title="Play audio"]').click();
      await sleep(2500);
      console.log("audio play clicked");
    } else {
      console.log("no library tracks available (optCount=" + optCount + ")");
    }
  } catch (e) {
    console.log("track/play setup failed:", e.message.split("\n")[0]);
  }
  const q1 = await boneQuat();
  await sleep(700);
  const q2 = await boneQuat();
  if (q1 && q2) {
    const dq =
      Math.abs(q1.x - q2.x) +
      Math.abs(q1.y - q2.y) +
      Math.abs(q1.z - q2.z) +
      Math.abs(q1.w - q2.w);
    console.log(
      `bone '${q1.name}' dq=${dq.toFixed(5)} -> ${dq > 0.0001 ? "ANIMATING" : "FROZEN"}`,
    );
  } else {
    console.log("no bone node found:", q1, q2);
  }
  console.log("post-model mem:", JSON.stringify(await mem()));

  // 4) Primitive dispose regression: 6 spheres in, 6 out (drawer still open).
  for (let i = 0; i < 6; i++) {
    await page.locator('button[title="Add Sphere"]').first().click();
    await sleep(250);
  }
  await sleep(1500);
  console.log("after 6 sphere adds:", JSON.stringify(await mem()));
  // Switch to Objects tab to get remove buttons
  const objTab = page.locator(".bottom-drawer button", { hasText: "Objects" }).first();
  if (await objTab.count()) {
    await objTab.click();
    await sleep(400);
  }
  const rows = page.locator(".bottom-drawer [class*='cursor-pointer']");
  for (let i = 0; i < 6; i++) {
    const n = await rows.count();
    let removed = false;
    for (let r = n - 1; r >= 0; r--) {
      const txt = (await rows.nth(r).innerText()).replace(/\s+/g, " ");
      if (/Sphere/.test(txt)) {
        await rows.nth(r).locator('button[title="Remove"]').click();
        removed = true;
        break;
      }
    }
    if (!removed) break;
    await sleep(400);
  }
  await sleep(1500);
  console.log("after sphere removal:", JSON.stringify(await mem()));

  // 5) Remove the character; memory should fall back toward baseline.
  const n2 = await rows.count();
  for (let r = n2 - 1; r >= 0; r--) {
    const txt = (await rows.nth(r).innerText()).replace(/\s+/g, " ");
    if (/Character|hero/i.test(txt)) {
      await rows.nth(r).locator('button[title="Remove"]').click();
      break;
    }
  }
  await sleep(2500);
  console.log("after character removal:", JSON.stringify(await mem()), "bones:", await hasBones());
} finally {
  await browser.close();
}
