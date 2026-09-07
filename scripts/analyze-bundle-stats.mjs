// Analyze rollup-plugin-visualizer stats.html and print actionable bundle insights.
// Usage: node scripts/analyze-bundle-stats.mjs [path/to/stats.html]
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "packages/frontend/dist/stats.html";
const html = readFileSync(path, "utf8");

const marker = "const data = ";
const start = html.indexOf(marker);
if (start < 0) {
  console.error("No visualizer data found");
  process.exit(1);
}
// JSON ends right before the template footer: `..."sourcemap":false};`
const jsonStart = start + marker.length;
const tail = '"sourcemap":false}}';
const tailIdx = html.indexOf(tail, jsonStart);
if (tailIdx < 0) {
  console.error("Could not locate end of visualizer data");
  process.exit(1);
}
const data = JSON.parse(html.slice(jsonStart, tailIdx + tail.length));

const parts = data.nodeParts; // uid -> {renderedLength, gzipLength, brotliLength}
const metas = data.nodeMetas; // uid -> {id, moduleParts, imported, importers, isEntry, isExternal}

// Walk the tree; collect leaves (actual chunks/files)
const chunks = []; // {chunkName, uid}
(function walk(node, chunkName) {
  if (node.children) {
    for (const child of node.children) walk(child, child.children ? chunkName : child.name);
    return;
  }
  chunks.push({ chunkName: node.name, uid: node.uid });
})(data.tree, "root");

const kb = (n) => (n / 1024).toFixed(1) + " KB";

// --- 1. Per-chunk totals (rendered + gzip) ---
console.log("=== CHUNK TOTALS (rendered | gzip) ===");
const chunkTotals = new Map();
for (const { chunkName, uid } of chunks) {
  const p = parts[uid];
  if (!p) continue;
  const t = chunkTotals.get(chunkName) ?? { rendered: 0, gzip: 0 };
  t.rendered += p.renderedLength;
  t.gzip += p.gzipLength ?? 0;
  chunkTotals.set(chunkName, t);
}
[...chunkTotals.entries()]
  .sort((a, b) => b[1].rendered - a[1].rendered)
  .forEach(([name, t]) => console.log(`${name.padEnd(45)} ${kb(t.rendered).padStart(10)} | ${kb(t.gzip).padStart(9)}`));

// --- 2. Top packages by size ---
// nodeParts[partUid] = {renderedLength,gzipLength,metaUid}; nodeMetas[metaUid] = {id,...}
console.log("\n=== TOP PACKAGES (by rendered size, across all chunks) ===");
const pkgTotals = new Map();
const pkgRePnpm = /node_modules\/\.pnpm\/([^/]+)\/node_modules\//;
const pkgRePlain = /node_modules\/(@[^/]+\/[^/]+|[^/]+)$/;
const normPkg = (name) => name.split("_")[0]; // strip peer-hash suffix: pkg@1.2.3_peers -> pkg@1.2.3
const partsByMeta = new Map(); // metaUid -> [{partUid, part}]
for (const [partUid, part] of Object.entries(parts)) {
  const meta = metas[part.metaUid];
  if (!meta?.id || meta.isExternal) continue;
  if (!part.renderedLength) continue;
  const id = String(meta.id).replace(/\\/g, "/");
  let group;
  const mP = id.match(pkgRePnpm);
  if (mP) group = "npm:" + normPkg(mP[1]);
  else {
    const mN = id.match(pkgRePlain) ?? id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)\//);
    group = mN ? "npm:" + normPkg(mN[1]) : "app:" + id.replace(/^.*packages\/frontend\//, "");
  }
  const t = pkgTotals.get(group) ?? { rendered: 0, gzip: 0, files: 0 };
  t.rendered += part.renderedLength; t.gzip += part.gzipLength ?? 0; t.files += 1;
  pkgTotals.set(group, t);
  const arr = partsByMeta.get(part.metaUid) ?? [];
  arr.push({ partUid, part });
  partsByMeta.set(part.metaUid, arr);
}
[...pkgTotals.entries()]
  .sort((a, b) => b[1].rendered - a[1].rendered)
  .slice(0, 30)
  .forEach(([name, t]) => console.log(`${name.padEnd(55)} ${kb(t.rendered).padStart(10)} | gz ${kb(t.gzip).padStart(9)} | ${t.files} modules`));

// --- 3. Largest individual app source files ---
console.log("\n=== LARGEST APP SOURCE FILES ===");
[...pkgTotals.entries()]
  .filter(([name]) => name.startsWith("app:"))
  .sort((a, b) => b[1].rendered - a[1].rendered)
  .slice(0, 20)
  .forEach(([name, t]) => console.log(`${name.padEnd(70)} ${kb(t.rendered).padStart(10)} | gz ${kb(t.gzip).padStart(9)}`));

// --- 4. Duplicated modules (landed in multiple chunks) ---
console.log("\n=== DUPLICATED MODULES (in >1 chunk) ===");
const dups = [];
for (const [metaUid, arr] of partsByMeta) {
  if (arr.length > 1) {
    const rendered = arr.reduce((s, x) => s + x.part.renderedLength, 0);
    dups.push({ id: metas[metaUid].id, chunks: arr.length, rendered });
  }
}
dups.sort((a, b) => b.rendered - a.rendered).slice(0, 15)
  .forEach(d => console.log(`${String(d.id).replace(/^.*node_modules\//, "npm:").padEnd(70)} x${d.chunks} ${kb(d.rendered)}`));
console.log(`total duplicated modules: ${dups.length}`);
