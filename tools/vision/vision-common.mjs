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
    (n) => baseName(n) !== active && n !== activeModel
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
  const resident = await residentVisionModels();
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
  const fs = await import('fs');
  const buffer = fs.readFileSync(imagePath);
  if (buffer.length < 50000) return buffer.toString('base64');

  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return buffer.toString('base64');
  }

  // Text-legibility mode: JPEG at q80 smears glyph edges, so PNG sources stay
  // PNG. Small-enough sources skip the sharp round-trip entirely — re-encoding
  // pixel-identical data only re-compresses it.
  const meta = await sharp(buffer).metadata();
  const needsResize = Math.max(meta.width || 0, meta.height || 0) > maxDim;
  const isPng = (meta.format || '').toLowerCase() === 'png';
  if (pngPassthrough && isPng && !needsResize) {
    return buffer.toString('base64');
  }
  const resized = sharp(buffer).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  const out = pngPassthrough && isPng ? await resized.png().toBuffer() : await resized.jpeg({ quality }).toBuffer();
  return out.toString('base64');
}

/**
 * Send a single vision request to Ollama and return the parsed response
 * text.  Retries once on the same model when the output was truncated.
 */
export async function analyzeWithOllama(images, prompt, model, numPredict = 4096, think = false, keepAlive = VISION_KEEP_ALIVE) {
  const imageData = typeof images === 'string' ? images : images[0];
  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: prompt || 'Describe this image in detail.',
        images: [imageData],
      },
    ],
    stream: false,
    // Callers falling back to a second vision model pass a short keepAlive so
    // the resident slot returns to the primary model (8 GB card, two 4 GB
    // vision models resident at once squeeze each other).
    keep_alive: keepAlive,
    options: { num_ctx: VISION_NUM_CTX, num_predict: numPredict },
  };
  if (think) body.think = true;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // 300 s, not 120 s: a cold model load on 8 GB VRAM takes
    // 60-183 s (measured 2026-10-11: minicpm-v:8b 183 s), which
    // blew the 120 s budget before any image was processed. This
    // inner fetch is the binding limit, so it must match the
    // VISION_TIMEOUT_MS (300 s) outer budget in analyze.mjs.
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // /api/chat returns the answer at `message.content`, NOT at `response` (that is
  // the /api/generate shape). Reading `data.response` here always yielded ''.
  const content = data.message?.content || data.response || '';
  // Reasoning models can burn the whole budget on chain-of-thought and return an
  // empty content plus a populated `thinking` field. Better than returning nothing.
  const thinking = data.message?.thinking || '';
  return !String(content).trim() && thinking.trim() ? thinking : content;
}
