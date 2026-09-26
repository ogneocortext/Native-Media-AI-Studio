import { 
  encodeImage, 
  residentVisionModels, 
  resolveVisionModel, 
  analyzeWithOllama,
  baseName,
  OLLAMA_URL,
  VISION_MAX_DIM,
  VISION_QUALITY,
  VISION_KEEP_ALIVE,
  VISION_NUM_CTX,
  DEFAULT_VISION_MODEL,
  VISION_FALLBACK_MODEL
} from '../vision/vision-common.mjs';

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

async function main() {
  console.log('=== vision-common.mjs contract check ===');

  assert(typeof encodeImage === 'function', 'encodeImage is a function');
  assert(typeof residentVisionModels === 'function', 'residentVisionModels is a function');
  assert(typeof resolveVisionModel === 'function', 'resolveVisionModel is a function');
  assert(typeof analyzeWithOllama === 'function', 'analyzeWithOllama is a function');
  assert(typeof baseName === 'function', 'baseName is a function');
  assert(OLLAMA_URL.includes('http'), `OLLAMA_URL is a URL: ${OLLAMA_URL}`);
  assert(VISION_MAX_DIM > 0, `VISION_MAX_DIM positive: ${VISION_MAX_DIM}`);
  assert(VISION_QUALITY > 0 && VISION_QUALITY <= 100, `VISION_QUALITY in range: ${VISION_QUALITY}`);
  assert(VISION_KEEP_ALIVE.includes('m'), `VISION_KEEP_ALIVE has unit: ${VISION_KEEP_ALIVE}`);
  assert(VISION_NUM_CTX >= 1024, `VISION_NUM_CTX sane: ${VISION_NUM_CTX}`);
  assert(DEFAULT_VISION_MODEL.length > 0, `DEFAULT_VISION_MODEL set: ${DEFAULT_VISION_MODEL}`);
  assert(VISION_FALLBACK_MODEL.length > 0, `VISION_FALLBACK_MODEL set: ${VISION_FALLBACK_MODEL}`);

  assert(baseName('qwen3-vl:2b') === 'qwen3-vl', 'baseName strips tag');
  assert(baseName('gemma4:e2b-it-qat') === 'gemma4', 'baseName strips colon tag');

  const r1 = await resolveVisionModel(null);
  assert(r1 && typeof r1.model === 'string' && typeof r1.why === 'string', 
    `resolveVisionModel(null) -> ${JSON.stringify(r1)}`);

  const r2 = await resolveVisionModel('qwen3-vl:2b');
  assert(r2.model === 'qwen3-vl:2b' && r2.why === 'override', 
    `resolveVisionModel(override) -> ${JSON.stringify(r2)}`);

  const resident = await residentVisionModels();
  assert(Array.isArray(resident), `residentVisionModels() is array (${resident.length} resident vision models)`);

  console.log('');
  console.log('=== ollama-tools-mcp.mjs import check ===');

  try {
    const mod = await import('../mcp/ollama-tools-mcp.mjs');
    assert(typeof mod === 'object', 'ollama-tools-mcp.mjs module object imported');
  } catch (e) {
    console.error(`  FAIL: ollama-tools-mcp.mjs import threw: ${e.message}`);
    failed++;
  }

  console.log('');
  console.log('=== analyze.mjs CLI smoke check ===');

  const analyzePath = 'tools/vision/analyze.mjs';
  assert(existsSync(analyzePath), `analyze.mjs exists at ${analyzePath}`);

  // Spawn analyze.mjs with no args; it should print usage and exit non-zero.
  const child = spawn('node', [analyzePath], { cwd: process.cwd() });
  let out = '';
  let err = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => err += d);
  
  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  assert(exitCode !== 0, 'analyze.mjs exits non-zero with no args');
  assert(out.includes('Usage:') || err.includes('Usage:'), 'analyze.mjs prints usage on no args');

  console.log('');
  console.log(`=== Summary: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
