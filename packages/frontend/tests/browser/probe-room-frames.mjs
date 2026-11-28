// Verify the three wall frames render and face the camera: raycast from
// the camera through each frame's state position and dump the first hit.
import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(6000);
await page.getByRole('button', { name: 'Wide', exact: true }).click();
await sleep(2200);

const frames = [
  ['frame-1', [-2.47, 1.6, -0.6]],
  ['frame-2', [2.47, 1.6, -0.9]],
  ['frame-3', [-1.2, 1.55, 1.98]],
];

for (const [name, pos] of frames) {
  const result = await page.evaluate(([n, p]) => {
    const R = window.__room;
    const T = window.__THREE;
    const { camera, scene } = R;
    const target = new T.Vector3(...p);
    const dir = target.clone().sub(camera.position).normalize();
    const rc = new T.Raycaster(camera.position, dir, 0, 30);
    const hits = rc.intersectObjects(scene.children, true).slice(0, 3).map(x => {
      const o = x.object;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const wp = o.getWorldPosition(new T.Vector3());
      return {
        d: +x.distance.toFixed(2),
        type: o.type,
        geo: o.geometry.parameters ? JSON.stringify(o.geometry.parameters).slice(0, 80) : o.geometry.type,
        color: m && m.color ? '#' + m.color.getHexString() : null,
        wp: wp.toArray().map(v => +v.toFixed(2)),
      };
    });
    // is the point inside the frustum?
    const v = target.clone().project(camera);
    return { name: n, ndc: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)], hits };
  }, [name, pos]);
  console.log(JSON.stringify(result));
}
await browser.close();
