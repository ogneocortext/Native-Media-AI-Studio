/**
 * Shared vision-analysis helpers used by both the MCP bridge and the
 * standalone `tools/vision/analyze.mjs` CLI.  Keeping this logic in one
 * place prevents the two implementations from drifting apart.
 */

// Vision detection relies on Ollama's top-level `capabilities: ["vision",...]`
// field (documented API shape, stable 0.34.x → 0.40.x+) reported per model in
// `/api/tags`. No hardcoded family list needed. See residentVisionModels().

// `/api/ps` DOES report running models on this workstation (measured
// 2026-10-22 on the live server: gemma4:e2b-it-qat comes back while warm) —
// earlier notes that it returned an empty array in 0.40.5 were wrong. It is
// the right primitive for VRAM-aware checks; /api/show is the one that
// returns malformed JSON for some models and stays unused here.

// Local-only policy: everything below routes to models that run on this
// machine's GPU. Network-hosted models are never selected; the only place a
// remote model is recognized is the `:cloud` name-suffix Ollama appends, kept
// as an exclusion guard (same convention tools/probe-ollama.py relies on).

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
export const VISION_MAX_DIM = parseInt(process.env.VISION_MAX_DIM || '1280');
export const VISION_QUALITY = parseInt(process.env.VISION_QUALITY || '80');
export const VISION_KEEP_ALIVE = process.env.VISION_KEEP_ALIVE || '10m';
export const VISION_NUM_CTX = parseInt(process.env.VISION_NUM_CTX || '8192');
export const DEFAULT_VISION_MODEL = process.env.VISION_MODEL || 'gemma4:e2b-it-qat';
// Must NOT equal DEFAULT_VISION_MODEL. It used to, which made the fallback a no-op
// retry of the model that had just failed and reported itself as a second backend.
// The literal below is only the last-resort value: the actual fallback is resolved
// at call time by pickFallbackModel(), because model inventory churns on this
// workstation (qwen3-vl and the whole minicpm-v family were pruned on 2026-10-10,
// leaving /api/tags with no second local vision model — the old literal 404'd on
// every fallback attempt after that). Override with VISION_FALLBACK_MODEL if
// your machine has more VRAM.
export const VISION_FALLBACK_MODEL = process.env.VISION_FALLBACK_MODEL || 'qwen3.5:4b';

// Models that may only serve a call when explicitly requested (--model,
// VISION_MODEL*, or a mode map that names them). They stay installed but are
// never auto-selected: moondream is a ~1.8 GB captioner that loops and emits
// raw bbox coords on compound prompts — measured 2026-11-12/13 returning
// "[0.23, 0.13, 0.78, 0.45]" for a describe call and repeating "squished
// eyes" ~70x on a face crop. Opt back in with VISION_MODEL_FAST or an
// explicit model param.
export const AUTO_EXCLUDED_VISION_MODELS = new Set(['moondream']);

export function isAutoEligibleVisionModel(name) {
  return !AUTO_EXCLUDED_VISION_MODELS.has(baseName(name));
}

/**
 * Resolve the fallback vision model for a call whose primary just failed.
 *   1. env VISION_FALLBACK_MODEL (even if installed — operator override wins);
 *   2. another currently-resident vision-capable model (never the primary itself);
 *   3. the literal constant, as a final named attempt.
 */
export async function pickFallbackModel(activeModel) {
  const fromEnv = process.env.VISION_FALLBACK_MODEL;
  if (fromEnv) return fromEnv;
  const active = baseName(activeModel);
  const resident = (await residentVisionModels()).filter(
    (n) => baseName(n) !== active && n !== activeModel && isAutoEligibleVisionModel(n)
  );
  return resident[0] || VISION_FALLBACK_MODEL;
}

function baseName(name) {
  return String(name || '').split(':')[0].toLowerCase();
}

export { baseName };

/**
 * Return the names of currently-resident Ollama models that advertise vision
 * capability.
 *
 * Ollama v0.40.5 reports vision on each `/api/tags` model via a top-level
 * `capabilities: ["vision", ...]` array (the documented API shape; `details.families`
 * only carries family names like `["gemma4"]`). We read `/api/tags` once and match
 * against that authoritative field, with the basename heuristic kept as a small
 * safety net for any edge case where capabilities were not populated. `/api/show`
 * still returns malformed JSON for some models. (`/api/ps` works fine here —
 * see the note at the top of this file — but does not list capabilities, so
 * `/api/tags` is the single source for vision-capable model discovery.)
 */
export async function residentVisionModels() {
  let out = [];
  try {
    const tr = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(10000) });
    if (!tr.ok) return [];
    const td = await tr.json();
    const models = Array.isArray(td.models) ? td.models : [];
    for (const m of models) {
      // Local-only policy: skip network-hosted models outright, regardless of
      // any capability they advertise.
      if (String(m.name || '').toLowerCase().endsWith(':cloud')) continue;
      // Primary: Ollama reports vision via a top-level `capabilities: ["vision",...]`
      // array on each /api/tags entry (documented API shape, stable 0.34.x → 0.40.x+).
      // When capabilities are present they are authoritative either way: an
      // embedding-only model (embeddinggemma-2:270m) used to leak through the
      // basename fallback because "gemma" matches anywhere in its name, which
      // made resident-sticky routing hand screenshots to a 270m embedder.
      const caps = Array.isArray(m.capabilities) ? m.capabilities : null;
      if (caps) {
        if (caps.includes('vision')) out.push(m.name);
        continue;
      }
      // Bare basename search stays only for servers that report no
      // capabilities field at all; anchored gemma check so embedding variants
      // do not match ("gemma" alone matched embeddinggemma-2:270m).
      const b = baseName(m.name);
      if (/^gemma\d/.test(b) || b.includes('vl') || b.includes('vision') || b.includes('minicpm')) {
        out.push(m.name);
      }
    }
  } catch (e) {
    console.error(`[vision] /api/tags failed: ${e.message}`);
  }
  // Among locals, the configured primary leads so resident-sticky [0] matches
  // the documented default rather than whatever order /api/tags happens to
  // list them in (its order put qwen3.5:4b ahead of gemma4 on this machine,
  // which flipped the sticky pick).
  const primaryBase = baseName(DEFAULT_VISION_MODEL);
  out.sort((a, b) => Number(baseName(a) !== primaryBase) - Number(baseName(b) !== primaryBase));
  return out;
}

/**
 * Resolve which vision model to use:
 *   1. explicit override
 *   2. a resident vision model (stickiness avoids cold-load churn)
 *   3. configured default
 */
export async function resolveVisionModel(forcedModel) {
  if (forcedModel) return { model: forcedModel, why: 'override' };
  const resident = (await residentVisionModels()).filter(isAutoEligibleVisionModel);
  if (resident.length === 0) return { model: DEFAULT_VISION_MODEL, why: 'default' };
  // residentVisionModels sorts local-first; qwen3-vl / minicpm-v family
  // preferences are gone — those models were pruned 2026-10-10.
  return { model: resident[0], why: `resident-sticky(${resident[0]})` };
}

/**
 * Read an image from disk and return a base64-encoded string, resizing
 * with sharp when available so large screenshots stay under Ollama's
 * per-request limits.
 */
export async function encodeImage(imagePath, opts = {}) {
  const { maxDim = VISION_MAX_DIM, quality = VISION_QUALITY, pngPassthrough = false } = opts;
  // ROI support: crop = {left, top, width, height} in SOURCE pixels, applied
  // before resize. scale = enlargement factor (>1 allowed — small element
  // captures like a 240px canvas need it; VLM-SubtleBench 2026: crops beat
  // full frames for detail work). Both are provenance-relevant: callers
  // should record them alongside the result.
  const crop = opts.crop &&
    ['left', 'top', 'width', 'height'].every((k) => Number.isFinite(opts.crop[k]))
    ? opts.crop
    : null;
  const scale = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1;
  const fs = await import('fs');
  const buffer = fs.readFileSync(imagePath);
  const roiActive = !!crop || scale !== 1;
  if (buffer.length < 50000 && !roiActive) return buffer.toString('base64');

  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // sharp missing: ROI requests degrade to the full image. Warn — the
    // caller's provenance will claim a crop that never happened otherwise.
    if (roiActive) console.error('[vision] sharp unavailable — crop/scale ignored');
    return buffer.toString('base64');
  }

  let pipeline = sharp(buffer);
  // Effective source dims after crop — sharp.metadata() reports the INPUT
  // image, not post-extract state, so track the crop rect ourselves.
  let srcW = 0;
  let srcH = 0;
  if (crop) {
    // Clamp the rect to the image bounds — a stale selector box or a
    // hand-typed crop must not throw EINVAL out of sharp.extract.
    const meta0 = await pipeline.metadata();
    const iw = meta0.width || 1;
    const ih = meta0.height || 1;
    const left = Math.max(0, Math.min(crop.left, iw - 1));
    const top = Math.max(0, Math.min(crop.top, ih - 1));
    srcW = Math.max(1, Math.min(crop.width, iw - left));
    srcH = Math.max(1, Math.min(crop.height, ih - top));
    pipeline = pipeline.extract({
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(srcW),
      height: Math.round(srcH),
    });
  } else {
    const meta0 = await pipeline.metadata();
    srcW = meta0.width || 0;
    srcH = meta0.height || 0;
  }

  // Text-legibility mode: JPEG at q80 smears glyph edges, so PNG sources stay
  // PNG. Small-enough sources skip the sharp round-trip entirely — re-encoding
  // pixel-identical data only re-compresses it. A crop forces the pipeline
  // even when the result fits — the original buffer contains the uncropped
  // pixels.
  const meta = await pipeline.metadata();
  const needsResize = scale !== 1 || Math.max(srcW, srcH) > maxDim;
  const isPng = (meta.format || '').toLowerCase() === 'png';
  if (!crop && !needsResize && pngPassthrough && isPng) {
    return buffer.toString('base64');
  }
  // scale===1 keeps the historical contract: fit inside maxDim, never
  // enlarge. scale>1 enlarges by that factor (small ROIs need it) with the
  // long edge still capped at maxDim for token budget.
  const boxW = scale === 1 ? maxDim : Math.min(maxDim, Math.max(1, Math.round(srcW * scale)));
  const boxH = scale === 1 ? maxDim : Math.min(maxDim, Math.max(1, Math.round(srcH * scale)));
  const resized = pipeline.resize(boxW, boxH, {
    fit: 'inside',
    withoutEnlargement: scale === 1,
  });
  // PNG when the source is PNG in passthrough mode, or whenever an explicit
  // upscale ran (JPEG would smear the very detail the ROI was cut for).
  const preferPng = isPng ? pngPassthrough || scale !== 1 : scale !== 1;
  const out = preferPng
    ? await resized.png().toBuffer()
    : await resized.jpeg({ quality }).toBuffer();
  return out.toString('base64');
}

/**
 * Source-image metadata for provenance records: pixel dims, byte size, format.
 * Metadata-only (no pixel decode) so it is cheap even on large screenshots.
 * Returns nulls when sharp is unavailable or the file is unreadable.
 */
export async function probeImageMeta(imagePath) {
  const fs = await import('fs');
  let bytes = 0;
  try {
    bytes = fs.statSync(imagePath).size;
  } catch {
    /* reported as 0 */
  }
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(imagePath).metadata();
    return { width: meta.width || 0, height: meta.height || 0, bytes, format: meta.format || '' };
  } catch {
    return { width: 0, height: 0, bytes, format: '' };
  }
}

/**
 * Pixel-diff two images and return the bounding box of changed pixels.
 * Deterministic gate for compare/regression flows: when nothing changed,
 * the VLM call is pure cost. Samples on a stride for speed on large frames.
 *
 * Returns { changedRatio, bbox: {left,top,width,height} | null, reason }.
 * bbox is padded by `margin` px and clamped to image bounds; null when the
 * diff is below `threshold` ratio (caller decides what "no change" means).
 */
export async function diffImagesRegion(pathA, pathB, opts = {}) {
  const { maxDim = 800, threshold = 0.002, margin = 48, channelDelta = 24 } = opts;
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return { changedRatio: -1, bbox: null, reason: 'sharp-unavailable' };
  }
  try {
    const [a, b] = await Promise.all([
      sharp(pathA).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(pathB).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    // Different aspect ratios resize to different dims — compare on the
    // overlapping region only, reported against total pixels of A.
    const w = Math.min(a.info.width, b.info.width);
    const h = Math.min(a.info.height, b.info.height);
    if (w < 8 || h < 8) return { changedRatio: -1, bbox: null, reason: 'images-too-small' };
    // Both sides went through removeAlpha(), but a grayscale/palette source
    // can still surface a different channel count — indexing would misalign.
    if (a.info.channels !== b.info.channels) {
      return { changedRatio: -1, bbox: null, reason: 'channel-mismatch' };
    }
    const ch = a.info.channels;
    const stride = 4; // sample every 4th pixel — diffs are regional, not salt
    let changed = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const total = Math.ceil(w / stride) * Math.ceil(h / stride);
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const i = (y * a.info.width + x) * ch;
        const j = (y * b.info.width + x) * ch;
        const d = Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2]);
        if (d > channelDelta * 3) {
          changed++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const ratio = changed / total;
    if (ratio < threshold || maxX < 0) {
      return { changedRatio: ratio, bbox: null, reason: 'below-threshold' };
    }
    // Map sampled coords back to source-A pixels (A was resized fit-inside).
    const metaA = await sharp(pathA).metadata();
    const sx = (metaA.width || w) / a.info.width;
    const sy = (metaA.height || h) / a.info.height;
    const padX = Math.round(margin * sx);
    const padY = Math.round(margin * sy);
    const left = Math.max(0, Math.round(minX * sx) - padX);
    const top = Math.max(0, Math.round(minY * sy) - padY);
    const right = Math.min(metaA.width || w, Math.round((maxX + stride) * sx) + padX);
    const bottom = Math.min(metaA.height || h, Math.round((maxY + stride) * sy) + padY);
    return {
      changedRatio: ratio,
      bbox: { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
      reason: 'changed',
    };
  } catch (e) {
    return { changedRatio: -1, bbox: null, reason: `error:${e.message}` };
  }
}

/**
 * Write a cropped PNG of `srcPath` to `outPath` (sharp extract). Used by the
 * compare diff-gate to hand the VLM only the changed region of each frame.
 * Returns the output path, or null on failure.
 */
export async function cropImageToFile(srcPath, bbox, outPath) {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(srcPath).metadata();
    const left = Math.max(0, Math.min(bbox.left, (meta.width || 1) - 1));
    const top = Math.max(0, Math.min(bbox.top, (meta.height || 1) - 1));
    const width = Math.max(1, Math.min(bbox.width, (meta.width || 1) - left));
    const height = Math.max(1, Math.min(bbox.height, (meta.height || 1) - top));
    await sharp(srcPath)
      .extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) })
      .png()
      .toFile(outPath);
    return outPath;
  } catch {
    return null;
  }
}

/**
 * Read an image for a vision-model request: returns the base64 payload plus
 * the metadata some callers report (dimensions, size). This is the single
 * resize implementation — scripts/vision.mjs, scripts/vision-quick.mjs,
 * scripts/analyze-visualizer-frames.mjs and tools/mcp/vision-mcp.mjs each
 * used to carry their own near-identical sharp copy here.
 */
export async function readImageForModel(imagePath, opts = {}) {
  const { maxDim = VISION_MAX_DIM, quality = VISION_QUALITY, pngPassthrough = false } = opts;
  const base64 = await encodeImage(imagePath, { maxDim, quality, pngPassthrough });
  let width = 0;
  let height = 0;
  let sizeKB = Math.round((base64.length * 3) / 4 / 1024); // base64 is 4/3 of raw bytes
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(Buffer.from(base64, 'base64')).metadata();
    width = meta.width || 0;
    height = meta.height || 0;
  } catch {
    /* sharp missing or metadata unreadable — zeros are fine for logging */
  }
  return { base64, width, height, sizeKB };
}

/**
 * POST one request to /api/chat and normalize the answer. Every vision entry
 * point routes through here so they cannot drift apart again: each used to
 * re-implement the fetch, and two of them read `data.response` (the
 * /api/generate shape) on a /api/chat call, which always yields an empty
 * string — measured live on 2026-10-22 in scripts/vision-quick.mjs, which
 * printed "No response" for every prompt.
 *
 * Returns { text, content, thinking, usedThinking, doneReason } where `text`
 * already applies the thinking fallback (reasoning-capable models can spend
 * the whole output budget on chain-of-thought and return empty `content` with
 * the answer in `thinking`; measured on this machine: qwen3-vl:4b — content
 * 0 chars, thinking 2331 chars, done_reason "length").
 */
export async function ollamaChat({
  model,
  prompt,
  images = [], // base64 strings, optional
  numCtx = VISION_NUM_CTX,
  numPredict = 4096,
  temperature = null, // null = omit (Ollama server default)
  keepAlive = VISION_KEEP_ALIVE,
  think = false,
  timeoutMs = 300000,
}) {
  const userContent = { role: 'user', content: prompt || 'Describe this image in detail.' };
  if (images.length === 1) userContent.images = [images[0]];
  else if (images.length > 1) userContent.images = images;

  const body = {
    model,
    messages: [userContent],
    stream: false,
    // Callers falling back to a second vision model pass a short keepAlive so
    // the resident slot returns to the primary model (8 GB card, two 4 GB
    // vision models resident at once squeeze each other).
    keep_alive: keepAlive,
    options: { num_ctx: numCtx, num_predict: numPredict },
  };
  if (temperature !== null) body.options.temperature = temperature;
  if (think) body.think = true;

  // 300 s, not 120 s: a cold model load on 8 GB VRAM takes 60-183 s
  // (measured 2026-10-11: minicpm-v:8b 183 s), which blew the 120 s budget
  // before any image was processed.
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  // /api/chat returns the answer at `message.content`, NOT at `response` (that
  // is the /api/generate shape; kept as a last resort for safety).
  const content = data.message?.content || data.response || '';
  const thinking = data.message?.thinking || '';
  const usedThinking = !String(content).trim() && !!thinking.trim();
  if (usedThinking) {
    console.error(
      `[vision] ${model}: content empty (done_reason=${data.done_reason || '?'}); ` +
        `using ${thinking.length} chars of thinking output as the analysis.`
    );
  }
  return {
    content,
    thinking,
    usedThinking,
    text: usedThinking ? thinking : content,
    doneReason: data.done_reason || '',
  };
}

/**
 * Send a single vision request to Ollama and return the response text.
 * Legacy entry point kept so existing imports (ollama-tools-mcp.mjs,
 * tools/tests/validate-vision-unified.mjs) stay stable — the request itself
 * now goes through ollamaChat(). Retries once on the same model when the
 * output was truncated (historical behavior; the retry lives with the caller).
 */
export async function analyzeWithOllama(images, prompt, model, numPredict = 4096, think = false, keepAlive = VISION_KEEP_ALIVE) {
  const imageData = typeof images === 'string' ? images : images[0];
  const result = await ollamaChat({
    model,
    prompt,
    images: imageData ? [imageData] : [],
    numPredict,
    think,
    keepAlive,
  });
  return result.text;
}

// ─── VRAM management (8 GB card: exactly one vision model resident) ───
// Shared single copies of what scripts/analyze-visualizer-frames.mjs and
// tools/mcp/vision-mcp.mjs each used to define — identical logic, which is
// exactly where two policies drift apart over time.

async function getRunningModels() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}
export { getRunningModels };

export async function unloadModel(model, log = (m) => console.error(`[vision] ${m}`)) {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000),
    });
    log(`unloaded model: ${model}`);
  } catch (e) {
    log(`unload failed: ${e.message}`);
  }
}

/**
 * Before a vision call on this card: unload every OTHER resident model so the
 * target fits. Coordinates through the backend's VRAM manager so the
 * _ollama_loaded / _atomic_chat_loaded flags stay in sync with /api/ps reality.
 * Retries once — the first unload can race the scheduler.
 */
export async function ensureVisionModel(model, opts = {}) {
  const { settleMs = 1500, log = (m) => console.error(`[vision] ${m}`) } = opts;
  const running = await getRunningModels();
  if (running.length === 0) return;
  const toUnload = running.filter((m) => m !== model);
  if (toUnload.length === 0) return;

  // Offload through the VRAM manager so its resident flags stay in sync.
  // offload-ollama unloads ALL Ollama models; we then reload the target below.
  log(`offloading backend models via VRAM manager: ${toUnload.join(',')}`);
  try {
    await fetch(`${BACKEND_URL}/api/integrations/vram/offload-ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    log(`VRAM manager offload failed, falling back to direct unload: ${e.message}`);
    for (const m of toUnload) await unloadModel(m, log);
  }

  // offload-ollama unloads ALL Ollama models — including the target when it
  // was resident (the old `targetIsOllama` check skipped the reload exactly
  // then, so "ensure" left the requested model cold). Always re-warm the
  // target; a generate ping against an already-loaded model is cheap.
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: '5m' }),
      signal: AbortSignal.timeout(300000),
    });
  } catch (e) {
    log(`load target model failed: ${e.message}`);
  }

  await new Promise((r) => setTimeout(r, settleMs));
  const still = await getRunningModels();
  const remain = still.filter((m) => m !== model);
  if (remain.length > 0) {
    log(`retry unload: ${remain.join(',')}`);
    for (const m of remain) await unloadModel(m, log);
    await new Promise((r) => setTimeout(r, settleMs));
  }
}
