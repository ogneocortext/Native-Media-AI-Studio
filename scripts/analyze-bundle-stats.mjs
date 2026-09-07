// Analyze rollup-plugin-visualizer stats.html and print actionable bundle insights.
// Usage:
//   node scripts/analyze-bundle-stats.mjs [path/to/stats.html]      — full report
//   node scripts/analyze-bundle-stats.mjs --who <substring>        — which chunks contain modules matching <substring>
import { readFileSync } from "node:fs";

const whoIdx = process.argv.indexOf("--who");
const who = whoIdx >= 0 ? process.argv[whoIdx + 1] : null;
const path = process.argv.find((a, i) => i >= 2 && a !== "--who" && a !== who) ?? "packages/frontend/dist/stats.html";
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

// Walk the tree. Top-level children of root are chunks (asset files); their subtrees are modules.
// Build: uidToChunk (module uid -> chunk name), chunkAgg (per-chunk size sums), chunk list for section 1.
const chunks = []; // {chunkName, uid}
const uidToChunk = new Map();
const chunkAgg = new Map(); // chunkName -> {rendered, gzip, modules}
function walkChunk(chunkNode) {
  let rendered = 0, gzip = 0, modules = 0;
  (function walkModule(node) {
    if (node.children) {
      for (const child of node.children) walkModule(child);
      return;
    }
    if (node.uid) {
      uidToChunk.set(node.uid, chunkNode.name);
      const p = parts[node.uid];
      if (p) { rendered += p.renderedLength ?? 0; gzip += p.gzipLength ?? 0; }
      modules += 1;
    }
  })(chunkNode);
  chunks.push({ chunkName: chunkNode.name, uid: chunkNode.uid });
  chunkAgg.set(chunkNode.name, { rendered, gzip, modules });
}
for (const chunkNode of data.tree.children ?? []) walkChunk(chunkNode);

const kb = (n) => (n / 1024).toFixed(1) + " KB";

// --who mode: find chunks containing modules whose id matches the substring
if (who) {
  const hits = new Map(); // chunkName -> {count, rendered}
  for (const [uid, p] of Object.entries(parts)) {
    const meta = metas[p.metaUid];
    if (!meta?.id || meta.isExternal) continue;
    if (!String(meta.id).toLowerCase().includes(who.toLowerCase())) continue;
    const chunkName = uidToChunk.get(uid);
    if (!chunkName) continue;
    const t = hits.get(chunkName) ?? { count: 0, rendered: 0 };
    t.count += 1;
    t.rendered += p.renderedLength ?? 0;
    hits.set(chunkName, t);
  }
  console.log(`chunks containing modules matching "${who}":`);
  [...hits.entries()]
    .sort((a, b) => b[1].rendered - a[1].rendered)
    .forEach(([name, t]) => console.log(`${name.padEnd(50)} ${t.count} modules, ${kb(t.rendered)}`));
  if (hits.size === 0) console.log("(none)");
  process.exit(0);
}

// --- 1. Per-chunk totals (rendered + gzip) ---
console.log("=== CHUNK TOTALS (rendered | gzip | modules) ===");
[...chunkAgg.entries()]
  .sort((a, b) => b[1].rendered - a[1].rendered)
  .slice(0, 25)
  .forEach(([name, t]) => console.log(`${name.padEnd(45)} ${kb(t.rendered).padStart(10)} | ${kb(t.gzip).padStart(9)} | ${t.modules}`));

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
// --- 5. One-off: where did recharts land, and who pulls it into the entry chunk? ---
const isRecharts = (id) => /recharts|d3-|^npm:d3|victory-vendor/.test(id);
const chunkNames = new Map();
for (const [uid, meta] of Object.entries(metas)) {
  if (meta.isEntry || meta.isDynamicEntry) chunkNames.set(uid, meta.id);
}
const rechartsByChunk = new Map();
for (const [uid, p] of Object.entries(parts)) {
  const m = metas[p.metaUid];
  if (!m || !isRecharts(m.id)) continue;
  const cUid = Object.keys(m.moduleParts ?? {})[0];
  const cname = m.moduleParts && chunkNames.get(cUid) ? chunkNames.get(cUid) : cUid;
  const key = String(cname).replace(/^.*assets\//, "");
  const t = rechartsByChunk.get(key) ?? { size: 0, modules: [] };
  t.size += p.renderedLength;
  t.modules.push(m.id.replace(/^.*node_modules\//, ""));
  rechartsByChunk.set(key, t);
}
console.log("\n=== RECHARTS/D3 MODULES PER CHUNK ===");
for (const [chunk, t] of [...rechartsByChunk.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8)) {
  console.log(`${chunk}  ${kb(t.size)} (${t.modules.length} modules)`);
  if (chunk.startsWith("index")) t.modules.slice(0, 12).forEach((m) => console.log("   -", m));
}

