/**
 * Shared vision-analysis helpers used by both the MCP bridge and the
 * standalone `tools/vision/analyze.mjs` CLI.  Keeping this logic in one
 * place prevents the two implementations from drifting apart.
 */

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
export const VISION_MAX_DIM = parseInt(process.env.VISION_MAX_DIM || '1280');
export const VISION_QUALITY = parseInt(process.env.VISION_QUALITY || '80');
export const VISION_KEEP_ALIVE = process.env.VISION_KEEP_ALIVE || '10m';
export const VISION_NUM_CTX = parseInt(process.env.VISION_NUM_CTX || '8192');
export const DEFAULT_VISION_MODEL = process.env.VISION_MODEL || 'qwen3-vl:2b';
// Must NOT equal DEFAULT_VISION_MODEL. It used to, which made the fallback a no-op
// retry of the model that had just failed and reported itself as a second backend.
// Measured on an 8 GB card with the desktop holding ~5 GB, gemma4:e2b-it-qat was
// the fastest model that terminated cleanly (41 s, done_reason "stop"); qwen3-vl:4b
// returned empty content at 121 s and minicpm-v:8b did not finish inside 150 s.
// Override with VISION_FALLBACK_MODEL if your machine has more VRAM.
export const VISION_FALLBACK_MODEL = process.env.VISION_FALLBACK_MODEL || 'gemma4:e2b-it-qat';

function baseName(name) {
  return String(name || '').split(':')[0].toLowerCase();
}

export { baseName };

/**
 * Return the names of currently-resident Ollama models that advertise
 * `vision` capability (or have a vision-like basename as fallback).
 */
export async function residentVisionModels() {
  let names = [];
  try {
    const r = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const d = await r.json();
    names = (d.models || []).map((m) => m.name);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if ((d.capabilities || []).includes('vision')) out.push(n);
    } catch {
      const b = baseName(n);
      if (b.includes('vl') || b.includes('vision') || b.includes('minicpm') || b.includes('gemma')) {
        out.push(n);
      }
    }
  }
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
  const preferred = resident.find((n) => n.includes('qwen3-vl') || n.includes('gemma') || n.includes('minicpm'));
  return { model: preferred || resident[0], why: `resident-sticky(${preferred || resident[0]})` };
}

/**
 * Read an image from disk and return a base64-encoded string, resizing
 * with sharp when available so large screenshots stay under Ollama's
 * per-request limits.
 */
export async function encodeImage(imagePath, opts = {}) {
  const { maxDim = VISION_MAX_DIM, quality = VISION_QUALITY } = opts;
  const fs = await import('fs');
  const buffer = fs.readFileSync(imagePath);
  if (buffer.length < 50000) return buffer.toString('base64');

  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return buffer.toString('base64');
  }

  const resized = await sharp(buffer)
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();

  return resized.toString('base64');
}

/**
 * Send a single vision request to Ollama and return the parsed response
 * text.  Retries once on the same model when the output was truncated.
 */
export async function analyzeWithOllama(images, prompt, model, numPredict = 4096, think = false) {
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
    keep_alive: VISION_KEEP_ALIVE,
    options: { num_ctx: VISION_NUM_CTX, num_predict: numPredict },
  };
  if (think) body.think = true;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
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
