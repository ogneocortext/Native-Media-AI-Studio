// Extract viz-* rules from the pre-rewrite visualizer.css that have no
// counterpart in the current stylesheet, dedupe, and emit a restore block.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(resolve(root, "packages/frontend/package.json"));
const postcss = require(
  resolve(root, "node_modules/.pnpm/postcss@8.5.32/node_modules/postcss"),
);

const OLD_CSS = process.env.TEMP + "\\viz-old.css";
const SRC = resolve(root, "packages/frontend/src");
const OUT = resolve(SRC, "styles/_viz-restored.css");

// --- 1. classes currently used in ts/tsx ---
import { readdirSync, statSync } from "node:fs";
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = resolve(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
})(SRC);
const used = new Set();
for (const f of files) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(/viz-[a-zA-Z0-9_-]+/g)) used.add(m[0]);
}

// --- 2. classes that already have a rule in current css ---
const currentCss = readFileSync(resolve(SRC, "styles/visualizer.css"), "utf8") +
  readFileSync(resolve(SRC, "styles/components.css"), "utf8") +
  readFileSync(resolve(SRC, "styles/globals.css"), "utf8") +
  readFileSync(resolve(SRC, "styles/effects.css"), "utf8") +
  readFileSync(resolve(SRC, "styles/layout.css"), "utf8") +
  readFileSync(resolve(SRC, "styles/sidebar.css"), "utf8") +
  readFileSync(resolve(SRC, "styles/theatre.css"), "utf8") +
  readFileSync(resolve(SRC, "styles/toast.css"), "utf8");
const defined = new Set();
for (const m of currentCss.matchAll(/\.([a-zA-Z0-9_-]*viz-[a-zA-Z0-9_-]+)/g))
  defined.add(m[1]);
const missing = [...used].filter((c) => !defined.has(c));
const missingRe = new RegExp(`\\.(${missing.join("|")})(?![a-zA-Z0-9_-])`);

// --- 3. walk old css, keep rules touching missing classes ---
const rootNode = postcss.parse(readFileSync(OLD_CSS, "utf8"));
const kept = []; // {context, css}
const keyframesNeeded = new Set();
const animRe = /animation(?:-name)?\s*:\s*([^;]+)/g;

const emittedNodes = new Set();

// does this rule's subtree (nested rules only, not declarations) touch a
// missing class? If so we emit the whole rule — nested & selectors and
// ancestor context stay intact.
function subtreeHasMissing(rule) {
  if (missingRe.test(rule.selector)) return true;
  let found = false;
  rule.walkRules((r) => {
    if (missingRe.test(r.selector)) found = true;
  });
  return found;
}

function markSubtree(rule) {
  emittedNodes.add(rule);
  rule.walkRules((r) => emittedNodes.add(r));
}

function walkRules(node, context) {
  node.each((child) => {
    if (child.type === "atrule") {
      if (child.name === "keyframes" || child.name === "-webkit-keyframes") {
        child.__vizName = child.params.trim();
        child.__vizContext = context;
        keyframesCandidates.push(child);
        return;
      }
      const inner = context ? `${context} >> ${child.name} ${child.params}` : `${child.name} ${child.params}`;
      walkRules(child, inner);
      return;
    }
    if (child.type === "rule") {
      if (emittedNodes.has(child)) return;
      if (subtreeHasMissing(child)) {
        child.walkDecls((d) => {
          if (d.prop === "animation" || d.prop === "animation-name") {
            for (const m of d.value.matchAll(/[a-zA-Z0-9_-]+/g)) keyframesUsed.add(m[0]);
          }
        });
        kept.push({ context, css: child.toString() });
        markSubtree(child);
      }
      return;
    }
  });
}
const keyframesCandidates = [];
const keyframesUsed = new Set();
walkRules(rootNode, "");

// keyframes actually referenced by kept rules (or by name prefix already in new css)
const emittedKeyframes = new Set();
const kfOut = [];
for (const k of keyframesCandidates) {
  const name = k.params.trim();
  if (!keyframesUsed.has(name)) continue;
  if (["viz-spin", "viz-empty-spin"].includes(name)) continue; // already in new css
  if (emittedKeyframes.has(name)) continue;
  emittedKeyframes.add(name);
  kfOut.push(k.toString());
}

// --- 4. dedupe exact repeats, keep order (later rules still win) ---
const seen = new Set();
const unique = [];
for (const k of kept) {
  const sig = k.context + "||" + k.css.replace(/\s+/g, " ").trim();
  if (seen.has(sig)) continue;
  seen.add(sig);
  unique.push(k);
}

// group by context to re-wrap @media
const byContext = new Map();
for (const k of unique) {
  if (!byContext.has(k.context)) byContext.set(k.context, []);
  byContext.get(k.context).push(k.css);
}

let out = `/* ============================================================\n   RESTORED COMPONENT CHROME\n   Rules recovered from the pre-slim visualizer.css for viz-* classes\n   that lost their styles in the ee2714e rewrite. Deduped; cascade\n   order preserved. The original @scope (.viz-page) wrapper is dropped —\n   selectors stay viz-*-prefixed so they cannot match outside the\n   visualizer, matching this file's unscoped convention.\n   ============================================================ */\n\n`;
for (const [ctx, rules] of byContext) {
  // ctx looks like "scope (.viz-page) >> media (max-width: 900px)" —
  // keep only the @media part; @scope is intentionally not re-emitted.
  const mediaMatch = ctx.match(/media\s*([^{]+)/);
  if (mediaMatch) {
    out += `@media ${mediaMatch[1].trim()} {\n${rules.join("\n")}\n}\n\n`;
  } else {
    out += rules.join("\n") + "\n\n";
  }
}
if (kfOut.length) out += `/* --- keyframes referenced by restored rules --- */\n\n` + kfOut.join("\n\n") + "\n";

// :scope only has meaning inside @scope; the attribute lives on .viz-page.
out = out.replaceAll(":scope[", ".viz-page[");

writeFileSync(OUT, out);
console.log(`missing classes: ${missing.length}`);
console.log(`kept rules: ${kept.length} -> unique ${unique.length}`);
console.log(`keyframes emitted: ${kfOut.length} -> ${[...emittedKeyframes].join(", ")}`);
console.log(`wrote ${OUT} (${out.split("\n").length} lines)`);
